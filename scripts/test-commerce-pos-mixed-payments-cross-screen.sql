-- Mission maitre, section 11 Scenario 5 -- MIXED PAYMENTS: CASH + Mobile
-- Money (WAVE) + Other (CARD) in the same session must show the exact same
-- breakdown everywhere a manager or cashier can see it: the live preview,
-- the closure itself, the control report detail, and the store cockpit.
-- None of these are independent calculations -- proving they agree here
-- is proving they share the one canonical source
-- (_internal_commerce_pos_session_commercial_totals), not that four
-- separate formulas happen to match today. Creates its own fixtures,
-- everything reverted.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_manager_id uuid;
  v_commerce_unit_id uuid;
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-mixed-' || txid_current()::text;
  v_session text := 'session-mixed-' || txid_current()::text;
  v_preview jsonb;
  v_close jsonb;
  v_report_id uuid;
  v_detail jsonb;
  v_cockpit jsonb;
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
  VALUES ('TEST MIXED PAYMENTS ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'MIX' || v_token, 'Test Mixed Payments ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('MIX-' || v_token, 'Article test mixed', 'TEST', 'PIECE', 100, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 500);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 400, 40000, 'OPENING');

  -- CASH 1000, WAVE 1500, CARD 700 -- total 3200, theoretical cash 1000.
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:mixed-cash-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'WAVE',
    'reference', 'POS:mixed-wave-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'SERVICE', 'service_name', 'Reparation', 'quantity', 1, 'unit_price', 1500))
  ));
  PERFORM public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CARD',
    'reference', 'POS:mixed-card-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 700))
  ));

  ------------------------------------------------------------------
  -- 1. Live preview, before closure.
  ------------------------------------------------------------------
  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  IF (v_preview ->> 'ticketCount')::int <> 3
    OR (v_preview ->> 'cashTotal')::numeric <> 1000
    OR (v_preview ->> 'mobileMoneyTotal')::numeric <> 1500
    OR (v_preview ->> 'otherPaymentTotal')::numeric <> 700
    OR (v_preview ->> 'theoreticalCash')::numeric <> 1000
  THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: preview mismatch, expected 3 tickets / cash 1000 / mobile 1500 / other 700, got %', v_preview;
  END IF;

  ------------------------------------------------------------------
  -- 2. The closure itself.
  ------------------------------------------------------------------
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'mixed-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;
  IF (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 1000
    OR (SELECT mobile_money_total FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 1500
    OR (SELECT other_payment_total FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 700
    OR (SELECT total_revenue FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 3200
  THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: closure/report columns do not match the preview.';
  END IF;

  ------------------------------------------------------------------
  -- 3. The manager-facing report detail RPC (same figures, different call).
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
  IF (v_detail -> 'report' ->> 'cashExpected')::numeric <> 1000
    OR (v_detail -> 'report' ->> 'mobileMoneyTotal')::numeric <> 1500
    OR (v_detail -> 'report' ->> 'otherPaymentTotal')::numeric <> 700
    OR (v_detail -> 'report' ->> 'totalRevenue')::numeric <> 3200
  THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: report detail does not match the preview/closure, got %', v_detail -> 'report';
  END IF;

  ------------------------------------------------------------------
  -- 4. The store cockpit (CA is payment-method agnostic, but must still
  -- total the same 3200 across all three tickets).
  ------------------------------------------------------------------
  v_cockpit := public.get_commerce_store_cockpit(v_location_id, current_date, current_date);
  IF (v_cockpit -> 'profitability' ->> 'totalRevenue')::numeric <> 3200
    OR (v_cockpit -> 'sales' ->> 'ticketCount')::int <> 3
  THEN
    RAISE EXCEPTION 'MIXED_TEST_FAILED: cockpit does not agree with the session totals, got %', v_cockpit -> 'profitability';
  END IF;

  RAISE NOTICE 'MIXED_PAYMENTS_CROSS_SCREEN_TEST_PASSED: CASH 1000 + Mobile Money (WAVE) 1500 + Other (CARD) 700 = 3200 shown identically by the live preview, the closure/report columns, the manager report-detail RPC, and the store cockpit -- no payment method silently dropped or diverging between screens.';
END;
$test$;

ROLLBACK;
