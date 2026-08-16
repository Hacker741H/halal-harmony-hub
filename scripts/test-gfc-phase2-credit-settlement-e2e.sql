-- GFC V1 Phase 2 validation gate -- mandatory E2E synthetic proof of the
-- full "vente a credit -> facture -> paiement -> Finance -> wallet"
-- workflow, exactly per the 5-scenario spec requested before Phase 3:
--   A. credit sale 10000 -- CA=10000, creance=10000, wallet unchanged, zero
--      finance_operations.
--   B. confirmed payment 6000 -- creance=4000, wallet +6000 exactly,
--      CA still 10000, exactly one Finance operation, type=DEPOSIT.
--   C. retry the same confirmation -- no duplicate.
--   D. final payment 4000 -- creance=0, wallet cumulative +10000, CA still
--      10000.
--   E. cancel one settlement -- debt restored, treasury reversed, CA still
--      10000 (no second sale/revenue created).
-- Own synthetic fixtures, ROLLBACK at the end -- proof, not production data.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_wallet_opening numeric(14, 2);
  v_client public.transport_clients;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_payment_a public.commercial_invoice_payments;
  v_payment_b public.commercial_invoice_payments;
  v_summary record;
  v_wallet_balance numeric(14, 2);
  v_op_count integer;
  v_op_type text;
  v_sale_count_before integer;
  v_sale_count_after integer;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Test requires a super_admin user.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST E2E SETTLEMENT ' || txid_current()::text, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  SELECT balance INTO v_wallet_opening FROM public.wallets WHERE id = v_wallet_id;

  v_client := public.create_client(jsonb_build_object('display_name', 'Client E2E Reglement ' || txid_current()::text));

  ------------------------------------------------------------------
  -- A. Vente a credit 10000.
  ------------------------------------------------------------------
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client.id,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Marchandise E2E', 'quantity', 1, 'unit_price', 10000))
  ));
  v_sale := public.confirm_commercial_sale(v_sale.id);
  v_invoice := public.create_commercial_invoice(v_sale.id, '{}'::jsonb);
  v_invoice := public.issue_commercial_invoice(v_invoice.id);

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE module_id = v_invoice.id OR module_id = v_sale.id;

  IF v_summary.total_invoiced <> 10000 THEN RAISE EXCEPTION 'STEP_A_FAILED: CA must be 10000, got %', v_summary.total_invoiced; END IF;
  IF v_summary.amount_due <> 10000 THEN RAISE EXCEPTION 'STEP_A_FAILED: creance must be 10000, got %', v_summary.amount_due; END IF;
  IF v_wallet_balance <> v_wallet_opening THEN RAISE EXCEPTION 'STEP_A_FAILED: wallet must be unchanged, got % vs opening %', v_wallet_balance, v_wallet_opening; END IF;
  IF v_op_count <> 0 THEN RAISE EXCEPTION 'STEP_A_FAILED: a credit sale must create zero finance_operations before any payment, found %', v_op_count; END IF;
  RAISE NOTICE 'STEP_A_PASSED: credit sale 10000 -- CA=10000, creance=10000, wallet unchanged, 0 Finance operations.';

  ------------------------------------------------------------------
  -- B. Paiement confirme 6000.
  ------------------------------------------------------------------
  v_payment_a := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id, 'amount', 6000, 'payment_date', current_date, 'status', 'RECEIVED', 'payment_kind', 'PAYMENT'
  ));
  v_payment_a := public.confirm_commercial_invoice_payment(v_payment_a.id);

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*), max(type) INTO v_op_count, v_op_type
  FROM public.finance_operations WHERE module = 'COMMERCIAL_INVOICE_PAYMENT' AND module_id = v_payment_a.id;

  IF v_summary.amount_due <> 4000 THEN RAISE EXCEPTION 'STEP_B_FAILED: creance must be 4000, got %', v_summary.amount_due; END IF;
  IF v_wallet_balance <> v_wallet_opening + 6000 THEN RAISE EXCEPTION 'STEP_B_FAILED: wallet must be +6000 exactly, got % vs opening %', v_wallet_balance, v_wallet_opening; END IF;
  IF v_summary.total_invoiced <> 10000 THEN RAISE EXCEPTION 'STEP_B_FAILED: CA must stay 10000, got %', v_summary.total_invoiced; END IF;
  IF v_op_count <> 1 THEN RAISE EXCEPTION 'STEP_B_FAILED: exactly one Finance operation expected, found %', v_op_count; END IF;
  IF v_op_type <> 'DEPOSIT' THEN RAISE EXCEPTION 'STEP_B_FAILED: settlement must be recorded as DEPOSIT (treasury inflow for already-counted CA), got %', v_op_type; END IF;
  RAISE NOTICE 'STEP_B_PASSED: confirmed payment 6000 -- creance=4000, wallet +6000, CA=10000, exactly 1 Finance operation, type=DEPOSIT.';

  ------------------------------------------------------------------
  -- C. Retry du paiement (meme id, deja CONFIRMED).
  ------------------------------------------------------------------
  PERFORM public.confirm_commercial_invoice_payment(v_payment_a.id);
  SELECT count(*) INTO v_op_count FROM public.finance_operations WHERE module = 'COMMERCIAL_INVOICE_PAYMENT' AND module_id = v_payment_a.id;
  IF v_op_count <> 1 THEN RAISE EXCEPTION 'STEP_C_FAILED: retrying an already-confirmed payment must not create a duplicate, found %', v_op_count; END IF;
  RAISE NOTICE 'STEP_C_PASSED: retry of an already-confirmed payment created no duplicate.';

  ------------------------------------------------------------------
  -- D. Paiement final 4000.
  ------------------------------------------------------------------
  v_payment_b := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id, 'amount', 4000, 'payment_date', current_date, 'status', 'RECEIVED', 'payment_kind', 'SETTLEMENT'
  ));
  v_payment_b := public.confirm_commercial_invoice_payment(v_payment_b.id);

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;

  IF v_summary.amount_due <> 0 THEN RAISE EXCEPTION 'STEP_D_FAILED: creance must be 0, got %', v_summary.amount_due; END IF;
  IF v_wallet_balance <> v_wallet_opening + 10000 THEN RAISE EXCEPTION 'STEP_D_FAILED: wallet must be cumulative +10000, got % vs opening %', v_wallet_balance, v_wallet_opening; END IF;
  IF v_summary.total_invoiced <> 10000 THEN RAISE EXCEPTION 'STEP_D_FAILED: CA must stay 10000, got %', v_summary.total_invoiced; END IF;
  IF v_summary.invoice_status <> 'PAID' THEN RAISE EXCEPTION 'STEP_D_FAILED: invoice must be PAID, got %', v_summary.invoice_status; END IF;
  RAISE NOTICE 'STEP_D_PASSED: final payment 4000 -- creance=0, wallet cumulative +10000, CA still 10000, invoice PAID.';

  ------------------------------------------------------------------
  -- E. Annulation/reversal du premier reglement (6000).
  ------------------------------------------------------------------
  SELECT count(*) INTO v_sale_count_before FROM public.commercial_sales WHERE client_id = v_client.id;
  v_payment_a := public.cancel_commercial_invoice_payment(v_payment_a.id, 'Test E2E -- annulation reglement.');

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_sale_count_after FROM public.commercial_sales WHERE client_id = v_client.id;

  IF v_summary.amount_due <> 6000 THEN RAISE EXCEPTION 'STEP_E_FAILED: creance must be restored to 6000, got %', v_summary.amount_due; END IF;
  IF v_wallet_balance <> v_wallet_opening + 4000 THEN RAISE EXCEPTION 'STEP_E_FAILED: wallet must be reversed to +4000 (10000-6000), got % vs opening %', v_wallet_balance, v_wallet_opening; END IF;
  IF v_summary.total_invoiced <> 10000 THEN RAISE EXCEPTION 'STEP_E_FAILED: CA must stay 10000, no double revenue, got %', v_summary.total_invoiced; END IF;
  IF v_sale_count_after <> v_sale_count_before THEN RAISE EXCEPTION 'STEP_E_FAILED: cancelling a settlement must not create a second sale, before=% after=%', v_sale_count_before, v_sale_count_after; END IF;
  IF (SELECT status FROM public.commercial_invoice_payments WHERE id = v_payment_a.id) <> 'CANCELLED' THEN
    RAISE EXCEPTION 'STEP_E_FAILED: payment must be CANCELLED.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_commercial_invoice_payment_links WHERE payment_id = v_payment_a.id AND link_type = 'REVERSAL') THEN
    RAISE EXCEPTION 'STEP_E_FAILED: a reversal Finance operation must exist.';
  END IF;
  RAISE NOTICE 'STEP_E_PASSED: cancelling the 6000 settlement -- creance restored to 6000, wallet reversed to +4000, CA still 10000, no second sale created.';

  RAISE NOTICE 'GFC_V1_PHASE2_CREDIT_SETTLEMENT_E2E_PASSED';
  CREATE TEMP TABLE e2e_result AS SELECT 'GFC_V1_PHASE2_CREDIT_SETTLEMENT_E2E_PASSED'::text AS result;
END;
$test$;

SELECT result FROM e2e_result;

ROLLBACK;
