-- POS-04B server synchronization checks. Everything created by this script is
-- reverted at the end; it is safe to run against a linked project.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_wallet_id uuid;
  v_location_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_simple_event_id text := 'offline-' || txid_current()::text || '-sale-simple';
  v_event_id text := 'offline-' || txid_current()::text || '-sale-a';
  v_conflict_event_id text := 'offline-' || txid_current()::text || '-sale-conflict';
  v_simple_event jsonb;
  v_simple_result jsonb;
  v_event jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_conflict jsonb;
  v_wallet_balance numeric(14, 2);
  v_item_stock numeric(14, 3);
  v_location_stock numeric(14, 3);
  v_finance_count integer;
  v_sale_count integer;
  v_invoice_count integer;
  v_payment_count integer;
  v_stock_movement_count integer;
BEGIN
  SELECT user_id INTO v_actor_id
  FROM public.user_roles
  WHERE role = 'super_admin'::public.app_role
  ORDER BY user_id
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'POS-04B test requires one existing super_admin actor.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  IF has_function_privilege('anon', 'public.sync_commerce_pos_offline_sale(jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.sync_commerce_pos_offline_sale(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The offline synchronization RPC grants are not restricted to authenticated users.';
  END IF;
  IF has_table_privilege('authenticated', 'public.commerce_pos_offline_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'public.commerce_pos_offline_receipts', 'INSERT') THEN
    RAISE EXCEPTION 'Offline receipts must not be directly exposed to authenticated users.';
  END IF;

  SELECT id INTO v_commerce_unit_id
  FROM public.business_units
  WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_commerce_unit_id IS NULL THEN
    RAISE EXCEPTION 'The active COMMERCE business unit is missing.';
  END IF;

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST POS-04B ' || v_token, 'CASH', 0, 0, false)
  RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'POS4B' || v_token, 'Test POS-04B ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('POS4B-' || v_token, 'Article test POS-04B', 'TEST', 'PIECE', 7, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 7, 5000);

  -- A simple article-only cash sale proves that the recorded cash amount,
  -- not the amount received before change, is credited once.
  v_simple_event := jsonb_build_object(
    'offline_sale_id', v_simple_event_id,
    'terminal_id', 'terminal-pos04b-' || v_token,
    'cash_session_id', 'session-pos04b-' || v_token,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now() - interval '6 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos04b-simple-' || v_token,
      'payment_method', 'CASH', 'total', 5000, 'cash_received', 6000, 'change_due', 1000,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 5000))
    )
  );
  v_simple_result := public.sync_commerce_pos_offline_sale(v_simple_event);
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  SELECT stock_actuel INTO v_item_stock FROM public.inventory_items WHERE id = v_item_id;
  SELECT quantity INTO v_location_stock
  FROM public.business_location_inventory_items
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  SELECT count(*) INTO v_finance_count
  FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND origin = 'COMMERCE_POS_PAYMENT' AND status <> 'CANCELLED';
  IF (v_simple_result ->> 'status') <> 'PROCESSED'
    OR (v_simple_result ->> 'amount')::numeric <> 5000
    OR v_wallet_balance <> 5000
    OR v_item_stock <> 6
    OR v_location_stock <> 6
    OR v_finance_count <> 1 THEN
    RAISE EXCEPTION 'Offline cash sale must credit 5000 once after 1000 change, with one stock decrement.';
  END IF;

  v_event := jsonb_build_object(
    'offline_sale_id', v_event_id,
    'terminal_id', 'terminal-pos04b-' || v_token,
    'cash_session_id', 'session-pos04b-' || v_token,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now() - interval '5 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos04b-' || v_token,
      'client_id', null,
      'payment_method', 'CASH',
      'total', 20000,
      'cash_received', 25000,
      'change_due', 5000,
      'lines', jsonb_build_array(
        jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 5000),
        jsonb_build_object('line_type', 'SERVICE', 'service_name', 'Réparation test', 'service_note', 'Sans stock', 'quantity', 1, 'unit_price', 15000)
      )
    )
  );

  v_result := public.sync_commerce_pos_offline_sale(v_event);
  v_retry := public.sync_commerce_pos_offline_sale(v_event);
  IF (v_result ->> 'status') <> 'PROCESSED'
    OR (v_result ->> 'saleId') IS DISTINCT FROM (v_retry ->> 'saleId')
    OR (v_result ->> 'operationId') IS DISTINCT FROM (v_retry ->> 'operationId')
    OR (v_result ->> 'amount')::numeric <> 20000 THEN
    RAISE EXCEPTION 'The same offline sale was not processed idempotently.';
  END IF;

  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  SELECT stock_actuel INTO v_item_stock FROM public.inventory_items WHERE id = v_item_id;
  SELECT quantity INTO v_location_stock FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  SELECT count(*) INTO v_finance_count
  FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND origin = 'COMMERCE_POS_PAYMENT' AND status <> 'CANCELLED';

  IF v_wallet_balance <> 25000 OR v_item_stock <> 5 OR v_location_stock <> 5 OR v_finance_count <> 2 THEN
    RAISE EXCEPTION 'Offline mixed sale regression: wallet %, item %, location %, finance operations %.', v_wallet_balance, v_item_stock, v_location_stock, v_finance_count;
  END IF;
  IF (SELECT count(*) FROM public.commercial_sale_lines WHERE sale_id = (v_result ->> 'saleId')::uuid AND line_type = 'SERVICE' AND inventory_item_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'The offline service line must not create an inventory source.';
  END IF;
  IF (SELECT count(*) FROM public.commerce_pos_offline_receipts WHERE offline_sale_id = v_event_id AND status = 'PROCESSED') <> 1 THEN
    RAISE EXCEPTION 'Exactly one offline receipt must be retained for a synchronized ticket.';
  END IF;

  -- An invalid total is a permanent payload failure before any business write.
  BEGIN
    PERFORM public.sync_commerce_pos_offline_sale(jsonb_set(v_event, '{offline_sale_id}', to_jsonb(v_event_id || '-invalid-total')) || jsonb_build_object(
      'payload', jsonb_set(v_event -> 'payload', '{total}', '19000'::jsonb)
    ));
    RAISE EXCEPTION 'An inconsistent offline total was accepted.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Bad terminal identifiers are rejected even before the transaction reaches the sales engine.
  BEGIN
    PERFORM public.sync_commerce_pos_offline_sale(jsonb_set(v_event, '{terminal_id}', '"bad terminal id"'::jsonb));
    RAISE EXCEPTION 'An invalid terminal identifier was accepted.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- A stock conflict is retained as an auditable receipt and must not credit the wallet.
  v_conflict := public.sync_commerce_pos_offline_sale(jsonb_build_object(
    'offline_sale_id', v_conflict_event_id,
    'terminal_id', 'terminal-pos04b-' || v_token,
    'cash_session_id', 'session-pos04b-' || v_token,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now(),
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos04b-conflict-' || v_token,
      'payment_method', 'CASH', 'total', 30000, 'cash_received', 30000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 6, 'unit_price', 5000))
    )
  ));
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  SELECT stock_actuel INTO v_item_stock FROM public.inventory_items WHERE id = v_item_id;
  SELECT quantity INTO v_location_stock
  FROM public.business_location_inventory_items
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  SELECT count(*) INTO v_sale_count
  FROM public.commercial_sales
  WHERE business_location_id = v_location_id;
  SELECT count(*) INTO v_invoice_count
  FROM public.commercial_invoices AS invoice_row
  JOIN public.commercial_sales AS sale_row ON sale_row.id = invoice_row.sale_id
  WHERE sale_row.business_location_id = v_location_id;
  SELECT count(*) INTO v_payment_count
  FROM public.commercial_invoice_payments AS payment_row
  JOIN public.commercial_sales AS sale_row ON sale_row.id = payment_row.sale_id
  WHERE sale_row.business_location_id = v_location_id AND payment_row.status = 'CONFIRMED';
  SELECT count(*) INTO v_finance_count
  FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND origin = 'COMMERCE_POS_PAYMENT' AND status <> 'CANCELLED';
  SELECT count(*) INTO v_stock_movement_count
  FROM public.stock_movements
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id AND movement_type = 'SALE';

  IF (v_conflict ->> 'status') <> 'CONFLICT'
    OR v_wallet_balance <> 25000
    OR v_item_stock <> 5
    OR v_location_stock <> 5
    OR v_sale_count <> 2
    OR v_invoice_count <> 2
    OR v_payment_count <> 2
    OR v_finance_count <> 2
    OR v_stock_movement_count <> 2 THEN
    RAISE EXCEPTION 'A stock conflict must retain the receipt without partial sale, invoice, payment, finance, wallet or stock writes.';
  END IF;

  -- An arbitrary authenticated subject has no commerce permission, so the RPC
  -- must reject it before accepting an event supplied by the browser.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
  BEGIN
    PERFORM public.sync_commerce_pos_offline_sale(v_event);
    RAISE EXCEPTION 'A caller without commerce.pos.sell was accepted.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  RAISE NOTICE 'POS-04B validated: idempotent offline sale, mixed article/service, wallet and stock once, payload and terminal rejection, conflict retention, restricted RPC.';
END;
$test$;

ROLLBACK;
