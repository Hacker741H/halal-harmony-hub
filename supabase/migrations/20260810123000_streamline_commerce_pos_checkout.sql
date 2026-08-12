-- A counter sale can be anonymous. The store's primary CASH_DRAWER wallet is
-- resolved by PostgreSQL, never chosen by a cashier's browser.

ALTER TABLE public.commercial_sales
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.commercial_invoices
  ALTER COLUMN client_id DROP NOT NULL;

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
  v_total numeric(14,2) := 0;
  v_stock_movement public.stock_movements;
  v_client_label text := 'Client comptoir';
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF p_sale IS NULL
    OR jsonb_typeof(p_sale) <> 'object'
    OR jsonb_typeof(p_sale -> 'lines') <> 'array'
    OR jsonb_array_length(p_sale -> 'lines') = 0 THEN
    RAISE EXCEPTION 'La vente caisse doit contenir au moins un article.' USING ERRCODE = '22023';
  END IF;

  IF v_location_id IS NULL OR NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  -- The cash drawer is configured by a manager. A browser payload can neither
  -- select another wallet nor alter the accounting destination of a ticket.
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
    SELECT *
    INTO v_client
    FROM public.transport_clients
    WHERE id = v_client_id
      AND status = 'ACTIVE';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Client actif introuvable.' USING ERRCODE = '23503';
    END IF;

    v_client_label := v_client.display_name;
  END IF;

  IF v_payment_method NOT IN ('CASH', 'WAVE', 'JEKO', 'CARD', 'OTHER') THEN
    RAISE EXCEPTION 'Moyen de paiement invalide.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_price := NULLIF(v_line ->> 'unit_price', '')::numeric;

    SELECT *
    INTO v_local
    FROM public.business_location_inventory_items
    WHERE business_location_id = v_location_id
      AND inventory_item_id = NULLIF(v_line ->> 'inventory_item_id', '')::uuid
    FOR UPDATE;

    IF NOT FOUND
      OR v_quantity IS NULL
      OR v_quantity <= 0
      OR v_price IS NULL
      OR v_price < 0
      OR v_local.quantity < v_quantity THEN
      RAISE EXCEPTION 'Article, quantité ou prix de vente invalide.' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + round(v_quantity * v_price, 2);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Le total de la vente doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commercial_sales (
    sale_number, status, client_id, sale_date, reference, notes,
    business_unit_id, business_location_id, created_by, updated_by, confirmed_at
  )
  SELECT
    public._internal_next_commercial_sale_number(), 'CONFIRMED', v_client_id,
    current_date, v_reference, v_notes, unit_row.id, v_location_id,
    auth.uid(), auth.uid(), now()
  FROM public.business_locations AS location_row
  JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = v_location_id
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_price := (v_line ->> 'unit_price')::numeric;

    SELECT *
    INTO v_item
    FROM public.inventory_items
    WHERE id = (v_line ->> 'inventory_item_id')::uuid;

    INSERT INTO public.commercial_sale_lines (
      sale_id, description, quantity, unit, unit_price, line_total, inventory_item_id
    ) VALUES (
      v_sale.id, v_item.nom, v_quantity, coalesce(v_item.unite, 'UNITE'),
      v_price, round(v_quantity * v_price, 2), v_item.id
    ) RETURNING id INTO v_line_id;

    UPDATE public.business_location_inventory_items
    SET quantity = quantity - v_quantity,
        updated_at = now()
    WHERE business_location_id = v_location_id
      AND inventory_item_id = v_item.id;

    UPDATE public.inventory_items
    SET stock_actuel = stock_actuel - v_quantity,
        updated_at = now()
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
