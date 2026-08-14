-- Mission caisse -- mixed online/offline session check: proves that
-- close_commerce_pos_cash_session counts every sale attributed to a
-- cash_session_id exactly once, however it reached the server (a direct
-- online create_commerce_cash_sale call, or an offline ticket synchronized
-- later through sync_commerce_pos_offline_sale), and separates CASH from
-- Mobile Money correctly. Also proves closure/report idempotency on retry.
-- Everything created by this script is reverted at the end; it is safe to
-- run against a linked project once the mission caisse migrations are applied.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_wallet_id uuid;
  v_location_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-mixed-' || v_token;
  v_session_id text := 'session-mixed-' || v_token;
  v_offline_result jsonb;
  v_close jsonb;
  v_close_retry jsonb;
  v_report_id uuid;
  v_report public.commerce_pos_control_reports;
  v_detail jsonb;
  v_report_row_count integer;
  v_closure_row_count integer;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Mixed session test requires one existing super_admin actor.';
  END IF;

  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_commerce_unit_id IS NULL THEN
    RAISE EXCEPTION 'The active COMMERCE business unit is missing.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST MIXED CASH ' || v_token, 'CASH', 0, 0, false)
  RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'MIXED' || v_token, 'Test Mixed Session ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('MIXED-' || v_token, 'Article test mixte', 'TEST', 'PIECE', 50, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 50, 40000);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 50, 28000, 1400000, 'OPENING');

  -- (a) Online CASH sale, as if the browser were connected -- 40 000 FCFA.
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:mixed-online-cash', 'notes', NULL,
    'cash_session_id', v_session_id, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 40000))
  ));

  -- (b) Offline CASH sale, same session, same cashier -- 25 000 FCFA.
  v_offline_result := public.sync_commerce_pos_offline_sale(jsonb_build_object(
    'offline_sale_id', 'mixed-offline-sale-' || v_token,
    'terminal_id', v_terminal,
    'cash_session_id', v_session_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now() - interval '20 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'mixed-offline-ticket-' || v_token,
      'payment_method', 'CASH', 'total', 25000, 'cash_received', 25000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 25000))
    )
  ));
  IF (v_offline_result ->> 'status') <> 'PROCESSED' THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: the offline sale was not processed: %', v_offline_result;
  END IF;

  -- (c) Online JEKO (Mobile Money) sale -- 15 000 FCFA -- must land in
  -- mobile_money_total, never in cash_expected.
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'JEKO',
    'reference', 'POS:mixed-online-jeko', 'notes', NULL,
    'cash_session_id', v_session_id, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 15000))
  ));

  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session_id, 'event_id', 'mixed-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;
  SELECT * INTO v_report FROM public.commerce_pos_control_reports WHERE id = v_report_id;

  IF v_report.ticket_count <> 3 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: expected 3 tickets (1 online CASH + 1 offline CASH + 1 online JEKO), got %', v_report.ticket_count;
  END IF;
  IF v_report.cash_expected <> 65000 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: expected cash_expected=65000 (40000 online + 25000 offline), got %', v_report.cash_expected;
  END IF;
  IF v_report.mobile_money_total <> 15000 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: expected mobile_money_total=15000 (JEKO only, excluded from cash), got %', v_report.mobile_money_total;
  END IF;
  IF v_report.total_revenue <> 80000 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: expected total_revenue=80000 (40000+25000+15000), got %', v_report.total_revenue;
  END IF;
  IF v_report.article_quantity_total <> 3 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: expected article_quantity_total=3, got %', v_report.article_quantity_total;
  END IF;

  -- Traceability: the report detail must list all 3 sales regardless of entry path.
  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF jsonb_array_length(v_detail -> 'sales') <> 3 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: report detail should trace exactly 3 sales, got %', jsonb_array_length(v_detail -> 'sales');
  END IF;

  -- Idempotency: replaying the close (same cash_session_id, a different
  -- event_id -- simulating a retry after a dropped connection) must never
  -- create a second closure or report.
  v_close_retry := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session_id, 'event_id', 'mixed-close-retry-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  IF (v_close_retry ->> 'reportId')::uuid <> v_report_id OR (v_close_retry ->> 'closureId') <> (v_close ->> 'closureId') THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: retrying close_commerce_pos_cash_session produced a different closure/report.';
  END IF;

  SELECT count(*) INTO v_closure_row_count FROM public.commerce_pos_cash_session_closures WHERE cash_session_id = v_session_id;
  SELECT count(*) INTO v_report_row_count FROM public.commerce_pos_control_reports WHERE cash_session_id = v_session_id;
  IF v_closure_row_count <> 1 OR v_report_row_count <> 1 THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: expected exactly 1 closure and 1 report, got % closures and % reports', v_closure_row_count, v_report_row_count;
  END IF;

  RAISE NOTICE 'Mission caisse mixed-session validated: 3 tickets (online CASH + offline CASH + online JEKO) counted exactly once, cash_expected=65000, mobile_money_total=15000, idempotent retry, zero duplicate closure/report.';
END;
$test$;

ROLLBACK;
