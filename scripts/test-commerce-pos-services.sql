-- POS-03B end-to-end checks. Every record created below is reverted by the
-- final ROLLBACK. Suspended tickets intentionally have no SQL test here: they
-- are local drafts stored on the cashier's device and create no server record.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_wallet_id uuid;
  v_location_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_service_reference text;
  v_mixed_reference text;
  v_service_result jsonb;
  v_service_retry jsonb;
  v_mixed_result jsonb;
  v_mixed_retry jsonb;
  v_service_sale_id uuid;
  v_mixed_sale_id uuid;
  v_service_payment_id uuid;
  v_mixed_payment_id uuid;
  v_service_line_count integer;
  v_service_stock_link_count integer;
  v_mixed_stock_link_count integer;
  v_mixed_service_stock_link_count integer;
  v_wallet_balance numeric(14, 2);
  v_item_stock numeric(14, 3);
  v_location_stock numeric(14, 3);
  v_sale_count integer;
  v_invoice_count integer;
  v_payment_count integer;
  v_finance_count integer;
BEGIN
  SELECT user_id
  INTO v_actor_id
  FROM public.user_roles
  WHERE role = 'super_admin'::public.app_role
  ORDER BY user_id
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'POS-03B test requires one existing super_admin test actor.';
  END IF;

  -- Exercise the RPC with the same authenticated identity mechanism used by
  -- Supabase, while keeping all test records inside this transaction.
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  IF NOT public.user_has_permission('commerce.pos.sell') THEN
    RAISE EXCEPTION 'The POS-03B actor does not have commerce.pos.sell.';
  END IF;
  IF has_function_privilege('anon', 'public.create_commerce_cash_sale(jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_commerce_cash_sale(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POS checkout grants are not restricted to authenticated users.';
  END IF;

  SELECT id
  INTO v_commerce_unit_id
  FROM public.business_units
  WHERE code = 'COMMERCE' AND status = 'ACTIVE';

  IF v_commerce_unit_id IS NULL THEN
    RAISE EXCEPTION 'The active COMMERCE business unit is missing.';
  END IF;

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST POS-03B ' || v_token, 'CASH', 0, 0, false)
  RETURNING id INTO v_wallet_id;

  INSERT INTO public.business_locations(
    business_unit_id, code, name, location_type, status, created_by, updated_by
  ) VALUES (
    v_commerce_unit_id, 'POS3B' || v_token, 'Test POS-03B ' || v_token,
    'STORE', 'ACTIVE', v_actor_id, v_actor_id
  ) RETURNING id INTO v_location_id;

  INSERT INTO public.business_location_wallets(
    business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by
  ) VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);

  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('POS3B-' || v_token, 'Article test POS-03B', 'TEST', 'PIECE', 5, 0)
  RETURNING id INTO v_item_id;

  INSERT INTO public.business_location_inventory_items(
    business_location_id, inventory_item_id, quantity, sale_price
  ) VALUES (v_location_id, v_item_id, 5, 500);

  -- A service-only ticket must create a sale, invoice, confirmed payment and
  -- one revenue operation, without ever changing physical stock.
  v_service_reference := 'POS:TEST-SERVICE-' || v_token;
  v_service_result := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id,
    'payment_method', 'CASH',
    'reference', v_service_reference,
    'lines', jsonb_build_array(jsonb_build_object(
      'line_type', 'SERVICE',
      'service_name', 'Pose de protection test',
      'service_note', 'Validation POS-03B',
      'quantity', 1,
      'unit_price', 15000
    ))
  ));
  v_service_retry := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id,
    'payment_method', 'CASH',
    'reference', v_service_reference,
    'lines', jsonb_build_array(jsonb_build_object(
      'line_type', 'SERVICE',
      'service_name', 'Pose de protection test',
      'service_note', 'Validation POS-03B',
      'quantity', 1,
      'unit_price', 15000
    ))
  ));

  IF (v_service_result ->> 'saleId') IS DISTINCT FROM (v_service_retry ->> 'saleId')
    OR (v_service_result ->> 'operationId') IS DISTINCT FROM (v_service_retry ->> 'operationId')
    OR (v_service_result ->> 'amount')::numeric <> 15000 THEN
    RAISE EXCEPTION 'Service-only POS retry is not idempotent.';
  END IF;

  v_service_sale_id := (v_service_result ->> 'saleId')::uuid;
  v_service_payment_id := (v_service_result ->> 'paymentId')::uuid;

  SELECT count(*)
  INTO v_service_line_count
  FROM public.commercial_sale_lines
  WHERE sale_id = v_service_sale_id
    AND line_type = 'SERVICE'
    AND inventory_item_id IS NULL
    AND description = 'Pose de protection test'
    AND line_total = 15000;

  SELECT count(*)
  INTO v_service_stock_link_count
  FROM public.commercial_sale_stock_movement_links AS link_row
  JOIN public.commercial_sale_lines AS line_row ON line_row.id = link_row.sale_line_id
  WHERE line_row.sale_id = v_service_sale_id;

  IF v_service_line_count <> 1 OR v_service_stock_link_count <> 0 THEN
    RAISE EXCEPTION 'A service must be persisted once without a stock movement.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.commercial_invoices AS invoice_row
    JOIN public.commercial_invoice_payments AS payment_row ON payment_row.invoice_id = invoice_row.id
    JOIN public.finance_commercial_invoice_payment_links AS finance_link ON finance_link.payment_id = payment_row.id
    JOIN public.finance_operations AS operation_row ON operation_row.id = finance_link.operation_id
    WHERE invoice_row.sale_id = v_service_sale_id
      AND invoice_row.status = 'PAID'
      AND invoice_row.total_amount = 15000
      AND payment_row.id = v_service_payment_id
      AND payment_row.status = 'CONFIRMED'
      AND payment_row.amount = 15000
      AND operation_row.wallet_id = v_wallet_id
      AND operation_row.type = 'REVENUE'
      AND operation_row.amount = 15000
      AND operation_row.status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'Service-only sale did not create the expected invoice, payment and revenue operation.';
  END IF;

  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_balance <> 15000 THEN
    RAISE EXCEPTION 'Service-only sale did not credit its wallet exactly once (%).', v_wallet_balance;
  END IF;

  -- A mixed ticket proves that only the ARTICLE line decrements stock, while
  -- both lines contribute to the single payment and revenue operation.
  v_mixed_reference := 'POS:TEST-MIXED-' || v_token;
  v_mixed_result := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id,
    'payment_method', 'CASH',
    'reference', v_mixed_reference,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'line_type', 'ARTICLE',
        'inventory_item_id', v_item_id,
        'quantity', 2,
        'unit_price', 500
      ),
      jsonb_build_object(
        'line_type', 'SERVICE',
        'service_name', 'Configuration test',
        'service_note', 'Sans impact stock',
        'quantity', 1,
        'unit_price', 15000
      )
    )
  ));
  v_mixed_retry := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id,
    'payment_method', 'CASH',
    'reference', v_mixed_reference,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'line_type', 'ARTICLE',
        'inventory_item_id', v_item_id,
        'quantity', 2,
        'unit_price', 500
      ),
      jsonb_build_object(
        'line_type', 'SERVICE',
        'service_name', 'Configuration test',
        'service_note', 'Sans impact stock',
        'quantity', 1,
        'unit_price', 15000
      )
    )
  ));

  IF (v_mixed_result ->> 'saleId') IS DISTINCT FROM (v_mixed_retry ->> 'saleId')
    OR (v_mixed_result ->> 'operationId') IS DISTINCT FROM (v_mixed_retry ->> 'operationId')
    OR (v_mixed_result ->> 'amount')::numeric <> 16000 THEN
    RAISE EXCEPTION 'Mixed POS retry is not idempotent.';
  END IF;

  v_mixed_sale_id := (v_mixed_result ->> 'saleId')::uuid;
  v_mixed_payment_id := (v_mixed_result ->> 'paymentId')::uuid;

  SELECT stock_actuel INTO v_item_stock FROM public.inventory_items WHERE id = v_item_id;
  SELECT quantity INTO v_location_stock
  FROM public.business_location_inventory_items
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;

  SELECT count(*)
  INTO v_mixed_stock_link_count
  FROM public.commercial_sale_stock_movement_links AS link_row
  JOIN public.commercial_sale_lines AS line_row ON line_row.id = link_row.sale_line_id
  JOIN public.stock_movements AS movement_row ON movement_row.id = link_row.stock_movement_id
  WHERE line_row.sale_id = v_mixed_sale_id
    AND line_row.line_type = 'ARTICLE'
    AND movement_row.movement_type = 'SALE'
    AND movement_row.quantity = 2;

  SELECT count(*)
  INTO v_mixed_service_stock_link_count
  FROM public.commercial_sale_stock_movement_links AS link_row
  JOIN public.commercial_sale_lines AS line_row ON line_row.id = link_row.sale_line_id
  WHERE line_row.sale_id = v_mixed_sale_id
    AND line_row.line_type = 'SERVICE';

  IF v_item_stock <> 3 OR v_location_stock <> 3
    OR v_mixed_stock_link_count <> 1 OR v_mixed_service_stock_link_count <> 0 THEN
    RAISE EXCEPTION 'Mixed ticket stock behavior is incorrect: item %, location %, article links %, service links %.',
      v_item_stock, v_location_stock, v_mixed_stock_link_count, v_mixed_service_stock_link_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.commercial_invoices AS invoice_row
    JOIN public.commercial_invoice_payments AS payment_row ON payment_row.invoice_id = invoice_row.id
    JOIN public.finance_commercial_invoice_payment_links AS finance_link ON finance_link.payment_id = payment_row.id
    JOIN public.finance_operations AS operation_row ON operation_row.id = finance_link.operation_id
    WHERE invoice_row.sale_id = v_mixed_sale_id
      AND invoice_row.status = 'PAID'
      AND invoice_row.total_amount = 16000
      AND payment_row.id = v_mixed_payment_id
      AND payment_row.status = 'CONFIRMED'
      AND payment_row.amount = 16000
      AND operation_row.wallet_id = v_wallet_id
      AND operation_row.type = 'REVENUE'
      AND operation_row.amount = 16000
      AND operation_row.status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'Mixed sale did not create the expected invoice, payment and revenue operation.';
  END IF;

  SELECT count(*) INTO v_sale_count
  FROM public.commercial_sales
  WHERE business_location_id = v_location_id
    AND reference IN (v_service_reference, v_mixed_reference);
  SELECT count(*) INTO v_invoice_count
  FROM public.commercial_invoices
  WHERE sale_id IN (v_service_sale_id, v_mixed_sale_id);
  SELECT count(*) INTO v_payment_count
  FROM public.commercial_invoice_payments
  WHERE sale_id IN (v_service_sale_id, v_mixed_sale_id)
    AND status = 'CONFIRMED';
  SELECT count(*) INTO v_finance_count
  FROM public.finance_operations
  WHERE wallet_id = v_wallet_id
    AND origin = 'COMMERCE_POS_PAYMENT'
    AND status <> 'CANCELLED';
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;

  IF v_sale_count <> 2 OR v_invoice_count <> 2 OR v_payment_count <> 2 OR v_finance_count <> 2
    OR v_wallet_balance <> 31000 THEN
    RAISE EXCEPTION 'POS service regression: sales %, invoices %, payments %, finance operations %, wallet %.',
      v_sale_count, v_invoice_count, v_payment_count, v_finance_count, v_wallet_balance;
  END IF;

  RAISE NOTICE 'POS-03B validated: service-only and mixed tickets are idempotent; stock changes only for articles; wallet credited once per ticket.';
END;
$test$;

ROLLBACK;
