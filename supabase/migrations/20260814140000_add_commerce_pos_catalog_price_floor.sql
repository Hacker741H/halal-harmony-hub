-- Mission caisse-UX -- prix plancher catalogue : le prix de vente encaisse
-- par le caissier ne peut jamais etre inferieur au prix catalogue, mais peut
-- toujours etre augmente volontairement. Le serveur relit lui-meme le prix
-- catalogue autoritaire -- il ne fait jamais confiance a un prix envoye par
-- le navigateur. Une politique deterministe protege les ventes hors ligne
-- deja legitimes lorsque le catalogue change pendant la periode offline :
-- la borne appliquee est celle qui etait effectivement en vigueur au moment
-- de la vente (created_at_device), jamais le prix courant au moment de la
-- synchronisation.
--
-- Les services (ligne SERVICE) n'ont aucun catalogue de reference dans ce
-- systeme -- desigation et prix sont saisis librement par le caissier a
-- chaque vente (voir 20260811140000_add_pos_services_and_suspended_tickets.sql).
-- Aucune borne n'est donc appliquee aux lignes SERVICE : il n'existe rien
-- contre quoi la comparer, et en inventer un catalogue fictif serait une
-- architecture non demandee.

-- ---------------------------------------------------------------------------
-- 1) Historique des prix catalogue -- necessaire pour honorer une vente hors
--    ligne faite de bonne foi avant un changement de prix ulterieur, sans
--    jamais se fier a une valeur envoyee par le client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_location_inventory_item_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  sale_price numeric(14, 2) CHECK (sale_price IS NULL OR sale_price >= 0),
  effective_from timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_location_inventory_item_price_history_lookup_idx
  ON public.business_location_inventory_item_price_history (business_location_id, inventory_item_id, effective_from DESC);

ALTER TABLE public.business_location_inventory_item_price_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.business_location_inventory_item_price_history IS
  'Historique des prix catalogue par magasin/article. Alimente uniquement par le trigger ci-dessous. Sert a determiner le prix plancher effectivement en vigueur au moment (passe) d''une vente hors ligne -- jamais accessible directement au client.';

-- Ligne de base pour chaque article deja catalogue : "voici le prix connu a
-- partir de maintenant". N'invente aucune donnee anterieure -- une vente
-- hors ligne deja en file d'attente, faite avant ce deploiement, ne trouvera
-- donc aucun historique a cette date et ne se verra pas retroactivement
-- bloquee (voir la clause "v_floor_price IS NOT NULL" plus bas).
INSERT INTO public.business_location_inventory_item_price_history (business_location_id, inventory_item_id, sale_price, effective_from)
SELECT business_location_id, inventory_item_id, sale_price, now()
FROM public.business_location_inventory_items;

CREATE OR REPLACE FUNCTION public._internal_track_business_location_inventory_item_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.sale_price IS DISTINCT FROM OLD.sale_price THEN
    -- clock_timestamp(), not now(): a price changed twice within the same
    -- transaction must still record two distinct, correctly ordered points
    -- in history rather than colliding on the transaction's start time.
    INSERT INTO public.business_location_inventory_item_price_history (business_location_id, inventory_item_id, sale_price, effective_from)
    VALUES (NEW.business_location_id, NEW.inventory_item_id, NEW.sale_price, clock_timestamp());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_track_business_location_inventory_item_price ON public.business_location_inventory_items;
CREATE TRIGGER trg_track_business_location_inventory_item_price
AFTER INSERT OR UPDATE OF sale_price ON public.business_location_inventory_items
FOR EACH ROW EXECUTE FUNCTION public._internal_track_business_location_inventory_item_price();

-- ---------------------------------------------------------------------------
-- 2) Tracabilite du surprix -- le prix plancher applique est fige sur la
--    ligne de vente au moment de l'encaissement. C'est une donnee d'audit :
--    le CA reste le prix reellement vendu, jamais une seconde ecriture.
-- ---------------------------------------------------------------------------
ALTER TABLE public.commercial_sale_lines
  ADD COLUMN IF NOT EXISTS catalog_price_at_sale numeric(14, 2);

