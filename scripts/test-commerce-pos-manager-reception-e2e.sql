-- Mission maitre, Blocker C: full manager-reception workflow, end to end,
-- against the CURRENT architecture (automatic closure, 5-arg
-- confirm_commerce_pos_cash_reception). Covers exactly the 4 reception
-- scenarios the mission specifies (complete / partial / deficit / surplus)
-- plus retry-idempotence and the "wallet stays at zero until reception"
-- invariant. Creates its own fixtures, everything reverted.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_manager_id uuid;
  v_commerce_unit_id uuid;
  v_token text := txid_current()::text;
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_terminal text;
  v_session text;
  v_sale jsonb;
  v_close jsonb;
  v_report_id uuid;
  v_closure_id uuid;
  v_wallet_before numeric;
  v_wallet_after numeric;
  v_recv jsonb;
  v_recv_retry jsonb;
  v_detail jsonb;
  v_deposit_count integer;
  v_sale_count_before integer;
  v_sale_count_after integer;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_manager_id FROM public.user_roles WHERE role IN ('gestionnaire'::public.app_role,'admin'::public.app_role,'super_admin'::public.app_role) AND user_id IS DISTINCT FROM v_actor_id ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL OR v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Test requires one super_admin (cashier role) and one other manager-tier actor.';
  END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST E2E RECEPTION ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'E2E' || v_token, 'Test E2E Reception ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, assigned_by)
  VALUES (v_location_id, v_manager_id, 'STORE_MANAGER', current_date, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('E2E-' || v_token, 'Article test E2E', 'TEST', 'PIECE', 1000, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 1000, 1000);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 1000, 400, 400000, 'OPENING');

  -- ====================================================================
  -- SCENARIO 1 -- CASH complet
  -- ====================================================================
  v_terminal := 'terminal-e2e-s1-' || v_token;
  v_session := 'session-e2e-s1-' || v_token;
  SELECT count(*) INTO v_sale_count_before FROM public.commercial_sales WHERE business_location_id = v_location_id;

  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:e2e-s1-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  IF (v_sale ->> 'amount')::numeric <> 1000 THEN RAISE EXCEPTION 'E2E_S1_FAILED: sale must be 1000, got %', v_sale; END IF;

  SELECT balance INTO v_wallet_before FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_before <> 0 THEN RAISE EXCEPTION 'E2E_S1_FAILED: wallet must stay at 0 after the sale, got %', v_wallet_before; END IF;

  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'e2e-s1-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;

  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> 0 THEN RAISE EXCEPTION 'E2E_S1_FAILED: wallet must still be 0 right after closure (before any reception), got %', v_wallet_after; END IF;
  IF (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 1000 THEN
    RAISE EXCEPTION 'E2E_S1_FAILED: report cash_expected must be 1000.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  v_recv := public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s1-recv-' || v_token, 1000, true, 'Reception complete.');
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> 1000 THEN RAISE EXCEPTION 'E2E_S1_FAILED: wallet must be exactly +1000 after full reception, got %', v_wallet_after; END IF;
  IF (v_recv ->> 'difference')::numeric <> 0 THEN RAISE EXCEPTION 'E2E_S1_FAILED: a full reception must have difference=0, got %', v_recv; END IF;

  SELECT count(*) INTO v_deposit_count FROM public.finance_operations WHERE wallet_id = v_wallet_id AND type = 'DEPOSIT';
  IF v_deposit_count <> 1 THEN RAISE EXCEPTION 'E2E_S1_FAILED: expected exactly 1 DEPOSIT, got %', v_deposit_count; END IF;

  SELECT count(*) INTO v_sale_count_after FROM public.commercial_sales WHERE business_location_id = v_location_id;
  IF v_sale_count_after <> v_sale_count_before + 1 THEN
    RAISE EXCEPTION 'E2E_S1_FAILED: reception must never create a new commercial_sales row (no fictitious second CA), before=%, after=%', v_sale_count_before, v_sale_count_after;
  END IF;

  -- Retry: same event id must not duplicate anything.
  v_recv_retry := public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s1-recv-' || v_token, 1000, true, NULL);
  IF (v_recv ->> 'remittanceId')::uuid <> (v_recv_retry ->> 'remittanceId')::uuid THEN
    RAISE EXCEPTION 'E2E_S1_FAILED: retrying the same reception event must return the same remittance, not create a new one.';
  END IF;
  SELECT count(*) INTO v_deposit_count FROM public.finance_operations WHERE wallet_id = v_wallet_id AND type = 'DEPOSIT';
  IF v_deposit_count <> 1 THEN RAISE EXCEPTION 'E2E_S1_FAILED: retry must never create a second DEPOSIT, got %', v_deposit_count; END IF;

  -- Already finalized: a further reception attempt must be rejected outright.
  BEGIN
    PERFORM public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s1-recv-extra-' || v_token, 1, true, NULL);
    RAISE EXCEPTION 'E2E_S1_FAILED: a reception on an already-finalized report must be rejected.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF (v_detail -> 'report' ->> 'receivedTotal')::numeric <> 1000
    OR (v_detail -> 'report' ->> 'remainingAmount')::numeric <> 0
    OR (v_detail -> 'report' ->> 'isFinalized')::boolean IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'E2E_S1_FAILED: report detail must show receivedTotal=1000, remainingAmount=0, isFinalized=true, got %', v_detail -> 'report';
  END IF;

  -- ====================================================================
  -- SCENARIO 2 -- PARTIEL (6000 puis 4000 = 10000)
  -- ====================================================================
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  v_terminal := 'terminal-e2e-s2-' || v_token;
  v_session := 'session-e2e-s2-' || v_token;

  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:e2e-s2-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 10, 'unit_price', 1000))
  ));
  IF (v_sale ->> 'amount')::numeric <> 10000 THEN RAISE EXCEPTION 'E2E_S2_FAILED: sale must be 10000, got %', v_sale; END IF;

  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'e2e-s2-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  v_recv := public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s2-recv-partial-' || v_token, 6000, false, 'Reception partielle.');
  IF (v_recv ->> 'isFinal')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'E2E_S2_FAILED: a partial reception must echo isFinal=false.'; END IF;
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> 1000 + 6000 THEN RAISE EXCEPTION 'E2E_S2_FAILED: wallet must be 7000 after scenario 1 (1000) + partial 6000, got %', v_wallet_after; END IF;

  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF (v_detail -> 'report' ->> 'receivedTotal')::numeric <> 6000
    OR (v_detail -> 'report' ->> 'remainingAmount')::numeric <> 4000
    OR (v_detail -> 'report' ->> 'isFinalized')::boolean IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'E2E_S2_FAILED: after the partial reception, report must show received=6000, remaining=4000, not finalized, got %', v_detail -> 'report';
  END IF;

  -- Second (final) reception closes the remaining 4000.
  v_recv := public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s2-recv-final-' || v_token, 4000, true, 'Reception finale.');
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> 1000 + 10000 THEN RAISE EXCEPTION 'E2E_S2_FAILED: wallet must total 11000 (1000 + full 10000) after both receptions, got %', v_wallet_after; END IF;
  IF (v_recv ->> 'difference')::numeric <> 0 THEN RAISE EXCEPTION 'E2E_S2_FAILED: the final reception must close exactly on the remaining 4000, difference=0, got %', v_recv; END IF;

  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF (v_detail -> 'report' ->> 'receivedTotal')::numeric <> 10000
    OR (v_detail -> 'report' ->> 'remainingAmount')::numeric <> 0
    OR (v_detail -> 'report' ->> 'isFinalized')::boolean IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'E2E_S2_FAILED: after both receptions, report must show received=10000, remaining=0, finalized, got %', v_detail -> 'report';
  END IF;

  SELECT count(*) INTO v_deposit_count FROM public.finance_operations WHERE wallet_id = v_wallet_id AND type = 'DEPOSIT'
    AND module_id = v_report_id;
  IF v_deposit_count <> 2 THEN RAISE EXCEPTION 'E2E_S2_FAILED: expected exactly 2 DEPOSIT (partial + final) for this report, got %', v_deposit_count; END IF;

  -- ====================================================================
  -- SCENARIO 3 -- ECART NEGATIF (expected 10000, recu 9500)
  -- ====================================================================
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  v_terminal := 'terminal-e2e-s3-' || v_token;
  v_session := 'session-e2e-s3-' || v_token;

  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:e2e-s3-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 10, 'unit_price', 1000))
  ));
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'e2e-s3-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  SELECT balance INTO v_wallet_before FROM public.wallets WHERE id = v_wallet_id;
  v_recv := public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s3-recv-' || v_token, 9500, true, 'Ecart constate a la reception.');
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 9500 THEN
    RAISE EXCEPTION 'E2E_S3_FAILED: wallet must move by exactly the amount actually received (+9500), no fictitious top-up to 10000, got % (was %)', v_wallet_after, v_wallet_before;
  END IF;
  IF (v_recv ->> 'difference')::numeric <> -500 THEN RAISE EXCEPTION 'E2E_S3_FAILED: difference must be -500, got %', v_recv; END IF;

  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF (v_detail -> 'report' ->> 'receivedTotal')::numeric <> 9500
    OR (v_detail -> 'report' ->> 'remainingAmount')::numeric <> 500
    OR (v_detail -> 'report' ->> 'isFinalized')::boolean IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'E2E_S3_FAILED: a finalized-with-shortfall report must still show the true remainingAmount=500 (visible gap), received=9500, finalized=true, got %', v_detail -> 'report';
  END IF;
  -- No further reception possible even though a gap remains: it is final.
  BEGIN
    PERFORM public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s3-recv-extra-' || v_token, 500, true, NULL);
    RAISE EXCEPTION 'E2E_S3_FAILED: a finalized report must reject further receptions, even to cover its own visible gap.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- ====================================================================
  -- SCENARIO 4 -- SURPLUS (expected 10000, recu 10100)
  -- ====================================================================
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  v_terminal := 'terminal-e2e-s4-' || v_token;
  v_session := 'session-e2e-s4-' || v_token;

  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:e2e-s4-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 10, 'unit_price', 1000))
  ));
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'e2e-s4-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  SELECT balance INTO v_wallet_before FROM public.wallets WHERE id = v_wallet_id;
  v_recv := public.confirm_commerce_pos_cash_reception(v_report_id, 'e2e-s4-recv-' || v_token, 10100, true, 'Surplus constate a la reception.');
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 10100 THEN
    RAISE EXCEPTION 'E2E_S4_FAILED: wallet must move by exactly the amount actually received (+10100), got % (was %)', v_wallet_after, v_wallet_before;
  END IF;
  IF (v_recv ->> 'difference')::numeric <> 100 THEN RAISE EXCEPTION 'E2E_S4_FAILED: difference must be +100, got %', v_recv; END IF;

  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF (v_detail -> 'report' ->> 'receivedTotal')::numeric <> 10100
    OR (v_detail -> 'report' ->> 'remainingAmount')::numeric <> 0
    OR (v_detail -> 'report' ->> 'isFinalized')::boolean IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'E2E_S4_FAILED: a finalized-with-surplus report must show remainingAmount=0 (never negative), received=10100, finalized=true, got %', v_detail -> 'report';
  END IF;

  RAISE NOTICE 'E2E_RECEPTION_TEST_PASSED: full/partial/deficit/surplus reception scenarios all verified end to end -- wallet stays at 0 through sale and closure, moves only by the amount actually received (never the theoretical), retry-idempotent, no reception accepted after finalization even with a visible gap, and no reception ever creates a second commercial_sales row.';
END;
$test$;

ROLLBACK;
