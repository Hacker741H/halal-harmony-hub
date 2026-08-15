-- Correction du modele financier POS (mission caisse phase 2): une vente
-- seule ne doit jamais creer d'ecriture Finance ; la cloture cree un rapport
-- sans toucher au wallet ; seule la reception confirmee par le gestionnaire
-- credite le wallet CASH_DRAWER du magasin. Tout est annule par le ROLLBACK
-- final ; aucune donnee de test ne survit.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_manager2 uuid;
  v_commerce_unit_id uuid;
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-fin-' || txid_current()::text;
  v_session text := 'session-fin-' || txid_current()::text;
  v_wallet_before numeric;
  v_wallet_after numeric;
  v_finance_count_before integer;
  v_finance_count_after integer;
  v_sale1 jsonb; v_sale2 jsonb; v_sale3 jsonb; v_sale4 jsonb;
  v_close jsonb; v_close_retry jsonb;
  v_report_id uuid;
  v_recv1 jsonb; v_recv1_retry jsonb;
  v_cockpit jsonb;
  v_op_count integer;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_manager2 FROM public.user_roles WHERE role IN ('gestionnaire'::public.app_role,'admin'::public.app_role,'super_admin'::public.app_role) AND user_id IS DISTINCT FROM v_actor_id ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL OR v_manager2 IS NULL THEN
    RAISE EXCEPTION 'Test requires one super_admin and one other manager-tier actor.';
  END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST FIN CASH ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'FIN' || v_token, 'Test Finance ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, assigned_by)
  VALUES (v_location_id, v_manager2, 'STORE_MANAGER', current_date, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('FIN-' || v_token, 'Article test finance', 'TEST', 'PIECE', 100, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 500);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 200, 20000, 'OPENING');

  SELECT balance INTO v_wallet_before FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_finance_count_before FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id;

  ------------------------------------------------------------------
  -- SCENARIO 1+2 : 4 ventes (4000+500+2500+3000 = 10000 CASH), zero
  -- finance_operations avant cloture, wallet inchange.
  ------------------------------------------------------------------
  v_sale1 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:fin-1-' || v_token, 'notes', NULL,
    'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 8, 'unit_price', 500))
  ));
  IF (v_sale1 ->> 'operationId') IS NOT NULL THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: a sale must never return an operationId, got %', v_sale1 ->> 'operationId';
  END IF;
  v_sale2 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:fin-2-' || v_token, 'notes', NULL,
    'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 500))
  ));
  v_sale3 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:fin-3-' || v_token, 'notes', NULL,
    'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 5, 'unit_price', 500))
  ));
  v_sale4 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:fin-4-' || v_token, 'notes', NULL,
    'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 6, 'unit_price', 500))
  ));
  IF (v_sale1 ->> 'amount')::numeric + (v_sale2 ->> 'amount')::numeric + (v_sale3 ->> 'amount')::numeric + (v_sale4 ->> 'amount')::numeric <> 10000 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: the 4 sales must total 10000, got %', (v_sale1 ->> 'amount')::numeric + (v_sale2 ->> 'amount')::numeric + (v_sale3 ->> 'amount')::numeric + (v_sale4 ->> 'amount')::numeric;
  END IF;

  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_finance_count_after FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id;
  IF v_finance_count_after <> v_finance_count_before OR v_wallet_after <> v_wallet_before THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: 4 sales must create 0 finance_operations and leave the wallet untouched, got % ops (was %), balance % (was %)',
      v_finance_count_after - v_finance_count_before, v_finance_count_before, v_wallet_after, v_wallet_before;
  END IF;

  -- CA commercial correct malgre l'absence totale d'ecriture Finance.
  v_cockpit := public.get_commerce_store_cockpit(v_location_id, current_date, current_date);
  IF (v_cockpit #>> '{profitability,totalRevenue}')::numeric <> 10000
    OR (v_cockpit #>> '{profitability,costOfGoodsSold}')::numeric <> 4000
    OR (v_cockpit #>> '{profitability,grossMargin}')::numeric <> 6000 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: CA/CMV/marge incorrects malgre 0 finance_operation: %', v_cockpit -> 'profitability';
  END IF;

  ------------------------------------------------------------------
  -- SCENARIO 3+8 : cloture -- theorique correct, un seul rapport, zero
  -- finance_operations, idempotent au retry.
  ------------------------------------------------------------------
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'fin-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '2 hours', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;
  IF (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 10000 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: cash_expected must be 10000, got %', (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id);
  END IF;
  IF (SELECT count(*) FROM public.commerce_pos_control_reports WHERE closure_id = (v_close ->> 'closureId')::uuid) <> 1 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: exactly one report must exist per closure.';
  END IF;

  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_finance_count_after FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id;
  IF v_finance_count_after <> v_finance_count_before OR v_wallet_after <> v_wallet_before THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: closing a session must still create 0 finance_operations, got % ops, balance %', v_finance_count_after - v_finance_count_before, v_wallet_after;
  END IF;

  -- retry cloture : meme rapport, pas de doublon.
  v_close_retry := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'fin-close-retry-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '2 hours', 'closed_at_device', now()
  ));
  IF (v_close_retry ->> 'reportId')::uuid <> v_report_id THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: retrying close_commerce_pos_cash_session must return the same report.';
  END IF;
  IF (SELECT count(*) FROM public.commerce_pos_control_reports WHERE cash_session_id = v_session) <> 1 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: retry created a second report.';
  END IF;

  ------------------------------------------------------------------
  -- SCENARIO 6+7 : reception partielle (6000 puis 4000), retry sans
  -- doublon, wallet credite uniquement du montant reellement recu, une
  -- seule ecriture DEPOSIT par reception reelle.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_manager2::text, true);
  v_recv1 := public.confirm_commerce_pos_cash_reception(v_report_id, 'fin-recv-1-' || v_token, 6000, false, 'Premier versement partiel.');
  v_recv1_retry := public.confirm_commerce_pos_cash_reception(v_report_id, 'fin-recv-1-' || v_token, 6000, false, 'Premier versement partiel.');
  IF (v_recv1 ->> 'remittanceId')::uuid <> (v_recv1_retry ->> 'remittanceId')::uuid THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: retrying a reception must not create a second remittance.';
  END IF;

  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 6000 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: after a 6000 partial reception, wallet must be +6000, got % (was %)', v_wallet_after, v_wallet_before;
  END IF;

  -- 4000 final, solde le rapport.
  PERFORM public.confirm_commerce_pos_cash_reception(v_report_id, 'fin-recv-2-' || v_token, 4000, true, 'Reception finale exacte.');
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 10000 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: after 6000+4000 receptions, wallet must be +10000 (exactly the received total, never the sales total twice), got %', v_wallet_after;
  END IF;

  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE wallet_id = v_wallet_id AND type = 'DEPOSIT' AND category = 'REMISE DE CAISSE' AND module_id = v_report_id;
  IF v_op_count <> 2 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: expected exactly 2 DEPOSIT operations (partial + final), got %', v_op_count;
  END IF;
  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE wallet_id = v_wallet_id AND type = 'REVENUE';
  IF v_op_count <> 0 THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: no REVENUE operation must ever exist for this wallet post-fix, got %', v_op_count;
  END IF;

  -- Tracabilite : chaque operation pointe vers le rapport, la remise pointe
  -- vers la cloture, le detail expose les 4 ventes et les 2 receptions.
  IF NOT EXISTS (SELECT 1 FROM public.finance_operations WHERE wallet_id = v_wallet_id AND module = 'COMMERCE_POS_CONTROL_REPORT' AND module_id = v_report_id) THEN
    RAISE EXCEPTION 'FIN_TEST_FAILED: finance_operations must be traceable back to the report via module_id.';
  END IF;
  DECLARE
    v_detail jsonb;
  BEGIN
    v_detail := public.get_commerce_pos_control_report_detail(v_report_id);
    IF jsonb_array_length(v_detail -> 'sales') <> 4 THEN
      RAISE EXCEPTION 'FIN_TEST_FAILED: report detail must trace back to exactly 4 sales, got %', jsonb_array_length(v_detail -> 'sales');
    END IF;
    IF jsonb_array_length(v_detail -> 'receptions') <> 2 THEN
      RAISE EXCEPTION 'FIN_TEST_FAILED: report detail must show exactly 2 receptions, got %', jsonb_array_length(v_detail -> 'receptions');
    END IF;
    IF (v_detail #>> '{report,isFinalized}')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'FIN_TEST_FAILED: report must be finalized after the final reception.';
    END IF;
  END;

  RAISE NOTICE 'FIN_TEST_PASSED: 4 sales (10000 CASH) create 0 finance_operations, CA/CMV/margin correct, closure creates exactly 1 report with 0 finance_operations (idempotent retry), partial (6000) + final (4000) receptions create exactly 2 DEPOSIT operations totalling wallet +10000, 0 REVENUE, fully traceable to report/sales.';
END;
$test$;

ROLLBACK;
