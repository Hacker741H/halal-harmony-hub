-- Mission maitre, Blocker A: get_commerce_pos_cash_session_preview must now
-- also return the row-level list of sales for the open session (not just
-- aggregate totals), so the frontend "Ventes" tab has a server source that
-- covers online-direct sales too. Creates its own fixtures, everything
-- reverted.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-saleslist-' || txid_current()::text;
  v_session text := 'session-saleslist-' || txid_current()::text;
  v_sale_one jsonb;
  v_sale_two jsonb;
  v_preview jsonb;
  v_sales jsonb;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Test requires a super_admin actor.'; END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST SALES LIST ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'SLT' || v_token, 'Test Sales List ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('SLT-' || v_token, 'Article test sales list', 'TEST', 'PIECE', 100, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 500);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 200, 20000, 'OPENING');

  ------------------------------------------------------------------
  -- Empty session first: sales must be [], not an error or a missing key.
  ------------------------------------------------------------------
  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  IF jsonb_typeof(v_preview -> 'sales') <> 'array' OR jsonb_array_length(v_preview -> 'sales') <> 0 THEN
    RAISE EXCEPTION 'SALES_LIST_TEST_FAILED: empty session must return sales=[], got %', v_preview -> 'sales';
  END IF;

  ------------------------------------------------------------------
  -- Sale 1: 1 article (500) -- the "online-direct" path in production terms.
  ------------------------------------------------------------------
  v_sale_one := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:saleslist-one-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 500))
  ));

  ------------------------------------------------------------------
  -- Sale 2: 1 article (500) + 1 service (1300) -- mixed lines, CASH again.
  ------------------------------------------------------------------
  v_sale_two := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:saleslist-two-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(
      jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 500),
      jsonb_build_object('line_type', 'SERVICE', 'service_name', 'Reparation', 'quantity', 1, 'unit_price', 1300)
    )
  ));

  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  v_sales := v_preview -> 'sales';

  IF jsonb_array_length(v_sales) <> 2 THEN
    RAISE EXCEPTION 'SALES_LIST_TEST_FAILED: expected 2 sales rows, got %', jsonb_array_length(v_sales);
  END IF;

  -- Newest first (matches the local outbox list's existing sort order).
  IF (v_sales -> 0 ->> 'id') <> (v_sale_two ->> 'saleId') THEN
    RAISE EXCEPTION 'SALES_LIST_TEST_FAILED: sales must be ordered newest-first, got %', v_sales;
  END IF;

  IF (v_sales -> 0 ->> 'total')::numeric <> 1800
    OR (v_sales -> 0 ->> 'articleCount')::int <> 1
    OR (v_sales -> 0 ->> 'serviceCount')::int <> 1
    OR (v_sales -> 0 ->> 'paymentMethod') <> 'CASH'
  THEN
    RAISE EXCEPTION 'SALES_LIST_TEST_FAILED: sale two row mismatch, got %', v_sales -> 0;
  END IF;

  IF (v_sales -> 1 ->> 'id') <> (v_sale_one ->> 'saleId')
    OR (v_sales -> 1 ->> 'total')::numeric <> 500
    OR (v_sales -> 1 ->> 'articleCount')::int <> 1
    OR (v_sales -> 1 ->> 'serviceCount')::int <> 0
  THEN
    RAISE EXCEPTION 'SALES_LIST_TEST_FAILED: sale one row mismatch, got %', v_sales -> 1;
  END IF;

  -- The aggregate totals alongside it must still be exactly right (2300 =
  -- 500 + 1800), proving the row list and the totals never diverge -- same
  -- underlying rows, same WHERE clause.
  IF (v_preview ->> 'ticketCount')::int <> 2 OR (v_preview ->> 'theoreticalCash')::numeric <> 2300 THEN
    RAISE EXCEPTION 'SALES_LIST_TEST_FAILED: aggregate totals must still be 2 tickets / 2300 theoretical, got %', v_preview;
  END IF;

  RAISE NOTICE 'SALES_LIST_TEST_PASSED: get_commerce_pos_cash_session_preview returns the exact row-level sales list (newest first, correct total/articleCount/serviceCount/paymentMethod per row) alongside unchanged aggregate totals.';
END;
$test$;

ROLLBACK;
