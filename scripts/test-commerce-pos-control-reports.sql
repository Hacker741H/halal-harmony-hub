-- Mission caisse -- control center reconciliation check: automatic closure,
-- 1:1 report generation, partial/final physical cash reception reusing
-- commerce_cash_remittances (POS-05), positive/negative variance both
-- allowed, and the 4-state computed status (PENDING_CONTROL /
-- PARTIALLY_RECEIVED / RECEIVED / REVIEW_REQUIRED). Everything created by
-- this script is reverted at the end; it is safe to run against a linked
-- project once the mission caisse migrations are applied.
BEGIN;

-- Mirrors exactly the status computation of get_commerce_pos_control_reports,
-- used here to observe the status of a single report at intermediate points
-- in the scenario (before/after each reception) that the list RPC alone,
-- which only reflects the current moment, cannot replay.
CREATE OR REPLACE FUNCTION pg_temp.compute_status(p_report_id uuid) RETURNS text AS $inner$
  WITH received AS (
    SELECT link.closure_id, sum(r.received_amount) AS total_received, bool_or(coalesce(r.is_final, false)) AS is_finalized
    FROM public.commerce_cash_remittances r
    JOIN public.commerce_cash_remittance_closures link ON link.remittance_id = r.id
    WHERE r.status = 'CONFIRMED'
    GROUP BY link.closure_id
  )
  SELECT
    CASE
      WHEN report.flagged_for_review THEN 'REVIEW_REQUIRED'
      WHEN report.cash_expected <= 0 THEN 'RECEIVED'
      WHEN coalesce(received.is_finalized, false) THEN
        CASE WHEN round(coalesce(received.total_received, 0), 2) = round(report.cash_expected, 2) THEN 'RECEIVED' ELSE 'REVIEW_REQUIRED' END
      WHEN coalesce(received.total_received, 0) = 0 THEN 'PENDING_CONTROL'
      ELSE 'PARTIALLY_RECEIVED'
    END
  FROM public.commerce_pos_control_reports report
  LEFT JOIN received ON received.closure_id = report.closure_id
  WHERE report.id = p_report_id
$inner$ LANGUAGE sql;

DO $test$
DECLARE
  v_commerce_unit_id uuid;
  v_token text := txid_current()::text;
  v_location_id uuid;
  v_cash_wallet_id uuid;
  v_dest_wallet_id uuid;
  v_item_id uuid;
  v_cashier_id uuid;
  v_manager_id uuid;
  v_terminal text := 'terminal-control-' || v_token;
  v_close1 jsonb; v_close2 jsonb; v_close3 jsonb; v_close4 jsonb;
  v_report1_id uuid; v_report2_id uuid; v_report3_id uuid; v_report4_id uuid;
  v_recv1a jsonb; v_recv1a_retry jsonb; v_recv1b jsonb; v_recv1c jsonb;
  v_recv1c_failed boolean := false;
  v_recv2 jsonb;
  v_recv3 jsonb; v_recv3_failed boolean := false;
  v_finance_op_count_before integer; v_finance_op_count_after integer;
  v_sale_count_before integer; v_sale_count_after integer;
  v_status1_before_final text; v_status1_after_final text; v_status2 text; v_status3 text; v_status4 text;
  v_list jsonb; v_detail1 jsonb;
