-- GFC V1 Phase 5 -- mandatory E2E test, scenarios A-K from the mission.
-- Runs inside a single ROLLBACK-wrapped transaction against the live
-- linked schema. Uses real admin actor d3d1ef24-fa63-49c0-93c5-34fad56f84db
-- and real caissier abdoul (51cf49b4-20f0-4adf-a6d5-bec923f6cfb9) for the
-- permission-rejection scenario -- both real, pre-existing accounts, never
-- modified, only impersonated via request.jwt.claim.sub inside this
-- transaction.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid := 'd3d1ef24-fa63-49c0-93c5-34fad56f84db';
  v_cashier_id uuid := '51cf49b4-20f0-4adf-a6d5-bec923f6cfb9';
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_client_id uuid;
  v_op_count_before integer;
  v_op_count_after integer;
  v_rejected boolean;

  v_sale jsonb;
  v_sale_id uuid;
  v_sale_line_id uuid;
  v_return public.commerce_sale_returns;
  v_refund public.commerce_sale_refunds;
  v_summary record;
  v_bli public.business_location_inventory_items;
  v_cost_state public.commerce_inventory_cost_states;
  v_wallet_balance_before numeric;
  v_wallet_balance_after numeric;
BEGIN
  SET LOCAL search_path = public, auth, pg_temp;
  SELECT count(*) INTO v_op_count_before FROM public.finance_operations;

  ------------------------------------------------------------------
  -- FIXTURE: one fresh Commerce location, cash wallet, item, client.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  INSERT INTO public.business_locations(business_unit_id, code, name, status)
  SELECT id, 'P5TEST_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'PHASE5 TEST LOCATION', 'ACTIVE' FROM public.business_units WHERE code = 'COMMERCE'
  RETURNING id INTO v_location_id;

  INSERT INTO public.wallets(name, type, balance) VALUES ('PHASE5 TEST WALLET', 'CASH', 0) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_at)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, now());

  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P5-' || txid_current()::text, 'Article Phase5 Test', 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity) VALUES (v_location_id, v_item_id, 100);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 500, 50000, 'OPENING');

  INSERT INTO public.transport_clients(client_number, display_name, status, country_code)
  VALUES ('CLI-P5-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'Client Phase5 Test', 'ACTIVE', 'CI')
  RETURNING id INTO v_client_id;

  ------------------------------------------------------------------
  -- A. Retour complet paye cash : vente 1000 (1 unite, cout 500) ->
  -- return 1 (RESTOCK) -> stock revient, CA net 0, CMV net 0, marge 0,
  -- wallet inchange avant remboursement -> remboursement 1000 -> wallet -1000.
  ------------------------------------------------------------------
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale_id LIMIT 1;

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 99 THEN RAISE EXCEPTION 'STEP_A_FAILED: stock must be 99 after sale, got %', v_bli.quantity; END IF;

  SELECT balance INTO v_wallet_balance_before FROM public.wallets WHERE id = v_wallet_id;

  v_return := public.create_commerce_sale_return(jsonb_build_object(
    'sale_id', v_sale_id, 'reason', 'Test A -- retour complet', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))
  ));

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 100 THEN RAISE EXCEPTION 'STEP_A_FAILED: stock must return to 100, got %', v_bli.quantity; END IF;
  SELECT * INTO v_cost_state FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_cost_state.current_unit_cost <> 500 THEN RAISE EXCEPTION 'STEP_A_FAILED: unit cost must stay 500, got %', v_cost_state.current_unit_cost; END IF;

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale_id);
  IF v_summary.total_returned <> 1000 OR v_summary.amount_due <> 0 OR v_summary.refundable_credit <> 1000 THEN
    RAISE EXCEPTION 'STEP_A_FAILED: expected returned=1000/due=0/refundable=1000, got returned=%/due=%/refundable=%', v_summary.total_returned, v_summary.amount_due, v_summary.refundable_credit;
  END IF;

  SELECT balance INTO v_wallet_balance_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_balance_after <> v_wallet_balance_before THEN RAISE EXCEPTION 'STEP_A_FAILED: wallet must be unchanged by the return itself.'; END IF;

  v_refund := public.create_commerce_sale_refund(v_sale_id, jsonb_build_object('wallet_id', v_wallet_id, 'amount', 1000, 'refund_date', current_date));
  v_refund := public.confirm_commerce_sale_refund(v_refund.id);
  SELECT balance INTO v_wallet_balance_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_balance_after <> v_wallet_balance_before - 1000 THEN
    RAISE EXCEPTION 'STEP_A_FAILED: wallet must be exactly -1000, before=% after=%', v_wallet_balance_before, v_wallet_balance_after;
  END IF;
  RAISE NOTICE 'STEP_A_PASSED: full return + restock + refund, stock/cost/wallet all exact.';

  ------------------------------------------------------------------
  -- B. Retour partiel : vente qty 3 -> retour 1,1,1 (chacun OK) -> 4e rejete.
  ------------------------------------------------------------------
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 3, 'unit_price', 1000))
  ));
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale_id LIMIT 1;

  PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test B -- 1', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));
  PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test B -- 2', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));
  PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test B -- 3', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));

  v_rejected := false;
  BEGIN
    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test B -- 4 doit echouer', 'idempotency_key', gen_random_uuid()::text,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_B_FAILED: a 4th return of 1 unit on a 3-unit sale must be rejected.'; END IF;
  RAISE NOTICE 'STEP_B_PASSED: partial returns 1+1+1 accepted, 4th correctly rejected.';

  ------------------------------------------------------------------
  -- C. Credit non paye : vente crediee 10000 (jamais payee) -> retour 2000
  -- -> creance 8000, aucun wallet, refundable 0.
  ------------------------------------------------------------------
  DECLARE
    v_credit_sale public.commercial_sales;
    v_credit_invoice public.commercial_invoices;
    v_credit_line_id uuid;
  BEGIN
    v_credit_sale := public.create_commercial_sale(jsonb_build_object(
      'client_id', v_client_id,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Vente credit test', 'quantity', 1, 'unit_price', 10000, 'inventory_item_id', v_item_id))
    ));
    PERFORM public.confirm_commercial_sale(v_credit_sale.id);
    v_credit_invoice := public.create_commercial_invoice(v_credit_sale.id);
    PERFORM public.issue_commercial_invoice(v_credit_invoice.id);
    SELECT id INTO v_credit_line_id FROM public.commercial_sale_lines WHERE sale_id = v_credit_sale.id LIMIT 1;

    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_credit_sale.id, 'reason', 'Test C -- retour credit non paye', 'idempotency_key', gen_random_uuid()::text,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_credit_line_id, 'quantity_returned', 0.2))));

    SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_credit_sale.id);
    IF v_summary.amount_due <> 8000 OR v_summary.refundable_credit <> 0 THEN
      RAISE EXCEPTION 'STEP_C_FAILED: expected due=8000/refundable=0, got due=%/refundable=%', v_summary.amount_due, v_summary.refundable_credit;
    END IF;
  END;
  RAISE NOTICE 'STEP_C_PASSED: unpaid credit sale return correctly stock-blind, créance net 8000, zero refundable.';

  ------------------------------------------------------------------
  -- D+E. Deja paye : vente 10000 payee -> retour 2000 -> credit 2000,
  -- aucun wallet avant remboursement -> remboursement 1500 puis 500 ->
  -- wallet exactement -2000, retry sans doublon.
  ------------------------------------------------------------------
  DECLARE
    v_paid_sale public.commercial_sales;
    v_paid_invoice public.commercial_invoices;
    v_paid_line_id uuid;
    v_payment public.commercial_invoice_payments;
    v_refund1 public.commerce_sale_refunds;
    v_refund2 public.commerce_sale_refunds;
    v_key text;
  BEGIN
    v_paid_sale := public.create_commercial_sale(jsonb_build_object(
      'client_id', v_client_id,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Vente payee test', 'quantity', 1, 'unit_price', 10000, 'inventory_item_id', v_item_id))
    ));
    PERFORM public.confirm_commercial_sale(v_paid_sale.id);
    v_paid_invoice := public.create_commercial_invoice(v_paid_sale.id);
    PERFORM public.issue_commercial_invoice(v_paid_invoice.id);
    SELECT id INTO v_paid_line_id FROM public.commercial_sale_lines WHERE sale_id = v_paid_sale.id LIMIT 1;

    v_payment := public.create_commercial_invoice_payment(v_paid_invoice.id, jsonb_build_object(
      'wallet_id', v_wallet_id, 'amount', 10000, 'payment_date', current_date, 'status', 'RECEIVED'
    ));
    PERFORM public.confirm_commercial_invoice_payment(v_payment.id);

    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_paid_sale.id, 'reason', 'Test D -- retour vente payee', 'idempotency_key', gen_random_uuid()::text,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_paid_line_id, 'quantity_returned', 0.2))));

    SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_paid_sale.id);
    IF v_summary.amount_due <> 0 OR v_summary.refundable_credit <> 2000 THEN
      RAISE EXCEPTION 'STEP_D_FAILED: expected due=0/refundable=2000, got due=%/refundable=%', v_summary.amount_due, v_summary.refundable_credit;
    END IF;
    RAISE NOTICE 'STEP_D_PASSED: paid sale return correctly yields 2000 refundable credit, zero wallet impact yet.';

    SELECT balance INTO v_wallet_balance_before FROM public.wallets WHERE id = v_wallet_id;
    v_refund1 := public.create_commerce_sale_refund(v_paid_sale.id, jsonb_build_object('wallet_id', v_wallet_id, 'amount', 1500));
    v_refund1 := public.confirm_commerce_sale_refund(v_refund1.id);
    v_refund2 := public.create_commerce_sale_refund(v_paid_sale.id, jsonb_build_object('wallet_id', v_wallet_id, 'amount', 500));
    v_refund2 := public.confirm_commerce_sale_refund(v_refund2.id);
    SELECT balance INTO v_wallet_balance_after FROM public.wallets WHERE id = v_wallet_id;
    IF v_wallet_balance_after <> v_wallet_balance_before - 2000 THEN
      RAISE EXCEPTION 'STEP_E_FAILED: wallet must be exactly -2000, before=% after=%', v_wallet_balance_before, v_wallet_balance_after;
    END IF;

    -- Retry: create with the SAME idempotency key must not duplicate the return.
    v_key := gen_random_uuid()::text;
    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_paid_sale.id, 'reason', 'Test K -- retry', 'idempotency_key', v_key,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_paid_line_id, 'quantity_returned', 0.1))));
    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_paid_sale.id, 'reason', 'Test K -- retry', 'idempotency_key', v_key,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_paid_line_id, 'quantity_returned', 0.1))));
    IF (SELECT count(*) FROM public.commerce_sale_returns WHERE sale_id = v_paid_sale.id AND idempotency_key = v_key) <> 1 THEN
      RAISE EXCEPTION 'STEP_K_FAILED: retrying create_commerce_sale_return with the same idempotency key must not duplicate.';
    END IF;

    -- Retry: re-confirming an already-CONFIRMED refund must be a no-op, not an error, not a second Finance op.
    PERFORM public.confirm_commerce_sale_refund(v_refund1.id);
    IF (SELECT count(*) FROM public.finance_commercial_refund_links WHERE refund_id = v_refund1.id) <> 1 THEN
      RAISE EXCEPTION 'STEP_K_FAILED: retrying confirm_commerce_sale_refund must not create a second Finance link.';
    END IF;
  END;
  RAISE NOTICE 'STEP_E_PASSED: sequential refunds 1500+500 = exactly -2000, no over-refund possible.';
  RAISE NOTICE 'STEP_K_PASSED: retrying return-create and refund-confirm with the same key/id is a safe no-op.';

  ------------------------------------------------------------------
  -- F. Produit endommage : retour accepte sans restock -> stock inchange.
  ------------------------------------------------------------------
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale_id LIMIT 1;
  SELECT quantity INTO v_bli.quantity FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;

  PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test F -- endommage', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'DAMAGED'))));

  DECLARE v_bli_after public.business_location_inventory_items;
  BEGIN
    SELECT * INTO v_bli_after FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
    IF v_bli_after.quantity <> v_bli.quantity THEN
      RAISE EXCEPTION 'STEP_F_FAILED: stock must stay unchanged for a DAMAGED disposition, before=% after=%', v_bli.quantity, v_bli_after.quantity;
    END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_sale_return_lines rl JOIN public.commerce_sale_returns r ON r.id = rl.return_id WHERE r.sale_id = v_sale_id AND rl.disposition = 'DAMAGED') THEN
    RAISE EXCEPTION 'STEP_F_FAILED: the return line must be recorded with disposition DAMAGED.';
  END IF;
  RAISE NOTICE 'STEP_F_PASSED: damaged return accepted, recorded, zero stock impact.';

  ------------------------------------------------------------------
  -- G. Snapshot cout : vente au cout historique 500, CUMP courant derive
  -- ensuite a 650 -> le retour revendable doit utiliser 500, pas 650.
  ------------------------------------------------------------------
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale_id LIMIT 1;
  IF (SELECT unit_cost FROM public.commercial_sale_line_costs WHERE sale_line_id = v_sale_line_id) <> 500 THEN
    RAISE EXCEPTION 'STEP_G_FAILED: historical unit cost must be 500 at sale time.';
  END IF;

  -- Simulates a purchase happening afterwards that moves the live average up to 650.
  UPDATE public.commerce_inventory_cost_states SET current_unit_cost = 650, inventory_value = round(quantity_on_hand * 650, 2)
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;

  PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test G -- snapshot cout', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));

  IF (SELECT historical_unit_cost FROM public.commerce_sale_return_lines rl JOIN public.commerce_sale_returns r ON r.id = rl.return_id WHERE r.sale_id = v_sale_id) <> 500 THEN
    RAISE EXCEPTION 'STEP_G_FAILED: the return line must record the historical cost 500, not the current 650.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_inventory_cost_events WHERE stock_movement_id = (SELECT stock_movement_id FROM public.commerce_sale_return_lines rl JOIN public.commerce_sale_returns r ON r.id = rl.return_id WHERE r.sale_id = v_sale_id) AND unit_cost = 500 AND event_type = 'SALE_RETURN') THEN
    RAISE EXCEPTION 'STEP_G_FAILED: the SALE_RETURN cost event must be valued at 500, the historical cost, not the live 650 average.';
  END IF;
  RAISE NOTICE 'STEP_G_PASSED: a restock always re-enters at the sale''s own historical cost, immune to CUMP drift since the sale.';

  ------------------------------------------------------------------
  -- H. Session cloturee : la vente appartient a une session/cloture/rapport
  -- deja generes -> un retour ulterieur ne doit jamais modifier ces
  -- valeurs historiques figees.
  ------------------------------------------------------------------
  DECLARE
    v_session_id text := 'P5TESTSESSION' || substr(gen_random_uuid()::text, 1, 8);
    v_terminal_id text := 'P5TESTTERMINAL01';
    v_report_before record;
    v_report_after record;
  BEGIN
    v_sale := public.create_commerce_cash_sale(jsonb_build_object(
      'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
      'cash_session_id', v_session_id, 'terminal_id', v_terminal_id,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
    ));
    v_sale_id := (v_sale ->> 'saleId')::uuid;
    SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale_id LIMIT 1;

    PERFORM public.close_commerce_pos_cash_session(jsonb_build_object(
      'cash_session_id', v_session_id, 'event_id', gen_random_uuid()::text, 'terminal_id', v_terminal_id,
      'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
      'opened_at_device', (now() - interval '1 hour')::text, 'closed_at_device', now()::text
    ));

    SELECT article_revenue, total_revenue, cash_expected INTO v_report_before
    FROM public.commerce_pos_control_reports WHERE cash_session_id = v_session_id;

    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test H -- retour apres cloture', 'idempotency_key', gen_random_uuid()::text,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));

    SELECT article_revenue, total_revenue, cash_expected INTO v_report_after
    FROM public.commerce_pos_control_reports WHERE cash_session_id = v_session_id;

    IF v_report_before.article_revenue <> v_report_after.article_revenue
      OR v_report_before.total_revenue <> v_report_after.total_revenue
      OR v_report_before.cash_expected <> v_report_after.cash_expected THEN
      RAISE EXCEPTION 'STEP_H_FAILED: a return must never alter an already-generated control report.';
    END IF;
  END;
  RAISE NOTICE 'STEP_H_PASSED: a return after session closure leaves the frozen control report byte-identical.';

  ------------------------------------------------------------------
  -- I. Permissions : un caissier ne peut ni retourner ni rembourser.
  ------------------------------------------------------------------
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  v_sale_id := (v_sale ->> 'saleId')::uuid;
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale_id LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test I -- caissier rejete', 'idempotency_key', gen_random_uuid()::text,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_I_FAILED: a caissier must not be able to create a sale return.'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.create_commerce_sale_refund(v_sale_id, jsonb_build_object('wallet_id', v_wallet_id, 'amount', 100));
  EXCEPTION WHEN OTHERS THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_I_FAILED: a caissier must not be able to create a sale refund.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  RAISE NOTICE 'STEP_I_PASSED: caissier correctly rejected from both return and refund creation.';

  ------------------------------------------------------------------
  -- J. Finance : un retour seul cree 0 finance_operations ; un
  -- remboursement en cree exactement une.
  ------------------------------------------------------------------
  DECLARE
    v_op_count_just_before integer;
    v_op_count_mid integer;
  BEGIN
    SELECT count(*) INTO v_op_count_just_before FROM public.finance_operations;
    PERFORM public.create_commerce_sale_return(jsonb_build_object('sale_id', v_sale_id, 'reason', 'Test J -- zero finance', 'idempotency_key', gen_random_uuid()::text,
      'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))));
    SELECT count(*) INTO v_op_count_mid FROM public.finance_operations;
    IF v_op_count_mid <> v_op_count_just_before THEN
      RAISE EXCEPTION 'STEP_J_FAILED: a return alone must create zero finance_operations, before=% mid=%', v_op_count_just_before, v_op_count_mid;
    END IF;

    v_refund := public.create_commerce_sale_refund(v_sale_id, jsonb_build_object('wallet_id', v_wallet_id, 'amount', 1000));
    v_refund := public.confirm_commerce_sale_refund(v_refund.id);
    SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
    IF v_op_count_after <> v_op_count_mid + 1 THEN
      RAISE EXCEPTION 'STEP_J_FAILED: confirming a refund must create exactly one finance_operations row, mid=% after=%', v_op_count_mid, v_op_count_after;
    END IF;
  END;
  RAISE NOTICE 'STEP_J_PASSED: return creates zero finance_operations, confirmed refund creates exactly one.';

  RAISE NOTICE 'GFC_V1_PHASE5_RETURNS_REFUNDS_E2E_PASSED';
  CREATE TEMP TABLE phase5_e2e_result AS SELECT 'GFC_V1_PHASE5_RETURNS_REFUNDS_E2E_PASSED'::text AS result;
END;
$test$;

SELECT result FROM phase5_e2e_result;

ROLLBACK;
