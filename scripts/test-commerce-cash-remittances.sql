-- POS-05 cash-remittance and financial invariants. Everything is rolled back.
--
-- Mission caisse (20260814120000) revoked commerce.cash.remittance.declare
-- from the caissier role. declare_commerce_cash_remittance additionally
-- requires closure.cashier_user_id = auth.uid() (a caissier may only ever
-- declare their OWN closure) -- so after that migration, no actor can ever
-- legitimately declare a closure owned by a plain caissier through this
-- legacy path any more: the permission is gone from the role, and no other
-- role can satisfy the ownership check on a caissier-owned closure. The
-- manual declare/confirm pathway therefore now only makes sense self-served
-- by a manager-tier actor who is also the closure's own cashier_user_id --
-- exactly how the control-center path (confirm_commerce_pos_cash_reception,
-- declared_by always NULL) already replaces it for real caissier closures.
-- This test reflects that: v_cashier proves the lockout, v_manager plays
-- both "the closure's cashier" and "the declarer" for the happy path, and a
-- second, distinct manager (v_manager2) plays the confirmer and the
-- unauthorized outsider.
BEGIN;

DO $test$
DECLARE
  v_cashier uuid;
  v_manager uuid;
  v_manager2 uuid;
  v_unit uuid;
  v_location uuid;
  v_other_location uuid;
  v_source_wallet uuid;
  v_destination_wallet uuid;
  v_rogue_wallet uuid;
  v_item uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-pos05-' || txid_current()::text;
  v_session_mgr text := 'session-pos05-mgr-' || txid_current()::text;
  v_sale_event jsonb;
  v_close_mgr jsonb;
  v_manager_closure_id uuid;
  v_partial_closure_id uuid;
  v_declaration jsonb;
  v_declared jsonb;
  v_declared_retry jsonb;
  v_confirmed jsonb;
  v_confirmed_retry jsonb;
  v_partial jsonb;
  v_workspace jsonb;
  v_cockpit jsonb;
  v_source_before numeric;
  v_destination_before numeric;
  v_revenue_count integer;
  v_transfer_count integer;
  v_cashier_declare_rejected boolean := false;
