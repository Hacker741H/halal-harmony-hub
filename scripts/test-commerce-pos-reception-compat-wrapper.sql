-- Compatibility matrix for the transitional deployment (old frontend / new
-- backend, new frontend / transitional backend, both signatures coexisting
-- without ambiguity). Everything reverted; safe against a linked project
-- once this migration is applied.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_manager2 uuid;
  v_commerce_unit_id uuid;
  v_location_id uuid;
  v_wallet_id uuid;
  v_rogue_wallet_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-compat-' || txid_current()::text;
  v_session text := 'session-compat-' || txid_current()::text;
  v_sale jsonb;
  v_close jsonb;
  v_report_id uuid;
  v_wallet_before numeric;
  v_wallet_after numeric;
  v_recv_old jsonb;
  v_recv_old_retry jsonb;
  v_recv_new jsonb;
  v_deposit_count integer;
  v_transfer_count integer;
  v_rogue_credited boolean;
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
  VALUES ('TEST COMPAT CASH ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  -- A wallet that is NOT this store's CASH_DRAWER, to prove the legacy
  -- p_destination_wallet_id argument is never actually used for routing.
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST COMPAT ROGUE ' || v_token, 'BANK', 0, 0, false) RETURNING id INTO v_rogue_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'CPT' || v_token, 'Test Compat ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, assigned_by)
  VALUES (v_location_id, v_manager2, 'STORE_MANAGER', current_date, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('CPT-' || v_token, 'Article test compat', 'TEST', 'PIECE', 100, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 1000);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 400, 40000, 'OPENING');

  ------------------------------------------------------------------
  -- Setup: one sale, one closure -- both already proven elsewhere to post
  -- zero Finance operations. Only the reception step is under test here.
  ------------------------------------------------------------------
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:compat-' || v_token, 'notes', NULL,
    'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 10, 'unit_price', 1000))
  ));
  IF (v_sale ->> 'amount')::numeric <> 10000 THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: setup sale must total 10000, got %', v_sale ->> 'amount';
  END IF;
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'compat-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;
  SELECT balance INTO v_wallet_before FROM public.wallets WHERE id = v_wallet_id;

  PERFORM set_config('request.jwt.claim.sub', v_manager2::text, true);

  ------------------------------------------------------------------
  -- MATRIX 1: ancien frontend (appel a 6 arguments, avec
  -- destinationWalletId) contre le nouveau backend transitoire. Doit
  -- fonctionner, produire un DEPOSIT (jamais un TRANSFER), et ne jamais
  -- crediter le wallet "destination" fourni -- seul le CASH_DRAWER reel
  -- bouge.
  ------------------------------------------------------------------
  v_recv_old := public.confirm_commerce_pos_cash_reception(
    v_report_id, 'compat-recv-old-' || v_token, 6000, v_rogue_wallet_id, false, 'Reception via ancien appel (6 arguments).'
  );
  v_recv_old_retry := public.confirm_commerce_pos_cash_reception(
    v_report_id, 'compat-recv-old-' || v_token, 6000, v_rogue_wallet_id, false, 'Retry.'
  );
  IF (v_recv_old ->> 'remittanceId')::uuid <> (v_recv_old_retry ->> 'remittanceId')::uuid THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: retrying the legacy 6-argument call must not create a second remittance.';
  END IF;

  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 6000 THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: the legacy call must still credit the real CASH_DRAWER for +6000, got % (was %)', v_wallet_after, v_wallet_before;
  END IF;
  SELECT (balance <> 0) INTO v_rogue_credited FROM public.wallets WHERE id = v_rogue_wallet_id;
  IF v_rogue_credited THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: the legacy destination_wallet_id argument must never actually receive funds.';
  END IF;

  SELECT count(*) INTO v_deposit_count FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND type = 'DEPOSIT' AND destination_wallet_id IS NULL AND module = 'COMMERCE_POS_CONTROL_REPORT';
  IF v_deposit_count <> 1 THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: expected exactly 1 DEPOSIT from the legacy call, got %', v_deposit_count;
  END IF;
  SELECT count(*) INTO v_transfer_count FROM public.finance_operations
  WHERE wallet_id IN (v_wallet_id, v_rogue_wallet_id) AND type = 'TRANSFER';
  IF v_transfer_count <> 0 THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: the legacy call must never produce a TRANSFER, got %', v_transfer_count;
  END IF;

  -- Legacy call still validates its own argument shape: NULL and
  -- nonexistent wallets are rejected exactly as before, even though the
  -- value is never used for routing.
  BEGIN
    PERFORM public.confirm_commerce_pos_cash_reception(v_report_id, 'compat-recv-null-' || v_token, 100, NULL, false, NULL);
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: a NULL legacy destination wallet must be rejected.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.confirm_commerce_pos_cash_reception(v_report_id, 'compat-recv-fake-' || v_token, 100, gen_random_uuid(), false, NULL);
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: a nonexistent legacy destination wallet must be rejected.';
  EXCEPTION WHEN SQLSTATE '23503' THEN NULL;
  END;

  ------------------------------------------------------------------
  -- MATRIX 2: nouveau frontend (appel a 5 arguments, sans
  -- destinationWalletId) contre ce meme backend transitoire, alors que
  -- l'overload a 6 arguments existe toujours. Doit se resoudre sans
  -- ambiguite vers le nouvel overload et completer la reception du meme
  -- rapport (reliquat 4000 apres les 6000 ci-dessus).
  ------------------------------------------------------------------
  v_recv_new := public.confirm_commerce_pos_cash_reception(
    v_report_id, 'compat-recv-new-' || v_token, 4000, true, 'Reception finale via nouvel appel (5 arguments).'
  );
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 10000 THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: mixing the legacy call then the new call must still total wallet +10000, got %', v_wallet_after;
  END IF;
  IF (v_recv_new ->> 'isFinal')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: the new-signature call must finalize the report as usual.';
  END IF;

  SELECT count(*) INTO v_deposit_count FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND type = 'DEPOSIT' AND module = 'COMMERCE_POS_CONTROL_REPORT';
  IF v_deposit_count <> 2 THEN
    RAISE EXCEPTION 'COMPAT_TEST_FAILED: expected exactly 2 DEPOSIT total (legacy call + new call), got %', v_deposit_count;
  END IF;

  RAISE NOTICE 'COMPAT_TEST_PASSED: legacy 6-argument call works against the transitional backend (DEPOSIT only, destination argument never used for routing, retry-idempotent, NULL/nonexistent destination still rejected); new 5-argument call resolves unambiguously against the same transitional backend and completes the same report; mixed legacy+new receptions on one report total exactly the confirmed amount with zero TRANSFER and zero duplicate.';
END;
$test$;

ROLLBACK;
