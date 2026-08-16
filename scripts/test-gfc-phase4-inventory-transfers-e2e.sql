-- GFC V1 Phase 4D -- mandatory E2E synthetic proof, scenarios A-L exactly
-- per spec. Own synthetic fixtures, ROLLBACK at the end.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_bystander_id uuid;
  v_commerce_unit_id uuid;
  v_location_a_id uuid;
  v_location_b_id uuid;
  v_item_id uuid;
  v_item_f_id uuid;
  v_count public.commerce_inventory_counts;
  v_count_b public.commerce_inventory_counts;
  v_count_c public.commerce_inventory_counts;
  v_bli record;
  v_cost_state record;
  v_op_count_before integer;
  v_op_count_after integer;
  v_transfer public.commerce_stock_transfers;
  v_rejected boolean;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_bystander_id FROM public.user_roles WHERE role = 'lecture_seule'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL OR v_bystander_id IS NULL THEN RAISE EXCEPTION 'Test requires a super_admin and a lecture_seule user.'; END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'P4A' || txid_current()::text, 'Test Phase4 Magasin A', 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_a_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'P4B' || txid_current()::text, 'Test Phase4 Magasin B', 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_b_id;

  SELECT count(*) INTO v_op_count_before FROM public.finance_operations;

  ------------------------------------------------------------------
  -- Fixture: article A a 10 unites @ CUMP 500 au magasin A (via achat,
  -- moteur deja prouve en Phase 3).
  ------------------------------------------------------------------
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P4-' || txid_current()::text, 'Article Phase4 Test', 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity)
  VALUES (v_location_a_id, v_item_id, 10);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_a_id, v_item_id, 10, 500, 5000, 'OPENING');

  ------------------------------------------------------------------
  -- A. Inventaire sans ecart.
  ------------------------------------------------------------------
  v_count := public.open_commerce_inventory_count(v_location_a_id, 'Test A -- sans ecart');
  PERFORM public.update_inventory_count_line(v_count.id, v_item_id, 10);
  v_count := public.complete_commerce_inventory_count(v_count.id);
  IF (SELECT quantity FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id) <> 10 THEN
    RAISE EXCEPTION 'STEP_A_FAILED: stock must stay 10.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE inventory_item_id = v_item_id AND movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT')) THEN
    RAISE EXCEPTION 'STEP_A_FAILED: a zero-variance count must create no stock movement.';
  END IF;
  RAISE NOTICE 'STEP_A_PASSED: no-variance count creates no movement, stock stays 10.';

  ------------------------------------------------------------------
  -- B. Deficit : systeme 10, physique 8.
  ------------------------------------------------------------------
  v_count_b := public.open_commerce_inventory_count(v_location_a_id, 'Test B -- deficit');
  PERFORM public.update_inventory_count_line(v_count_b.id, v_item_id, 8);
  v_count_b := public.complete_commerce_inventory_count(v_count_b.id);

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 8 THEN RAISE EXCEPTION 'STEP_B_FAILED: stock must be 8, got %', v_bli.quantity; END IF;
  SELECT * INTO v_cost_state FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_cost_state.current_unit_cost <> 500 OR v_cost_state.inventory_value <> 4000 THEN
    RAISE EXCEPTION 'STEP_B_FAILED: cost must stay 500, value must be 4000, got cost=% value=%', v_cost_state.current_unit_cost, v_cost_state.inventory_value;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE inventory_item_id = v_item_id AND movement_type = 'ADJUSTMENT_OUT' AND quantity = 2) THEN
    RAISE EXCEPTION 'STEP_B_FAILED: expected an ADJUSTMENT_OUT movement of quantity 2.';
  END IF;
  RAISE NOTICE 'STEP_B_PASSED: deficit -2 -- stock=8, value=4000, unit cost unchanged at 500, ADJUSTMENT_OUT event recorded.';

  ------------------------------------------------------------------
  -- C. Surplus : systeme 8, physique 12 (politique validee : cout moyen courant).
  ------------------------------------------------------------------
  v_count_c := public.open_commerce_inventory_count(v_location_a_id, 'Test C -- surplus');
  PERFORM public.update_inventory_count_line(v_count_c.id, v_item_id, 12);
  v_count_c := public.complete_commerce_inventory_count(v_count_c.id);

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 12 THEN RAISE EXCEPTION 'STEP_C_FAILED: stock must be 12, got %', v_bli.quantity; END IF;
  SELECT * INTO v_cost_state FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_cost_state.current_unit_cost <> 500 OR v_cost_state.inventory_value <> 6000 THEN
    RAISE EXCEPTION 'STEP_C_FAILED: cost must stay 500 (validated policy), value must be 6000, got cost=% value=%', v_cost_state.current_unit_cost, v_cost_state.inventory_value;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE inventory_item_id = v_item_id AND movement_type = 'ADJUSTMENT_IN' AND quantity = 4) THEN
    RAISE EXCEPTION 'STEP_C_FAILED: expected an ADJUSTMENT_IN movement of quantity 4.';
  END IF;
  RAISE NOTICE 'STEP_C_PASSED: surplus +4 valued at current average cost -- stock=12, value=6000, unit cost still unchanged at 500.';

  ------------------------------------------------------------------
  -- D. Retry inventaire (deja COMPLETED) -- aucune double application.
  ------------------------------------------------------------------
  PERFORM public.complete_commerce_inventory_count(v_count_c.id);
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 12 THEN RAISE EXCEPTION 'STEP_D_FAILED: retry must not re-apply, stock must still be 12, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'STEP_D_PASSED: retrying an already-completed count is a no-op.';

  ------------------------------------------------------------------
  -- E. Transfert : A=12 (apres B+C) -- creer transfert 3.
  ------------------------------------------------------------------
  v_transfer := public.create_commerce_stock_transfer(jsonb_build_object(
    'source_location_id', v_location_a_id, 'destination_location_id', v_location_b_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity', 3))
  ));
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 12 THEN RAISE EXCEPTION 'STEP_E_FAILED: creating a transfer must not touch stock, A must stay 12, got %', v_bli.quantity; END IF;

  PERFORM public.dispatch_commerce_stock_transfer(v_transfer.id);
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 9 THEN RAISE EXCEPTION 'STEP_E_FAILED: A must be 9 after dispatch (12-3), got %', v_bli.quantity; END IF;
  IF EXISTS (SELECT 1 FROM public.business_location_inventory_items WHERE business_location_id = v_location_b_id AND inventory_item_id = v_item_id) THEN
    RAISE EXCEPTION 'STEP_E_FAILED: B must still have zero stock right after dispatch, before receive.';
  END IF;

  PERFORM public.receive_commerce_stock_transfer(v_transfer.id, jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity_received', 3)));
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_b_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 3 THEN RAISE EXCEPTION 'STEP_E_FAILED: B must be +3, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'STEP_E_PASSED: create leaves A untouched (12), dispatch A=9/B still 0, receive B=+3.';

  ------------------------------------------------------------------
  -- F. CUMP destination -- B avait deja 5 unites @ 300 avant reception.
  ------------------------------------------------------------------
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P4F-' || txid_current()::text, 'Article Phase4 CUMP Test', 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_item_f_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity) VALUES (v_location_a_id, v_item_f_id, 10), (v_location_b_id, v_item_f_id, 5);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_a_id, v_item_f_id, 10, 500, 5000, 'OPENING'), (v_location_b_id, v_item_f_id, 5, 300, 1500, 'OPENING');

  DECLARE
    v_transfer_f public.commerce_stock_transfers;
  BEGIN
    v_transfer_f := public.create_commerce_stock_transfer(jsonb_build_object(
      'source_location_id', v_location_a_id, 'destination_location_id', v_location_b_id,
      'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_f_id, 'quantity', 3))
    ));
    PERFORM public.dispatch_commerce_stock_transfer(v_transfer_f.id);
    PERFORM public.receive_commerce_stock_transfer(v_transfer_f.id, jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_f_id, 'quantity_received', 3)));

    SELECT * INTO v_cost_state FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_b_id AND inventory_item_id = v_item_f_id;
    -- B: 5@300=1500, +3@500(figé source)=1500 -> total value 3000, qty 8, cost 375.
    IF v_cost_state.quantity_on_hand <> 8 OR v_cost_state.inventory_value <> 3000 OR v_cost_state.current_unit_cost <> 375 THEN
      RAISE EXCEPTION 'STEP_F_FAILED: expected B qty=8/value=3000/cost=375 after blending, got qty=%/value=%/cost=%', v_cost_state.quantity_on_hand, v_cost_state.inventory_value, v_cost_state.current_unit_cost;
    END IF;
    -- Source A cost must stay 500 (removed at its own average, unaffected by destination's average).
    SELECT * INTO v_cost_state FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_f_id;
    IF v_cost_state.current_unit_cost <> 500 OR v_cost_state.quantity_on_hand <> 7 THEN
      RAISE EXCEPTION 'STEP_F_FAILED: source A must be qty=7/cost=500 unchanged, got qty=%/cost=%', v_cost_state.quantity_on_hand, v_cost_state.current_unit_cost;
    END IF;
  END;
  RAISE NOTICE 'STEP_F_PASSED: destination CUMP correctly blended (5@300 + 3@500 = 8@375), source cost untouched at 500.';

  ------------------------------------------------------------------
  -- G. Retry dispatch -- A ne redescend jamais deux fois.
  ------------------------------------------------------------------
  PERFORM public.dispatch_commerce_stock_transfer(v_transfer.id);
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 9 THEN RAISE EXCEPTION 'STEP_G_FAILED: retry dispatch must not decrement A twice, expected 9, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'STEP_G_PASSED: retry dispatch on an already-DISPATCHED transfer is a no-op.';

  ------------------------------------------------------------------
  -- H. Retry receive -- B ne monte jamais deux fois.
  ------------------------------------------------------------------
  PERFORM public.receive_commerce_stock_transfer(v_transfer.id, jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity_received', 3)));
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_b_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 3 THEN RAISE EXCEPTION 'STEP_H_FAILED: retry receive must not increment B twice, expected 3, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'STEP_H_PASSED: retry receive on an already-RECEIVED transfer is a no-op.';

  ------------------------------------------------------------------
  -- I. Annulation avant dispatch -- aucun impact.
  ------------------------------------------------------------------
  DECLARE
    v_transfer_i public.commerce_stock_transfers;
  BEGIN
    v_transfer_i := public.create_commerce_stock_transfer(jsonb_build_object(
      'source_location_id', v_location_a_id, 'destination_location_id', v_location_b_id,
      'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity', 1))
    ));
    v_transfer_i := public.cancel_commerce_stock_transfer(v_transfer_i.id, 'Test I -- annulation avant expedition.');
    IF v_transfer_i.status <> 'CANCELLED' THEN RAISE EXCEPTION 'STEP_I_FAILED: transfer must be CANCELLED.'; END IF;
    SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_id;
    IF v_bli.quantity <> 9 THEN RAISE EXCEPTION 'STEP_I_FAILED: cancelling before dispatch must not touch stock, A must stay 9, got %', v_bli.quantity; END IF;
  END;
  RAISE NOTICE 'STEP_I_PASSED: cancelling before dispatch has zero stock impact.';

  ------------------------------------------------------------------
  -- J. Annulation apres dispatch -- rejetee.
  ------------------------------------------------------------------
  v_rejected := false;
  BEGIN
    PERFORM public.cancel_commerce_stock_transfer(v_transfer.id, 'Test J -- tentative apres expedition.');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_J_FAILED: cancelling an already-dispatched transfer must be rejected.'; END IF;
  RAISE NOTICE 'STEP_J_PASSED: cancelling a dispatched/received transfer is correctly rejected.';

  ------------------------------------------------------------------
  -- K. Multi-magasin permissions -- utilisateur non autorise rejete.
  ------------------------------------------------------------------
  DECLARE
    v_transfer_k public.commerce_stock_transfers;
  BEGIN
    v_transfer_k := public.create_commerce_stock_transfer(jsonb_build_object(
      'source_location_id', v_location_a_id, 'destination_location_id', v_location_b_id,
      'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity', 1))
    ));
    PERFORM set_config('request.jwt.claim.sub', v_bystander_id::text, true);
    v_rejected := false;
    BEGIN
      PERFORM public.dispatch_commerce_stock_transfer(v_transfer_k.id);
    EXCEPTION WHEN OTHERS THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_K_FAILED: lecture_seule must not be able to dispatch a transfer.'; END IF;
    PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  END;
  RAISE NOTICE 'STEP_K_PASSED: an unauthorized role cannot dispatch/receive a transfer for a store it has no access model for.';

  ------------------------------------------------------------------
  -- L. Finance -- nombre de finance_operations identique avant/apres.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
  IF v_op_count_after <> v_op_count_before THEN
    RAISE EXCEPTION 'STEP_L_FAILED: inventory counts and transfers must never create a finance_operations row, before=% after=%', v_op_count_before, v_op_count_after;
  END IF;
  RAISE NOTICE 'STEP_L_PASSED: zero finance_operations created by any inventory/transfer action in this whole test, before=% after=%', v_op_count_before, v_op_count_after;

  RAISE NOTICE 'GFC_V1_PHASE4_INVENTORY_TRANSFERS_E2E_PASSED';
  CREATE TEMP TABLE phase4_e2e_result AS SELECT 'GFC_V1_PHASE4_INVENTORY_TRANSFERS_E2E_PASSED'::text AS result;
END;
$test$;

SELECT result FROM phase4_e2e_result;

ROLLBACK;