BEGIN
  SELECT user_id INTO v_cashier FROM public.user_roles
  WHERE role = 'caissier'::public.app_role ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_manager FROM public.user_roles
  WHERE role IN ('gestionnaire'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
    AND user_id IS DISTINCT FROM v_cashier
  ORDER BY CASE role WHEN 'gestionnaire'::public.app_role THEN 1 WHEN 'admin'::public.app_role THEN 2 ELSE 3 END, user_id
  LIMIT 1;
  SELECT user_id INTO v_manager2 FROM public.user_roles
  WHERE role IN ('gestionnaire'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
    AND user_id IS DISTINCT FROM v_cashier AND user_id IS DISTINCT FROM v_manager
  ORDER BY CASE role WHEN 'gestionnaire'::public.app_role THEN 1 WHEN 'admin'::public.app_role THEN 2 ELSE 3 END, user_id
  LIMIT 1;
  IF v_cashier IS NULL OR v_manager IS NULL OR v_manager2 IS NULL THEN
    RAISE EXCEPTION 'POS-05 tests require one cashier and two distinct manager-tier actors.';
  END IF;
  SELECT id INTO v_unit FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Active COMMERCE unit missing.'; END IF;

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('POS05 caisse ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_source_wallet;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('POS05 collecte ' || v_token, 'BANK', 0, 0, false) RETURNING id INTO v_destination_wallet;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('POS05 interdit ' || v_token, 'BANK', 0, 0, false) RETURNING id INTO v_rogue_wallet;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_unit, 'P05A' || v_token, 'POS-05 principal', 'STORE', 'ACTIVE', v_manager, v_manager) RETURNING id INTO v_location;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_unit, 'P05B' || v_token, 'POS-05 autre', 'STORE', 'ACTIVE', v_manager, v_manager) RETURNING id INTO v_other_location;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES
    (v_location, v_source_wallet, 'CASH_DRAWER', true, true, v_manager),
    (v_location, v_destination_wallet, 'COLLECTION', false, true, v_manager);
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, assigned_by)
  VALUES
    (v_location, v_cashier, 'CASHIER', current_date, v_manager),
    (v_location, v_manager, 'STORE_MANAGER', current_date, v_manager),
    (v_location, v_manager2, 'STORE_MANAGER', current_date, v_manager);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('POS05-' || v_token, 'Article POS-05', 'TEST', 'PIECE', 10, 0) RETURNING id INTO v_item;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location, v_item, 10, 10000);
  INSERT INTO public.commerce_inventory_cost_states(
    business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from
  ) VALUES (v_location, v_item, 10, 4000, 40000, 'OPENING');

  PERFORM set_config('request.jwt.claim.sub', v_cashier::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  IF public.user_has_permission('commerce.cash.remittance.declare')
    OR public.user_has_permission('commerce.cash.remittance.confirm') THEN
    RAISE EXCEPTION 'Cashier remittance permissions are incorrect: caissier must hold neither declare nor confirm since mission caisse.';
  END IF;

  ------------------------------------------------------------------
  -- permission_require('commerce.cash.remittance.declare') is the very
  -- first thing declare_commerce_cash_remittance checks -- before it even
  -- looks up a closure -- so a caissier is rejected on the permission alone,
  -- for ANY closure id, real or not. No fixture needed to prove the lockout.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.declare_commerce_cash_remittance(jsonb_build_object(
      'remittance_event_id', 'remittance-pos05-cashier-locked-' || v_token,
      'business_location_id', v_location, 'reference', 'POS05-LOCKED-' || v_token,
      'closures', jsonb_build_array(jsonb_build_object('closure_id', gen_random_uuid(), 'amount', 1))
    ));
  EXCEPTION WHEN SQLSTATE '42501' THEN v_cashier_declare_rejected := true;
  END;
  IF NOT v_cashier_declare_rejected THEN
    RAISE EXCEPTION 'A caissier declared a remittance -- this permission must have been revoked by mission caisse.';
  END IF;

  ------------------------------------------------------------------
  -- Happy path: a manager-tier actor closes their OWN session (so ownership
  -- and permission both hold) and declares it. A second, distinct manager
  -- confirms -- self-confirmation is still rejected regardless of role.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  v_sale_event := jsonb_build_object(
    'offline_sale_id', 'offline-pos05-mgr-' || v_token, 'terminal_id', v_terminal,
    'cash_session_id', v_session_mgr, 'business_location_id', v_location,
    'cashier_user_id', v_manager, 'created_at_device', now() - interval '8 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos05-mgr-' || v_token, 'payment_method', 'CASH',
      'total', 100000, 'cash_received', 100000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object(
        'line_type', 'ARTICLE', 'inventory_item_id', v_item, 'quantity', 10, 'unit_price', 10000
      ))
    )
  );
  IF (public.sync_commerce_pos_offline_sale(v_sale_event) ->> 'status') <> 'PROCESSED' THEN
    RAISE EXCEPTION 'Manager-owned POS sale setup failed.';
  END IF;
  v_close_mgr := public.sync_commerce_pos_cash_session_close(jsonb_build_object(
    'cash_session_id', v_session_mgr, 'event_id', 'close-pos05-mgr-' || v_token,
    'terminal_id', v_terminal, 'business_location_id', v_location, 'cashier_user_id', v_manager,
    'payload', jsonb_build_object(
      'opened_at_device', now() - interval '9 minutes', 'closed_at_device', now(),
      'ticket_count', 1, 'article_total', 100000, 'service_total', 0,
      'cash_total', 100000, 'other_payment_total', 0, 'theoretical_cash', 100000,
      'counted_cash', 98500, 'difference', -1500, 'note', 'Écart POS-05 (gestionnaire)'
    )
  ));
  v_manager_closure_id := (v_close_mgr ->> 'closureId')::uuid;
  v_declaration := jsonb_build_object(
    'remittance_event_id', 'remittance-pos05-full-' || v_token,
    'business_location_id', v_location, 'reference', 'POS05-FULL-' || v_token,
    'closures', jsonb_build_array(jsonb_build_object('closure_id', v_manager_closure_id, 'amount', 98500))
  );
  v_declared := public.declare_commerce_cash_remittance(v_declaration);
  v_declared_retry := public.declare_commerce_cash_remittance(v_declaration);
  IF (v_declared ->> 'id') IS DISTINCT FROM (v_declared_retry ->> 'id')
    OR (v_declared ->> 'expectedAmount')::numeric <> 100000
    OR (v_declared ->> 'declaredAmount')::numeric <> 98500 THEN
    RAISE EXCEPTION 'Full remittance declaration is not exact or idempotent.';
  END IF;

  BEGIN
    PERFORM public.confirm_commerce_cash_remittance((v_declared ->> 'id')::uuid, 98500, v_destination_wallet, NULL);
    RAISE EXCEPTION 'The declarer confirmed their own remittance.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_manager2::text, true);
  IF NOT public.user_has_permission('commerce.cash.remittance.confirm') THEN
    RAISE EXCEPTION 'Manager confirmation permission is missing.';
  END IF;
  BEGIN
    PERFORM public.confirm_commerce_cash_remittance((v_declared ->> 'id')::uuid, 98500, v_rogue_wallet, NULL);
    RAISE EXCEPTION 'An unauthorized destination wallet was accepted.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  SELECT balance INTO v_source_before FROM public.wallets WHERE id = v_source_wallet;
  SELECT balance INTO v_destination_before FROM public.wallets WHERE id = v_destination_wallet;
  v_confirmed := public.confirm_commerce_cash_remittance((v_declared ->> 'id')::uuid, 98500, v_destination_wallet, 'Réception physique exacte');
  v_confirmed_retry := public.confirm_commerce_cash_remittance((v_declared ->> 'id')::uuid, 98500, v_destination_wallet, 'Retry sans effet');
  IF (v_confirmed ->> 'operationId') IS DISTINCT FROM (v_confirmed_retry ->> 'operationId') THEN
    RAISE EXCEPTION 'Double confirmation created another operation.';
  END IF;
  SELECT count(*) INTO v_revenue_count FROM public.finance_operations
  WHERE wallet_id = v_source_wallet AND type = 'REVENUE' AND origin = 'COMMERCE_POS_PAYMENT';
  SELECT count(*) INTO v_transfer_count FROM public.finance_operations
  WHERE wallet_id = v_source_wallet AND type = 'TRANSFER' AND origin = 'COMMERCE_CASH_REMITTANCE';
  IF v_revenue_count <> 1 OR v_transfer_count <> 1
    OR (SELECT balance FROM public.wallets WHERE id = v_source_wallet) <> v_source_before - 98500
    OR (SELECT balance FROM public.wallets WHERE id = v_destination_wallet) <> v_destination_before + 98500 THEN
    RAISE EXCEPTION 'Remittance must move treasury once without creating revenue.';
  END IF;
  v_cockpit := public.get_commerce_store_cockpit(v_location, current_date, current_date);
  IF (v_cockpit #>> '{profitability,totalRevenue}')::numeric <> 100000
    OR (v_cockpit #>> '{profitability,costOfGoodsSold}')::numeric <> 40000
    OR (v_cockpit #>> '{profitability,grossMargin}')::numeric <> 60000
    OR (v_cockpit #>> '{profitability,netResult}')::numeric <> 60000 THEN
    RAISE EXCEPTION 'Cash remittance changed STORE-02/03 commercial results: %', v_cockpit -> 'profitability';
  END IF;

  -- A 500 000 counted closure (owned by the manager, so it can legitimately
  -- be self-declared) can be remitted in 300 000 then 200 000. It is never
  -- consumed twice and the residual is not labelled as a loss.
  INSERT INTO public.finance_operations(wallet_id, type, amount, operation_date, category, status, origin, created_by)
  VALUES (v_source_wallet, 'DEPOSIT', 500000, current_date, 'TEST POS-05', 'VALIDE', 'POS05_TEST_FIXTURE', v_manager);
  PERFORM public.update_wallet_balance(v_source_wallet);
  INSERT INTO public.commerce_pos_cash_session_closures(
    cash_session_id, closure_event_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, status, payload_hash,
    declared_ticket_count, declared_article_total, declared_service_total, declared_cash_total,
    declared_other_payment_total, declared_theoretical_cash, counted_cash, declared_difference,
    server_ticket_count, server_article_total, server_service_total, server_cash_total,
    server_other_payment_total, server_difference, totals_match, payload
  ) VALUES (
    'session-pos05-partial-' || v_token, 'close-pos05-partial-' || v_token, v_terminal, v_location, v_manager,
    now() - interval '1 day', now() - interval '23 hours', 'SYNCED', repeat('c', 32),
    1, 500000, 0, 500000, 0, 500000, 500000, 0,
    1, 500000, 0, 500000, 0, 0, true, '{}'::jsonb
  ) RETURNING id INTO v_partial_closure_id;
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  v_partial := public.declare_commerce_cash_remittance(jsonb_build_object(
    'remittance_event_id', 'remittance-pos05-partial-' || v_token, 'business_location_id', v_location,
    'closures', jsonb_build_array(jsonb_build_object('closure_id', v_partial_closure_id, 'amount', 300000))
  ));
  v_workspace := public.get_commerce_cash_remittance_workspace(v_location);
  IF (v_workspace #>> '{summary,remainingToRemit}')::numeric <> 200000 THEN
    RAISE EXCEPTION 'Partial declaration did not preserve the 200 000 remainder: %', v_workspace -> 'summary';
  END IF;
  BEGIN
    PERFORM public.declare_commerce_cash_remittance(jsonb_build_object(
      'remittance_event_id', 'remittance-pos05-over-' || v_token, 'business_location_id', v_location,
      'closures', jsonb_build_array(jsonb_build_object('closure_id', v_partial_closure_id, 'amount', 200001))
    ));
    RAISE EXCEPTION 'A closure was allocated above its remaining amount.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Another location, and another manager who does not own this closure,
  -- cannot be smuggled into a declaration.
  PERFORM set_config('request.jwt.claim.sub', v_manager2::text, true);
  BEGIN
    PERFORM public.declare_commerce_cash_remittance(jsonb_build_object(
      'remittance_event_id', 'remittance-pos05-wrong-owner-' || v_token, 'business_location_id', v_location,
      'closures', jsonb_build_array(jsonb_build_object('closure_id', v_partial_closure_id, 'amount', 1))
    ));
    RAISE EXCEPTION 'A manager declared another manager''s closure.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.declare_commerce_cash_remittance(jsonb_build_object(
      'remittance_event_id', 'remittance-pos05-wrong-store-' || v_token, 'business_location_id', v_other_location,
      'closures', jsonb_build_array(jsonb_build_object('closure_id', v_partial_closure_id, 'amount', 1))
    ));
    RAISE EXCEPTION 'A closure was declared for the wrong store.';
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '23503' THEN NULL;
  END;

  IF has_function_privilege('anon', 'public.declare_commerce_cash_remittance(jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_commerce_cash_remittance(uuid,numeric,uuid,text)', 'EXECUTE')
    OR has_table_privilege('authenticated', 'public.commerce_cash_remittance_closures', 'INSERT') THEN
    RAISE EXCEPTION 'POS-05 grants expose a protected function or table.';
  END IF;
  RAISE NOTICE 'POS-05 validated post mission-caisse: caissier locked out of declare/confirm entirely (permission-gated, before any closure lookup), manager self-service declare/confirm still works with self-confirmation blocked, revenue 100000, transfer 98500, partial 300000/200000, idempotence, ownership/store rejections.';
END;
$test$;

ROLLBACK;
