-- GFC V1 Phase 3D -- mandatory E2E synthetic proof, scenarios A-G exactly
-- per spec, before any Phase 3 frontend work. Own synthetic fixtures,
-- ROLLBACK at the end -- proof, not production data.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_location_a_id uuid;
  v_location_b_id uuid;
  v_wallet_a_id uuid;
  v_wallet_b_id uuid;
  v_wallet_a_opening numeric(14, 2);
  v_supplier public.commerce_suppliers;
  v_item public.inventory_items;
  v_item_b public.inventory_items;
  v_purchase public.commerce_purchases;
  v_purchase_b public.commerce_purchases;
  v_payment_a public.commerce_supplier_payments;
  v_payment_b public.commerce_supplier_payments;
  v_payment_c public.commerce_supplier_payments;
  v_summary record;
  v_wallet_balance numeric(14, 2);
  v_cost_state public.commerce_inventory_cost_states;
  v_bli public.business_location_inventory_items;
  v_op_count integer;
  v_sale jsonb;
  v_profitability jsonb;
  v_line_cost_count integer;
  v_stock_qty_b numeric(14, 3);
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Test requires a super_admin user.'; END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST P3 WALLET A ' || txid_current()::text, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_a_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST P3 WALLET B ' || txid_current()::text, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_b_id;
  SELECT balance INTO v_wallet_a_opening FROM public.wallets WHERE id = v_wallet_a_id;

  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'P3A' || txid_current()::text, 'Test Phase3 Magasin A', 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_a_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'P3B' || txid_current()::text, 'Test Phase3 Magasin B', 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_b_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_a_id, v_wallet_a_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_b_id, v_wallet_b_id, 'CASH_DRAWER', true, true, v_actor_id);

  v_supplier := public.create_supplier(jsonb_build_object('display_name', 'Fournisseur Test ' || txid_current()::text));
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P3-' || txid_current()::text, 'Article Fournisseur Test', 'TEST', 'PIECE', 0, 0)
  RETURNING * INTO v_item;

  ------------------------------------------------------------------
  -- A. Achat stock a credit : 10 x 1000.
  ------------------------------------------------------------------
  v_purchase := public.create_commerce_purchase(jsonb_build_object(
    'supplier_id', v_supplier.id, 'business_location_id', v_location_a_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item.id, 'quantity', 10, 'unit_cost', 1000))
  ));
  IF v_purchase.total_amount <> 10000 THEN RAISE EXCEPTION 'STEP_A_FAILED: purchase total must be 10000, got %', v_purchase.total_amount; END IF;

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item.id;
  IF v_bli.quantity <> 10 THEN RAISE EXCEPTION 'STEP_A_FAILED: stock must be +10, got %', v_bli.quantity; END IF;

  SELECT * INTO v_cost_state FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item.id;
  IF v_cost_state.quantity_on_hand <> 10 OR v_cost_state.current_unit_cost <> 1000 OR v_cost_state.inventory_value <> 10000 THEN
    RAISE EXCEPTION 'STEP_A_FAILED: CUMP state wrong, got qty=% cost=% value=%', v_cost_state.quantity_on_hand, v_cost_state.current_unit_cost, v_cost_state.inventory_value;
  END IF;

  SELECT * INTO v_summary FROM public.get_commerce_purchase_financial_summary(v_purchase.id);
  IF v_summary.amount_due <> 10000 THEN RAISE EXCEPTION 'STEP_A_FAILED: debt must be 10000, got %', v_summary.amount_due; END IF;

  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_a_id;
  IF v_wallet_balance <> v_wallet_a_opening THEN RAISE EXCEPTION 'STEP_A_FAILED: wallet must be unchanged, got %', v_wallet_balance; END IF;

  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE module_id IN (v_purchase.id) OR module = 'COMMERCE_PURCHASE';
  IF v_op_count <> 0 THEN RAISE EXCEPTION 'STEP_A_FAILED: a credit purchase must create zero finance_operations, found %', v_op_count; END IF;

  v_profitability := public.get_commerce_store_profitability(v_location_a_id, current_date, current_date);
  IF (v_profitability ->> 'operatingExpenses')::numeric <> 0 THEN
    RAISE EXCEPTION 'STEP_A_FAILED: a stock purchase must not appear as an operating expense, got %', v_profitability ->> 'operatingExpenses';
  END IF;
  RAISE NOTICE 'STEP_A_PASSED: credit purchase 10x1000 -- stock+10, CUMP=1000/value=10000, debt=10000, wallet unchanged, 0 Finance ops, 0 operating expense.';

  ------------------------------------------------------------------
  -- B. Paiement partiel 6000.
  ------------------------------------------------------------------
  v_payment_a := public.create_supplier_payment(v_purchase.id, jsonb_build_object('wallet_id', v_wallet_a_id, 'amount', 6000, 'payment_date', current_date));
  v_payment_a := public.confirm_supplier_payment(v_payment_a.id);

  SELECT * INTO v_summary FROM public.get_commerce_purchase_financial_summary(v_purchase.id);
  IF v_summary.amount_due <> 4000 THEN RAISE EXCEPTION 'STEP_B_FAILED: debt must be 4000, got %', v_summary.amount_due; END IF;
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_a_id;
  IF v_wallet_balance <> v_wallet_a_opening - 6000 THEN RAISE EXCEPTION 'STEP_B_FAILED: wallet must be -6000 exactly, got %', v_wallet_balance; END IF;
  RAISE NOTICE 'STEP_B_PASSED: partial payment 6000 -- debt=4000, wallet -6000 exactly.';

  ------------------------------------------------------------------
  -- C. Paiement final 4000.
  ------------------------------------------------------------------
  v_payment_b := public.create_supplier_payment(v_purchase.id, jsonb_build_object('wallet_id', v_wallet_a_id, 'amount', 4000, 'payment_date', current_date));
  v_payment_b := public.confirm_supplier_payment(v_payment_b.id);

  SELECT * INTO v_summary FROM public.get_commerce_purchase_financial_summary(v_purchase.id);
  IF v_summary.amount_due <> 0 THEN RAISE EXCEPTION 'STEP_C_FAILED: debt must be 0, got %', v_summary.amount_due; END IF;
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_a_id;
  IF v_wallet_balance <> v_wallet_a_opening - 10000 THEN RAISE EXCEPTION 'STEP_C_FAILED: wallet must be -10000 total, got %', v_wallet_balance; END IF;
  RAISE NOTICE 'STEP_C_PASSED: final payment 4000 -- debt=0, wallet -10000 total.';

  ------------------------------------------------------------------
  -- D. Retry du paiement final (deja CONFIRMED).
  ------------------------------------------------------------------
  PERFORM public.confirm_supplier_payment(v_payment_b.id);
  SELECT count(*) INTO v_op_count FROM public.finance_supplier_payment_links WHERE payment_id = v_payment_b.id AND link_type = 'PAYMENT';
  IF v_op_count <> 1 THEN RAISE EXCEPTION 'STEP_D_FAILED: retry must not create a duplicate disbursement, found % PAYMENT links', v_op_count; END IF;
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_a_id;
  IF v_wallet_balance <> v_wallet_a_opening - 10000 THEN RAISE EXCEPTION 'STEP_D_FAILED: wallet must still be -10000 after retry, got %', v_wallet_balance; END IF;
  RAISE NOTICE 'STEP_D_PASSED: retrying an already-confirmed payment created no duplicate disbursement.';

  ------------------------------------------------------------------
  -- E. Achat comptant : reception + paiement dans le meme workflow.
  ------------------------------------------------------------------
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P3CASH-' || txid_current()::text, 'Article Comptant Test', 'TEST', 'PIECE', 0, 0)
  RETURNING * INTO v_item_b;

  v_purchase_b := public.create_commerce_purchase(jsonb_build_object(
    'supplier_id', v_supplier.id, 'business_location_id', v_location_a_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_b.id, 'quantity', 5, 'unit_cost', 800))
  ));
  v_payment_c := public.create_supplier_payment(v_purchase_b.id, jsonb_build_object('wallet_id', v_wallet_a_id, 'amount', 4000, 'payment_date', current_date));
  v_payment_c := public.confirm_supplier_payment(v_payment_c.id);

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_b.id;
  IF v_bli.quantity <> 5 THEN RAISE EXCEPTION 'STEP_E_FAILED: cash purchase stock must be +5, got %', v_bli.quantity; END IF;
  SELECT * INTO v_summary FROM public.get_commerce_purchase_financial_summary(v_purchase_b.id);
  IF v_summary.amount_due <> 0 THEN RAISE EXCEPTION 'STEP_E_FAILED: cash purchase debt must be settled immediately, got %', v_summary.amount_due; END IF;
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_a_id;
  IF v_wallet_balance <> v_wallet_a_opening - 10000 - 4000 THEN RAISE EXCEPTION 'STEP_E_FAILED: wallet must decrease by exactly the cash purchase amount, got %', v_wallet_balance; END IF;
  RAISE NOTICE 'STEP_E_PASSED: cash purchase (reception + payment) -- stock+5, debt settled immediately, wallet -4000 exactly.';

  ------------------------------------------------------------------
  -- F. Vente ulterieure -- CMV calcule une seule fois, achat initial
  -- jamais rededuit comme charge d'exploitation.
  ------------------------------------------------------------------
  UPDATE public.business_location_inventory_items SET sale_price = 2500 WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item.id;
  v_sale := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_a_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:phase3-' || txid_current()::text, 'notes', NULL,
    'cash_session_id', 'session-p3-' || txid_current()::text, 'terminal_id', 'terminal-p3-' || txid_current()::text,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item.id, 'quantity', 3, 'unit_price', 2500))
  ));

  SELECT count(*) INTO v_line_cost_count
  FROM public.commercial_sale_line_costs cost
  JOIN public.commercial_sale_lines line ON line.id = cost.sale_line_id
  JOIN public.commercial_sales sale ON sale.id = line.sale_id
  WHERE sale.id = (v_sale ->> 'saleId')::uuid;
  IF v_line_cost_count <> 1 THEN RAISE EXCEPTION 'STEP_F_FAILED: exactly one CMV snapshot expected for the sale line, found %', v_line_cost_count; END IF;

  v_profitability := public.get_commerce_store_profitability(v_location_a_id, current_date, current_date);
  IF (v_profitability ->> 'costOfGoodsSold')::numeric <> 3000 THEN
    RAISE EXCEPTION 'STEP_F_FAILED: COGS for 3 units at CUMP 1000 must be 3000, got %', v_profitability ->> 'costOfGoodsSold';
  END IF;
  IF (v_profitability ->> 'operatingExpenses')::numeric <> 0 THEN
    RAISE EXCEPTION 'STEP_F_FAILED: the original stock purchase must still never appear as an operating expense after the sale, got %', v_profitability ->> 'operatingExpenses';
  END IF;
  RAISE NOTICE 'STEP_F_PASSED: selling 3 units -- exactly one CMV snapshot (3000), original purchase still never counted as an operating expense.';

  ------------------------------------------------------------------
  -- G. Multi-magasin.
  ------------------------------------------------------------------
  SELECT quantity INTO v_stock_qty_b FROM public.business_location_inventory_items WHERE business_location_id = v_location_b_id AND inventory_item_id = v_item.id;
  IF v_stock_qty_b IS NOT NULL AND v_stock_qty_b <> 0 THEN
    RAISE EXCEPTION 'STEP_G_FAILED: magasin B must have zero stock of an item only ever purchased at magasin A, got %', v_stock_qty_b;
  END IF;

  DECLARE
    v_purchase_gb public.commerce_purchases;
    v_payment_gb public.commerce_supplier_payments;
    v_item_gb public.inventory_items;
    v_wallet_a_balance_before_g numeric(14, 2);
    v_wallet_b_balance_after_g numeric(14, 2);
  BEGIN
    INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
    VALUES ('P3B-' || txid_current()::text, 'Article Magasin B', 'TEST', 'PIECE', 0, 0)
    RETURNING * INTO v_item_gb;

    SELECT balance INTO v_wallet_a_balance_before_g FROM public.wallets WHERE id = v_wallet_a_id;

    v_purchase_gb := public.create_commerce_purchase(jsonb_build_object(
      'supplier_id', v_supplier.id, 'business_location_id', v_location_b_id,
      'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_gb.id, 'quantity', 2, 'unit_cost', 500))
    ));
    v_payment_gb := public.create_supplier_payment(v_purchase_gb.id, jsonb_build_object('wallet_id', v_wallet_b_id, 'amount', 1000, 'payment_date', current_date));
    v_payment_gb := public.confirm_supplier_payment(v_payment_gb.id);

    IF (SELECT quantity FROM public.business_location_inventory_items WHERE business_location_id = v_location_a_id AND inventory_item_id = v_item_gb.id) IS NOT NULL THEN
      RAISE EXCEPTION 'STEP_G_FAILED: magasin A must not receive stock from a magasin B purchase.';
    END IF;
    IF (SELECT quantity FROM public.business_location_inventory_items WHERE business_location_id = v_location_b_id AND inventory_item_id = v_item_gb.id) <> 2 THEN
      RAISE EXCEPTION 'STEP_G_FAILED: magasin B must have exactly 2 units.';
    END IF;
    SELECT balance INTO v_wallet_a_balance_before_g FROM public.wallets WHERE id = v_wallet_a_id;
    IF v_wallet_a_balance_before_g <> v_wallet_a_opening - 10000 - 4000 THEN
      RAISE EXCEPTION 'STEP_G_FAILED: magasin A wallet must be untouched by a magasin B payment, got %', v_wallet_a_balance_before_g;
    END IF;
    SELECT balance INTO v_wallet_b_balance_after_g FROM public.wallets WHERE id = v_wallet_b_id;
    IF v_wallet_b_balance_after_g <> -1000 THEN
      RAISE EXCEPTION 'STEP_G_FAILED: magasin B wallet must be -1000 exactly, got %', v_wallet_b_balance_after_g;
    END IF;
  END;
  RAISE NOTICE 'STEP_G_PASSED: multi-magasin -- purchase at B only stocks B, debt at B, payment only moves wallet B, magasin A wallet/stock untouched.';

  RAISE NOTICE 'GFC_V1_PHASE3_SUPPLIERS_PURCHASES_E2E_PASSED';
  CREATE TEMP TABLE phase3_e2e_result AS SELECT 'GFC_V1_PHASE3_SUPPLIERS_PURCHASES_E2E_PASSED'::text AS result;
END;
$test$;

SELECT result FROM phase3_e2e_result;

ROLLBACK;
