-- OVERRIDE CONTRÔLÉ DU PRIX DE VENTE
--
-- Règle par défaut inchangée : un article catalogue ne se vend jamais en
-- dessous de son prix de vente configuré (business_location_inventory_items
-- .sale_price, via son historique -- voir 20260814140000). Nouvelle
-- exception : un utilisateur possédant la permission
-- commerce.sales.price_override peut vendre à la hausse OU à la baisse,
-- jamais un nom de rôle codé en dur -- la décision dépend uniquement de
-- cette permission, vérifiée côté serveur indépendamment de tout contrôle
-- client. Dans tous les cas, le prix final reste strictement positif (> 0).
--
-- Audit préalable (aucune permission équivalente trouvée : grep de tous les
-- codes 'commerce.*' existants -- commerce.cash.*, commerce.pos.*,
-- commerce.stock.* -- aucun ne couvre le prix de vente).
--
-- Portée couverte par cette migration (audit des endroits où le prix de
-- vente peut être modifié) :
--   1. Caisse / vente comptoir -- _internal_create_commerce_cash_sale_at,
--      le moteur interne partagé par create_commerce_cash_sale (parcours en
--      ligne) ET sync_commerce_pos_offline_sale (vente hors ligne
--      resynchronisée) : un seul endroit à modifier protège les deux.
--   2. Vente commerciale manuelle / facturation -- _internal_upsert_
--      commercial_sale_lines (create_commercial_sale, update_commercial_sale)
--      pour le plancher > 0 au brouillon, et confirm_commercial_sale pour le
--      vrai contrôle de plancher catalogue -- c'est le seul moment où le
--      magasin (donc le prix catalogue applicable) est garanti connu, même
--      motif déjà utilisé par cette même fonction pour re-valider les
--      lignes liées à une récolte au moment de l'engagement réel plutôt
--      qu'au brouillon.
--
-- Non concerné, vérifié : les lignes SERVICE (aucun catalogue de
-- référence, prix libre par conception -- voir 20260814140000) et les
-- lignes liées à une récolte (harvest_id, prix agricole libre, aucun
-- concept de "prix de vente configuré").

-- ---------------------------------------------------------------------------
-- 1) Permission
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (code, module, action, description, sensitivity)
VALUES (
  'commerce.sales.price_override',
  'commerce',
  'sales_price_override',
  'Vendre un article en dessous de son prix de vente configuré (caisse et ventes commerciales).',
  'CRITICAL'
)
ON CONFLICT (code) DO NOTHING;

-- super_admin obtient déjà toute permission automatiquement
-- (current_user_permissions()) -- aucune ligne role_permissions requise
-- pour ce rôle. admin et gestionnaire l'obtiennent explicitement, comme
-- demandé ; caissier (utilisateur "normal") ne l'obtient pas par défaut --
-- c'est précisément le rôle que cette règle doit continuer à contraindre.
-- Tout autre rôle peut se voir accorder cette permission plus tard via la
-- page Rôles & permissions existante (déjà générique, lit cette même table).
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('admin', 'commerce.sales.price_override'),
  ('gestionnaire', 'commerce.sales.price_override')
