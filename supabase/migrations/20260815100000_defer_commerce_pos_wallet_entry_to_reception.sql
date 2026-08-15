-- Correction du modele financier POS : une vente ne doit plus, a elle seule,
-- creer une ecriture Finance/wallet. Le circuit devient strictement :
--   vente (commercial) -> cloture (rapport, aucune ecriture Finance)
--   -> confirmation gestionnaire (seul point qui materialise la tresorerie).
-- Le CA, la marge, le CMV et le stock restent inchanges : ils vivent dans
-- commercial_sales / commercial_sale_lines / commercial_invoice_payments /
-- stock_movements, jamais dans finance_operations. On ne retire que le
-- couplage vente = entree wallet immediate.
--
-- Aucune donnee existante n'est modifiee ou supprimee par cette migration :
-- les finance_operations deja creees par des ventes passees (categorie
-- 'VENTE MAGASIN') restent intactes ; une strategie de regularisation sera
-- traitee separement, avec autorisation explicite.
--
-- Transition sans interruption : confirm_commerce_pos_cash_reception garde
-- temporairement son ancienne signature a 6 arguments (wrapper de
-- compatibilite, section 4bis) en plus de la nouvelle a 5 arguments, pour que
-- le frontend deja en production au moment de l'application de cette
-- migration continue de fonctionner jusqu'a son propre deploiement.

-- ---------------------------------------------------------------------------
-- 1) payment_method devient disponible sans dependre de finance_operations.
-- ---------------------------------------------------------------------------

ALTER TABLE public.commercial_invoice_payments
  ADD COLUMN IF NOT EXISTS payment_method text;

COMMENT ON COLUMN public.commercial_invoice_payments.payment_method IS
  'Mode de paiement reel de ce versement (CASH/WAVE/JEKO/CARD/OTHER). Renseigne par _internal_create_commerce_cash_sale_at depuis cette migration -- NULL pour tout paiement anterieur, jamais reconstitue par heuristique.';

-- confirm_commerce_pos_cash_reception ne transite plus l'argent entre deux
-- wallets distincts : il credite directement le wallet CASH_DRAWER du
-- magasin (seul wallet reellement configure en production). NULL satisfait
-- deja la contrainte source_wallet_id <> destination_wallet_id (comparaison
-- a NULL = NULL, jamais FALSE) -- aucune remise POS-05 existante n'est
-- affectee, elles ont toutes deja deux wallets distincts non NULL.
ALTER TABLE public.commerce_cash_remittances
  ALTER COLUMN destination_wallet_id DROP NOT NULL;

-- Un recu hors-ligne PROCESSED exigeait jusqu'ici server_operation_id NOT
-- NULL (20260811160000) -- vrai tant que toute vente creait une operation
-- Finance. Desormais une vente n'en cree plus : seuls la vente, la facture
-- et le paiement restent obligatoires pour un recu PROCESSED.
ALTER TABLE public.commerce_pos_offline_receipts
  DROP CONSTRAINT IF EXISTS commerce_pos_offline_receipts_check1;

