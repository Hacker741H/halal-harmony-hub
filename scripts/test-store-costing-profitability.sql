-- STORE-02 reproducible integration tests. No test data survives ROLLBACK.
BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_unit uuid;
  v_wallet uuid;
  v_location uuid;
  v_profit_location uuid;
  v_offline_location uuid;
  v_item uuid;
  v_offline_item uuid;
  v_sale jsonb;
  v_service jsonb;
  v_sale_line uuid;
  v_expense public.commerce_store_expenses;
  v_metrics jsonb;
  v_offline_event jsonb;
  v_offline_result jsonb;
  v_offline_retry jsonb;
  v_token text := txid_current()::text;
  v_cump numeric;
  v_cost numeric;
  v_event_count integer;
  v_wallet_before_expense numeric(14,2);
  v_wallet_after_expense numeric(14,2);
  v_expense_operation_count integer;
  v_real_sale jsonb;
  v_real_line uuid;
  v_cashier_actor uuid;
  v_cashier_financial_denied boolean := false;
  v_cashier_valuation_denied boolean := false;
BEGIN
  SELECT user_id INTO v_actor FROM public.user_roles
  WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'STORE-02 tests require one super_admin actor.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT id INTO v_unit FROM public.business_units WHERE code='COMMERCE' AND status='ACTIVE';
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Active COMMERCE unit missing.'; END IF;

  INSERT INTO public.wallets(name,type,balance,initial_balance,is_default)
  VALUES('TEST STORE-02 '||v_token,'CASH',0,0,false) RETURNING id INTO v_wallet;

  INSERT INTO public.business_locations(business_unit_id,code,name,location_type,status,created_by,updated_by)
  VALUES(v_unit,'ST02A'||v_token,'STORE-02 CUMP','STORE','ACTIVE',v_actor,v_actor) RETURNING id INTO v_location;
  INSERT INTO public.business_location_wallets(business_location_id,wallet_id,purpose,is_primary,is_active,assigned_by)
  VALUES(v_location,v_wallet,'CASH_DRAWER',true,true,v_actor);

  -- A: 10 x 400 then 10 x 500 => 20 units at CUMP 450.
  SELECT (public.receive_commerce_inventory_item(jsonb_build_object(
    'business_location_id',v_location,'wallet_id',v_wallet,'name','Article STORE-02 '||v_token,
    'sku','ST02-'||v_token,'quantity',10,'purchase_unit_price',400,'sale_price',800
  ))->>'inventoryItemId')::uuid INTO v_item;
  PERFORM public.receive_commerce_inventory_item(jsonb_build_object(
    'business_location_id',v_location,'wallet_id',v_wallet,'inventory_item_id',v_item,
    'quantity',10,'purchase_unit_price',500,'sale_price',800));
  SELECT current_unit_cost INTO v_cump FROM public.commerce_inventory_cost_states
  WHERE business_location_id=v_location AND inventory_item_id=v_item;
  IF v_cump <> 450 THEN RAISE EXCEPTION 'A failed: expected CUMP 450, got %.',v_cump; END IF;

  -- B: 2 x 800 => revenue 1600, historical COGS 900, margin 700.
  v_sale:=public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id',v_location,'payment_method','CASH','reference','ST02-SALE-'||v_token,
    'lines',jsonb_build_array(jsonb_build_object('line_type','ARTICLE','inventory_item_id',v_item,'quantity',2,'unit_price',800))));
  SELECT l.id INTO v_sale_line FROM public.commercial_sale_lines l WHERE l.sale_id=(v_sale->>'saleId')::uuid;
  SELECT total_cost INTO v_cost FROM public.commercial_sale_line_costs WHERE sale_line_id=v_sale_line;
  IF (v_sale->>'amount')::numeric<>1600 OR v_cost<>900 OR
     (SELECT gross_margin FROM public.commercial_sale_line_costs WHERE sale_line_id=v_sale_line)<>700 THEN
    RAISE EXCEPTION 'B failed: sale revenue/cost/margin mismatch.';
  END IF;

  -- C: a later receipt changes current CUMP, never the old line cost.
  PERFORM public.receive_commerce_inventory_item(jsonb_build_object(
    'business_location_id',v_location,'wallet_id',v_wallet,'inventory_item_id',v_item,
    'quantity',5,'purchase_unit_price',600,'sale_price',800));
  SELECT total_cost INTO v_cost FROM public.commercial_sale_line_costs WHERE sale_line_id=v_sale_line;
  SELECT current_unit_cost INTO v_cump FROM public.commerce_inventory_cost_states
  WHERE business_location_id=v_location AND inventory_item_id=v_item;
  IF v_cost<>900 OR v_cump=450 THEN RAISE EXCEPTION 'C failed: historical cost changed or current CUMP did not.'; END IF;

  -- D: gross margin 22,000 - confirmed store expense 17,000 = net result 5,000.
  INSERT INTO public.business_locations(business_unit_id,code,name,location_type,status,created_by,updated_by)
  VALUES(v_unit,'ST02D'||v_token,'STORE-02 PROFIT','STORE','ACTIVE',v_actor,v_actor) RETURNING id INTO v_profit_location;
  INSERT INTO public.business_location_wallets(business_location_id,wallet_id,purpose,is_primary,is_active,assigned_by)
  VALUES(v_profit_location,v_wallet,'CASH_DRAWER',true,true,v_actor);
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id',v_profit_location,'payment_method','CASH','reference','ST02-PROFIT-'||v_token,
    'lines',jsonb_build_array(jsonb_build_object('line_type','SERVICE','service_name','Service marge test','quantity',1,'unit_price',22000))));
  v_expense:=public.create_commerce_store_expense(jsonb_build_object(
    'business_location_id',v_profit_location,'category','RENT','amount',17000,'description','Loyer test'));
  SELECT balance INTO v_wallet_before_expense FROM public.wallets WHERE id=v_wallet;
  PERFORM public.confirm_commerce_store_expense(v_expense.id,v_wallet);
  SELECT balance INTO v_wallet_after_expense FROM public.wallets WHERE id=v_wallet;
  SELECT count(*) INTO v_expense_operation_count
  FROM public.finance_commerce_store_expense_links expense_link
  JOIN public.finance_operations operation_row ON operation_row.id=expense_link.operation_id
  WHERE expense_link.store_expense_id=v_expense.id
    AND operation_row.wallet_id=v_wallet AND operation_row.type='EXPENSE'
    AND operation_row.amount=17000 AND operation_row.status='VALIDE';
  v_metrics:=public.get_commerce_store_profitability(v_profit_location,current_date,current_date);
  IF (v_metrics->>'grossMargin')::numeric<>22000 OR (v_metrics->>'operatingExpenses')::numeric<>17000
    OR (v_metrics->>'netResult')::numeric<>5000 THEN RAISE EXCEPTION 'D failed: expected net result 5000, got %.',v_metrics; END IF;
  IF v_wallet_after_expense<>v_wallet_before_expense-17000 OR v_expense_operation_count<>1 THEN
    RAISE EXCEPTION 'D failed: expense must debit its wallet once through one Finance operation.';
  END IF;

  -- Stock value is an asset, not a realized loss: receiving stock alone does
  -- not enter store operating expenses or reduce the profitability RPC.
  IF (public.get_commerce_store_profitability(v_location,current_date,current_date)->>'operatingExpenses')::numeric<>0 THEN
    RAISE EXCEPTION 'D failed: inventory purchases must not be operating expenses in store profit.';
  END IF;

  -- E: service revenue 15,000 and no stock movement.
  v_service:=public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id',v_profit_location,'payment_method','CASH','reference','ST02-SERVICE-'||v_token,
    'lines',jsonb_build_array(jsonb_build_object('line_type','SERVICE','service_name','Reparation telephone','quantity',1,'unit_price',15000))));
  IF EXISTS(SELECT 1 FROM public.commercial_sale_stock_movement_links link_row
    JOIN public.commercial_sale_lines line_row ON line_row.id=link_row.sale_line_id
    WHERE line_row.sale_id=(v_service->>'saleId')::uuid) THEN RAISE EXCEPTION 'E failed: service created stock movement.'; END IF;

  -- F: a client-only pending event has no definitive server KPI; after sync,
  -- retrying the same offline_sale_id is accounted exactly once.
  INSERT INTO public.business_locations(business_unit_id,code,name,location_type,status,created_by,updated_by)
  VALUES(v_unit,'ST02F'||v_token,'STORE-02 OFFLINE','STORE','ACTIVE',v_actor,v_actor) RETURNING id INTO v_offline_location;
  INSERT INTO public.business_location_wallets(business_location_id,wallet_id,purpose,is_primary,is_active,assigned_by)
  VALUES(v_offline_location,v_wallet,'CASH_DRAWER',true,true,v_actor);
  SELECT (public.receive_commerce_inventory_item(jsonb_build_object(
    'business_location_id',v_offline_location,'wallet_id',v_wallet,'name','Offline item '||v_token,
    'sku','ST02-OFF-'||v_token,'quantity',2,'purchase_unit_price',1000,'sale_price',2000
  ))->>'inventoryItemId')::uuid INTO v_offline_item;
  v_metrics:=public.get_commerce_store_profitability(v_offline_location,current_date,current_date);
  IF (v_metrics->>'totalRevenue')::numeric<>0 THEN RAISE EXCEPTION 'F failed: unsynchronized client event affected server KPI.'; END IF;
  v_offline_event:=jsonb_build_object(
    'offline_sale_id','st02-offline-'||v_token,'terminal_id','terminal-'||v_token,'cash_session_id','session-'||v_token,
    'business_location_id',v_offline_location,'cashier_user_id',v_actor,'created_at_device',now(),
    'payload',jsonb_build_object('ticket_id','ticket-'||v_token,'payment_method','CASH','total',2000,'cash_received',2000,'change_due',0,
      'lines',jsonb_build_array(jsonb_build_object('line_type','ARTICLE','inventory_item_id',v_offline_item,'quantity',1,'unit_price',2000))));
  v_offline_result:=public.sync_commerce_pos_offline_sale(v_offline_event);
  v_offline_retry:=public.sync_commerce_pos_offline_sale(v_offline_event);
  IF v_offline_result->>'saleId' IS DISTINCT FROM v_offline_retry->>'saleId' THEN RAISE EXCEPTION 'F failed: offline retry not idempotent.'; END IF;
  SELECT count(*) INTO v_event_count FROM public.commercial_sales WHERE business_location_id=v_offline_location AND status='CONFIRMED';
  IF v_event_count<>1 THEN RAISE EXCEPTION 'F failed: offline sale accounted % times.',v_event_count; END IF;

  -- G: cashier receives neither permissions nor direct protected-table access.
  IF EXISTS(SELECT 1 FROM public.role_permissions WHERE role='caissier'::public.app_role
    AND permission_code IN('store.financial.read','store.stock_valuation.read','store.expenses.read')) THEN
    RAISE EXCEPTION 'G failed: cashier has sensitive store permission.';
  END IF;
  IF has_table_privilege('authenticated','public.commercial_sale_line_costs','SELECT')
    OR has_table_privilege('authenticated','public.commerce_inventory_cost_states','SELECT') THEN
    RAISE EXCEPTION 'G failed: protected costs are directly readable.';
  END IF;
  IF NOT public.user_has_permission('store.financial.read') OR NOT public.user_has_permission('store.stock_valuation.read') THEN
    RAISE EXCEPTION 'G failed: super_admin lacks STORE-02 read permissions.';
  END IF;
  SELECT user_id INTO v_cashier_actor FROM public.user_roles
  WHERE role='caissier'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_cashier_actor IS NULL THEN RAISE EXCEPTION 'G failed: no cashier actor available.'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_cashier_actor::text,true);
  BEGIN
    PERFORM public.get_commerce_store_profitability(v_location,current_date,current_date);
  EXCEPTION WHEN insufficient_privilege THEN v_cashier_financial_denied:=true;
  END;
  BEGIN
    PERFORM public.get_commerce_store_stock_valuation(v_location);
  EXCEPTION WHEN insufficient_privilege THEN v_cashier_valuation_denied:=true;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  IF NOT v_cashier_financial_denied OR NOT v_cashier_valuation_denied THEN
    RAISE EXCEPTION 'G failed: cashier reached a sensitive STORE-02 RPC.';
  END IF;

  -- Production opening stock validation, still inside this transaction. The
  -- final ROLLBACK removes the test sale and restores quantity/value/wallet.
  IF NOT EXISTS(
    SELECT 1 FROM public.commerce_inventory_cost_states
    WHERE business_location_id='ea6525b1-1a39-407d-b5c8-0c9c1d75fce9'
      AND inventory_item_id='9674bf77-f1e4-4355-a684-b7623e1a4dd2'
      AND quantity_on_hand=4 AND current_unit_cost=350 AND inventory_value=1400
  ) THEN RAISE EXCEPTION 'Production opening stock is not 4 x 350 = 1400.'; END IF;

  v_real_sale:=public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id','ea6525b1-1a39-407d-b5c8-0c9c1d75fce9',
    'payment_method','CASH','reference','ST02-REAL-ROLLBACK-'||v_token,
    'lines',jsonb_build_array(jsonb_build_object(
      'line_type','ARTICLE','inventory_item_id','9674bf77-f1e4-4355-a684-b7623e1a4dd2',
      'quantity',1,'unit_price',500))));
  SELECT line_row.id INTO v_real_line FROM public.commercial_sale_lines line_row
  WHERE line_row.sale_id=(v_real_sale->>'saleId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.commercial_sale_line_costs
    WHERE sale_line_id=v_real_line AND unit_cost=350 AND total_cost=350) THEN
    RAISE EXCEPTION 'Production article test sale did not snapshot unit COGS 350.';
  END IF;
END;
$test$;

ROLLBACK;
