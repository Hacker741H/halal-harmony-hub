-- POS-04C server checks. All generated data is rolled back at the end.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_wallet_id uuid;
  v_location_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal_id text := 'terminal-pos04c-' || txid_current()::text;
  v_session_id text := 'session-pos04c-' || txid_current()::text;
  v_mismatch_session_id text := 'session-pos04c-review-' || txid_current()::text;
  v_pending_session_id text := 'session-pos04c-pending-' || txid_current()::text;
  v_article_sale jsonb;
  v_mixed_sale jsonb;
  v_review_sale jsonb;
  v_close_event jsonb;
  v_close_result jsonb;
  v_close_retry jsonb;
  v_pending_result jsonb;
  v_review_result jsonb;
  v_wallet_before_close numeric(14, 2);
  v_wallet_after_close numeric(14, 2);
  v_finance_before_close integer;
  v_finance_after_close integer;
  v_item_stock numeric(14, 3);
  v_location_stock numeric(14, 3);
  v_closure_count integer;
BEGIN
  SELECT user_id INTO v_actor_id
  FROM public.user_roles
  WHERE role = 'super_admin'::public.app_role
  ORDER BY user_id
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'POS-04C test requires one existing super_admin actor.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  IF has_function_privilege('anon', 'public.sync_commerce_pos_cash_session_close(jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.sync_commerce_pos_cash_session_close(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Cash-session close RPC grants are not restricted to authenticated users.';
  END IF;
  IF has_table_privilege('authenticated', 'public.commerce_pos_cash_session_closures', 'SELECT')
    OR has_table_privilege('authenticated', 'public.commerce_pos_cash_session_closures', 'INSERT') THEN
    RAISE EXCEPTION 'Cash-session closures must not be directly exposed to authenticated users.';
  END IF;

  SELECT id INTO v_commerce_unit_id
  FROM public.business_units
  WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_commerce_unit_id IS NULL THEN
    RAISE EXCEPTION 'The active COMMERCE business unit is missing.';
  END IF;

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST POS-04C ' || v_token, 'CASH', 0, 0, false)
  RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'POS4C' || v_token, 'Test POS-04C ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('POS4C-' || v_token, 'Chargeur Type C', 'TEST', 'PIECE', 7, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 7, 5000);

  -- The first ticket is article-only; the second one is a mixed article +
  -- service ticket. Their total must be 25 000 FCFA, while stock moves only
  -- for the two articles.
  v_article_sale := jsonb_build_object(
    'offline_sale_id', 'offline-pos04c-article-' || v_token,
    'terminal_id', v_terminal_id,
    'cash_session_id', v_session_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now() - interval '10 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos04c-article-' || v_token,
      'payment_method', 'CASH', 'total', 5000, 'cash_received', 5000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 5000))
    )
  );
  v_mixed_sale := jsonb_build_object(
    'offline_sale_id', 'offline-pos04c-mixed-' || v_token,
    'terminal_id', v_terminal_id,
    'cash_session_id', v_session_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now() - interval '8 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos04c-mixed-' || v_token,
      'payment_method', 'CASH', 'total', 20000, 'cash_received', 25000, 'change_due', 5000,
      'lines', jsonb_build_array(
        jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 5000),
        jsonb_build_object('line_type', 'SERVICE', 'service_name', 'Réparation téléphone', 'service_note', 'Sans stock', 'quantity', 1, 'unit_price', 15000)
      )
    )
  );
  IF (public.sync_commerce_pos_offline_sale(v_article_sale) ->> 'status') <> 'PROCESSED'
    OR (public.sync_commerce_pos_offline_sale(v_mixed_sale) ->> 'status') <> 'PROCESSED' THEN
    RAISE EXCEPTION 'The POS-04C setup tickets could not be synchronized.';
  END IF;

  SELECT balance INTO v_wallet_before_close FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_finance_before_close
  FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND origin = 'COMMERCE_POS_PAYMENT' AND status <> 'CANCELLED';
  SELECT stock_actuel INTO v_item_stock FROM public.inventory_items WHERE id = v_item_id;
  SELECT quantity INTO v_location_stock
  FROM public.business_location_inventory_items
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_wallet_before_close <> 25000 OR v_finance_before_close <> 2 OR v_item_stock <> 5 OR v_location_stock <> 5 THEN
    RAISE EXCEPTION 'The session setup must create exactly two receipts, two finance operations, 25 000 FCFA and two stock decrements.';
  END IF;

  -- A negative cash discrepancy is a fact to record, not a financial
  -- counter-entry. Replaying this exact close must return the same close.
  v_close_event := jsonb_build_object(
    'cash_session_id', v_session_id,
    'event_id', 'cash-close-pos04c-' || v_token,
    'terminal_id', v_terminal_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'payload', jsonb_build_object(
      'opened_at_device', now() - interval '12 minutes',
      'closed_at_device', now() - interval '1 minute',
      'ticket_count', 2,
      'article_total', 10000,
      'service_total', 15000,
      'cash_total', 25000,
      'other_payment_total', 0,
      'theoretical_cash', 25000,
      'counted_cash', 23000,
      'difference', -2000,
      'note', 'Écart physique contrôlé pendant le test'
    )
  );
  v_close_result := public.sync_commerce_pos_cash_session_close(v_close_event);
  v_close_retry := public.sync_commerce_pos_cash_session_close(v_close_event);
  IF (v_close_result ->> 'status') <> 'SYNCED'
    OR (v_close_result ->> 'closureId') IS DISTINCT FROM (v_close_retry ->> 'closureId') THEN
    RAISE EXCEPTION 'A normal close must be synchronized once and be idempotent.';
  END IF;
  SELECT count(*) INTO v_closure_count
  FROM public.commerce_pos_cash_session_closures
  WHERE cash_session_id = v_session_id;
  SELECT balance INTO v_wallet_after_close FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_finance_after_close
  FROM public.finance_operations
  WHERE wallet_id = v_wallet_id AND origin = 'COMMERCE_POS_PAYMENT' AND status <> 'CANCELLED';
  IF v_closure_count <> 1
    OR v_wallet_after_close <> v_wallet_before_close
    OR v_finance_after_close <> v_finance_before_close THEN
    RAISE EXCEPTION 'Closing a cash session must not change the wallet or create a finance operation.';
  END IF;
  IF (SELECT declared_difference FROM public.commerce_pos_cash_session_closures WHERE cash_session_id = v_session_id) <> -2000
    OR (SELECT server_difference FROM public.commerce_pos_cash_session_closures WHERE cash_session_id = v_session_id) <> -2000 THEN
    RAISE EXCEPTION 'The negative physical cash discrepancy was not retained.';
  END IF;

  -- No server receipt exists for this session yet: the close remains pending
  -- and no closure record is created prematurely.
  v_pending_result := public.sync_commerce_pos_cash_session_close(jsonb_build_object(
    'cash_session_id', v_pending_session_id,
    'event_id', 'cash-close-pos04c-pending-' || v_token,
    'terminal_id', v_terminal_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'payload', jsonb_build_object(
      'opened_at_device', now() - interval '3 minutes', 'closed_at_device', now(),
      'ticket_count', 1, 'article_total', 5000, 'service_total', 0,
      'cash_total', 5000, 'other_payment_total', 0, 'theoretical_cash', 5000,
      'counted_cash', 5000, 'difference', 0, 'note', null
    )
  ));
  IF (v_pending_result ->> 'status') <> 'PENDING_SALES'
    OR EXISTS (SELECT 1 FROM public.commerce_pos_cash_session_closures WHERE cash_session_id = v_pending_session_id) THEN
    RAISE EXCEPTION 'A close with unsynchronized sales must remain pending without a server closure.';
  END IF;

  -- A server-side total mismatch is retained for review. It also checks that
  -- a positive physical discrepancy stays visible instead of being hidden.
  v_review_sale := jsonb_build_object(
    'offline_sale_id', 'offline-pos04c-review-' || v_token,
    'terminal_id', v_terminal_id,
    'cash_session_id', v_mismatch_session_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', now() - interval '4 minutes',
    'payload', jsonb_build_object(
      'ticket_id', 'ticket-pos04c-review-' || v_token,
      'payment_method', 'CASH', 'total', 5000, 'cash_received', 5000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 5000))
    )
  );
  IF (public.sync_commerce_pos_offline_sale(v_review_sale) ->> 'status') <> 'PROCESSED' THEN
    RAISE EXCEPTION 'The review close setup ticket could not be synchronized.';
  END IF;
  v_review_result := public.sync_commerce_pos_cash_session_close(jsonb_build_object(
    'cash_session_id', v_mismatch_session_id,
    'event_id', 'cash-close-pos04c-review-' || v_token,
    'terminal_id', v_terminal_id,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'payload', jsonb_build_object(
      'opened_at_device', now() - interval '5 minutes', 'closed_at_device', now(),
      'ticket_count', 1, 'article_total', 4000, 'service_total', 1000,
      'cash_total', 5000, 'other_payment_total', 0, 'theoretical_cash', 5000,
      'counted_cash', 6000, 'difference', 1000, 'note', 'Excédent physique contrôlé'
    )
  ));
  IF (v_review_result ->> 'status') <> 'REVIEW_REQUIRED'
    OR (SELECT declared_difference FROM public.commerce_pos_cash_session_closures WHERE cash_session_id = v_mismatch_session_id) <> 1000
    OR (SELECT totals_match FROM public.commerce_pos_cash_session_closures WHERE cash_session_id = v_mismatch_session_id) <> false THEN
    RAISE EXCEPTION 'A positive discrepancy or a server total mismatch was not retained for review.';
  END IF;

  BEGIN
    PERFORM public.sync_commerce_pos_cash_session_close(
      jsonb_set(jsonb_set(v_close_event, '{event_id}', to_jsonb('cash-close-pos04c-invalid-' || v_token)), '{terminal_id}', '"bad terminal id"'::jsonb)
    );
    RAISE EXCEPTION 'An invalid terminal identifier was accepted for a close.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.sync_commerce_pos_cash_session_close(
      jsonb_set(
        jsonb_set(v_close_event, '{event_id}', to_jsonb('cash-close-pos04c-wrong-user-' || v_token)),
        '{cashier_user_id}', '"00000000-0000-0000-0000-000000000099"'::jsonb
      )
    );
    RAISE EXCEPTION 'A caller could close a cash session for another cashier.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
  BEGIN
    PERFORM public.sync_commerce_pos_cash_session_close(v_close_event);
    RAISE EXCEPTION 'A caller without commerce.pos.sell was accepted for a close.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  RAISE NOTICE 'POS-04C validated: session close after sales, mixed ticket, idempotence, +/- discrepancies, pending close, review close, restricted access and no financial impact.';
END;
$test$;

ROLLBACK;
