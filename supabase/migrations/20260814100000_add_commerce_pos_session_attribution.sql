-- POS-06: give every POS-confirmed commercial_sales row a stable, server-
-- verified link to the till session, terminal and cashier that produced it,
-- for both the online and the offline-synced checkout path. STORE-04 found
-- that sync_commerce_pos_cash_session_close computed its theoretical cash
-- only from commerce_pos_offline_receipts, so any session made of online
-- sales (the default, connected path) always showed a 0 theoretical and a
-- misleading full-counted-cash "difference". This migration is additive:
-- existing commercial_sales rows keep cash_session_id/terminal_id NULL,
-- which is read explicitly as "session not determinable" rather than
-- guessed by timestamp proximity.

ALTER TABLE public.commercial_sales
  ADD COLUMN IF NOT EXISTS cash_session_id text,
  ADD COLUMN IF NOT EXISTS terminal_id text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commercial_sales'::regclass
      AND conname = 'commercial_sales_pos06_session_pair_check'
  ) THEN
    ALTER TABLE public.commercial_sales
      ADD CONSTRAINT commercial_sales_pos06_session_pair_check CHECK (
        (cash_session_id IS NULL) = (terminal_id IS NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commercial_sales'::regclass
      AND conname = 'commercial_sales_pos06_session_format_check'
  ) THEN
    ALTER TABLE public.commercial_sales
      ADD CONSTRAINT commercial_sales_pos06_session_format_check CHECK (
        (cash_session_id IS NULL OR cash_session_id ~ '^[A-Za-z0-9_-]{8,160}$')
        AND (terminal_id IS NULL OR terminal_id ~ '^[A-Za-z0-9_-]{8,160}$')
      );
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS commercial_sales_cash_session_idx
  ON public.commercial_sales (cash_session_id)
  WHERE cash_session_id IS NOT NULL;

COMMENT ON COLUMN public.commercial_sales.cash_session_id IS
  'POS-06: stable till-session identity, shared by the online and offline-synced checkout path. NULL on rows predating POS-06 or created outside the POS (e.g. harvest sales) -- read as "session not determinable", never inferred after the fact.';
COMMENT ON COLUMN public.commercial_sales.terminal_id IS
  'POS-06: browser-persistent terminal identity paired with cash_session_id. Format-validated only; no server-side terminal registry exists yet (that is POS-03 scope).';

-- create_commerce_cash_sale gains two optional jsonb keys. Both are supplied
-- together or not at all: an online checkout with IndexedDB unavailable
-- must keep working without a local session, exactly as it does today, and
-- the sale is then stored with cash_session_id/terminal_id NULL. When a
-- session id is supplied, the server never trusts it blindly: any prior sale
-- or offline receipt already carrying that session id must agree on store,
-- cashier and terminal, and a session that already has a closure cannot
-- receive another sale.
CREATE OR REPLACE FUNCTION public.create_commerce_cash_sale(p_sale jsonb)
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
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF p_sale IS NULL
    OR jsonb_typeof(p_sale) <> 'object'
    OR jsonb_typeof(p_sale -> 'lines') <> 'array'
    OR jsonb_array_length(p_sale -> 'lines') = 0 THEN
    RAISE EXCEPTION 'La vente caisse doit contenir au moins une ligne.' USING ERRCODE = '22023';
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

      INSERT INTO public.commercial_sale_lines (
        sale_id, line_type, description, quantity, unit, unit_price, line_total, inventory_item_id
      ) VALUES (
        v_sale.id, 'ARTICLE', v_item.nom, v_quantity, coalesce(v_item.unite, 'UNITE'),
        v_price, round(v_quantity * v_price, 2), v_item.id
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

REVOKE ALL ON FUNCTION public.create_commerce_cash_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_cash_sale(jsonb) TO authenticated;

-- The offline-sync bridge already resolves and validates its own
-- cash_session_id/terminal_id before this point; it now forwards them into
-- the same create_commerce_cash_sale path used online, so both checkout
-- routes stamp commercial_sales identically.
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
    v_sale_result := public.create_commerce_cash_sale(v_sale_payload);
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

-- POS-06 core fix: the session's theoretical cash (server_cash_total) and
-- everything derived from it (server_article_total, server_service_total,
-- server_ticket_count, server_difference) now come from every CONFIRMED,
-- CASH-settled commercial_sales row stamped with this cash_session_id --
-- online or offline-synced alike -- instead of commerce_pos_offline_receipts
-- alone. The declared-vs-offline totals_match check keeps its original,
-- narrower meaning (did every offline ticket for this session finish
-- syncing before close) using its own offline-only variables, so a session
-- made of online sales no longer needs a fabricated 0 to reach SYNCED.
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
  -- stamped with this session, whichever checkout route created it.
  SELECT
    count(*)::integer,
    COALESCE(sum(article_line.total), 0),
    COALESCE(sum(service_line.total), 0),
    COALESCE(sum(operation.amount), 0)
  INTO v_server_ticket_count, v_server_article_total, v_server_service_total, v_server_cash_total
  FROM public.commercial_sales AS sale
  JOIN public.commercial_invoice_payments AS payment
    ON payment.sale_id = sale.id AND payment.status = 'CONFIRMED'
  JOIN public.finance_operations AS operation
    ON operation.module = 'COMMERCIAL_INVOICE_PAYMENT'
    AND operation.module_id = payment.id
    AND operation.status <> 'CANCELLED'
    AND operation.payment_method = 'CASH'
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

REVOKE ALL ON FUNCTION public.sync_commerce_pos_cash_session_close(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_commerce_pos_cash_session_close(jsonb) TO authenticated;

-- The cockpit's "theoretical" figure must be the same number the difference
-- is computed from. Before POS-06 it showed the device-declared value (0 for
-- any session made of online sales) next to a server-computed difference,
-- which is exactly the mismatch STORE-04 traced. get_commerce_cash_remittance_workspace
-- already used server_cash_total here; this brings the store cockpit in line.
CREATE OR REPLACE FUNCTION public.get_commerce_store_cockpit(p_location_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_profitability jsonb;
  v_stock_summary jsonb;
  v_financial_access boolean := public.user_has_permission('store.financial.read');
  v_stock_valuation_access boolean := public.user_has_permission('store.stock_valuation.read');
  v_expenses_read_access boolean := public.user_has_permission('store.expenses.read');
  v_expenses_create_access boolean := public.user_has_permission('store.expenses.create');
  v_expenses_confirm_access boolean := public.user_has_permission('store.expenses.confirm');
  v_cash_access boolean := public.user_has_permission('commerce.cash.read');
  v_stock_access boolean := public.user_has_permission('commerce.stock.read');
BEGIN
  PERFORM public.permission_require('commerce.pos.read');
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Periode invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.user_has_permission('locations.manage')
    OR public.user_has_permission('commerce.stock.receive')
    OR v_financial_access
    OR v_expenses_read_access
  ) THEN
    RAISE EXCEPTION 'Acces refuse au pilotage du magasin.' USING ERRCODE = '42501';
  END IF;

  IF v_financial_access THEN
    v_profitability := public.get_commerce_store_profitability(p_location_id, p_from, p_to);
  END IF;
  IF v_stock_valuation_access THEN
    v_stock_summary := public.get_commerce_store_stock_valuation(p_location_id);
  END IF;

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'access', jsonb_build_object(
      'financial', v_financial_access,
      'stockValuation', v_stock_valuation_access,
      'expensesRead', v_expenses_read_access,
      'expensesCreate', v_expenses_create_access,
      'expensesConfirm', v_expenses_confirm_access,
      'cash', v_cash_access,
      'stock', v_stock_access
    ),
    'location', jsonb_build_object(
      'id', location_row.id,
      'name', location_row.name,
      'code', location_row.code,
      'status', location_row.status,
      'address', location_row.address,
      'openedAt', location_row.created_at::date,
      'manager', (
        SELECT jsonb_build_object(
          'id', assignment_row.user_id,
          'name', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur')
        )
        FROM public.business_location_assignments assignment_row
        LEFT JOIN public.profiles profile_row ON profile_row.id = assignment_row.user_id
        WHERE assignment_row.business_location_id = p_location_id
          AND assignment_row.assignment_role = 'STORE_MANAGER'
          AND assignment_row.end_date IS NULL
        ORDER BY assignment_row.start_date DESC, assignment_row.created_at DESC
        LIMIT 1
      ),
      'lastActivityAt', (
        SELECT max(activity_at)
        FROM (
          SELECT max(sale_row.created_at) AS activity_at FROM public.commercial_sales sale_row WHERE sale_row.business_location_id = p_location_id
          UNION ALL SELECT max(expense_row.created_at) FROM public.commerce_store_expenses expense_row WHERE expense_row.business_location_id = p_location_id
          UNION ALL SELECT max(charge_row.created_at) FROM public.commerce_store_planned_expenses charge_row WHERE charge_row.business_location_id = p_location_id
          UNION ALL SELECT max(movement_row.created_at) FROM public.stock_movements movement_row WHERE movement_row.business_location_id = p_location_id
          UNION ALL SELECT max(closure_row.received_at_server) FROM public.commerce_pos_cash_session_closures closure_row WHERE closure_row.business_location_id = p_location_id
          UNION ALL SELECT max(receipt_row.received_at_server) FROM public.commerce_pos_offline_receipts receipt_row WHERE receipt_row.business_location_id = p_location_id
        ) activity_rows
      )
    ),
    'wallets', CASE WHEN v_financial_access OR v_cash_access THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wallet_row.id, 'name', wallet_row.name, 'purpose', mapping_row.purpose,
        'isPrimary', mapping_row.is_primary, 'balance', wallet_row.balance
      ) ORDER BY mapping_row.is_primary DESC, wallet_row.name)
      FROM public.business_location_wallets mapping_row
      JOIN public.wallets wallet_row ON wallet_row.id = mapping_row.wallet_id
      WHERE mapping_row.business_location_id = p_location_id AND mapping_row.is_active
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'profitability', CASE WHEN v_financial_access THEN v_profitability ELSE NULL END,
    'costCertification', CASE WHEN v_financial_access THEN jsonb_build_object(
      'firstSnapshotAt', (
        SELECT min(line_cost.recorded_at)
        FROM public.commercial_sale_line_costs line_cost
        JOIN public.commercial_sale_lines line_row ON line_row.id = line_cost.sale_line_id
        JOIN public.commercial_sales sale_row ON sale_row.id = line_row.sale_id
        WHERE sale_row.business_location_id = p_location_id
      ),
      'selectedPeriodCertified', coalesce((v_profitability ->> 'isComplete')::boolean, false)
    ) ELSE NULL END,
    'sales', CASE WHEN v_financial_access THEN jsonb_build_object(
      'ticketCount', (
        SELECT count(*) FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
          AND sale_row.sale_date BETWEEN p_from AND p_to
      ),
      'averageBasket', COALESCE((
        SELECT round(avg(ticket_total), 2)
        FROM (
          SELECT sum(line_row.line_total) AS ticket_total
          FROM public.commercial_sales sale_row
          JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
            AND sale_row.sale_date BETWEEN p_from AND p_to
          GROUP BY sale_row.id
        ) ticket_rows
      ), 0),
      'cancelledCount', (
        SELECT count(*) FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CANCELLED'
          AND sale_row.sale_date BETWEEN p_from AND p_to
      ),
      'recent', COALESCE((
        SELECT jsonb_agg(to_jsonb(recent_row) ORDER BY recent_row."createdAt" DESC)
        FROM (
          SELECT sale_row.id, sale_row.sale_number AS "saleNumber", sale_row.sale_date AS "saleDate",
            sale_row.status, sale_row.reference, sale_row.created_at AS "createdAt",
            COALESCE(sum(line_row.line_total), 0) AS total,
            count(*) FILTER (WHERE line_row.line_type = 'ARTICLE') AS "articleLines",
            count(*) FILTER (WHERE line_row.line_type = 'SERVICE') AS "serviceLines"
          FROM public.commercial_sales sale_row
          LEFT JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.sale_date BETWEEN p_from AND p_to
          GROUP BY sale_row.id
          ORDER BY sale_row.created_at DESC
          LIMIT 30
        ) recent_row
      ), '[]'::jsonb),
      'topItems', COALESCE((
        SELECT jsonb_agg(to_jsonb(top_row) ORDER BY top_row.revenue DESC, top_row.quantity DESC)
        FROM (
          SELECT line_row.inventory_item_id AS id, line_row.description AS name,
            sum(line_row.quantity) AS quantity, sum(line_row.line_total) AS revenue
          FROM public.commercial_sales sale_row
          JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
            AND sale_row.sale_date BETWEEN p_from AND p_to AND line_row.line_type = 'ARTICLE'
          GROUP BY line_row.inventory_item_id, line_row.description
          ORDER BY revenue DESC, quantity DESC
          LIMIT 10
        ) top_row
      ), '[]'::jsonb),
      'services', COALESCE((
        SELECT jsonb_agg(to_jsonb(service_row) ORDER BY service_row.revenue DESC)
        FROM (
          SELECT line_row.description AS name, sum(line_row.quantity) AS quantity, sum(line_row.line_total) AS revenue
          FROM public.commercial_sales sale_row
          JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
            AND sale_row.sale_date BETWEEN p_from AND p_to AND line_row.line_type = 'SERVICE'
          GROUP BY line_row.description
          ORDER BY revenue DESC
          LIMIT 20
        ) service_row
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'stock', CASE WHEN v_stock_valuation_access THEN v_stock_summary || jsonb_build_object(
      'lowStockCount', (
        SELECT count(*) FROM public.business_location_inventory_items local_item
        WHERE local_item.business_location_id = p_location_id AND local_item.reorder_level IS NOT NULL
          AND local_item.quantity <= local_item.reorder_level
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', item_row.id, 'sku', item_row.sku, 'name', item_row.nom, 'unit', item_row.unite,
          'quantity', local_item.quantity, 'unitCost', cost_state.current_unit_cost,
          'costValue', cost_state.inventory_value, 'salePrice', local_item.sale_price,
          'potentialSaleValue', round(local_item.quantity * local_item.sale_price, 2),
          'potentialMargin', round(local_item.quantity * local_item.sale_price, 2) - cost_state.inventory_value,
          'reorderLevel', local_item.reorder_level,
          'isLow', local_item.reorder_level IS NOT NULL AND local_item.quantity <= local_item.reorder_level
        ) ORDER BY item_row.nom)
        FROM public.business_location_inventory_items local_item
        JOIN public.inventory_items item_row ON item_row.id = local_item.inventory_item_id
        LEFT JOIN public.commerce_inventory_cost_states cost_state
          ON cost_state.business_location_id = local_item.business_location_id
          AND cost_state.inventory_item_id = local_item.inventory_item_id
        WHERE local_item.business_location_id = p_location_id
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'expenses', CASE WHEN v_expenses_read_access THEN jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(expense_view) ORDER BY expense_view."expenseDate" DESC, expense_view."createdAt" DESC)
        FROM (
          SELECT expense_row.id, expense_row.category, expense_row.amount,
            expense_row.expense_date AS "expenseDate", expense_row.status, expense_row.description,
            expense_row.reference, expense_row.created_at AS "createdAt", expense_row.confirmed_at AS "confirmedAt",
            coalesce(NULLIF(creator.full_name, ''), NULLIF(creator.username, ''), 'Utilisateur') AS "createdBy",
            coalesce(NULLIF(confirmer.full_name, ''), NULLIF(confirmer.username, ''), NULL) AS "confirmedBy",
            wallet_row.id AS "walletId", wallet_row.name AS "walletName",
            operation_row.id AS "operationId", operation_row.reference AS "financeReference"
          FROM public.commerce_store_expenses expense_row
          LEFT JOIN public.profiles creator ON creator.id = expense_row.created_by
          LEFT JOIN public.profiles confirmer ON confirmer.id = expense_row.confirmed_by
          LEFT JOIN public.wallets wallet_row ON wallet_row.id = expense_row.wallet_id
          LEFT JOIN public.finance_commerce_store_expense_links expense_link ON expense_link.store_expense_id = expense_row.id
          LEFT JOIN public.finance_operations operation_row ON operation_row.id = expense_link.operation_id
          WHERE expense_row.business_location_id = p_location_id
            AND expense_row.expense_date BETWEEN p_from AND p_to
          ORDER BY expense_row.expense_date DESC, expense_row.created_at DESC
          LIMIT 100
        ) expense_view
      ), '[]'::jsonb),
      'planned', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', charge_row.id, 'category', charge_row.category, 'expectedAmount', charge_row.expected_amount,
          'dueDate', charge_row.due_date, 'status', charge_row.status, 'reference', charge_row.reference,
          'description', charge_row.description, 'paidExpenseId', charge_row.paid_expense_id,
          'createdAt', charge_row.created_at,
          'timing', CASE WHEN charge_row.status = 'PLANNED' AND charge_row.due_date < current_date THEN 'OVERDUE'
            WHEN charge_row.status = 'PLANNED' THEN 'UPCOMING' ELSE charge_row.status END
        ) ORDER BY (charge_row.status = 'PLANNED') DESC, charge_row.due_date)
        FROM public.commerce_store_planned_expenses charge_row
        WHERE charge_row.business_location_id = p_location_id
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'cash', CASE WHEN v_cash_access THEN jsonb_build_object(
      'reviewRequiredCount', (
        SELECT count(*) FROM public.commerce_pos_cash_session_closures closure_row
        WHERE closure_row.business_location_id = p_location_id AND closure_row.status = 'REVIEW_REQUIRED'
          AND closure_row.closed_at_device::date BETWEEN p_from AND p_to
      ),
      'unclosedSessionCount', (
        SELECT count(*) FROM (
          SELECT DISTINCT receipt_row.cash_session_id
          FROM public.commerce_pos_offline_receipts receipt_row
          LEFT JOIN public.commerce_pos_cash_session_closures closure_row ON closure_row.cash_session_id = receipt_row.cash_session_id
          WHERE receipt_row.business_location_id = p_location_id AND closure_row.id IS NULL
        ) open_sessions
      ),
      'closures', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', closure_row.id, 'cashSessionId', closure_row.cash_session_id, 'terminalId', closure_row.terminal_id,
          'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
          'openedAt', closure_row.opened_at_device, 'closedAt', closure_row.closed_at_device,
          'theoreticalCash', closure_row.server_cash_total, 'countedCash', closure_row.counted_cash,
          'difference', closure_row.server_difference, 'status', closure_row.status,
          'totalsMatch', closure_row.totals_match
        ) ORDER BY closure_row.closed_at_device DESC)
        FROM public.commerce_pos_cash_session_closures closure_row
        LEFT JOIN public.profiles profile_row ON profile_row.id = closure_row.cashier_user_id
        WHERE closure_row.business_location_id = p_location_id
          AND closure_row.closed_at_device::date BETWEEN p_from AND p_to
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'remittances', CASE WHEN v_cash_access THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', remittance_row.id, 'date', remittance_row.remittance_date, 'amount', remittance_row.amount,
        'status', remittance_row.status, 'reference', remittance_row.reference,
        'sourceWallet', source_wallet.name, 'destinationWallet', destination_wallet.name
      ) ORDER BY remittance_row.remittance_date DESC, remittance_row.created_at DESC)
      FROM public.commerce_cash_remittances remittance_row
      JOIN public.wallets source_wallet ON source_wallet.id = remittance_row.source_wallet_id
      JOIN public.wallets destination_wallet ON destination_wallet.id = remittance_row.destination_wallet_id
      WHERE remittance_row.business_location_id = p_location_id
        AND remittance_row.remittance_date BETWEEN p_from AND p_to
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'finance', CASE WHEN v_financial_access THEN jsonb_build_object(
      'inflows', COALESCE((
        SELECT sum(CASE
          WHEN operation_row.wallet_id = mapping_row.wallet_id AND operation_row.type = 'REVENUE' THEN operation_row.amount
          WHEN operation_row.destination_wallet_id = mapping_row.wallet_id AND operation_row.type = 'TRANSFER' THEN operation_row.amount
          ELSE 0 END)
        FROM public.finance_operations operation_row
        JOIN public.business_location_wallets mapping_row
          ON mapping_row.business_location_id = p_location_id AND mapping_row.is_active
          AND (mapping_row.wallet_id = operation_row.wallet_id OR mapping_row.wallet_id = operation_row.destination_wallet_id)
        WHERE operation_row.operation_date BETWEEN p_from AND p_to AND COALESCE(operation_row.status, 'VALIDE') <> 'CANCELLED'
      ), 0),
      'outflows', COALESCE((
        SELECT sum(CASE
          WHEN operation_row.wallet_id = mapping_row.wallet_id AND operation_row.type IN ('EXPENSE','TRANSFER') THEN operation_row.amount
          ELSE 0 END)
        FROM public.finance_operations operation_row
        JOIN public.business_location_wallets mapping_row
          ON mapping_row.business_location_id = p_location_id AND mapping_row.is_active
          AND mapping_row.wallet_id = operation_row.wallet_id
        WHERE operation_row.operation_date BETWEEN p_from AND p_to AND COALESCE(operation_row.status, 'VALIDE') <> 'CANCELLED'
      ), 0),
      'operations', COALESCE((
        SELECT jsonb_agg(to_jsonb(operation_view) ORDER BY operation_view."createdAt" DESC)
        FROM (
          SELECT DISTINCT operation_row.id, operation_row.operation_date AS date, operation_row.type,
            operation_row.amount, operation_row.category, operation_row.description, operation_row.reference,
            operation_row.status, operation_row.origin, operation_row.created_at AS "createdAt",
            wallet_row.name AS "walletName"
          FROM public.finance_operations operation_row
          JOIN public.business_location_wallets mapping_row
            ON mapping_row.business_location_id = p_location_id AND mapping_row.is_active
            AND (mapping_row.wallet_id = operation_row.wallet_id OR mapping_row.wallet_id = operation_row.destination_wallet_id)
          LEFT JOIN public.wallets wallet_row ON wallet_row.id = operation_row.wallet_id
          WHERE operation_row.operation_date BETWEEN p_from AND p_to
          ORDER BY operation_row.created_at DESC
          LIMIT 50
        ) operation_view
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'sync', CASE WHEN v_cash_access THEN jsonb_build_object(
      'processedCount', (
        SELECT count(*) FROM public.commerce_pos_offline_receipts receipt_row
        WHERE receipt_row.business_location_id = p_location_id AND receipt_row.status = 'PROCESSED'
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
      ),
      'conflictCount', (
        SELECT count(*) FROM public.commerce_pos_offline_receipts receipt_row
        WHERE receipt_row.business_location_id = p_location_id AND receipt_row.status = 'CONFLICT'
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
      ),
      'pendingCount', NULL,
      'receipts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', receipt_row.id, 'offlineSaleId', receipt_row.offline_sale_id,
          'terminalId', receipt_row.terminal_id,
          'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
          'createdAtDevice', receipt_row.created_at_device, 'receivedAtServer', receipt_row.received_at_server,
          'status', receipt_row.status, 'saleId', receipt_row.server_sale_id,
          'errorCode', receipt_row.error_code, 'errorMessage', receipt_row.error_message
        ) ORDER BY receipt_row.received_at_server DESC)
        FROM public.commerce_pos_offline_receipts receipt_row
        LEFT JOIN public.profiles profile_row ON profile_row.id = receipt_row.cashier_user_id
        WHERE receipt_row.business_location_id = p_location_id
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'attention', COALESCE((
      SELECT jsonb_agg(to_jsonb(attention_row) ORDER BY attention_row.priority, attention_row.date)
      FROM (
        SELECT 'PLANNED_EXPENSE'::text AS type, charge_row.id::text AS id,
          CASE WHEN charge_row.due_date < current_date THEN 1 ELSE 2 END AS priority,
          charge_row.due_date AS date,
          CASE WHEN charge_row.due_date < current_date THEN 'Charge en retard' ELSE 'Charge a payer prochainement' END AS title,
          charge_row.description AS detail
        FROM public.commerce_store_planned_expenses charge_row
        WHERE v_expenses_read_access AND charge_row.business_location_id = p_location_id
          AND charge_row.status = 'PLANNED' AND charge_row.due_date <= current_date + 7
        UNION ALL
        SELECT 'CASH_REVIEW', closure_row.id::text, 1, closure_row.closed_at_device::date,
          'Ecart de caisse a verifier', 'Session ' || closure_row.cash_session_id || ' : ' || closure_row.server_difference || ' FCFA'
        FROM public.commerce_pos_cash_session_closures closure_row
        WHERE v_cash_access AND closure_row.business_location_id = p_location_id AND closure_row.status = 'REVIEW_REQUIRED'
        UNION ALL
        SELECT 'SYNC_CONFLICT', receipt_row.id::text, 1, receipt_row.received_at_server::date,
          'Conflit de synchronisation POS', receipt_row.offline_sale_id || coalesce(' : ' || receipt_row.error_message, '')
        FROM public.commerce_pos_offline_receipts receipt_row
        WHERE v_cash_access AND receipt_row.business_location_id = p_location_id AND receipt_row.status = 'CONFLICT'
        UNION ALL
        SELECT 'LOW_STOCK', local_item.id::text, 2, current_date,
          'Stock faible', item_row.nom || ' : ' || local_item.quantity || ' ' || coalesce(item_row.unite, 'unite')
        FROM public.business_location_inventory_items local_item
        JOIN public.inventory_items item_row ON item_row.id = local_item.inventory_item_id
        WHERE v_stock_access AND local_item.business_location_id = p_location_id
          AND local_item.reorder_level IS NOT NULL AND local_item.quantity <= local_item.reorder_level
        UNION ALL
        SELECT 'WALLET', wallet_row.id::text, 1, current_date,
          CASE WHEN wallet_row.balance < 0 THEN 'Wallet negatif' ELSE 'Wallet vide' END,
          wallet_row.name || ' : ' || wallet_row.balance || ' FCFA'
        FROM public.business_location_wallets mapping_row
        JOIN public.wallets wallet_row ON wallet_row.id = mapping_row.wallet_id
        WHERE v_financial_access AND mapping_row.business_location_id = p_location_id
          AND mapping_row.is_active AND wallet_row.balance <= 0
      ) attention_row
    ), '[]'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(to_jsonb(timeline_row) ORDER BY timeline_row."occurredAt" DESC)
      FROM (
        SELECT 'SALE'::text AS type, sale_row.id::text AS id, sale_row.created_at AS "occurredAt",
          sale_row.sale_number AS title, sale_row.status AS status,
          CASE WHEN v_financial_access THEN COALESCE(sum(line_row.line_total), 0)::text || ' FCFA' ELSE NULL END AS detail
        FROM public.commercial_sales sale_row
        LEFT JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
        WHERE sale_row.business_location_id = p_location_id AND sale_row.sale_date BETWEEN p_from AND p_to
        GROUP BY sale_row.id
        UNION ALL
        SELECT 'EXPENSE', expense_row.id::text, expense_row.created_at,
          expense_row.description, expense_row.status,
          CASE WHEN v_expenses_read_access THEN expense_row.amount::text || ' FCFA' ELSE NULL END
        FROM public.commerce_store_expenses expense_row
        WHERE v_expenses_read_access AND expense_row.business_location_id = p_location_id
          AND expense_row.expense_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'REMITTANCE', remittance_row.id::text, remittance_row.created_at,
          coalesce(remittance_row.reference, 'Versement caisse'), remittance_row.status,
          CASE WHEN v_cash_access THEN remittance_row.amount::text || ' FCFA' ELSE NULL END
        FROM public.commerce_cash_remittances remittance_row
        WHERE v_cash_access AND remittance_row.business_location_id = p_location_id
          AND remittance_row.remittance_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'STOCK_RECEIPT', movement_row.id::text, movement_row.created_at,
          coalesce(movement_row.reference, 'Reception stock'), movement_row.status,
          item_row.nom || ' x ' || movement_row.quantity
        FROM public.stock_movements movement_row
        JOIN public.inventory_items item_row ON item_row.id = movement_row.inventory_item_id
        WHERE v_stock_access AND movement_row.business_location_id = p_location_id
          AND movement_row.movement_type = 'PURCHASE' AND movement_row.movement_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT CASE WHEN closure_row.status = 'REVIEW_REQUIRED' THEN 'CASH_DIFFERENCE' ELSE 'CASH_CLOSURE' END,
          closure_row.id::text, closure_row.closed_at_device,
          'Cloture ' || closure_row.cash_session_id, closure_row.status,
          CASE WHEN v_cash_access THEN closure_row.server_difference::text || ' FCFA' ELSE NULL END
        FROM public.commerce_pos_cash_session_closures closure_row
        WHERE v_cash_access AND closure_row.business_location_id = p_location_id
          AND closure_row.closed_at_device::date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'POS_SYNC', receipt_row.id::text, receipt_row.received_at_server,
          receipt_row.offline_sale_id, receipt_row.status, receipt_row.error_message
        FROM public.commerce_pos_offline_receipts receipt_row
        WHERE v_cash_access AND receipt_row.business_location_id = p_location_id
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
        ORDER BY "occurredAt" DESC
        LIMIT 150
      ) timeline_row
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.business_locations location_row
  JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = p_location_id AND unit_row.code = 'COMMERCE';

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Magasin Commerce introuvable.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_store_cockpit(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_store_cockpit(uuid, date, date) TO authenticated;