COMMENT ON COLUMN public.commercial_sale_lines.catalog_price_at_sale IS
  'Prix plancher catalogue effectivement applique au moment de la vente (NULL pour les lignes SERVICE, qui n''ont pas de catalogue, et pour les lignes anterieures a cette fonctionnalite -- jamais reconstruit par heuristique). unit_price - catalog_price_at_sale, lorsque positif, est le surprix : une information d''audit, pas une seconde recette.';

-- ---------------------------------------------------------------------------
-- 3) create_commerce_cash_sale devient un mince relais public vers une
--    fonction interne parametree par la date d'effet du controle de prix :
--    clock_timestamp() pour le parcours en ligne (jamais autre chose, jamais
--    fourni par le client), et created_at_device pour une vente hors ligne resynchronisee
--    -- uniquement accessible depuis sync_commerce_pos_offline_sale, jamais
--    exposee directement a un client authentifie (sinon n'importe quel
--    caissier pourrait antidater sa propre vente pour retomber sur un ancien
--    prix plus bas : exactement le contournement que ce controle doit empecher).
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

      IF v_floor_price IS NOT NULL AND v_price < v_floor_price THEN
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

REVOKE ALL ON FUNCTION public._internal_create_commerce_cash_sale_at(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

-- Public entrypoint used directly by the online cashier checkout. Always
-- pins the price-floor check to this instant -- p_effective_at is never
-- something a client can influence, online or otherwise.
CREATE OR REPLACE FUNCTION public.create_commerce_cash_sale(p_sale jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  -- clock_timestamp(), not now(): the floor must be the price truly in
  -- effect this instant, immune to now()'s transaction-start freeze (a
  -- price change committed earlier must always be visible to a later sale).
  RETURN public._internal_create_commerce_cash_sale_at(p_sale, clock_timestamp());
END;
$function$;

REVOKE ALL ON FUNCTION public.create_commerce_cash_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_cash_sale(jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_commerce_cash_sale(jsonb) IS
  'Encaissement caisse en ligne. Relais mince vers _internal_create_commerce_cash_sale_at(p_sale, clock_timestamp()) -- le prix plancher catalogue est toujours verifie sur le prix EN VIGUEUR MAINTENANT, jamais sur une date fournie par le client.';

-- ---------------------------------------------------------------------------
-- 4) sync_commerce_pos_offline_sale appelle desormais la fonction interne
--    directement avec l'horodatage reel de la vente (created_at_device),
--    afin qu'un changement de prix survenu pendant la periode hors ligne ne
--    corrompe jamais retroactivement une vente hors ligne deja legitime.
--    Le reste de la fonction est inchange (idempotence, conflits de stock,
--    price_divergence informatif deja existant).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_commerce_pos_offline_sale(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_offline_sale_id text := NULLIF(btrim(p_event ->> 'offline_sale_id'), '');
  v_terminal_id text := NULLIF(btrim(p_event ->> 'terminal_id'), '');
  v_cash_session_id text := NULLIF(btrim(p_event ->> 'cash_session_id'), '');
  v_location_id uuid := NULLIF(p_event ->> 'business_location_id', '')::uuid;
  v_claimed_user_id uuid := NULLIF(p_event ->> 'cashier_user_id', '')::uuid;
  v_created_at_device timestamptz := NULLIF(p_event ->> 'created_at_device', '')::timestamptz;
  v_payload jsonb := p_event -> 'payload';
  v_payload_hash text;
  v_existing public.commerce_pos_offline_receipts;
  v_line jsonb;
  v_line_type text;
  v_item_id uuid;
  v_quantity numeric(14, 3);
  v_unit_price numeric(14, 2);
  v_total numeric(14, 2) := 0;
  v_reported_total numeric(14, 2);
  v_cash_received numeric(14, 2);
  v_change_due numeric(14, 2);
  v_client_id uuid;
  v_current_price numeric(14, 2);
  v_price_divergence jsonb := '[]'::jsonb;
  v_stock_conflicts jsonb;
  v_sale_payload jsonb;
  v_sale_result jsonb;
  v_receipt public.commerce_pos_offline_receipts;
  v_invoice_id uuid;
  v_error_code text;
  v_error_message text;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour synchroniser la caisse.' USING ERRCODE = '42501';
  END IF;

  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Événement hors connexion invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_offline_sale_id IS NULL OR v_offline_sale_id !~ '^[A-Za-z0-9_-]{8,120}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_claimed_user_id IS NULL OR v_created_at_device IS NULL THEN
    RAISE EXCEPTION 'Identifiants de synchronisation caisse invalides.' USING ERRCODE = '22023';
  END IF;

  IF v_claimed_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Le caissier de l’événement ne correspond pas à la session connectée.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_payload ->> 'payment_method', '') <> 'CASH'
    OR jsonb_typeof(v_payload -> 'lines') <> 'array'
    OR jsonb_array_length(v_payload -> 'lines') = 0
    OR jsonb_array_length(v_payload -> 'lines') > 100 THEN
    RAISE EXCEPTION 'Seules les ventes espèces hors connexion valides peuvent être synchronisées.' USING ERRCODE = '22023';
  END IF;

  v_payload_hash := md5(p_event::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':offline:' || v_offline_sale_id, 0));

  SELECT * INTO v_existing
  FROM public.commerce_pos_offline_receipts
  WHERE offline_sale_id = v_offline_sale_id;

  IF FOUND THEN
    IF v_existing.payload_hash <> v_payload_hash
      OR v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Identifiant de vente hors connexion déjà utilisé avec un contenu différent.' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'receiptId', v_existing.id,
      'status', v_existing.status,
      'saleId', v_existing.server_sale_id,
      'saleNumber', (SELECT sale_number FROM public.commercial_sales WHERE id = v_existing.server_sale_id),
      'invoiceNumber', (SELECT invoice_number FROM public.commercial_invoices WHERE id = v_existing.server_invoice_id),
      'paymentId', v_existing.server_payment_id,
      'operationId', v_existing.server_operation_id,
      'amount', v_existing.amount,
      'errorCode', v_existing.error_code,
      'errorMessage', v_existing.error_message
    );
  END IF;

  v_client_id := NULLIF(v_payload ->> 'client_id', '')::uuid;
  v_reported_total := NULLIF(v_payload ->> 'total', '')::numeric;
  v_cash_received := NULLIF(v_payload ->> 'cash_received', '')::numeric;
  v_change_due := NULLIF(v_payload ->> 'change_due', '')::numeric;

  IF v_reported_total IS NULL OR v_reported_total <= 0 OR (v_cash_received IS NOT NULL AND v_cash_received < 0)
    OR (v_change_due IS NOT NULL AND v_change_due < 0) THEN
    RAISE EXCEPTION 'Montants de caisse hors connexion invalides.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload -> 'lines') LOOP
    v_line_type := upper(coalesce(NULLIF(btrim(v_line ->> 'line_type'), ''), 'ARTICLE'));
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Quantité ou prix hors connexion invalide.' USING ERRCODE = '22023';
    END IF;

    IF v_line_type = 'ARTICLE' THEN
      v_item_id := NULLIF(v_line ->> 'inventory_item_id', '')::uuid;
      IF v_item_id IS NULL THEN
        RAISE EXCEPTION 'Article hors connexion invalide.' USING ERRCODE = '22023';
      END IF;

      SELECT local_item.sale_price
      INTO v_current_price
      FROM public.business_location_inventory_items AS local_item
      WHERE local_item.business_location_id = v_location_id
        AND local_item.inventory_item_id = v_item_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Article indisponible dans ce magasin.' USING ERRCODE = '22023';
      END IF;

      IF v_current_price IS DISTINCT FROM v_unit_price THEN
        v_price_divergence := v_price_divergence || jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_item_id,
          'captured_unit_price', v_unit_price,
          'current_unit_price', v_current_price
        ));
      END IF;
    ELSIF v_line_type = 'SERVICE' THEN
      IF NULLIF(btrim(coalesce(v_line ->> 'service_name', v_line ->> 'description')), '') IS NULL
        OR length(coalesce(v_line ->> 'service_name', v_line ->> 'description', '')) > 160
        OR length(coalesce(v_line ->> 'service_note', '')) > 1000
        OR NULLIF(v_line ->> 'inventory_item_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Service hors connexion invalide.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Type de ligne hors connexion invalide.' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + round(v_quantity * v_unit_price, 2);
  END LOOP;

  IF round(v_total, 2) <> round(v_reported_total, 2)
    OR (v_cash_received IS NOT NULL AND v_cash_received < v_total)
    OR (v_change_due IS NOT NULL AND round(v_change_due, 2) <> round(greatest(coalesce(v_cash_received, v_total) - v_total, 0), 2)) THEN
    RAISE EXCEPTION 'Le total espèces hors connexion ne correspond pas aux lignes du ticket.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_item_id', requested.inventory_item_id,
    'requested_quantity', requested.requested_quantity,
    'available_quantity', requested.available_quantity
  )), '[]'::jsonb)
  INTO v_stock_conflicts
  FROM (
    SELECT (source_line.value ->> 'inventory_item_id')::uuid AS inventory_item_id,
      sum((source_line.value ->> 'quantity')::numeric) AS requested_quantity,
      local_item.quantity AS available_quantity
    FROM jsonb_array_elements(v_payload -> 'lines') AS source_line(value)
    JOIN public.business_location_inventory_items AS local_item
      ON local_item.business_location_id = v_location_id
      AND local_item.inventory_item_id = (source_line.value ->> 'inventory_item_id')::uuid
    WHERE upper(coalesce(NULLIF(btrim(source_line.value ->> 'line_type'), ''), 'ARTICLE')) = 'ARTICLE'
    GROUP BY source_line.value ->> 'inventory_item_id', local_item.quantity
    HAVING local_item.quantity < sum((source_line.value ->> 'quantity')::numeric)
  ) AS requested;

  IF jsonb_array_length(v_stock_conflicts) > 0 THEN
    INSERT INTO public.commerce_pos_offline_receipts (
      offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
      status, payload_hash, payload, created_at_device, amount, price_divergence,
      error_code, error_message
    ) VALUES (
      v_offline_sale_id, v_terminal_id, v_cash_session_id, v_location_id, auth.uid(),
      'CONFLICT', v_payload_hash, p_event, v_created_at_device, v_total, v_price_divergence,
      'STOCK_CONFLICT', 'Le stock serveur ne couvre plus le ticket espèces hors connexion.'
    ) RETURNING * INTO v_receipt;

    PERFORM public.business_finance_audit_event(
      'COMMERCE_POS_OFFLINE_RECEIPT', v_receipt.id, NULL, 'CREATE', NULL,
      jsonb_build_object(
        'event_type', 'OFFLINE_SYNC',
        'sync_status', 'CONFLICT',
        'offline_sale_id', v_offline_sale_id,
        'stock_conflicts', v_stock_conflicts
      )
    );

    RETURN jsonb_build_object(
      'receiptId', v_receipt.id,
      'status', 'CONFLICT',
      'saleId', NULL,
      'saleNumber', NULL,
      'invoiceNumber', NULL,
      'paymentId', NULL,
      'operationId', NULL,
      'amount', v_total,
      'errorCode', 'STOCK_CONFLICT',
      'errorMessage', 'Le stock serveur ne couvre plus ce ticket. Il est conservé pour contrôle.',
      'stockConflicts', v_stock_conflicts
    );
  END IF;

  v_sale_payload := jsonb_build_object(
    'business_location_id', v_location_id,
    'client_id', v_client_id,
    'payment_method', 'CASH',
    'reference', 'POS:OFFLINE:' || v_offline_sale_id,
    'notes', 'Vente créée hors connexion le ' || to_char(v_created_at_device AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC ; terminal ' || v_terminal_id,
    'lines', v_payload -> 'lines',
    'cash_session_id', v_cash_session_id,
    'terminal_id', v_terminal_id
  );

  BEGIN
    -- p_effective_at = created_at_device : le prix plancher est celui en
    -- vigueur au moment reel de la vente hors ligne, jamais celui du jour
    -- de la synchronisation.
    v_sale_result := public._internal_create_commerce_cash_sale_at(v_sale_payload, v_created_at_device);
  EXCEPTION WHEN OTHERS THEN
    v_error_code := SQLSTATE;
    v_error_message := SQLERRM;

    IF v_error_code = '22023' AND v_error_message = 'Quantité indisponible dans ce magasin.' THEN
      INSERT INTO public.commerce_pos_offline_receipts (
        offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
        status, payload_hash, payload, created_at_device, amount, price_divergence,
        error_code, error_message
      ) VALUES (
        v_offline_sale_id, v_terminal_id, v_cash_session_id, v_location_id, auth.uid(),
        'CONFLICT', v_payload_hash, p_event, v_created_at_device, v_total, v_price_divergence,
        'STOCK_CONFLICT', 'Le stock a changé pendant la synchronisation de ce ticket.'
      ) RETURNING * INTO v_receipt;

      PERFORM public.business_finance_audit_event(
        'COMMERCE_POS_OFFLINE_RECEIPT', v_receipt.id, NULL, 'CREATE', NULL,
        jsonb_build_object(
          'event_type', 'OFFLINE_SYNC',
          'sync_status', 'CONFLICT',
          'offline_sale_id', v_offline_sale_id,
          'reason', v_error_message
        )
      );

      RETURN jsonb_build_object(
        'receiptId', v_receipt.id,
        'status', 'CONFLICT',
        'saleId', NULL,
        'saleNumber', NULL,
        'invoiceNumber', NULL,
        'paymentId', NULL,
        'operationId', NULL,
        'amount', v_total,
        'errorCode', 'STOCK_CONFLICT',
        'errorMessage', 'Le stock a changé pendant la synchronisation. Le ticket est conservé pour contrôle.'
      );
    END IF;

    RAISE;
  END;

  SELECT id INTO v_invoice_id
  FROM public.commercial_invoices
  WHERE invoice_number = v_sale_result ->> 'invoiceNumber';

  INSERT INTO public.commerce_pos_offline_receipts (
    offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
    status, payload_hash, payload, created_at_device, processed_at,
    server_sale_id, server_invoice_id, server_payment_id, server_operation_id,
    amount, price_divergence
  ) VALUES (
    v_offline_sale_id, v_terminal_id, v_cash_session_id, v_location_id, auth.uid(),
    'PROCESSED', v_payload_hash, p_event, v_created_at_device, now(),
    (v_sale_result ->> 'saleId')::uuid, v_invoice_id, (v_sale_result ->> 'paymentId')::uuid, (v_sale_result ->> 'operationId')::uuid,
    (v_sale_result ->> 'amount')::numeric, v_price_divergence
  ) RETURNING * INTO v_receipt;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_OFFLINE_RECEIPT', v_receipt.id, v_receipt.server_operation_id, 'CREATE', NULL,
    jsonb_build_object(
      'event_type', 'OFFLINE_SYNC',
      'sync_status', 'SYNCED',
      'offline_sale_id', v_offline_sale_id,
      'terminal_id', v_terminal_id,
      'cash_session_id', v_cash_session_id,
      'created_at_device', v_created_at_device,
      'received_at_server', v_receipt.received_at_server,
      'price_divergence', v_price_divergence
    )
  );

  RETURN jsonb_build_object(
    'receiptId', v_receipt.id,
    'status', 'PROCESSED',
    'saleId', v_receipt.server_sale_id,
    'saleNumber', v_sale_result ->> 'saleNumber',
    'invoiceNumber', v_sale_result ->> 'invoiceNumber',
    'paymentId', v_receipt.server_payment_id,
    'operationId', v_receipt.server_operation_id,
    'amount', v_receipt.amount,
    'errorCode', NULL,
    'errorMessage', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_commerce_pos_offline_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_commerce_pos_offline_sale(jsonb) TO authenticated;

COMMENT ON FUNCTION public.sync_commerce_pos_offline_sale(jsonb) IS
  'Synchronisation d''une vente encaissee hors connexion. Applique le prix plancher catalogue en vigueur au moment reel de la vente (created_at_device), jamais celui du jour de la synchronisation -- une hausse de prix decidee par le gestionnaire pendant que le caissier etait hors ligne ne corrompt jamais retroactivement une vente hors ligne deja legitime.';
