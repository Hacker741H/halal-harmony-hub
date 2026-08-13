-- STORE-03 remote integration tests. Every fixture and financial mutation is rolled back.
BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_cashier uuid;
  v_unit uuid;
  v_wallet uuid;
  v_destination_wallet uuid;
  v_location uuid;
  v_empty_location uuid;
  v_item uuid;
  v_sale jsonb;
  v_sale_id uuid;
  v_invoice_id uuid;
  v_expense public.commerce_store_expenses;
  v_charge public.commerce_store_planned_expenses;
  v_cancelled_charge public.commerce_store_planned_expenses;
  v_cockpit jsonb;
  v_token text := txid_current()::text;
  v_cashier_denied boolean := false;
BEGIN
  SELECT user_id INTO v_actor FROM public.user_roles
  WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'STORE-03 tests require one super_admin actor.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT id INTO v_unit FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Active COMMERCE unit missing.'; END IF;

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST STORE-03 ' || v_token, 'CASH', 50000, 50000, false) RETURNING id INTO v_wallet;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST STORE-03 DEST ' || v_token, 'BANK', 0, 0, false) RETURNING id INTO v_destination_wallet;

  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, address, created_by, updated_by)
  VALUES (v_unit, 'ST03A' || v_token, 'STORE-03 ACTIF', 'STORE', 'ACTIVE', 'Abidjan test', v_actor, v_actor)
  RETURNING id INTO v_location;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_unit, 'ST03E' || v_token, 'STORE-03 VIDE', 'STORE', 'ACTIVE', v_actor, v_actor)
  RETURNING id INTO v_empty_location;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location, v_wallet, 'CASH_DRAWER', true, true, v_actor),
    (v_empty_location, v_destination_wallet, 'CASH_DRAWER', true, true, v_actor);
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, assigned_by)
  VALUES (v_location, v_actor, 'STORE_MANAGER', current_date, v_actor);

  -- Empty stores and arbitrary periods are returned without invented activity.
  v_cockpit := public.get_commerce_store_cockpit(v_empty_location, current_date - 365, current_date);
  IF (v_cockpit #>> '{profitability,totalRevenue}')::numeric <> 0
    OR (v_cockpit #>> '{sales,ticketCount}')::integer <> 0
    OR jsonb_array_length(v_cockpit -> 'timeline') <> 0 THEN
    RAISE EXCEPTION 'Empty store cockpit is not empty: %', v_cockpit;
  END IF;

  SELECT (public.receive_commerce_inventory_item(jsonb_build_object(
    'business_location_id', v_location, 'wallet_id', v_wallet,
    'name', 'Article STORE-03 ' || v_token, 'sku', 'ST03-' || v_token,
    'quantity', 10, 'purchase_unit_price', 100, 'sale_price', 300, 'reorder_level', 8
  )) ->> 'inventoryItemId')::uuid INTO v_item;

  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location, 'payment_method', 'CASH', 'reference', 'ST03-SALE-' || v_token,
    'lines', jsonb_build_array(
      jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item, 'quantity', 2, 'unit_price', 300),
      jsonb_build_object('line_type', 'SERVICE', 'service_name', 'Service STORE-03', 'quantity', 1, 'unit_price', 1000)
    )
  ));
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  SELECT id INTO v_invoice_id FROM public.commercial_invoices WHERE sale_id = v_sale_id;

  v_expense := public.create_commerce_store_expense(jsonb_build_object(
    'business_location_id', v_location, 'category', 'SUPPLIES', 'amount', 200,
    'expense_date', current_date, 'description', 'Fournitures STORE-03'
  ));
  v_charge := public.create_commerce_store_planned_expense(jsonb_build_object(
    'business_location_id', v_location, 'category', 'RENT', 'expected_amount', 17000,
    'due_date', current_date + 5, 'reference', 'LOYER-' || v_token, 'description', 'Loyer planifie STORE-03'
  ));
  v_cancelled_charge := public.create_commerce_store_planned_expense(jsonb_build_object(
    'business_location_id', v_location, 'category', 'INTERNET', 'expected_amount', 500,
    'due_date', current_date + 10, 'description', 'Charge a annuler STORE-03'
  ));
  v_cancelled_charge := public.cancel_commerce_store_planned_expense(v_cancelled_charge.id, 'Test transactionnel');

  -- Article margin 400 + service 1000. Draft and planned charges have no impact.
  v_cockpit := public.get_commerce_store_cockpit(v_location, current_date, current_date);
  IF (v_cockpit #>> '{profitability,articleRevenue}')::numeric <> 600
    OR (v_cockpit #>> '{profitability,serviceRevenue}')::numeric <> 1000
    OR (v_cockpit #>> '{profitability,costOfGoodsSold}')::numeric <> 200
    OR (v_cockpit #>> '{profitability,grossMargin}')::numeric <> 1400
    OR (v_cockpit #>> '{profitability,operatingExpenses}')::numeric <> 0
    OR (v_cockpit #>> '{profitability,netResult}')::numeric <> 1400 THEN
    RAISE EXCEPTION 'Cockpit profitability mismatch before confirmation: %', v_cockpit -> 'profitability';
  END IF;
  IF (v_cockpit #>> '{stock,costValue}')::numeric <> 800
    OR (v_cockpit #>> '{stock,potentialSaleValue}')::numeric <> 2400
    OR (v_cockpit #>> '{stock,potentialMargin}')::numeric <> 1600
    OR (v_cockpit #>> '{stock,lowStockCount}')::integer <> 1 THEN
    RAISE EXCEPTION 'Cockpit stock valuation mismatch: %', v_cockpit -> 'stock';
  END IF;
  IF (v_cockpit #>> '{sales,ticketCount}')::integer <> 1
    OR (v_cockpit #>> '{sales,averageBasket}')::numeric <> 1600
    OR jsonb_array_length(v_cockpit #> '{sales,services}') <> 1 THEN
    RAISE EXCEPTION 'Sales/services section mismatch: %', v_cockpit -> 'sales';
  END IF;

  -- Confirmed STORE-02 expense reduces profit once; paying a plan creates and confirms one real expense.
  PERFORM public.confirm_commerce_store_expense(v_expense.id, v_wallet);
  v_cockpit := public.get_commerce_store_cockpit(v_location, current_date, current_date);
  IF (v_cockpit #>> '{profitability,operatingExpenses}')::numeric <> 200
    OR (v_cockpit #>> '{profitability,netResult}')::numeric <> 1200 THEN
    RAISE EXCEPTION 'Confirmed expense did not reduce result exactly once.';
  END IF;
  v_charge := public.pay_commerce_store_planned_expense(v_charge.id, v_wallet);
  IF v_charge.status <> 'PAID' OR v_charge.paid_expense_id IS NULL THEN
    RAISE EXCEPTION 'Planned charge did not link to one real expense.';
  END IF;
  v_cockpit := public.get_commerce_store_cockpit(v_location, current_date, current_date);
  IF (v_cockpit #>> '{profitability,operatingExpenses}')::numeric <> 17200
    OR (v_cockpit #>> '{profitability,netResult}')::numeric <> -15800 THEN
    RAISE EXCEPTION 'Paid charge/result mismatch: %', v_cockpit -> 'profitability';
  END IF;
  IF (SELECT count(*) FROM public.finance_commerce_store_expense_links WHERE store_expense_id = v_charge.paid_expense_id) <> 1 THEN
    RAISE EXCEPTION 'Paid planned charge must create exactly one STORE-02 Finance link.';
  END IF;

  -- Server-known cash review and sync conflict are exposed as real attention items.
  INSERT INTO public.commerce_pos_offline_receipts(
    offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
    status, payload_hash, payload, created_at_device, error_code, error_message
  ) VALUES (
    'st03-conflict-' || v_token, 'terminal-' || v_token, 'session-open-' || v_token, v_location, v_actor,
    'CONFLICT', repeat('a', 64), '{}'::jsonb, now(), 'TEST_CONFLICT', 'Conflit test STORE-03'
  );
  INSERT INTO public.commerce_pos_cash_session_closures(
    cash_session_id, closure_event_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, status, payload_hash,
    declared_ticket_count, declared_article_total, declared_service_total, declared_cash_total,
    declared_other_payment_total, declared_theoretical_cash, counted_cash, declared_difference,
    discrepancy_note, server_ticket_count, server_article_total, server_service_total,
    server_cash_total, server_other_payment_total, server_difference, totals_match, payload
  ) VALUES (
    'session-close-' || v_token, 'closure-' || v_token, 'terminal-' || v_token, v_location, v_actor,
    now() - interval '8 hours', now(), 'REVIEW_REQUIRED', repeat('b', 64),
    1, 600, 1000, 1600, 0, 1600, 1500, -100, 'Ecart test',
    1, 600, 1000, 1600, 0, -100, false, '{}'::jsonb
  );
  INSERT INTO public.commerce_cash_remittances(
    remittance_event_id, business_location_id, source_wallet_id, destination_wallet_id,
    expected_amount, amount, cashier_difference, remittance_date, status,
    reference, declared_by, declared_at, payload_hash
  ) VALUES (
    'st03-remittance-' || v_token, v_location, v_wallet, v_destination_wallet,
    100, 100, 0, current_date, 'DECLARED', 'ST03-REM-' || v_token,
    v_actor, now(), md5('st03-remittance-' || v_token)
  );

  v_cockpit := public.get_commerce_store_cockpit(v_location, current_date, current_date);
  IF (v_cockpit #>> '{cash,reviewRequiredCount}')::integer <> 1
    OR (v_cockpit #>> '{cash,unclosedSessionCount}')::integer <> 1
    OR (v_cockpit #>> '{sync,conflictCount}')::integer <> 1
    OR jsonb_array_length(v_cockpit -> 'remittances') <> 1
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cockpit -> 'attention') item WHERE item ->> 'type' = 'SYNC_CONFLICT') THEN
    RAISE EXCEPTION 'Cash/sync/remittance cockpit mismatch.';
  END IF;

  -- A period outside all activity returns zero authoritative metrics.
  v_cockpit := public.get_commerce_store_cockpit(v_location, current_date - 30, current_date - 20);
  IF (v_cockpit #>> '{profitability,totalRevenue}')::numeric <> 0
    OR (v_cockpit #>> '{profitability,operatingExpenses}')::numeric <> 0
    OR (v_cockpit #>> '{sales,ticketCount}')::integer <> 0 THEN
    RAISE EXCEPTION 'Historical empty period mismatch.';
  END IF;

  -- Cashiers have neither sensitive grants nor access to the management cockpit RPC.
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE role = 'caissier'::public.app_role
    AND permission_code IN ('store.financial.read','store.stock_valuation.read','store.expenses.read')) THEN
    RAISE EXCEPTION 'Cashier received a sensitive STORE permission.';
  END IF;
  SELECT user_id INTO v_cashier FROM public.user_roles WHERE role = 'caissier'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_cashier IS NULL THEN RAISE EXCEPTION 'STORE-03 tests require one cashier actor.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cashier::text, true);
  BEGIN
    PERFORM public.get_commerce_store_cockpit(v_location, current_date, current_date);
  EXCEPTION WHEN insufficient_privilege THEN
    v_cashier_denied := true;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  IF NOT v_cashier_denied THEN RAISE EXCEPTION 'Cashier reached the management cockpit.'; END IF;
END;
$test$;

ROLLBACK;
