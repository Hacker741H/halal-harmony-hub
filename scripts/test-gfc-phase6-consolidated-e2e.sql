-- GFC V1 Phase 6, section 17 -- one consolidated scenario walking the full
-- commercial engine end to end in a single traceable numeric thread:
-- client credit sale -> stock -> creance -> partial settlement -> partial
-- return -> client credit -> refund; supplier credit purchase -> stock ->
-- debt -> payment; an inventory count with a real discrepancy; a
-- multi-location transfer (dispatch + receive). Everything ROLLBACK'd.

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_unit uuid;
  v_wallet uuid;
  v_location_a uuid;
  v_location_b uuid;
  v_client_item uuid;
  v_supplier_item uuid;
  v_supplier public.commerce_suppliers;
  v_token text := txid_current()::text;

  v_sale public.commercial_sales;
  v_sale_line_id uuid;
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_return public.commerce_sale_returns;
  v_refund public.commerce_sale_refunds;
  v_summary record;
  v_bli record;

  v_purchase public.commerce_purchases;
  v_supplier_payment public.commerce_supplier_payments;
  v_purchase_summary record;

  v_count public.commerce_inventory_counts;
  v_transfer public.commerce_stock_transfers;

  v_wallet_balance numeric(14,2);
  v_wallet_opening numeric(14,2);
  v_profitability jsonb;
  v_op_count integer;
