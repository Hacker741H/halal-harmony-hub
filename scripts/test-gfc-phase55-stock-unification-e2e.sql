-- GFC V1 Phase 5.5A -- mandatory E2E test, scenarios 1-6 from the mission.
-- Runs inside a ROLLBACK-wrapped transaction. Reuses the same real admin
-- actor as the Phase 5 test.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid := 'd3d1ef24-fa63-49c0-93c5-34fad56f84db';
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_client_id uuid;

  v_sale public.commercial_sales;
  v_sale2 public.commercial_sales;
  v_line_id uuid;
  v_service_line_id uuid;
  v_bli public.business_location_inventory_items;
  v_summary record;
  v_movement_count integer;
  v_pos_sale jsonb;
  v_pos_sale_id uuid;
  v_rejected boolean;
BEGIN
  SET LOCAL search_path = public, auth, pg_temp;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  ------------------------------------------------------------------
  -- FIXTURE
  ------------------------------------------------------------------
  INSERT INTO public.business_locations(business_unit_id, code, name, status)
  SELECT id, 'P55TEST_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'PHASE55 TEST LOCATION', 'ACTIVE' FROM public.business_units WHERE code = 'COMMERCE'
  RETURNING id INTO v_location_id;

  INSERT INTO public.wallets(name, type, balance) VALUES ('PHASE55 TEST WALLET', 'CASH', 0) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_at)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, now());

  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P55-' || txid_current()::text, 'Article Phase55 Test', 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity) VALUES (v_location_id, v_item_id, 10);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 10, 500, 5000, 'OPENING');

  INSERT INTO public.transport_clients(client_number, display_name, status, country_code)
  VALUES ('CLI-P55-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'Client Phase55 Test', 'ACTIVE', 'CI')
  RETURNING id INTO v_client_id;

  ------------------------------------------------------------------
  -- 1. Vente credit article qty 3 : DRAFT inchange, CONFIRM -3, cost
  -- snapshot exact, dette correcte, wallet inchange.
  ------------------------------------------------------------------
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_id, 'business_location_id', v_location_id,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Ligne test', 'quantity', 3, 'unit', 'PIECE', 'unit_price', 1000,
      'inventory_item_id', v_item_id, 'harvest_id', null, 'farm_id', null
    ))
  ));
  SELECT id INTO v_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale.id LIMIT 1;

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 10 THEN RAISE EXCEPTION 'STEP_1_FAILED: DRAFT must not touch stock, expected 10, got %', v_bli.quantity; END IF;

  v_sale := public.confirm_commercial_sale(v_sale.id);
  IF v_sale.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'STEP_1_FAILED: sale must be CONFIRMED.'; END IF;

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 7 THEN RAISE EXCEPTION 'STEP_1_FAILED: stock must be 7 after confirm (10-3), got %', v_bli.quantity; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.commercial_sale_line_costs WHERE sale_line_id = v_line_id AND unit_cost = 500 AND total_cost = 1500) THEN
    RAISE EXCEPTION 'STEP_1_FAILED: cost snapshot must exist at unit_cost=500/total_cost=1500.';
  END IF;

  -- create_commercial_sale never issues an invoice on its own -- a credit
  -- sale's créance only exists once invoiced, matching the existing,
  -- untouched invoicing step. Invoice it now to check the créance math.
  DECLARE v_invoice public.commercial_invoices;
  BEGIN
    v_invoice := public.create_commercial_invoice(v_sale.id);
    PERFORM public.issue_commercial_invoice(v_invoice.id);
  END;
  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.amount_due <> 3000 THEN RAISE EXCEPTION 'STEP_1_FAILED: expected amount_due=3000, got %', v_summary.amount_due; END IF;

  IF (SELECT balance FROM public.wallets WHERE id = v_wallet_id) <> 0 THEN
    RAISE EXCEPTION 'STEP_1_FAILED: wallet must stay 0, no payment made yet.';
  END IF;
  RAISE NOTICE 'STEP_1_PASSED: credit sale qty 3 -- draft untouched, confirm -3, exact cost snapshot, correct créance, wallet untouched.';

  ------------------------------------------------------------------
  -- 2. Retry confirm : aucun second mouvement.
  ------------------------------------------------------------------
  PERFORM public.confirm_commercial_sale(v_sale.id);
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 7 THEN RAISE EXCEPTION 'STEP_2_FAILED: retry confirm must not double-decrement, expected 7, got %', v_bli.quantity; END IF;
  SELECT count(*) INTO v_movement_count FROM public.commercial_sale_stock_movement_links WHERE sale_line_id = v_line_id;
  IF v_movement_count <> 1 THEN RAISE EXCEPTION 'STEP_2_FAILED: expected exactly 1 stock movement link, got %', v_movement_count; END IF;
  RAISE NOTICE 'STEP_2_PASSED: retry confirm is a safe no-op, exactly one stock movement.';

  ------------------------------------------------------------------
  -- 3. Vente mixte article + service : article touche stock/CMV, service non.
  ------------------------------------------------------------------
  v_sale2 := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_id, 'business_location_id', v_location_id,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'Article mixte', 'quantity', 2, 'unit', 'PIECE', 'unit_price', 1000, 'inventory_item_id', v_item_id, 'harvest_id', null, 'farm_id', null),
      jsonb_build_object('description', 'Service mixte', 'quantity', 1, 'unit', 'SERVICE', 'unit_price', 500, 'inventory_item_id', null, 'harvest_id', null, 'farm_id', null)
    )
  ));
  SELECT id INTO v_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale2.id AND line_type = 'ARTICLE' LIMIT 1;
  SELECT id INTO v_service_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale2.id AND line_type = 'SERVICE' LIMIT 1;

  v_sale2 := public.confirm_commercial_sale(v_sale2.id);

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 5 THEN RAISE EXCEPTION 'STEP_3_FAILED: article line must decrement stock to 5 (7-2), got %', v_bli.quantity; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sale_stock_movement_links WHERE sale_line_id = v_line_id) THEN
    RAISE EXCEPTION 'STEP_3_FAILED: article line must have a stock movement link.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_sale_stock_movement_links WHERE sale_line_id = v_service_line_id) THEN
    RAISE EXCEPTION 'STEP_3_FAILED: service line must never have a stock movement link.';
  END IF;
  RAISE NOTICE 'STEP_3_PASSED: mixed sale -- article line moves stock, service line never does.';

  ------------------------------------------------------------------
  -- 4. Vente ensuite retournee : Phase 5 RETURN fonctionne desormais
  -- proprement pour une vente credit stock-backed.
  ------------------------------------------------------------------
  PERFORM public.create_commerce_sale_return(jsonb_build_object(
    'sale_id', v_sale2.id, 'reason', 'Test 4 -- retour vente credit stock-backed', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_line_id, 'quantity_returned', 1, 'disposition', 'RESTOCK'))
  ));
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 6 THEN RAISE EXCEPTION 'STEP_4_FAILED: return must restock to 6 (5+1), got %', v_bli.quantity; END IF;
  RAISE NOTICE 'STEP_4_PASSED: Phase 5 return now works cleanly against a credit sale, because it is properly stock-backed.';

  ------------------------------------------------------------------
  -- 5. POS : aucune regression, un seul mouvement stock par ligne article.
  ------------------------------------------------------------------
  v_pos_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', v_client_id, 'payment_method', 'CASH',
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 1000))
  ));
  v_pos_sale_id := (v_pos_sale ->> 'saleId')::uuid;
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  IF v_bli.quantity <> 5 THEN RAISE EXCEPTION 'STEP_5_FAILED: POS sale must decrement stock to 5 (6-1), got %', v_bli.quantity; END IF;
  SELECT id INTO v_line_id FROM public.commercial_sale_lines WHERE sale_id = v_pos_sale_id LIMIT 1;
  SELECT count(*) INTO v_movement_count FROM public.commercial_sale_stock_movement_links WHERE sale_line_id = v_line_id;
  IF v_movement_count <> 1 THEN RAISE EXCEPTION 'STEP_5_FAILED: POS must produce exactly one stock movement per line, got %', v_movement_count; END IF;
  IF (SELECT wallet_id FROM public.stock_movements sm JOIN public.commercial_sale_stock_movement_links l ON l.stock_movement_id = sm.id WHERE l.sale_line_id = v_line_id) <> v_wallet_id THEN
    RAISE EXCEPTION 'STEP_5_FAILED: POS stock movement must still carry the cash-drawer wallet_id.';
  END IF;
  RAISE NOTICE 'STEP_5_PASSED: POS sale unchanged -- exactly one stock movement, cash-drawer wallet_id preserved.';

  ------------------------------------------------------------------
  -- 6. Stock insuffisant : rejet atomique, aucune vente partiellement
  -- confirmee, aucune creance/facture incoherente.
  ------------------------------------------------------------------
  DECLARE
    v_over_sale public.commercial_sales;
  BEGIN
    v_over_sale := public.create_commercial_sale(jsonb_build_object(
      'client_id', v_client_id, 'business_location_id', v_location_id,
      'lines', jsonb_build_array(jsonb_build_object(
        'description', 'Trop demande', 'quantity', 999, 'unit', 'PIECE', 'unit_price', 1000,
        'inventory_item_id', v_item_id, 'harvest_id', null, 'farm_id', null
      ))
    ));
    v_rejected := false;
    BEGIN
      PERFORM public.confirm_commercial_sale(v_over_sale.id);
    EXCEPTION WHEN OTHERS THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_6_FAILED: confirming with insufficient stock must be rejected.'; END IF;

    IF (SELECT status FROM public.commercial_sales WHERE id = v_over_sale.id) <> 'DRAFT' THEN
      RAISE EXCEPTION 'STEP_6_FAILED: the sale must remain DRAFT after a rejected confirm, never partially CONFIRMED.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.commercial_invoices WHERE sale_id = v_over_sale.id) THEN
      RAISE EXCEPTION 'STEP_6_FAILED: no invoice must exist for a sale that never reached CONFIRMED.';
    END IF;
    SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
    IF v_bli.quantity <> 5 THEN RAISE EXCEPTION 'STEP_6_FAILED: stock must be untouched by the rejected confirm, expected 5, got %', v_bli.quantity; END IF;
  END;
  RAISE NOTICE 'STEP_6_PASSED: insufficient stock rejects the whole confirm atomically -- sale stays DRAFT, no invoice, no stock impact.';

  RAISE NOTICE 'GFC_V1_PHASE55_STOCK_UNIFICATION_E2E_PASSED';
  CREATE TEMP TABLE phase55_e2e_result AS SELECT 'GFC_V1_PHASE55_STOCK_UNIFICATION_E2E_PASSED'::text AS result;
END;
$test$;

SELECT result FROM phase55_e2e_result;

ROLLBACK;