ON CONFLICT (role, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Caisse / vente comptoir -- moteur interne partagé (en ligne + hors
--    ligne resynchronisée). CREATE OR REPLACE avec la même signature :
--    aucun grant/revoke à refaire (déjà REVOKE ALL FROM PUBLIC, anon,
--    authenticated -- accessible uniquement via les deux relais publics
--    inchangés create_commerce_cash_sale / sync_commerce_pos_offline_sale).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_create_commerce_cash_sale_at(p_sale jsonb, p_effective_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_sale ->> 'business_location_id', '')::uuid;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_wallet_id uuid;
  v_payment_method text := upper(coalesce(NULLIF(btrim(p_sale ->> 'payment_method'), ''), 'CASH'));
  v_reference text := NULLIF(btrim(p_sale ->> 'reference'), '');
  v_notes text := NULLIF(btrim(p_sale ->> 'notes'), '');
  v_cash_session_id text := NULLIF(btrim(p_sale ->> 'cash_session_id'), '');
  v_terminal_id text := NULLIF(btrim(p_sale ->> 'terminal_id'), '');
  v_prior_location_id uuid;
  v_prior_cashier_id uuid;
  v_prior_terminal_id text;
  v_prior_found boolean;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_operation public.finance_operations;
  v_client public.transport_clients;
  v_line jsonb;
  v_item public.inventory_items;
  v_local public.business_location_inventory_items;
  v_line_id uuid;
  v_quantity numeric(14,3);
  v_price numeric(14,2);
  v_requested_quantity numeric(14,3);
  v_total numeric(14,2) := 0;
  v_stock_movement public.stock_movements;
  v_client_label text := 'Client comptoir';
  v_line_type text;
  v_service_name text;
  v_service_note text;
  v_existing_sale_id uuid;
  v_existing_invoice_number text;
  v_existing_payment_id uuid;
  v_existing_operation_id uuid;
  v_existing_amount numeric(14,2);
  v_floor_price numeric(14,2);
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF p_sale IS NULL
    OR jsonb_typeof(p_sale) <> 'object'
    OR jsonb_typeof(p_sale -> 'lines') <> 'array'
    OR jsonb_array_length(p_sale -> 'lines') = 0 THEN
    RAISE EXCEPTION 'La vente caisse doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  IF p_effective_at IS NULL THEN
    RAISE EXCEPTION 'Date d''effet de vente invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_location_id IS NULL OR NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  -- A retry for the same persisted ticket returns its original receipt. This
  -- runs before any stock, invoice, finance or wallet mutation.
  IF v_reference IS NOT NULL AND v_reference LIKE 'POS:%' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':' || v_reference, 0));

    SELECT sale.id, invoice.invoice_number, payment.id, operation.id, payment.amount
    INTO v_existing_sale_id, v_existing_invoice_number, v_existing_payment_id, v_existing_operation_id, v_existing_amount
    FROM public.commercial_sales AS sale
    JOIN public.commercial_invoices AS invoice ON invoice.sale_id = sale.id
    JOIN public.commercial_invoice_payments AS payment ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
    JOIN public.finance_commercial_invoice_payment_links AS payment_link ON payment_link.payment_id = payment.id AND payment_link.link_type = 'PAYMENT'
    JOIN public.finance_operations AS operation ON operation.id = payment_link.operation_id AND operation.status <> 'CANCELLED'
    WHERE sale.business_location_id = v_location_id
      AND sale.reference = v_reference
      AND sale.status = 'CONFIRMED'
    ORDER BY payment.confirmed_at DESC NULLS LAST, payment.created_at DESC
    LIMIT 1;

    IF v_existing_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'saleId', v_existing_sale_id,
        'saleNumber', (SELECT sale_number FROM public.commercial_sales WHERE id = v_existing_sale_id),
        'invoiceNumber', v_existing_invoice_number,
        'paymentId', v_existing_payment_id,
        'operationId', v_existing_operation_id,
        'amount', v_existing_amount
      );
    END IF;
  END IF;

  -- POS-06 session/terminal attribution. Never trusted blindly: re-validated
  -- against any prior sale or offline receipt already using this session id.
  IF (v_cash_session_id IS NULL) <> (v_terminal_id IS NULL) THEN
    RAISE EXCEPTION 'La session de caisse et le terminal doivent être fournis ensemble.' USING ERRCODE = '22023';
  END IF;

  IF v_cash_session_id IS NOT NULL THEN
    IF v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$' OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$' THEN
      RAISE EXCEPTION 'Identifiant de session ou de terminal invalide.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.commerce_pos_cash_session_closures closure_row
      WHERE closure_row.cash_session_id = v_cash_session_id
    ) THEN
      RAISE EXCEPTION 'Cette session de caisse est déjà clôturée.' USING ERRCODE = '22023';
    END IF;

    SELECT sale.business_location_id, sale.created_by, sale.terminal_id
    INTO v_prior_location_id, v_prior_cashier_id, v_prior_terminal_id
    FROM public.commercial_sales AS sale
    WHERE sale.cash_session_id = v_cash_session_id
    LIMIT 1;
    v_prior_found := FOUND;

    IF NOT v_prior_found THEN
      SELECT receipt.business_location_id, receipt.cashier_user_id, receipt.terminal_id
      INTO v_prior_location_id, v_prior_cashier_id, v_prior_terminal_id
      FROM public.commerce_pos_offline_receipts AS receipt
      WHERE receipt.cash_session_id = v_cash_session_id
      LIMIT 1;
      v_prior_found := FOUND;
    END IF;

    IF v_prior_found AND (
      v_prior_location_id IS DISTINCT FROM v_location_id
      OR v_prior_cashier_id IS DISTINCT FROM auth.uid()
      OR v_prior_terminal_id IS DISTINCT FROM v_terminal_id
    ) THEN
      RAISE EXCEPTION 'Cette session de caisse appartient à un autre magasin, caissier ou terminal.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT location_wallet.wallet_id
  INTO v_wallet_id
  FROM public.business_location_wallets AS location_wallet
  WHERE location_wallet.business_location_id = v_location_id
    AND location_wallet.purpose = 'CASH_DRAWER'
    AND location_wallet.is_active
    AND location_wallet.is_primary
  ORDER BY location_wallet.assigned_at DESC
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet principal de caisse n’est configuré pour ce point de vente.' USING ERRCODE = '23503';
  END IF;

  IF v_client_id IS NOT NULL THEN
    SELECT * INTO v_client
    FROM public.transport_clients
    WHERE id = v_client_id AND status = 'ACTIVE';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Client actif introuvable.' USING ERRCODE = '23503';
    END IF;
    v_client_label := v_client.display_name;
  END IF;

  IF v_payment_method NOT IN ('CASH', 'WAVE', 'JEKO', 'CARD', 'OTHER') THEN
    RAISE EXCEPTION 'Moyen de paiement invalide.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_line_type := upper(coalesce(NULLIF(btrim(v_line ->> 'line_type'), ''), 'ARTICLE'));
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_price := NULLIF(v_line ->> 'unit_price', '')::numeric;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Quantité ou prix de vente invalide.' USING ERRCODE = '22023';
    END IF;

    IF v_line_type = 'ARTICLE' THEN
      -- OVERRIDE PRIX DE VENTE : un article catalogue se vend toujours à un
      -- prix strictement positif, avec ou sans permission de baisse -- le
      -- contrôle partagé juste au-dessus (`< 0`) laissait passer 0, et
      -- reste volontairement inchangé pour ne pas affecter les lignes
      -- SERVICE (prix libre par conception, aucun plancher catalogue).
      IF v_price <= 0 THEN
        RAISE EXCEPTION 'Le prix de vente doit être strictement supérieur à 0.' USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_local
      FROM public.business_location_inventory_items
      WHERE business_location_id = v_location_id
        AND inventory_item_id = NULLIF(v_line ->> 'inventory_item_id', '')::uuid
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Article indisponible dans ce magasin.' USING ERRCODE = '22023';
      END IF;

      -- Prix plancher : jamais celui envoyé par le client. La borne
      -- appliquée est celle en vigueur à p_effective_at (maintenant en
      -- ligne ; l'horodatage de la vente hors ligne originale lors d'une
      -- resynchronisation) -- jamais celle du jour si la vente a réellement
      -- eu lieu avant une hausse de prix ultérieure.
      SELECT history.sale_price INTO v_floor_price
      FROM public.business_location_inventory_item_price_history AS history
      WHERE history.business_location_id = v_location_id
        AND history.inventory_item_id = v_local.inventory_item_id
        AND history.effective_from <= p_effective_at
      ORDER BY history.effective_from DESC
      LIMIT 1;

      -- OVERRIDE PRIX DE VENTE : seule une permission explicite autorise un
      -- prix sous ce plancher -- jamais un nom de rôle codé en dur. La
      -- règle par défaut (jamais en dessous) reste inchangée pour
      -- quiconque n'a pas commerce.sales.price_override.
      IF v_floor_price IS NOT NULL AND v_price < v_floor_price
        AND NOT public.user_has_permission('commerce.sales.price_override') THEN
        RAISE EXCEPTION 'Le prix de vente ne peut pas être inférieur au prix catalogue de % FCFA.', v_floor_price USING ERRCODE = '22023';
      END IF;

      SELECT coalesce(sum((source_line.value ->> 'quantity')::numeric), 0)
      INTO v_requested_quantity
      FROM jsonb_array_elements(p_sale -> 'lines') AS source_line(value)
      WHERE upper(coalesce(NULLIF(btrim(source_line.value ->> 'line_type'), ''), 'ARTICLE')) = 'ARTICLE'
        AND source_line.value ->> 'inventory_item_id' = v_line ->> 'inventory_item_id';

      IF v_local.quantity < v_requested_quantity THEN
        RAISE EXCEPTION 'Quantité indisponible dans ce magasin.' USING ERRCODE = '22023';
      END IF;
    ELSIF v_line_type = 'SERVICE' THEN
      v_service_name := NULLIF(btrim(coalesce(v_line ->> 'service_name', v_line ->> 'description')), '');
      v_service_note := NULLIF(btrim(v_line ->> 'service_note'), '');
      IF v_service_name IS NULL OR length(v_service_name) > 160 OR length(coalesce(v_service_note, '')) > 1000
        OR NULLIF(v_line ->> 'inventory_item_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Service invalide : désignation, note ou source article non conforme.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Type de ligne caisse invalide.' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + round(v_quantity * v_price, 2);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Le total de la vente doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commercial_sales (
    sale_number, status, client_id, sale_date, reference, notes,
    business_unit_id, business_location_id, created_by, updated_by, confirmed_at,
    cash_session_id, terminal_id
  )
  SELECT public._internal_next_commercial_sale_number(), 'CONFIRMED', v_client_id,
    current_date, v_reference, v_notes, unit_row.id, v_location_id,
    auth.uid(), auth.uid(), now(), v_cash_session_id, v_terminal_id
  FROM public.business_locations AS location_row
  JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = v_location_id
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_line_type := upper(coalesce(NULLIF(btrim(v_line ->> 'line_type'), ''), 'ARTICLE'));
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_price := (v_line ->> 'unit_price')::numeric;

    IF v_line_type = 'ARTICLE' THEN
      SELECT * INTO v_item FROM public.inventory_items WHERE id = (v_line ->> 'inventory_item_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Article introuvable.' USING ERRCODE = '23503';
      END IF;

      SELECT history.sale_price INTO v_floor_price
      FROM public.business_location_inventory_item_price_history AS history
      WHERE history.business_location_id = v_location_id
        AND history.inventory_item_id = v_item.id
        AND history.effective_from <= p_effective_at
      ORDER BY history.effective_from DESC
      LIMIT 1;

      INSERT INTO public.commercial_sale_lines (
        sale_id, line_type, description, quantity, unit, unit_price, line_total, inventory_item_id, catalog_price_at_sale
      ) VALUES (
        v_sale.id, 'ARTICLE', v_item.nom, v_quantity, coalesce(v_item.unite, 'UNITE'),
        v_price, round(v_quantity * v_price, 2), v_item.id, v_floor_price
      ) RETURNING id INTO v_line_id;

      UPDATE public.business_location_inventory_items
      SET quantity = quantity - v_quantity, updated_at = now()
      WHERE business_location_id = v_location_id AND inventory_item_id = v_item.id;

      UPDATE public.inventory_items
      SET stock_actuel = stock_actuel - v_quantity, updated_at = now()
      WHERE id = v_item.id;

      INSERT INTO public.stock_movements (
        inventory_item_id, movement_type, quantity, unit_price, wallet_id,
        movement_date, client, reference, description, status, created_by, business_location_id
      ) VALUES (
        v_item.id, 'SALE', v_quantity, v_price, v_wallet_id, current_date,
        v_client_label, v_sale.sale_number, 'Vente caisse ' || v_sale.sale_number,
        'VALID', auth.uid(), v_location_id
      ) RETURNING * INTO v_stock_movement;

      INSERT INTO public.commercial_sale_stock_movement_links (sale_line_id, stock_movement_id)
      VALUES (v_line_id, v_stock_movement.id);
    ELSE
      v_service_name := NULLIF(btrim(coalesce(v_line ->> 'service_name', v_line ->> 'description')), '');
      v_service_note := NULLIF(btrim(v_line ->> 'service_note'), '');
      INSERT INTO public.commercial_sale_lines (
        sale_id, line_type, description, quantity, unit, unit_price, line_total, service_note
      ) VALUES (
        v_sale.id, 'SERVICE', v_service_name, v_quantity, 'SERVICE',
        v_price, round(v_quantity * v_price, 2), v_service_note
      );
    END IF;
  END LOOP;

  INSERT INTO public.commercial_invoices (
    invoice_number, sale_id, client_id, status, issue_date, issued_at,
    subtotal_amount, tax_rate, tax_amount, total_amount, created_by, updated_by
  ) VALUES (
    public._internal_next_commercial_invoice_number(), v_sale.id, v_client_id,
    'PAID', current_date, now(), v_total, 0, 0, v_total, auth.uid(), auth.uid()
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.commercial_invoice_payments (
    invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind,
    reference, notes, created_by, updated_by, confirmed_at
  ) VALUES (
    v_invoice.id, v_sale.id, v_wallet_id, v_total, current_date, 'CONFIRMED',
    'PAYMENT', coalesce(v_reference, v_sale.sale_number), v_notes,
    auth.uid(), auth.uid(), now()
  ) RETURNING * INTO v_payment;

  INSERT INTO public.finance_operations (
    wallet_id, type, amount, operation_date, category, description, reference,
    status, origin, module, module_id, payment_method, client, created_by
  ) VALUES (
    v_wallet_id, 'REVENUE', v_total, current_date, 'VENTE MAGASIN',
    'Encaissement caisse ' || v_invoice.invoice_number,
    coalesce(v_reference, v_payment.id::text), 'VALIDE', 'COMMERCE_POS_PAYMENT',
    'COMMERCIAL_INVOICE_PAYMENT', v_payment.id, v_payment_method,
    v_client_label, auth.uid()
  ) RETURNING * INTO v_operation;

  INSERT INTO public.finance_links (finance_operation_id, module, module_record_id)
  VALUES (v_operation.id, 'COMMERCIAL_INVOICE_PAYMENT', v_payment.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.finance_commercial_invoice_payment_links (payment_id, operation_id, link_type)
  VALUES (v_payment.id, v_operation.id, 'PAYMENT');

  PERFORM public.update_wallet_balance(v_wallet_id);
  PERFORM public.business_finance_audit_event(
    'COMMERCIAL_SALE', v_sale.id, v_operation.id, 'CREATE', NULL,
    jsonb_build_object('sale', to_jsonb(v_sale), 'invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment))
  );

  RETURN jsonb_build_object(
    'saleId', v_sale.id,
    'saleNumber', v_sale.sale_number,
    'invoiceNumber', v_invoice.invoice_number,
    'paymentId', v_payment.id,
    'operationId', v_operation.id,
    'amount', v_total
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Vente commerciale manuelle -- plancher > 0 au brouillon (le magasin,
--    donc le prix catalogue applicable, n'est pas garanti connu à ce stade
--    -- create_commercial_sale accepte business_location_id en optionnel).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_upsert_commercial_sale_lines(p_sale_id uuid, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_line jsonb;
  v_count integer := 0;
  v_description text;
  v_quantity numeric(14, 3);
  v_unit text;
  v_unit_price numeric(14, 2);
  v_inventory_item_id uuid;
  v_harvest_id uuid;
  v_farm_id uuid;
  v_harvest public.harvests;
  v_already_sold numeric(14, 3);
  v_remaining numeric(14, 3);
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.commercial_sale_lines WHERE sale_id = p_sale_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_line) AS key_name
      WHERE key_name NOT IN ('description', 'quantity', 'unit', 'unit_price', 'inventory_item_id', 'harvest_id', 'farm_id')
    ) THEN
      RAISE EXCEPTION 'Une ligne de vente contient une propriété non autorisée.' USING ERRCODE = '22023';
    END IF;

    v_description := NULLIF(btrim(v_line ->> 'description'), '');
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_unit := COALESCE(NULLIF(btrim(v_line ->> 'unit'), ''), 'UNITE');
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
    v_inventory_item_id := NULLIF(v_line ->> 'inventory_item_id', '')::uuid;
    v_harvest_id := NULLIF(v_line ->> 'harvest_id', '')::uuid;
    v_farm_id := NULLIF(v_line ->> 'farm_id', '')::uuid;

    IF v_description IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit posséder un libellé, une quantité positive et un prix unitaire valide.' USING ERRCODE = '22023';
    END IF;
    -- OVERRIDE PRIX DE VENTE : une ligne liée à un article catalogue doit
    -- toujours porter un prix strictement positif (0 passait le contrôle
    -- partagé ci-dessus) -- vérifié ici sans permission car il ne s'agit
    -- pas du plancher catalogue lui-même (voir confirm_commercial_sale,
    -- seul endroit où le magasin, donc le prix catalogue, est garanti
    -- connu). Les lignes récolte/libres ne sont pas concernées.
    IF v_inventory_item_id IS NOT NULL AND v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Le prix de vente doit être strictement supérieur à 0.' USING ERRCODE = '22023';
    END IF;
    IF v_inventory_item_id IS NOT NULL AND v_harvest_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une ligne ne peut pas référencer simultanément un article et une récolte.' USING ERRCODE = '22023';
    END IF;
    IF v_inventory_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = v_inventory_item_id) THEN
      RAISE EXCEPTION 'Article de stock introuvable.' USING ERRCODE = '23503';
    END IF;

    IF v_harvest_id IS NOT NULL THEN
      SELECT * INTO v_harvest FROM public.harvests WHERE id = v_harvest_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = '23503';
      END IF;
      IF v_harvest.status NOT IN ('DELIVERED', 'CLOSED') THEN
        RAISE EXCEPTION 'Cette récolte doit être livrée ou clôturée avant de pouvoir être vendue (statut actuel : %).', v_harvest.status USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.finance_harvest_links WHERE harvest_id = v_harvest_id) THEN
        RAISE EXCEPTION 'Cette récolte a déjà été vendue via l''ancien circuit direct -- vente GFC impossible pour cette récolte.' USING ERRCODE = '22023';
      END IF;

      SELECT COALESCE(sum(csl.quantity), 0) INTO v_already_sold
      FROM public.commercial_sale_lines csl
      JOIN public.commercial_sales cs ON cs.id = csl.sale_id
      WHERE csl.harvest_id = v_harvest_id AND cs.status = 'CONFIRMED';

      v_remaining := COALESCE(v_harvest.poids_livre_kg, 0) - v_already_sold;
      IF v_quantity > v_remaining THEN
        RAISE EXCEPTION 'Quantité vendue (% kg) supérieure à la quantité restante vendable de cette récolte (% kg restant sur % kg livré, % kg déjà vendu).',
          v_quantity, v_remaining, v_harvest.poids_livre_kg, v_already_sold USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
      RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.commercial_sale_lines(
      sale_id, description, quantity, unit, unit_price, line_total,
      inventory_item_id, harvest_id, farm_id
    ) VALUES (
      p_sale_id, v_description, v_quantity, v_unit, v_unit_price,
      round(v_quantity * v_unit_price, 2), v_inventory_item_id, v_harvest_id, v_farm_id
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) confirm_commercial_sale -- le vrai contrôle de plancher catalogue,
--    exactement au moment où business_location_id devient obligatoire
--    (donc où le prix catalogue applicable est enfin connu) et où le stock
--    est réellement débité -- même moment que la re-validation déjà
--    existante des lignes récolte. catalog_price_at_sale est renseigné ici
--    (jamais à l'upsert de brouillon, pour la même raison) : même colonne
--    d'audit que le parcours caisse (20260814140000), pas une deuxième
--    architecture.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_commercial_sale(p_sale_id uuid)
 RETURNS commercial_sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.commercial_sales;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_client_label text := 'Client comptoir';
  v_line record;
  v_harvest_line record;
  v_harvest public.harvests;
  v_already_sold numeric(14, 3);
  v_price_line record;
  v_floor_price numeric(14, 2);
BEGIN
  PERFORM public.permission_require('sales.update');
  SELECT * INTO v_before FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une vente brouillon peut être confirmée.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sale_lines WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.commercial_sale_lines WHERE sale_id = p_sale_id AND line_type = 'ARTICLE' AND inventory_item_id IS NOT NULL) THEN
    IF v_before.business_location_id IS NULL THEN
      RAISE EXCEPTION 'Un magasin est requis pour confirmer une vente contenant des articles de stock.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
      RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- OVERRIDE PRIX DE VENTE : même règle que la caisse (create_commerce_
  -- cash_sale) -- jamais en dessous du prix catalogue configuré pour ce
  -- magasin, sauf permission explicite commerce.sales.price_override.
  -- catalog_price_at_sale est renseigné pour chaque ligne, même quand le
  -- prix est conforme -- même colonne d'audit que le parcours caisse.
  FOR v_price_line IN
    SELECT csl.id, csl.inventory_item_id, csl.unit_price
    FROM public.commercial_sale_lines csl
    WHERE csl.sale_id = p_sale_id AND csl.line_type = 'ARTICLE' AND csl.inventory_item_id IS NOT NULL
  LOOP
    SELECT local_item.sale_price INTO v_floor_price
    FROM public.business_location_inventory_items AS local_item
    WHERE local_item.business_location_id = v_before.business_location_id
      AND local_item.inventory_item_id = v_price_line.inventory_item_id;

    IF v_floor_price IS NOT NULL AND v_price_line.unit_price < v_floor_price
      AND NOT public.user_has_permission('commerce.sales.price_override') THEN
      RAISE EXCEPTION 'Le prix de vente ne peut pas être inférieur au prix catalogue de % FCFA.', v_floor_price USING ERRCODE = '22023';
    END IF;

    UPDATE public.commercial_sale_lines SET catalog_price_at_sale = v_floor_price WHERE id = v_price_line.id;
  END LOOP;

  -- Re-validate harvest-linked lines at the moment of real commitment, with a
  -- row lock on the harvest: closes the race where two DRAFT sales for the
  -- same harvest are both created before either is confirmed (each would
  -- pass the draft-time check in _internal_upsert_commercial_sale_lines
  -- since neither counted as CONFIRMED yet).
  FOR v_harvest_line IN
    SELECT csl.harvest_id, csl.quantity
    FROM public.commercial_sale_lines csl
    WHERE csl.sale_id = p_sale_id AND csl.harvest_id IS NOT NULL
  LOOP
    SELECT * INTO v_harvest FROM public.harvests WHERE id = v_harvest_line.harvest_id FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.finance_harvest_links WHERE harvest_id = v_harvest_line.harvest_id) THEN
      RAISE EXCEPTION 'Cette récolte a déjà été vendue via l''ancien circuit direct -- confirmation impossible pour cette vente.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(sum(csl2.quantity), 0) INTO v_already_sold
    FROM public.commercial_sale_lines csl2
    JOIN public.commercial_sales cs2 ON cs2.id = csl2.sale_id
    WHERE csl2.harvest_id = v_harvest_line.harvest_id AND cs2.status = 'CONFIRMED';

    IF v_harvest_line.quantity > (COALESCE(v_harvest.poids_livre_kg, 0) - v_already_sold) THEN
      RAISE EXCEPTION 'Quantité vendue (% kg) supérieure à la quantité restante vendable de cette récolte (% kg restant).',
        v_harvest_line.quantity, COALESCE(v_harvest.poids_livre_kg, 0) - v_already_sold USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_before.client_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.transport_clients WHERE id = v_before.client_id;
    IF FOUND THEN v_client_label := v_client.display_name; END IF;
  END IF;

  UPDATE public.commercial_sales
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT id FROM public.commercial_sale_lines WHERE sale_id = p_sale_id AND line_type = 'ARTICLE' AND inventory_item_id IS NOT NULL
  LOOP
    PERFORM public._internal_apply_commercial_sale_line_stock_exit(
      v_line.id, v_sale.business_location_id, NULL, v_sale.sale_number,
      'Vente ' || v_sale.sale_number, v_client_label
    );
  END LOOP;

  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;