BEGIN
  SELECT user_id INTO v_actor FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Consolidated E2E requires one super_admin actor.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT id INTO v_unit FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Active COMMERCE unit missing.'; END IF;

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST P6 ' || v_token, 'CASH', 50000, 50000, false) RETURNING id INTO v_wallet;
  SELECT balance INTO v_wallet_opening FROM public.wallets WHERE id = v_wallet;

  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_unit, 'P6A' || v_token, 'P6 Magasin A', 'STORE', 'ACTIVE', v_actor, v_actor) RETURNING id INTO v_location_a;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_unit, 'P6B' || v_token, 'P6 Magasin B', 'STORE', 'ACTIVE', v_actor, v_actor) RETURNING id INTO v_location_b;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_a, v_wallet, 'CASH_DRAWER', true, true, v_actor);
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_b, v_wallet, 'CASH_DRAWER', true, true, v_actor);

  INSERT INTO public.transport_clients(client_number, display_name, status, created_by, updated_by)
  VALUES ('P6-CLIENT-' || v_token, 'Client P6 ' || v_token, 'ACTIVE', v_actor, v_actor);

  ------------------------------------------------------------------
  -- Fixtures: one item for the client track (CUMP 400), one for the
  -- supplier/inventory/transfer track (starts empty, purchase creates it).
  ------------------------------------------------------------------
  SELECT (public.receive_commerce_inventory_item(jsonb_build_object(
    'business_location_id', v_location_a, 'wallet_id', v_wallet, 'name', 'P6 Article Client ' || v_token,
    'sku', 'P6C-' || v_token, 'quantity', 10, 'purchase_unit_price', 400, 'sale_price', 1000
  ))->>'inventoryItemId')::uuid INTO v_client_item;

  ------------------------------------------------------------------
  -- CLIENT TRACK.
  ------------------------------------------------------------------
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', (SELECT id FROM public.transport_clients WHERE client_number = 'P6-CLIENT-' || v_token),
    'business_location_id', v_location_a, 'sale_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'P6 Article Client', 'quantity', 5, 'unit', 'UNITE', 'unit_price', 1000,
      'inventory_item_id', v_client_item
    ))
  ));

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_client_item;
  IF v_bli.quantity <> 10 THEN RAISE EXCEPTION 'CLIENT_FAILED: stock must stay 10 at DRAFT, got %', v_bli.quantity; END IF;

  v_sale := public.confirm_commercial_sale(v_sale.id);
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale.id;

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_client_item;
  IF v_bli.quantity <> 5 THEN RAISE EXCEPTION 'CLIENT_FAILED: stock must be 5 after confirm (10-5), got %', v_bli.quantity; END IF;
  RAISE NOTICE 'CLIENT_STEP_1_PASSED: credit sale confirmed, stock -5.';

  v_invoice := public.create_commercial_invoice(v_sale.id);
  IF v_invoice.total_amount <> 5000 THEN RAISE EXCEPTION 'CLIENT_FAILED: invoice must be 5000, got %', v_invoice.total_amount; END IF;
  v_invoice := public.issue_commercial_invoice(v_invoice.id);

  v_payment := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object('wallet_id', v_wallet, 'amount', 4000, 'payment_date', current_date));
  v_payment := public.confirm_commercial_invoice_payment(v_payment.id);

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.amount_due <> 1000 THEN RAISE EXCEPTION 'CLIENT_FAILED: amount_due must be 1000 after partial payment, got %', v_summary.amount_due; END IF;
  -- Net zero here is expected and correct: the same wallet absorbed a -4000
  -- EXPENSE when receive_commerce_inventory_item stocked the item earlier,
  -- then +4000 DEPOSIT from this payment -- both real, opposite movements.
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet;
  IF v_wallet_balance <> v_wallet_opening THEN RAISE EXCEPTION 'CLIENT_FAILED: wallet must net back to opening (-4000 stock receipt +4000 payment), got delta %', v_wallet_balance - v_wallet_opening; END IF;
  RAISE NOTICE 'CLIENT_STEP_2_PASSED: partial settlement 4000/5000, amount_due=1000, wallet nets to opening.';

  v_return := public.create_commerce_sale_return(jsonb_build_object(
    'sale_id', v_sale.id, 'reason', 'P6 retour partiel', 'idempotency_key', gen_random_uuid()::text,
    'lines', jsonb_build_array(jsonb_build_object('original_sale_line_id', v_sale_line_id, 'quantity_returned', 2, 'disposition', 'RESTOCK'))
  ));

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_client_item;
  IF v_bli.quantity <> 7 THEN RAISE EXCEPTION 'CLIENT_FAILED: stock must be back to 7 (5+2), got %', v_bli.quantity; END IF;

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.amount_due <> 0 THEN RAISE EXCEPTION 'CLIENT_FAILED: amount_due must floor at 0 after the return, got %', v_summary.amount_due; END IF;
  IF v_summary.refundable_credit <> 1000 THEN RAISE EXCEPTION 'CLIENT_FAILED: refundable_credit must be 1000 (paid 4000 - owed 3000 after return), got %', v_summary.refundable_credit; END IF;
  RAISE NOTICE 'CLIENT_STEP_3_PASSED: partial return of 2 -- stock back to 7, amount_due=0, refundable_credit=1000.';

  v_refund := public.create_commerce_sale_refund(v_sale.id, jsonb_build_object('wallet_id', v_wallet, 'amount', 1000, 'refund_date', current_date));
  v_refund := public.confirm_commerce_sale_refund(v_refund.id);
  -- Retry: confirming an already-CONFIRMED refund must not create a second disbursement.
  PERFORM public.confirm_commerce_sale_refund(v_refund.id);

  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet;
  IF v_wallet_balance <> v_wallet_opening - 1000 THEN RAISE EXCEPTION 'CLIENT_FAILED: wallet must be -1000 vs opening (-4000 receipt +4000 payment -1000 refund), got delta %', v_wallet_balance - v_wallet_opening; END IF;
  SELECT count(*) INTO v_op_count FROM public.finance_commercial_refund_links WHERE refund_id = v_refund.id;
  IF v_op_count <> 1 THEN RAISE EXCEPTION 'CLIENT_FAILED: exactly one refund Finance link expected, got %', v_op_count; END IF;
  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.refundable_credit <> 0 THEN RAISE EXCEPTION 'CLIENT_FAILED: refundable_credit must be 0 after refund, got %', v_summary.refundable_credit; END IF;
  RAISE NOTICE 'CLIENT_STEP_4_PASSED: refund of 1000 confirmed (retry no-op), wallet -1000 vs opening, refundable_credit=0.';

  ------------------------------------------------------------------
  -- SUPPLIER TRACK.
  ------------------------------------------------------------------
  v_supplier := public.create_supplier(jsonb_build_object('display_name', 'Fournisseur P6 ' || v_token));
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('P6S-' || v_token, 'P6 Article Fournisseur ' || v_token, 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_supplier_item;

  v_purchase := public.create_commerce_purchase(jsonb_build_object(
    'supplier_id', v_supplier.id, 'business_location_id', v_location_a,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_supplier_item, 'quantity', 20, 'unit_cost', 300))
  ));
  IF v_purchase.total_amount <> 6000 THEN RAISE EXCEPTION 'SUPPLIER_FAILED: purchase total must be 6000, got %', v_purchase.total_amount; END IF;

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_supplier_item;
  IF v_bli.quantity <> 20 THEN RAISE EXCEPTION 'SUPPLIER_FAILED: stock must be +20, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'SUPPLIER_STEP_1_PASSED: credit purchase confirmed, stock +20.';

  v_supplier_payment := public.create_supplier_payment(v_purchase.id, jsonb_build_object('wallet_id', v_wallet, 'amount', 6000, 'payment_date', current_date));
  v_supplier_payment := public.confirm_supplier_payment(v_supplier_payment.id);

  SELECT * INTO v_purchase_summary FROM public.get_commerce_purchase_financial_summary(v_purchase.id);
  IF v_purchase_summary.amount_due <> 0 THEN RAISE EXCEPTION 'SUPPLIER_FAILED: debt must be 0 after full payment, got %', v_purchase_summary.amount_due; END IF;
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet;
  IF v_wallet_balance <> v_wallet_opening - 7000 THEN RAISE EXCEPTION 'SUPPLIER_FAILED: wallet must be -7000 vs opening after the supplier payment, got delta %', v_wallet_balance - v_wallet_opening; END IF;
  RAISE NOTICE 'SUPPLIER_STEP_2_PASSED: full payment 6000, debt=0, wallet -7000 vs opening cumulative.';

  ------------------------------------------------------------------
  -- INVENTORY COUNT TRACK -- a real deficit of 2 (20 system vs 18 counted).
  ------------------------------------------------------------------
  v_count := public.open_commerce_inventory_count(v_location_a, 'P6 -- ecart deficit');
  PERFORM public.update_inventory_count_line(v_count.id, v_supplier_item, 18);
  v_count := public.complete_commerce_inventory_count(v_count.id);
  -- Retry: completing an already-COMPLETED count must not re-apply the adjustment.
  PERFORM public.complete_commerce_inventory_count(v_count.id);

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_supplier_item;
  IF v_bli.quantity <> 18 THEN RAISE EXCEPTION 'INVENTORY_FAILED: stock must be exactly 18 after validation (retry included), got %', v_bli.quantity; END IF;
  RAISE NOTICE 'INVENTORY_STEP_PASSED: deficit of 2 counted and validated (20 -> 18), retry did not double-apply.';

  ------------------------------------------------------------------
  -- TRANSFER TRACK -- A to B, dispatch then receive.
  ------------------------------------------------------------------
  v_transfer := public.create_commerce_stock_transfer(jsonb_build_object(
    'source_location_id', v_location_a, 'destination_location_id', v_location_b,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_supplier_item, 'quantity', 5))
  ));
  PERFORM public.dispatch_commerce_stock_transfer(v_transfer.id);
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_supplier_item;
  IF v_bli.quantity <> 13 THEN RAISE EXCEPTION 'TRANSFER_FAILED: A must be 13 after dispatch (18-5), got %', v_bli.quantity; END IF;

  PERFORM public.receive_commerce_stock_transfer(v_transfer.id, jsonb_build_array(jsonb_build_object('inventory_item_id', v_supplier_item, 'quantity_received', 5)));
  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_b AND inventory_item_id = v_supplier_item;
  IF v_bli.quantity <> 5 THEN RAISE EXCEPTION 'TRANSFER_FAILED: B must be +5, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'TRANSFER_STEP_PASSED: dispatch A 18->13, receive B 0->5.';

  ------------------------------------------------------------------
  -- FINAL CROSS-DOMAIN VERIFICATION.
  ------------------------------------------------------------------
  v_profitability := public.get_commerce_store_profitability(v_location_a, current_date, current_date);
  IF (v_profitability->>'totalRevenue')::numeric <> 3000 THEN RAISE EXCEPTION 'FINAL_FAILED: CA net must be 3000 (5000-2000 returned), got %', v_profitability->>'totalRevenue'; END IF;
  IF (v_profitability->>'costOfGoodsSold')::numeric <> 1200 THEN RAISE EXCEPTION 'FINAL_FAILED: CMV net must be 1200 (2000-800 returned), got %', v_profitability->>'costOfGoodsSold'; END IF;
  IF (v_profitability->>'grossMargin')::numeric <> 1800 THEN RAISE EXCEPTION 'FINAL_FAILED: gross margin must be 1800, got %', v_profitability->>'grossMargin'; END IF;
  RAISE NOTICE 'FINAL_STEP_1_PASSED: CA net=3000, CMV net=1200, marge=1800.';

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.amount_due <> 0 THEN RAISE EXCEPTION 'FINAL_FAILED: client creance must be 0, got %', v_summary.amount_due; END IF;
  SELECT * INTO v_purchase_summary FROM public.get_commerce_purchase_financial_summary(v_purchase.id);
  IF v_purchase_summary.amount_due <> 0 THEN RAISE EXCEPTION 'FINAL_FAILED: supplier debt must be 0, got %', v_purchase_summary.amount_due; END IF;
  RAISE NOTICE 'FINAL_STEP_2_PASSED: client creance=0, supplier dette=0.';

  SELECT * INTO v_bli FROM public.business_location_inventory_items WHERE business_location_id = v_location_a AND inventory_item_id = v_client_item;
  IF v_bli.quantity <> 7 THEN RAISE EXCEPTION 'FINAL_FAILED: client item stock must be 7, got %', v_bli.quantity; END IF;
  RAISE NOTICE 'FINAL_STEP_3_PASSED: stock states consistent across all four tracks.';

  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet;
  IF v_wallet_balance <> v_wallet_opening - 7000 THEN RAISE EXCEPTION 'FINAL_FAILED: wallet must be -7000 vs opening cumulative, got delta %', v_wallet_balance - v_wallet_opening; END IF;
  RAISE NOTICE 'FINAL_STEP_4_PASSED: wallet -7000 vs opening (-4000 stock receipt +4000 payment -1000 refund -6000 supplier).';

  -- No orphan Finance rows: the transfer, the inventory count, and the
  -- physical part of the return must never have created a finance_operations
  -- row of their own (they are stock-only events).
  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE module_id::text = v_transfer.id::text;
  IF v_op_count <> 0 THEN RAISE EXCEPTION 'FINAL_FAILED: a stock transfer must never create a finance_operations row, found %', v_op_count; END IF;
  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE module_id::text = v_count.id::text;
  IF v_op_count <> 0 THEN RAISE EXCEPTION 'FINAL_FAILED: an inventory count must never create a finance_operations row, found %', v_op_count; END IF;
  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE module_id::text = v_return.id::text;
  IF v_op_count <> 0 THEN RAISE EXCEPTION 'FINAL_FAILED: a product return must never create a finance_operations row on its own (only the later refund does), found %', v_op_count; END IF;
  RAISE NOTICE 'FINAL_STEP_5_PASSED: zero orphan Finance rows on transfer/count/return.';
END;
$test$;

ROLLBACK;

SELECT 'GFC_V1_PHASE6_CONSOLIDATED_E2E_PASSED' AS result;