ALTER TABLE public.commerce_pos_offline_receipts
  ADD CONSTRAINT commerce_pos_offline_receipts_processed_requires_sale_check
  CHECK (status <> 'PROCESSED' OR (server_invoice_id IS NOT NULL AND server_payment_id IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 2) La vente n'ecrit plus dans finance_operations. Le retry-lookup et
--    l'audit event sont adaptes pour ne plus dependre de finance_operations
--    non plus (une vente rejouee doit rester detectable meme sans operation
--    Finance).
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

  -- Un retry pour le meme ticket persiste retourne son recu original. Ceci
  -- s'execute avant toute mutation stock, facture ou paiement. Detecte
  -- directement depuis les ventes/paiements commerciaux -- ne depend plus de
  -- finance_operations, qui ne recoit plus rien au moment de la vente.
  IF v_reference IS NOT NULL AND v_reference LIKE 'POS:%' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':' || v_reference, 0));

    SELECT sale.id, invoice.invoice_number, payment.id, payment.amount
    INTO v_existing_sale_id, v_existing_invoice_number, v_existing_payment_id, v_existing_amount
    FROM public.commercial_sales AS sale
    JOIN public.commercial_invoices AS invoice ON invoice.sale_id = sale.id
    JOIN public.commercial_invoice_payments AS payment ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
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
        'operationId', NULL,
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

  -- Le paiement decrit comment la vente a ete encaissee (wallet + mode de
  -- paiement) -- c'est un objet commercial, pas une ecriture Finance.
  -- Aucune ecriture finance_operations n'est plus creee ici : la vente ne
  -- touche plus jamais un wallet. Le CA/la marge/le stock restent intacts
  -- (commercial_sales/commercial_sale_lines/stock_movements), seule la
  -- confirmation gestionnaire (confirm_commerce_pos_cash_reception) credite
  -- desormais le wallet, pour le montant reellement recu.
  INSERT INTO public.commercial_invoice_payments (
    invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind,
    payment_method, reference, notes, created_by, updated_by, confirmed_at
  ) VALUES (
    v_invoice.id, v_sale.id, v_wallet_id, v_total, current_date, 'CONFIRMED',
    'PAYMENT', v_payment_method, coalesce(v_reference, v_sale.sale_number), v_notes,
    auth.uid(), auth.uid(), now()
  ) RETURNING * INTO v_payment;

  PERFORM public.business_finance_audit_event(
    'COMMERCIAL_SALE', v_sale.id, NULL, 'CREATE', NULL,
    jsonb_build_object('sale', to_jsonb(v_sale), 'invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment))
  );

  RETURN jsonb_build_object(
    'saleId', v_sale.id,
    'saleNumber', v_sale.sale_number,
    'invoiceNumber', v_invoice.invoice_number,
    'paymentId', v_payment.id,
    'operationId', NULL,
    'amount', v_total
  );
END;
$function$;

COMMENT ON FUNCTION public._internal_create_commerce_cash_sale_at(jsonb, timestamptz) IS
  'Coeur de la vente caisse (online et hors-ligne synchronisee). Depuis la correction du modele financier POS : n''ecrit plus jamais dans finance_operations -- le CA/la marge/le stock restent visibles via commercial_sales/commercial_sale_lines/stock_movements, mais aucun wallet n''est plus credite a la vente. Seule confirm_commerce_pos_cash_reception, au moment de la cloture confirmee par un gestionnaire, materialise une ecriture de tresorerie.';

-- ---------------------------------------------------------------------------
-- 3) La cloture calcule desormais son theorique par mode de paiement
--    directement depuis les ventes/paiements commerciaux confirmes, sans
--    plus jamais dependre de finance_operations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_commerce_pos_cash_session(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_cash_session_id text := NULLIF(btrim(p_event ->> 'cash_session_id'), '');
  v_event_id text := NULLIF(btrim(p_event ->> 'event_id'), '');
  v_terminal_id text := NULLIF(btrim(p_event ->> 'terminal_id'), '');
  v_location_id uuid := NULLIF(p_event ->> 'business_location_id', '')::uuid;
  v_claimed_user_id uuid := NULLIF(p_event ->> 'cashier_user_id', '')::uuid;
  v_opened_at_device timestamptz := NULLIF(p_event ->> 'opened_at_device', '')::timestamptz;
  v_closed_at_device timestamptz := coalesce(NULLIF(p_event ->> 'closed_at_device', '')::timestamptz, now());
  v_existing public.commerce_pos_cash_session_closures;
  v_existing_report public.commerce_pos_control_reports;
  v_pending_sales integer := 0;
  v_server_ticket_count integer := 0;
  v_server_article_total numeric(14, 2) := 0;
  v_server_service_total numeric(14, 2) := 0;
  v_server_cash_total numeric(14, 2) := 0;
  v_server_mobile_money_total numeric(14, 2) := 0;
  v_server_other_payment_total numeric(14, 2) := 0;
  v_article_quantity_total numeric(14, 3) := 0;
  v_closure public.commerce_pos_cash_session_closures;
  v_report public.commerce_pos_control_reports;
  v_totals record;
BEGIN
  PERFORM public.permission_require('commerce.cash.close');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour clore une session de caisse.' USING ERRCODE = '42501';
  END IF;

  IF v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_event_id IS NULL OR v_event_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_claimed_user_id IS NULL OR v_opened_at_device IS NULL THEN
    RAISE EXCEPTION 'Evenement de cloture de caisse invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_claimed_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Le caissier de la cloture ne correspond pas a la session connectee.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorise.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':cash-close:' || v_cash_session_id, 0));

  -- Idempotence forte : un retry (rechargement navigateur, reprise apres
  -- coupure reseau au milieu de la synchronisation) retombe toujours sur la
  -- meme cloture et le meme rapport, jamais un doublon -- la contrainte
  -- UNIQUE sur cash_session_id et sur commerce_pos_control_reports.closure_id
  -- le garantit au niveau base, pas seulement au niveau applicatif.
  SELECT * INTO v_existing
  FROM public.commerce_pos_cash_session_closures
  WHERE cash_session_id = v_cash_session_id;

  IF FOUND THEN
    IF v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Cette session de caisse possede deja une cloture differente.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_existing_report FROM public.commerce_pos_control_reports WHERE closure_id = v_existing.id;
    RETURN jsonb_build_object('closureId', v_existing.id, 'reportId', v_existing_report.id, 'status', v_existing.status);
  END IF;

  -- Meme garde que POS-04C : tous les tickets hors ligne de cette session
  -- doivent avoir fini de synchroniser avant de pouvoir clore -- jamais de
  -- cloture avant les ventes dont elle depend.
  SELECT count(*) INTO v_pending_sales
  FROM public.commerce_pos_offline_receipts
  WHERE cash_session_id = v_cash_session_id
    AND business_location_id = v_location_id
    AND cashier_user_id = auth.uid()
    AND terminal_id = v_terminal_id
    AND status <> 'PROCESSED';

  IF v_pending_sales > 0 THEN
    RETURN jsonb_build_object(
      'closureId', NULL, 'reportId', NULL, 'status', 'PENDING_SALES',
      'errorCode', 'PENDING_SALES', 'errorMessage', 'La cloture attend encore des ventes a synchroniser.'
    );
  END IF;

  -- Theorique unifie POS-06/06B : toute vente confirmee rattachee a cette
  -- session, online ou offline synchronisee, ventilee par mode de paiement.
  -- Factorise dans _internal_commerce_pos_session_commercial_totals (section
  -- 6) -- meme fonction que get_commerce_pos_cash_session_preview, pour que
  -- le resume affiche avant cloture et la cloture reelle ne puissent jamais
  -- diverger en silence.
  SELECT * INTO v_totals
  FROM public._internal_commerce_pos_session_commercial_totals(
    v_cash_session_id, v_terminal_id, v_location_id, auth.uid()
  );
  v_server_ticket_count := v_totals.ticket_count;
  v_server_article_total := v_totals.article_total;
  v_server_service_total := v_totals.service_total;
  v_article_quantity_total := v_totals.article_quantity_total;
  v_server_cash_total := v_totals.cash_total;
  v_server_mobile_money_total := v_totals.mobile_money_total;
  v_server_other_payment_total := v_totals.other_payment_total;

  -- Aucune ecriture Finance ici : les ventes n'en produisent plus, la
  -- cloture ne fait que constater et figer un theorique commercial.
  INSERT INTO public.commerce_pos_cash_session_closures (
    cash_session_id, closure_event_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, status, payload_hash, closure_kind,
    declared_ticket_count, declared_article_total, declared_service_total,
    declared_cash_total, declared_other_payment_total, declared_theoretical_cash,
    counted_cash, declared_difference, discrepancy_note,
    server_ticket_count, server_article_total, server_service_total,
    server_cash_total, server_mobile_money_total, server_other_payment_total, server_difference,
    totals_match, payload
  ) VALUES (
    v_cash_session_id, v_event_id, v_terminal_id, v_location_id, auth.uid(),
    v_opened_at_device, v_closed_at_device, 'SYNCED', md5(p_event::text), 'AUTOMATIC',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    v_server_ticket_count, v_server_article_total, v_server_service_total,
    v_server_cash_total, v_server_mobile_money_total, v_server_other_payment_total, NULL,
    NULL, p_event
  ) RETURNING * INTO v_closure;

  INSERT INTO public.commerce_pos_control_reports (
    closure_id, cash_session_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, ticket_count, article_revenue, service_revenue, total_revenue,
    article_quantity_total, cash_expected, mobile_money_total, other_payment_total, sync_status
  ) VALUES (
    v_closure.id, v_cash_session_id, v_terminal_id, v_location_id, auth.uid(),
    v_opened_at_device, v_closed_at_device, v_server_ticket_count, v_server_article_total, v_server_service_total,
    v_server_article_total + v_server_service_total,
    v_article_quantity_total, v_server_cash_total, v_server_mobile_money_total, v_server_other_payment_total,
    v_closure.status
  ) RETURNING * INTO v_report;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CASH_SESSION_CLOSE', v_closure.id, NULL, 'CREATE', NULL,
    jsonb_build_object(
      'event_type', 'CASH_SESSION_CLOSE_AUTOMATIC', 'cash_session_id', v_cash_session_id,
      'terminal_id', v_terminal_id, 'report_id', v_report.id, 'cash_expected', v_server_cash_total,
      'mobile_money_total', v_server_mobile_money_total, 'other_payment_total', v_server_other_payment_total
    )
  );

  RETURN jsonb_build_object('closureId', v_closure.id, 'reportId', v_report.id, 'status', v_closure.status);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) confirm_commerce_pos_cash_reception credite directement le wallet
