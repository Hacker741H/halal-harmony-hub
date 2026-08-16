-- GFC V1 Phase 5.5A -- unifies stock/CUMP impact across every commercial
-- sale, regardless of payment method. Before this migration, only the POS
-- cash-sale path (_internal_create_commerce_cash_sale_at) ever decremented
-- stock; the generic credit-sale path (create_commercial_sale /
-- confirm_commercial_sale) accepted inventory_item_id on a line but never
-- touched stock at all -- the payment method silently decided whether the
-- product physically left inventory, which is incoherent (found during
-- Phase 5's own audit).
--
-- One canonical primitive, _internal_apply_commercial_sale_line_stock_exit,
-- replaces POS's own inline stock-mutation block (byte-identical resulting
-- effects: same UPDATE/UPDATE/INSERT/INSERT sequence, same
-- commercial_sale_stock_movement_links row, same snapshot_commerce_sale_cost
-- trigger firing) and is newly called from confirm_commercial_sale, once
-- per ARTICLE line, immediately after the DRAFT->CONFIRMED flip, inside the
-- same transaction -- so stock never moves at DRAFT, moves exactly once at
-- CONFIRM, and any insufficient-stock exception rolls back the whole
-- confirm (including the status flip) atomically: no partially-confirmed
-- sale, no orphan invoice ever becomes reachable (create_commercial_invoice
-- already requires status='CONFIRMED').
--
-- stock_movements_check required wallet_id for every SALE movement; a
-- credit sale legitimately has no wallet at confirm time (payment, if any,
-- happens later via commercial_invoice_payments, a wallet chosen at that
-- separate moment). Widened SALE to the same shape PURCHASE already has:
-- unit_price required, wallet_id free to be NULL (credit) or set (POS).
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_check CHECK (
  (movement_type = 'SALE' AND unit_price IS NOT NULL AND unit_price >= 0)
  OR (movement_type = 'PURCHASE' AND unit_price IS NOT NULL AND unit_price >= 0)
  OR (movement_type NOT IN ('PURCHASE', 'SALE') AND wallet_id IS NULL)
);

-- Self-sufficient and idempotent: a SERVICE line or a line already linked
-- to a stock movement is a silent no-op, so a caller can loop over every
-- line in a sale without pre-filtering and without fearing a retry.
CREATE OR REPLACE FUNCTION public._internal_apply_commercial_sale_line_stock_exit(
  p_sale_line_id uuid,
  p_business_location_id uuid,
  p_wallet_id uuid,
  p_reference text,
  p_description text,
  p_client_label text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_line public.commercial_sale_lines;
  v_movement public.stock_movements;
BEGIN
  SELECT * INTO v_line FROM public.commercial_sale_lines WHERE id = p_sale_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_line.line_type <> 'ARTICLE' OR v_line.inventory_item_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_sale_stock_movement_links WHERE sale_line_id = p_sale_line_id) THEN
    RETURN;
  END IF;
  IF p_business_location_id IS NULL THEN
    RAISE EXCEPTION 'Un magasin est requis pour sortir cet article du stock.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.business_location_inventory_items
  SET quantity = quantity - v_line.quantity, updated_at = now()
  WHERE business_location_id = p_business_location_id AND inventory_item_id = v_line.inventory_item_id
    AND quantity - v_line.quantity >= 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock insuffisant pour cet article dans ce magasin.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_items SET stock_actuel = stock_actuel - v_line.quantity, updated_at = now() WHERE id = v_line.inventory_item_id;

  INSERT INTO public.stock_movements (
    inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
    movement_date, client, reference, description, status, created_by
  ) VALUES (
    v_line.inventory_item_id, 'SALE', v_line.quantity, v_line.unit_price, p_wallet_id, p_business_location_id,
    current_date, p_client_label, p_reference, p_description, 'VALID', auth.uid()
  ) RETURNING * INTO v_movement;

  INSERT INTO public.commercial_sale_stock_movement_links(sale_line_id, stock_movement_id)
  VALUES (p_sale_line_id, v_movement.id);
END;
$function$;