BEGIN
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_commerce_unit_id IS NULL THEN
    RAISE EXCEPTION 'The active COMMERCE business unit is missing.';
  END IF;
  -- confirm_commerce_pos_cash_reception has no same-user restriction (unlike
  -- POS-05's declare/confirm remittance flow: declared_by is always NULL
  -- here), so one super_admin can safely play both the closing cashier and
  -- the receiving manager -- avoids depending on specific caissier/
  -- gestionnaire role assignments that may not exist in every environment.
  SELECT user_id INTO v_cashier_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  v_manager_id := v_cashier_id;
  IF v_cashier_id IS NULL THEN
    RAISE EXCEPTION 'Control report reconciliation test requires one existing super_admin actor.';
  END IF;

  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'CTRL' || v_token, 'Test Control Reports ' || v_token, 'STORE', 'ACTIVE', v_manager_id, v_manager_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default) VALUES ('TEST CTRL CASH ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_cash_wallet_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default) VALUES ('TEST CTRL COLLECTION ' || v_token, 'BANK', 0, 0, false) RETURNING id INTO v_dest_wallet_id;
  INSERT INTO public.business_location_wallets (business_location_id, wallet_id, purpose, is_primary, is_active, assigned_at)
  VALUES (v_location_id, v_cash_wallet_id, 'CASH_DRAWER', true, true, now());
  INSERT INTO public.business_location_wallets (business_location_id, wallet_id, purpose, is_primary, is_active, assigned_at)
  VALUES (v_location_id, v_dest_wallet_id, 'COLLECTION', false, true, now());
  INSERT INTO public.inventory_items (sku, nom, unite, stock_actuel) VALUES ('CTRL-' || v_token, 'Article test controle', 'Piece', 0) RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items (business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 1000);
  INSERT INTO public.commerce_inventory_cost_states (business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 700, 70000, 'OPENING');
  INSERT INTO public.business_location_assignments (business_location_id, user_id, assignment_role, start_date, assigned_by)
  VALUES (v_location_id, v_cashier_id, 'STORE_MANAGER', current_date, v_cashier_id);

  SELECT count(*) INTO v_finance_op_count_before FROM public.finance_operations WHERE wallet_id IN (v_cash_wallet_id, v_dest_wallet_id) OR destination_wallet_id IN (v_cash_wallet_id, v_dest_wallet_id);

  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);

  ------------------------------------------------------------------
  -- SESSION 1: 500 000 CASH expected -- partial then final reception WITH
  -- a negative variance (300000 + 198000 = 498000 received of 500000
  -- expected -> -2000 difference, accepted rather than blocked).
  ------------------------------------------------------------------
  FOR i IN 1..5 LOOP
    PERFORM public.create_commerce_cash_sale(jsonb_build_object(
      'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
      'reference', 'POS:ctrl-s1-t' || i, 'notes', NULL,
      'cash_session_id', 'ctrl-session-1-' || v_token, 'terminal_id', v_terminal,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 100000))
    ));
  END LOOP;
  SELECT count(*) INTO v_sale_count_before FROM public.commercial_sales WHERE business_location_id = v_location_id AND status = 'CONFIRMED';

  v_close1 := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', 'ctrl-session-1-' || v_token, 'event_id', 'ctrl-close-1-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_cashier_id,
    'opened_at_device', now() - interval '4 hours', 'closed_at_device', now() - interval '3 hours'
  ));
  v_report1_id := (v_close1 ->> 'reportId')::uuid;
  v_status1_before_final := pg_temp.compute_status(v_report1_id);
  IF v_status1_before_final <> 'PENDING_CONTROL' THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: a freshly closed report with no reception must be PENDING_CONTROL, got %', v_status1_before_final;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);

  v_recv1a := public.confirm_commerce_pos_cash_reception(v_report1_id, 'ctrl-recv-1a-' || v_token, 300000, v_dest_wallet_id, false, 'Premier versement, partiel.');
  v_recv1a_retry := public.confirm_commerce_pos_cash_reception(v_report1_id, 'ctrl-recv-1a-' || v_token, 300000, v_dest_wallet_id, false, 'Premier versement, partiel.');
  IF (v_recv1a_retry ->> 'remittanceId')::uuid <> (v_recv1a ->> 'remittanceId')::uuid THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: retrying a reception created a second remittance';
  END IF;

  v_recv1b := public.confirm_commerce_pos_cash_reception(v_report1_id, 'ctrl-recv-1b-' || v_token, 198000, v_dest_wallet_id, true, 'Reception finale, ecart assume.');
  v_status1_after_final := pg_temp.compute_status(v_report1_id);

  BEGIN
    v_recv1c := public.confirm_commerce_pos_cash_reception(v_report1_id, 'ctrl-recv-1c-' || v_token, 1, v_dest_wallet_id, false, 'Ne doit jamais passer.');
  EXCEPTION WHEN OTHERS THEN
    v_recv1c_failed := true;
  END;
  IF NOT v_recv1c_failed THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: a reception after finalization was accepted';
  END IF;

  ------------------------------------------------------------------
  -- SESSION 2: 200 000 CASH expected -- exact final reception (0 variance).
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:ctrl-s2-t1', 'notes', NULL,
    'cash_session_id', 'ctrl-session-2-' || v_token, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 2, 'unit_price', 100000))
  ));
  v_close2 := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', 'ctrl-session-2-' || v_token, 'event_id', 'ctrl-close-2-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_cashier_id,
    'opened_at_device', now() - interval '2 hours', 'closed_at_device', now() - interval '90 minutes'
  ));
  v_report2_id := (v_close2 ->> 'reportId')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  v_recv2 := public.confirm_commerce_pos_cash_reception(v_report2_id, 'ctrl-recv-2a-' || v_token, 200000, v_dest_wallet_id, true, 'Reception finale exacte.');
  v_status2 := pg_temp.compute_status(v_report2_id);

  ------------------------------------------------------------------
  -- SESSION 3: JEKO only -- cash_expected=0, any reception attempt rejected.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'JEKO',
    'reference', 'POS:ctrl-s3-t1', 'notes', NULL,
    'cash_session_id', 'ctrl-session-3-' || v_token, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 100000))
  ));
  v_close3 := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', 'ctrl-session-3-' || v_token, 'event_id', 'ctrl-close-3-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_cashier_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now() - interval '55 minutes'
  ));
  v_report3_id := (v_close3 ->> 'reportId')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  BEGIN
    v_recv3 := public.confirm_commerce_pos_cash_reception(v_report3_id, 'ctrl-recv-3a-' || v_token, 1, v_dest_wallet_id, true, 'Ne doit jamais passer.');
  EXCEPTION WHEN OTHERS THEN
    v_recv3_failed := true;
  END;
  IF NOT v_recv3_failed THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: a reception was accepted on a report with cash_expected=0';
  END IF;
  v_status3 := pg_temp.compute_status(v_report3_id);

  ------------------------------------------------------------------
  -- SESSION 4: closed, no reception attempted yet -> PENDING_CONTROL.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:ctrl-s4-t1', 'notes', NULL,
    'cash_session_id', 'ctrl-session-4-' || v_token, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 50000))
  ));
  v_close4 := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', 'ctrl-session-4-' || v_token, 'event_id', 'ctrl-close-4-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_cashier_id,
    'opened_at_device', now() - interval '30 minutes', 'closed_at_device', now() - interval '25 minutes'
  ));
  v_report4_id := (v_close4 ->> 'reportId')::uuid;
  v_status4 := pg_temp.compute_status(v_report4_id);

  ------------------------------------------------------------------
  -- GLOBAL CHECKS
  ------------------------------------------------------------------
  SELECT count(*) INTO v_sale_count_after FROM public.commercial_sales WHERE business_location_id = v_location_id AND status = 'CONFIRMED';
  SELECT count(*) INTO v_finance_op_count_after FROM public.finance_operations WHERE wallet_id IN (v_cash_wallet_id, v_dest_wallet_id) OR destination_wallet_id IN (v_cash_wallet_id, v_dest_wallet_id);
  -- sales: 5(s1) + 1(s2 qty2=200000) + 1(s3) + 1(s4) = 8 sales -> 8 REVENUE finance_operations.
  -- real receptions: 1a + 1b (s1) + 2a (s2) = 3 TRANSFER. Retries and rejections do not count.
  IF v_status1_before_final <> 'PENDING_CONTROL'
    OR v_status1_after_final <> 'REVIEW_REQUIRED'
    OR v_status2 <> 'RECEIVED'
    OR v_status3 <> 'RECEIVED'
    OR v_status4 <> 'PENDING_CONTROL' THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: unexpected status sequence: % / % / % / % / %', v_status1_before_final, v_status1_after_final, v_status2, v_status3, v_status4;
  END IF;
  IF (v_finance_op_count_after - v_finance_op_count_before) <> 11 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: expected 11 finance operations (8 revenue + 3 transfer), got %', v_finance_op_count_after - v_finance_op_count_before;
  END IF;
  IF v_sale_count_after <> v_sale_count_before + 3 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: closures and receptions must never create a phantom sale, expected % got %', v_sale_count_before + 3, v_sale_count_after;
  END IF;
  IF (v_recv1b ->> 'difference')::numeric <> -2000 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: expected final reception difference -2000, got %', v_recv1b ->> 'difference';
  END IF;
  IF (v_recv2 ->> 'difference')::numeric <> 0 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: expected exact reception difference 0, got %', v_recv2 ->> 'difference';
  END IF;

  -- Same checks through the actual control center RPCs (list + detail), not
  -- just the local status mirror above.
  v_list := public.get_commerce_pos_control_reports(v_location_id, (current_date - 1)::text::date, (current_date + 1)::text::date, NULL, NULL);
  v_detail1 := public.get_commerce_pos_control_report_detail(v_report1_id);
  IF (v_list -> 'counts' ->> 'reviewRequired')::int <> 1
    OR (v_list -> 'counts' ->> 'partiallyReceived')::int <> 0
    OR (v_list -> 'counts' ->> 'received')::int <> 2
    OR (v_list -> 'counts' ->> 'pendingControl')::int <> 1 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: control report counts mismatch: %', v_list -> 'counts';
  END IF;
  IF jsonb_array_length(v_detail1 -> 'sales') <> 5 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: report detail should trace back to exactly 5 sales, got %', jsonb_array_length(v_detail1 -> 'sales');
  END IF;
  IF jsonb_array_length(v_detail1 -> 'receptions') <> 2 THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: report detail should show exactly 2 receptions, got %', jsonb_array_length(v_detail1 -> 'receptions');
  END IF;
  IF (v_detail1 -> 'report' ->> 'flaggedForReview')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CONTROL_TEST_FAILED: report should not be flagged by default';
  END IF;

  RAISE NOTICE 'Mission caisse control center validated: PENDING_CONTROL -> REVIEW_REQUIRED (negative variance) / RECEIVED (exact) / RECEIVED (zero cash expected) / PENDING_CONTROL, idempotent retry, rejected reception after finalization and on zero cash expected, 11 finance operations, list/detail RPCs consistent.';
END;
$test$;

ROLLBACK;