--    CASH_DRAWER du magasin -- plus de choix de wallet destination.
--    Transition compatible sans interruption : le frontend deploye appelle
--    encore l'ancien overload a 6 arguments (p_destination_wallet_id) tant
--    que le nouveau frontend (5 arguments) n'est pas lui-meme deploye.
--    L'overload a 6 arguments N'EST PAS supprime ici -- il est redefini plus
--    bas comme un wrapper mince qui valide puis delegue integralement au
--    nouveau comportement DEPOSIT (plus jamais de TRANSFER), pour qu'un
--    appel du vieux frontend reste fonctionnel pendant la fenetre de
--    transition. Une migration ulterieure retirera cet overload une fois
--    qu'aucun client ancien ne peut plus l'appeler (cf. commentaire sur la
--    fonction plus bas).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_commerce_pos_cash_reception(
  p_report_id uuid,
  p_reception_event_id text,
  p_received_amount numeric,
  p_is_final boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_event_id text := NULLIF(btrim(p_reception_event_id), '');
  v_note text := NULLIF(btrim(p_note), '');
  v_report public.commerce_pos_control_reports;
  v_existing public.commerce_cash_remittances;
  v_already_received numeric(14, 2);
  v_already_finalized boolean;
  v_outstanding_before numeric(14, 2);
  v_wallet_id uuid;
  v_remittance public.commerce_cash_remittances;
  v_operation public.finance_operations;
  v_difference numeric(14, 2);
BEGIN
  PERFORM public.permission_require('commerce.cash.reports.confirm');
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour confirmer une reception.' USING ERRCODE = '42501';
  END IF;
  IF v_event_id IS NULL OR length(v_event_id) NOT BETWEEN 8 AND 160
    OR p_received_amount IS NULL OR p_received_amount <= 0
    OR p_is_final IS NULL
    OR (v_note IS NOT NULL AND length(v_note) > 1000) THEN
    RAISE EXCEPTION 'Reception invalide.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_report FROM public.commerce_pos_control_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rapport introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_report.business_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorise.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('pos-reception:' || p_report_id::text, 0));

  -- Retry idempotent : le meme evenement renvoie le meme resultat, jamais un
  -- second mouvement Finance.
  SELECT * INTO v_existing FROM public.commerce_cash_remittances WHERE remittance_event_id = v_event_id;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.commerce_cash_remittance_closures link
      WHERE link.remittance_id = v_existing.id AND link.closure_id = v_report.closure_id
    ) THEN
      RAISE EXCEPTION 'Identifiant de reception deja utilise pour un autre rapport.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'remittanceId', v_existing.id, 'operationId', NULL, 'receivedAmount', v_existing.received_amount,
      'isFinal', v_existing.is_final
    );
  END IF;

  -- Reliquat toujours recalcule depuis les remises CONFIRMED deja liees a
  -- cette cloture (jamais stocke), sous le verrou ci-dessus. Une fois une
  -- reception marquee finale, plus aucune reception n'est acceptee -- le
  -- rapport est solde, avec ou sans ecart.
  SELECT
    coalesce(sum(r.received_amount), 0),
    coalesce(bool_or(coalesce(r.is_final, false)), false)
  INTO v_already_received, v_already_finalized
  FROM public.commerce_cash_remittances AS r
  JOIN public.commerce_cash_remittance_closures AS link ON link.remittance_id = r.id
  WHERE link.closure_id = v_report.closure_id AND r.status = 'CONFIRMED';

  IF v_already_finalized THEN
    RAISE EXCEPTION 'Ce rapport est deja solde -- aucune nouvelle reception possible.' USING ERRCODE = '22023';
  END IF;
  IF v_report.cash_expected <= 0 THEN
    RAISE EXCEPTION 'Ce rapport n''attend aucune espece -- rien a recevoir.' USING ERRCODE = '22023';
  END IF;

  v_outstanding_before := round(v_report.cash_expected - v_already_received, 2);

  -- Seul wallet reellement concerne : le CASH_DRAWER principal du magasin.
  -- Resolu cote serveur uniquement -- jamais un wallet choisi par le client.
  SELECT mapping.wallet_id
  INTO v_wallet_id
  FROM public.business_location_wallets AS mapping
  WHERE mapping.business_location_id = v_report.business_location_id
    AND mapping.purpose = 'CASH_DRAWER' AND mapping.is_primary AND mapping.is_active
  ORDER BY mapping.assigned_at DESC
  LIMIT 1;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet de caisse principal actif pour ce magasin.' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM public.wallets WHERE id = v_wallet_id FOR UPDATE;

  v_difference := round(p_received_amount - v_outstanding_before, 2);

  -- Reception de caisse confirmee : credite directement le wallet du
  -- magasin, jamais un second wallet artificiel. type=DEPOSIT (pas REVENUE :
  -- le CA existe deja depuis les ventes, ceci ne fait que reconnaitre une
  -- entree de tresorerie ; pas TRANSFER : il n'y a pas de wallet source
  -- distinct a debiter -- l'argent n'a jamais ete compte nulle part avant
  -- cet instant).
  INSERT INTO public.finance_operations (
    wallet_id, destination_wallet_id, type, amount, operation_date, category,
    description, reference, status, origin, module, module_id, notes, created_by
  ) VALUES (
    v_wallet_id, NULL, 'DEPOSIT', round(p_received_amount, 2), current_date,
    'REMISE DE CAISSE', 'Reception physique de caisse -- ' || v_report.cash_session_id,
    'POS-REPORT:' || v_report.id::text || ':' || v_event_id, 'VALIDE',
    'COMMERCE_POS_CONTROL_REPORT', 'COMMERCE_POS_CONTROL_REPORT', v_report.id, v_note, auth.uid()
  ) RETURNING * INTO v_operation;

  -- Insere directement CONFIRMED : il n'y a plus de declarant distinct du
  -- confirmant dans ce parcours (declared_by NULL), donc plus de phase
  -- DECLARED intermediaire a franchir. destination_wallet_id reste NULL --
  -- ce n'est pas un transfert entre deux wallets.
  INSERT INTO public.commerce_cash_remittances (
    remittance_event_id, business_location_id, source_wallet_id, destination_wallet_id,
    expected_amount, amount, cashier_difference, remittance_date, status,
    reference, notes, declared_by, declared_at, payload_hash,
    received_amount, remittance_difference, confirmed_by, confirmed_at, confirmation_note, is_final
  ) VALUES (
    v_event_id, v_report.business_location_id, v_wallet_id, NULL,
    v_outstanding_before, round(p_received_amount, 2), v_difference, current_date, 'CONFIRMED',
    'Cloture ' || v_report.cash_session_id, v_note, NULL, now(),
    md5(v_report.id::text || ':' || v_event_id),
    round(p_received_amount, 2), v_difference, auth.uid(), now(), v_note, p_is_final
  ) RETURNING * INTO v_remittance;

  INSERT INTO public.commerce_cash_remittance_closures (
    remittance_id, closure_id, allocated_counted_amount, allocated_expected_amount
  ) VALUES (
    v_remittance.id, v_report.closure_id, round(p_received_amount, 2), v_outstanding_before
  );

  INSERT INTO public.finance_commerce_cash_remittance_links (remittance_id, operation_id)
  VALUES (v_remittance.id, v_operation.id);

  PERFORM public.update_wallet_balance(v_wallet_id);
  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CONTROL_REPORT', v_report.id, v_operation.id, 'CONFIRM', NULL,
    jsonb_build_object(
      'remittance_id', v_remittance.id, 'received_amount', v_remittance.received_amount,
      'outstanding_before', v_outstanding_before, 'is_final', p_is_final, 'difference', v_difference
    )
  );

  RETURN jsonb_build_object(
    'remittanceId', v_remittance.id, 'operationId', v_operation.id,
    'receivedAmount', v_remittance.received_amount, 'outstandingBefore', v_outstanding_before,
    'isFinal', p_is_final, 'difference', v_difference
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, boolean, text) IS
  'Action gestionnaire uniquement. Credite directement le wallet CASH_DRAWER principal du magasin du montant reellement recu (type=DEPOSIT, destination_wallet_id NULL -- pas de second wallet). Reutilise commerce_cash_remittances/commerce_cash_remittance_closures (POS-05) pour la tracabilite -- une ligne CONFIRMED par versement physique reel, declared_by NULL (jamais attribue au caissier). Le montant recu peut etre inferieur ou superieur au reliquat ; p_is_final distingue une reception partielle (le reliquat reste ouvert) d''une reception qui solde definitivement le rapport, ecart eventuel inclus. Idempotent par reception_event_id.';