-- POS: byte-identical inputs/outputs, only the per-line mutation block is
-- now a call to the shared primitive instead of inline UPDATE/INSERT/INSERT.
-- Every guard, the price floor, the session/terminal validation, the
-- upfront aggregate quantity check and its user-facing error message all
-- stay exactly as they were -- this is proven, tested code, not touched
-- beyond the one block the mission asked to extract.
CREATE OR REPLACE FUNCTION public._internal_create_commerce_cash_sale_at(p_sale jsonb, p_effective_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
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

      PERFORM public._internal_apply_commercial_sale_line_stock_exit(
        v_line_id, v_location_id, v_wallet_id, v_sale.sale_number,
        'Vente caisse ' || v_sale.sale_number, v_client_label
      );
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

-- Generic path: business_location_id becomes an accepted (optional) field
-- -- required in practice only once confirm_commercial_sale finds an
-- ARTICLE line and needs somewhere to take stock from.
CREATE OR REPLACE FUNCTION public.create_commercial_sale(p_sale jsonb)
RETURNS commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_sale public.commercial_sales;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_farm_id uuid := NULLIF(p_sale ->> 'farm_id', '')::uuid;
  v_location_id uuid := NULLIF(p_sale ->> 'business_location_id', '')::uuid;
  v_unit_id uuid;
BEGIN
  PERFORM public.permission_require('sales.create');
  IF p_sale IS NULL OR jsonb_typeof(p_sale) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_sale) AS key_name
    WHERE key_name NOT IN ('client_id', 'farm_id', 'business_location_id', 'sale_date', 'reference', 'notes', 'lines')
  ) THEN
    RAISE EXCEPTION 'Les données de vente sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.transport_clients WHERE id = v_client_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Un client actif est obligatoire pour une vente.' USING ERRCODE = '23503';
  END IF;
  IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
    RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_location_id IS NOT NULL THEN
    IF NOT public.commerce_location_access_allowed(v_location_id) THEN
      RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
    END IF;
    SELECT business_unit_id INTO v_unit_id FROM public.business_locations WHERE id = v_location_id;
    IF v_unit_id IS NULL THEN RAISE EXCEPTION 'Magasin introuvable.' USING ERRCODE = '23503'; END IF;
  END IF;

  INSERT INTO public.commercial_sales(
    sale_number, client_id, farm_id, business_location_id, business_unit_id, sale_date, reference, notes, created_by, updated_by
  ) VALUES (
    public._internal_next_commercial_sale_number(), v_client_id, v_farm_id, v_location_id, v_unit_id,
    COALESCE(NULLIF(p_sale ->> 'sale_date', '')::date, current_date),
    NULLIF(btrim(p_sale ->> 'reference'), ''), NULLIF(btrim(p_sale ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_sale;

  PERFORM public._internal_upsert_commercial_sale_lines(v_sale.id, p_sale -> 'lines');
  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'CREATE', NULL, to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_commercial_sale(p_sale_id uuid, p_sale jsonb)
RETURNS commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.commercial_sales;
  v_sale public.commercial_sales;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_farm_id uuid := NULLIF(p_sale ->> 'farm_id', '')::uuid;
  v_location_id uuid := NULLIF(p_sale ->> 'business_location_id', '')::uuid;
  v_unit_id uuid;
BEGIN
  PERFORM public.permission_require('sales.update');
  IF p_sale IS NULL OR jsonb_typeof(p_sale) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_sale) AS key_name
    WHERE key_name NOT IN ('client_id', 'farm_id', 'business_location_id', 'sale_date', 'reference', 'notes', 'lines')
  ) THEN
    RAISE EXCEPTION 'Les données de vente sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une vente brouillon peut être modifiée.' USING ERRCODE = '22023';
  END IF;
  IF v_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.transport_clients WHERE id = v_client_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Un client actif est obligatoire pour une vente.' USING ERRCODE = '23503';
  END IF;
  IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
    RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_location_id IS NOT NULL THEN
    IF NOT public.commerce_location_access_allowed(v_location_id) THEN
      RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
    END IF;
    SELECT business_unit_id INTO v_unit_id FROM public.business_locations WHERE id = v_location_id;
    IF v_unit_id IS NULL THEN RAISE EXCEPTION 'Magasin introuvable.' USING ERRCODE = '23503'; END IF;
  END IF;

  UPDATE public.commercial_sales
  SET client_id = v_client_id,
      farm_id = v_farm_id,
      business_location_id = v_location_id,
      business_unit_id = v_unit_id,
      sale_date = COALESCE(NULLIF(p_sale ->> 'sale_date', '')::date, v_before.sale_date),
      reference = NULLIF(btrim(p_sale ->> 'reference'), ''),
      notes = NULLIF(btrim(p_sale ->> 'notes'), ''),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  PERFORM public._internal_upsert_commercial_sale_lines(v_sale.id, p_sale -> 'lines');
  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;

-- The unification's actual hinge: stock only ever moves here, exactly
-- once, atomically with the DRAFT->CONFIRMED flip. A retry (status already
-- CONFIRMED) returns immediately before the loop is ever reached; the
-- primitive's own per-line idempotence guard is a second, redundant safety
-- net for the same invariant, not the primary one.
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

  IF EXISTS (SELECT 1 FROM public.commercial_sale_lines WHERE sale_id = p_sale_id AND line_type = 'ARTICLE') THEN
    IF v_before.business_location_id IS NULL THEN
      RAISE EXCEPTION 'Un magasin est requis pour confirmer une vente contenant des articles.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
      RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_before.client_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.transport_clients WHERE id = v_before.client_id;
    IF FOUND THEN v_client_label := v_client.display_name; END IF;
  END IF;

  UPDATE public.commercial_sales
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT id FROM public.commercial_sale_lines WHERE sale_id = p_sale_id AND line_type = 'ARTICLE'
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

REVOKE ALL ON FUNCTION public._internal_apply_commercial_sale_line_stock_exit(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