-- ---------------------------------------------------------------------------
-- 4bis) Wrapper de compatibilite temporaire, ancienne signature a 6
--    arguments. Existe uniquement pour que le frontend deja en production
--    (pas encore mis a jour) continue de fonctionner pendant la fenetre de
--    transition. Ne fait plus AUCUN TRANSFER : valide p_destination_wallet_id
--    (non nul, wallet existant reellement -- purement une verification de
--    forme, plus aucune contrainte COLLECTION/OPERATING/distinct-de-la-source,
--    puisque cette regle metier est precisement celle qu'on retire) puis
--    delegue integralement au nouvel overload a 5 arguments, qui execute le
--    seul comportement reel : DEPOSIT direct sur le CASH_DRAWER du magasin.
--    A SUPPRIMER par une migration ulterieure une fois le frontend a 5
--    arguments confirme deploye et plus aucun ancien client en circulation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_commerce_pos_cash_reception(
  p_report_id uuid,
  p_reception_event_id text,
  p_received_amount numeric,
  p_destination_wallet_id uuid,
  p_is_final boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF p_destination_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Reception invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_destination_wallet_id) THEN
    RAISE EXCEPTION 'Wallet destination introuvable.' USING ERRCODE = '23503';
  END IF;
  RETURN public.confirm_commerce_pos_cash_reception(
    p_report_id, p_reception_event_id, p_received_amount, p_is_final, p_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_commerce_pos_cash_reception(uuid, text, numeric, uuid, boolean, text) IS
  'COMPATIBILITE TEMPORAIRE (a retirer). Ancienne signature a 6 arguments conservee uniquement pour le frontend deja deploye au moment de cette migration. Ne fait plus de TRANSFER : valide p_destination_wallet_id (non nul, wallet existant) puis delegue entierement a confirm_commerce_pos_cash_reception(uuid, text, numeric, boolean, text), qui credite directement le CASH_DRAWER du magasin en DEPOSIT. Supprimer cet overload par une migration dediee des que le frontend a 5 arguments est confirme deploye en production.';

-- ---------------------------------------------------------------------------
-- 5) sync_commerce_pos_cash_session_close (POS-04C/POS-06, parcours manuel
--    declare/confirm toujours en vigueur pour toute cloture ancien-style)
--    calculait son theorique server_cash_total via le meme JOIN
--    finance_operations que close_commerce_pos_cash_session avant correction
--    -- il aurait silencieusement calcule 0 pour toute session des lors
--    qu'une vente ne credite plus finance_operations. Meme correction :
--    lecture directe de commercial_invoice_payments.payment_method.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_commerce_pos_cash_session_close(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_cash_session_id text := NULLIF(btrim(p_event ->> 'cash_session_id'), '');
  v_event_id text := NULLIF(btrim(p_event ->> 'event_id'), '');
  v_terminal_id text := NULLIF(btrim(p_event ->> 'terminal_id'), '');
  v_location_id uuid;
  v_claimed_user_id uuid;
  v_opened_at_device timestamptz;
  v_closed_at_device timestamptz;
  v_payload jsonb := p_event -> 'payload';
  v_payload_hash text;
  v_existing public.commerce_pos_cash_session_closures;
  v_declared_ticket_count integer;
  v_declared_article_total numeric(14, 2);
  v_declared_service_total numeric(14, 2);
  v_declared_cash_total numeric(14, 2);
  v_declared_other_payment_total numeric(14, 2);
  v_declared_theoretical_cash numeric(14, 2);
  v_counted_cash numeric(14, 2);
  v_declared_difference numeric(14, 2);
  v_note text;
  v_offline_ticket_count integer := 0;
  v_offline_article_total numeric(14, 2) := 0;
  v_offline_service_total numeric(14, 2) := 0;
  v_offline_cash_total numeric(14, 2) := 0;
  v_server_ticket_count integer := 0;
  v_server_article_total numeric(14, 2) := 0;
  v_server_service_total numeric(14, 2) := 0;
  v_server_cash_total numeric(14, 2) := 0;
  v_server_other_payment_total numeric(14, 2) := 0;
  v_server_difference numeric(14, 2) := 0;
  v_pending_sales integer := 0;
  v_totals_match boolean := false;
  v_status text;
  v_closure public.commerce_pos_cash_session_closures;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour synchroniser une clôture de caisse.' USING ERRCODE = '42501';
  END IF;

  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object'
    OR v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Événement de clôture hors connexion invalide.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_location_id := NULLIF(p_event ->> 'business_location_id', '')::uuid;
    v_claimed_user_id := NULLIF(p_event ->> 'cashier_user_id', '')::uuid;
    v_opened_at_device := NULLIF(v_payload ->> 'opened_at_device', '')::timestamptz;
    v_closed_at_device := NULLIF(v_payload ->> 'closed_at_device', '')::timestamptz;
    v_declared_ticket_count := NULLIF(v_payload ->> 'ticket_count', '')::integer;
    v_declared_article_total := NULLIF(v_payload ->> 'article_total', '')::numeric;
    v_declared_service_total := NULLIF(v_payload ->> 'service_total', '')::numeric;
    v_declared_cash_total := NULLIF(v_payload ->> 'cash_total', '')::numeric;
    v_declared_other_payment_total := NULLIF(v_payload ->> 'other_payment_total', '')::numeric;
    v_declared_theoretical_cash := NULLIF(v_payload ->> 'theoretical_cash', '')::numeric;
    v_counted_cash := NULLIF(v_payload ->> 'counted_cash', '')::numeric;
    v_declared_difference := NULLIF(v_payload ->> 'difference', '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Données de clôture hors connexion invalides.' USING ERRCODE = '22023';
  END;
  v_note := NULLIF(btrim(v_payload ->> 'note'), '');

  IF v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_event_id IS NULL OR v_event_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_claimed_user_id IS NULL
    OR v_opened_at_device IS NULL OR v_closed_at_device IS NULL
    OR v_closed_at_device < v_opened_at_device
    OR v_declared_ticket_count IS NULL OR v_declared_ticket_count < 0
    OR v_declared_article_total IS NULL OR v_declared_article_total < 0
    OR v_declared_service_total IS NULL OR v_declared_service_total < 0
    OR v_declared_cash_total IS NULL OR v_declared_cash_total < 0
    OR v_declared_other_payment_total IS NULL OR v_declared_other_payment_total < 0
    OR v_declared_theoretical_cash IS NULL OR v_declared_theoretical_cash < 0
    OR v_counted_cash IS NULL OR v_counted_cash < 0
    OR v_declared_difference IS NULL
    OR (v_note IS NOT NULL AND length(v_note) > 1000) THEN
    RAISE EXCEPTION 'Données de clôture hors connexion invalides.' USING ERRCODE = '22023';
  END IF;

  IF v_claimed_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Le caissier de la clôture ne correspond pas à la session connectée.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  IF round(v_declared_cash_total, 2) <> round(v_declared_article_total + v_declared_service_total, 2)
    OR round(v_declared_theoretical_cash, 2) <> round(v_declared_cash_total + v_declared_other_payment_total, 2)
    OR round(v_declared_difference, 2) <> round(v_counted_cash - v_declared_theoretical_cash, 2) THEN
    RAISE EXCEPTION 'Les totaux déclarés de clôture sont incohérents.' USING ERRCODE = '22023';
  END IF;

  v_payload_hash := md5(p_event::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':cash-close:' || v_cash_session_id, 0));

  SELECT * INTO v_existing
  FROM public.commerce_pos_cash_session_closures
  WHERE cash_session_id = v_cash_session_id;

  IF FOUND THEN
    IF v_existing.closure_event_id <> v_event_id
      OR v_existing.payload_hash <> v_payload_hash
      OR v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Cette session de caisse possède déjà une clôture différente.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'closureId', v_existing.id,
      'status', v_existing.status,
      'errorCode', CASE WHEN v_existing.status = 'REVIEW_REQUIRED' THEN 'TOTALS_MISMATCH' ELSE NULL END,
      'errorMessage', CASE WHEN v_existing.status = 'REVIEW_REQUIRED' THEN 'Les montants de la clôture doivent être contrôlés.' ELSE NULL END
    );
  END IF;

  SELECT count(*) INTO v_pending_sales
  FROM public.commerce_pos_offline_receipts
  WHERE cash_session_id = v_cash_session_id
    AND business_location_id = v_location_id
    AND cashier_user_id = auth.uid()
    AND terminal_id = v_terminal_id
    AND status <> 'PROCESSED';

  IF v_pending_sales > 0 THEN
    RETURN jsonb_build_object(
      'closureId', NULL,
      'status', 'PENDING_SALES',
      'errorCode', 'PENDING_SALES',
      'errorMessage', 'La clôture attend encore des ventes à synchroniser ou à contrôler.'
    );
  END IF;

  -- Offline-only recomputation: unchanged in meaning from pre-POS-06. It only
  -- verifies that everything the device sent through the offline outbox for
  -- this session actually landed, which is what totals_match/status audit.
  SELECT count(*)::integer
  INTO v_offline_ticket_count
  FROM public.commerce_pos_offline_receipts AS receipt
  WHERE receipt.cash_session_id = v_cash_session_id
    AND receipt.business_location_id = v_location_id
    AND receipt.cashier_user_id = auth.uid()
    AND receipt.terminal_id = v_terminal_id
    AND receipt.status = 'PROCESSED';

  IF v_offline_ticket_count < v_declared_ticket_count THEN
    RETURN jsonb_build_object(
      'closureId', NULL,
      'status', 'PENDING_SALES',
      'errorCode', 'PENDING_SALES',
      'errorMessage', 'La clôture attend encore des ventes à synchroniser.'
    );
  END IF;

  SELECT COALESCE(sum(receipt.amount), 0)
  INTO v_offline_cash_total
  FROM public.commerce_pos_offline_receipts AS receipt
  WHERE receipt.cash_session_id = v_cash_session_id
    AND receipt.business_location_id = v_location_id
    AND receipt.cashier_user_id = auth.uid()
    AND receipt.terminal_id = v_terminal_id
    AND receipt.status = 'PROCESSED';

  SELECT
    COALESCE(sum(CASE WHEN upper(COALESCE(NULLIF(btrim(line.value ->> 'line_type'), ''), 'ARTICLE')) = 'ARTICLE'
      THEN (line.value ->> 'quantity')::numeric * (line.value ->> 'unit_price')::numeric ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN upper(COALESCE(NULLIF(btrim(line.value ->> 'line_type'), ''), 'ARTICLE')) = 'SERVICE'
      THEN (line.value ->> 'quantity')::numeric * (line.value ->> 'unit_price')::numeric ELSE 0 END), 0)
  INTO v_offline_article_total, v_offline_service_total
  FROM public.commerce_pos_offline_receipts AS receipt
  CROSS JOIN LATERAL jsonb_array_elements(receipt.payload -> 'payload' -> 'lines') AS line(value)
  WHERE receipt.cash_session_id = v_cash_session_id
    AND receipt.business_location_id = v_location_id
    AND receipt.cashier_user_id = auth.uid()
    AND receipt.terminal_id = v_terminal_id
    AND receipt.status = 'PROCESSED';

  -- POS-06 unified theoretical: every CASH-settled confirmed sale actually
  -- stamped with this session, whichever checkout route created it. Depuis
  -- la correction du modele financier POS : lu directement depuis
  -- commercial_invoice_payments.payment_method, plus jamais depuis
  -- finance_operations (qui ne recoit plus rien a la vente).
  SELECT
    count(*)::integer,
    COALESCE(sum(article_line.total), 0),
    COALESCE(sum(service_line.total), 0),
    COALESCE(sum(payment.amount), 0)
  INTO v_server_ticket_count, v_server_article_total, v_server_service_total, v_server_cash_total
  FROM public.commercial_sales AS sale
  JOIN public.commercial_invoice_payments AS payment
    ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED' AND payment.payment_method = 'CASH'
  LEFT JOIN LATERAL (
    SELECT sum(line_row.line_total) AS total
    FROM public.commercial_sale_lines AS line_row
    WHERE line_row.sale_id = sale.id AND line_row.line_type = 'ARTICLE'
  ) AS article_line ON true
  LEFT JOIN LATERAL (
    SELECT sum(line_row.line_total) AS total
    FROM public.commercial_sale_lines AS line_row
    WHERE line_row.sale_id = sale.id AND line_row.line_type = 'SERVICE'
  ) AS service_line ON true
  WHERE sale.cash_session_id = v_cash_session_id
    AND sale.business_location_id = v_location_id
    AND sale.created_by = auth.uid()
    AND sale.status = 'CONFIRMED';

  -- The offline POS currently supports cash only. This remains explicit so a
  -- future card/mobile-money path cannot silently be counted as cash.
  v_server_other_payment_total := 0;
  v_server_difference := round(v_counted_cash - (v_server_cash_total + v_server_other_payment_total), 2);
  v_totals_match := v_offline_ticket_count = v_declared_ticket_count
    AND round(v_offline_article_total, 2) = round(v_declared_article_total, 2)
    AND round(v_offline_service_total, 2) = round(v_declared_service_total, 2)
    AND round(v_offline_cash_total, 2) = round(v_declared_cash_total, 2)
    AND round(v_server_other_payment_total, 2) = round(v_declared_other_payment_total, 2)
    AND round(v_offline_cash_total + v_server_other_payment_total, 2) = round(v_declared_theoretical_cash, 2);
  v_status := CASE WHEN v_totals_match THEN 'SYNCED' ELSE 'REVIEW_REQUIRED' END;

  INSERT INTO public.commerce_pos_cash_session_closures (
    cash_session_id, closure_event_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, status, payload_hash,
    declared_ticket_count, declared_article_total, declared_service_total,
    declared_cash_total, declared_other_payment_total, declared_theoretical_cash,
    counted_cash, declared_difference, discrepancy_note,
    server_ticket_count, server_article_total, server_service_total,
    server_cash_total, server_other_payment_total, server_difference,
    totals_match, payload
  ) VALUES (
    v_cash_session_id, v_event_id, v_terminal_id, v_location_id, auth.uid(),
    v_opened_at_device, v_closed_at_device, v_status, v_payload_hash,
    v_declared_ticket_count, v_declared_article_total, v_declared_service_total,
    v_declared_cash_total, v_declared_other_payment_total, v_declared_theoretical_cash,
    v_counted_cash, v_declared_difference, v_note,
    v_server_ticket_count, v_server_article_total, v_server_service_total,
    v_server_cash_total, v_server_other_payment_total, v_server_difference,
    v_totals_match, p_event
  ) RETURNING * INTO v_closure;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CASH_SESSION_CLOSE', v_closure.id, NULL, 'CREATE', NULL,
    jsonb_build_object(
      'event_type', 'CASH_SESSION_CLOSE',
      'cash_session_id', v_cash_session_id,
      'terminal_id', v_terminal_id,
      'status', v_status,
      'ticket_count', v_server_ticket_count,
      'theoretical_cash', v_server_cash_total,
      'counted_cash', v_counted_cash,
      'difference', v_server_difference,
      'totals_match', v_totals_match
    )
  );

  RETURN jsonb_build_object(
    'closureId', v_closure.id,
    'status', v_closure.status,
    'errorCode', CASE WHEN v_closure.status = 'REVIEW_REQUIRED' THEN 'TOTALS_MISMATCH' ELSE NULL END,
    'errorMessage', CASE WHEN v_closure.status = 'REVIEW_REQUIRED' THEN 'Les montants de la clôture doivent être contrôlés.' ELSE NULL END
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6) Resume pre-cloture. Le modal "Cloture de caisse" affichait 0 partout des
--    qu'une vente passait par le circuit en ligne (create_commerce_cash_sale) :
--    le seul calcul existant etait un agregat 100% IndexedDB (tickets locaux
--    au statut PAID_LOCAL), jamais alimente par ce circuit, qui ecrit
--    directement en base sans jamais toucher au stockage local. La source
--    serveur qui manquait est ajoutee ici -- meme definition metier que
--    close_commerce_pos_cash_session, factorisee pour ne jamais diverger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._internal_commerce_pos_session_commercial_totals(
  p_cash_session_id text,
  p_terminal_id text,
  p_business_location_id uuid,
  p_cashier_user_id uuid
)
RETURNS TABLE (
  ticket_count integer,
  article_total numeric,
  service_total numeric,
  article_quantity_total numeric,
  cash_total numeric,
  mobile_money_total numeric,
  other_payment_total numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::integer,
    COALESCE(sum(article_line.total), 0),
    COALESCE(sum(service_line.total), 0),
    COALESCE(sum(article_line.qty), 0),
    COALESCE(sum(payment.amount) FILTER (WHERE COALESCE(payment.payment_method, legacy_op.payment_method) = 'CASH'), 0),
    COALESCE(sum(payment.amount) FILTER (WHERE COALESCE(payment.payment_method, legacy_op.payment_method) IN ('WAVE', 'JEKO')), 0),
    COALESCE(sum(payment.amount) FILTER (WHERE COALESCE(payment.payment_method, legacy_op.payment_method) IN ('CARD', 'OTHER')), 0)
  FROM public.commercial_sales AS sale
  JOIN public.commercial_invoice_payments AS payment
    ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
  LEFT JOIN LATERAL (
    SELECT sum(line_row.line_total) AS total, sum(line_row.quantity) AS qty
    FROM public.commercial_sale_lines AS line_row
    WHERE line_row.sale_id = sale.id AND line_row.line_type = 'ARTICLE'
  ) AS article_line ON true
  LEFT JOIN LATERAL (
    SELECT sum(line_row.line_total) AS total
    FROM public.commercial_sale_lines AS line_row
    WHERE line_row.sale_id = sale.id AND line_row.line_type = 'SERVICE'
  ) AS service_line ON true
  -- Repli de transition, jamais heuristique : seulement quand
  -- payment.payment_method est NULL (donc forcement un paiement anterieur a
  -- cette migration -- toute vente post-migration le renseigne toujours),
  -- on lit la finance_operation reellement liee a CE paiement precis via son
  -- identifiant stable (module='COMMERCIAL_INVOICE_PAYMENT', module_id =
  -- payment.id) -- jamais un rapprochement par montant, date ou heure.
  LEFT JOIN LATERAL (
    SELECT legacy.payment_method
    FROM public.finance_operations AS legacy
    WHERE legacy.module = 'COMMERCIAL_INVOICE_PAYMENT'
      AND legacy.module_id = payment.id
      AND legacy.status <> 'CANCELLED'
    ORDER BY legacy.created_at
    LIMIT 1
  ) AS legacy_op ON payment.payment_method IS NULL
  WHERE sale.cash_session_id = p_cash_session_id
    AND sale.terminal_id = p_terminal_id
    AND sale.business_location_id = p_business_location_id
    AND sale.created_by = p_cashier_user_id
    AND sale.status = 'CONFIRMED';
$$;

COMMENT ON FUNCTION public._internal_commerce_pos_session_commercial_totals(text, text, uuid, uuid) IS
  'Definition metier unique du theorique commercial d''une session de caisse (ventes/paiements CONFIRMED). Source de mode de paiement : commercial_invoice_payments.payment_method en priorite ; uniquement si NULL (paiement anterieur a cette migration, jamais retro-rempli par heuristique), repli explicite sur la finance_operation reellement liee a ce paiement via module/module_id -- jamais un rapprochement par montant/date. Ne cree jamais d''ecriture Finance (lecture seule). Partagee par close_commerce_pos_cash_session et get_commerce_pos_cash_session_preview pour qu''elles ne puissent jamais diverger. Fonction interne -- aucun GRANT direct, appelee uniquement depuis des fonctions SECURITY DEFINER qui font deja leurs propres verifications de permission/acces.';

CREATE OR REPLACE FUNCTION public.get_commerce_pos_cash_session_preview(
  p_cash_session_id text,
  p_terminal_id text,
  p_business_location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_totals record;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_cash_session_id IS NULL OR p_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR p_terminal_id IS NULL OR p_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR p_business_location_id IS NULL THEN
    RAISE EXCEPTION 'Parametres de resume de caisse invalides.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.commerce_location_access_allowed(p_business_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorise.' USING ERRCODE = '42501';
  END IF;

  -- Lecture seule, aucun verrou, aucune ecriture : peut etre appelee autant
  -- de fois que necessaire pendant que la session reste ouverte (a chaque
  -- vente, au montage du composant, apres chaque synchronisation reussie).
  SELECT * INTO v_totals
  FROM public._internal_commerce_pos_session_commercial_totals(
    p_cash_session_id, p_terminal_id, p_business_location_id, auth.uid()
  );

  RETURN jsonb_build_object(
    'ticketCount', v_totals.ticket_count,
    'articleTotal', v_totals.article_total,
    'articleQuantityTotal', v_totals.article_quantity_total,
    'serviceTotal', v_totals.service_total,
    'cashTotal', v_totals.cash_total,
    'mobileMoneyTotal', v_totals.mobile_money_total,
    'otherPaymentTotal', v_totals.other_payment_total,
    'theoreticalCash', v_totals.cash_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_pos_cash_session_preview(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_cash_session_preview(text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_commerce_pos_cash_session_preview(text, text, uuid) IS
  'Resume commercial en lecture seule de la session de caisse ouverte du caissier appelant, avant cloture. Meme definition metier que close_commerce_pos_cash_session (voir _internal_commerce_pos_session_commercial_totals) : uniquement ventes/paiements CONFIRMED de cette session/ce terminal/ce magasin rattaches au caissier appelant, jamais finance_operations. Source serveur du resume pre-cloture cote frontend -- a fusionner avec le complement local (ventes hors-ligne pas encore synchronisees) sans jamais recompter une vente deja presente ici.';
