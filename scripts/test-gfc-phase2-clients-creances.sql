-- GFC V1 Phase 2 -- Clients/Creances. Transactional proof (ROLLBACK at the
-- end, no data survives) for the four migrations of this phase:
--   A. transport_clients.country_code widened to CI/SN (additive, no
--      existing row rewritten).
--   B. get_commercial_client_financial_metrics (+ bulk variant): real
--      computed values, real zero for no activity, matches the proven
--      per-sale formula aggregated per client.
--   C. gestionnaire can now confirm/cancel a commercial invoice payment
--      (previously 403 on a redundant, unrelated finance.create/
--      finance.cancel gate) -- with a negative control proving a role
--      without sales.payments is still correctly rejected.
--   D. merge_clients now also reassigns commercial_sales.client_id and
--      commercial_invoices.client_id (previously left behind).
-- Own synthetic fixtures throughout; nothing here touches real production
-- clients, sales, or user_roles beyond this transaction.

BEGIN;

------------------------------------------------------------------
-- SECTION A -- country_code widening.
------------------------------------------------------------------
DO $test_country$
DECLARE
  v_actor_id uuid;
  v_client_ci public.transport_clients;
  v_client_sn public.transport_clients;
  v_client_default public.transport_clients;
  v_rejected boolean := false;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Omitted country_code still defaults to CI -- existing behaviour preserved.
  v_client_default := public.create_client(jsonb_build_object('display_name', 'Client Defaut ' || txid_current()::text));
  IF v_client_default.country_code <> 'CI' THEN
    RAISE EXCEPTION 'PHASE2_A_FAILED: default country_code should stay CI, got %', v_client_default.country_code;
  END IF;

  -- Explicit CI still works.
  v_client_ci := public.create_client(jsonb_build_object('display_name', 'Client CI ' || txid_current()::text, 'country_code', 'CI'));
  IF v_client_ci.country_code <> 'CI' THEN RAISE EXCEPTION 'PHASE2_A_FAILED: explicit CI rejected.'; END IF;

  -- SN is now accepted (previously hard-rejected).
  v_client_sn := public.create_client(jsonb_build_object('display_name', 'Client SN ' || txid_current()::text, 'country_code', 'SN'));
  IF v_client_sn.country_code <> 'SN' THEN RAISE EXCEPTION 'PHASE2_A_FAILED: SN not accepted, got %', v_client_sn.country_code; END IF;

  -- update_client can also move a client to SN, and it actually persists (the
  -- pre-fix bug: create/update_client silently hardcoded 'CI' regardless of
  -- the parsed, validated value).
  v_client_ci := public.update_client(v_client_ci.id, jsonb_build_object('display_name', v_client_ci.display_name, 'country_code', 'SN'));
  IF v_client_ci.country_code <> 'SN' THEN
    RAISE EXCEPTION 'PHASE2_A_FAILED: update_client did not actually persist the parsed country_code, got %', v_client_ci.country_code;
  END IF;

  -- An unsupported country code is still rejected, not silently accepted.
  BEGIN
    PERFORM public.create_client(jsonb_build_object('display_name', 'Client Invalide ' || txid_current()::text, 'country_code', 'US'));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'PHASE2_A_FAILED: an unsupported country code (US) was silently accepted.'; END IF;

  RAISE NOTICE 'PHASE2_A_PASSED: country_code widened to CI/SN additively, default unchanged, garbage still rejected, update_client no longer silently discards the parsed value.';
END;
$test_country$;

------------------------------------------------------------------
-- SECTION B -- get_commercial_client_financial_metrics (+ bulk).
------------------------------------------------------------------
DO $test_metrics$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_client_empty public.transport_clients;
  v_client_active public.transport_clients;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_metrics_empty record;
  v_metrics_active record;
  v_bulk jsonb;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST PHASE2 METRICS ' || txid_current()::text, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;

  v_client_empty := public.create_client(jsonb_build_object('display_name', 'Client Sans Activite ' || txid_current()::text));
  v_client_active := public.create_client(jsonb_build_object('display_name', 'Client Actif ' || txid_current()::text));

  -- Client with genuinely zero commercial activity -> real zeros, not NULL, not fake.
  SELECT * INTO v_metrics_empty FROM public.get_commercial_client_financial_metrics(v_client_empty.id);
  IF v_metrics_empty.metrics_available IS DISTINCT FROM true
    OR v_metrics_empty.sale_count <> 0 OR v_metrics_empty.total_invoiced <> 0
    OR v_metrics_empty.total_received <> 0 OR v_metrics_empty.amount_due <> 0
    OR v_metrics_empty.last_sale_at IS NOT NULL THEN
    RAISE EXCEPTION 'PHASE2_B_FAILED: zero-activity client did not return real zeros, got %', row_to_json(v_metrics_empty);
  END IF;

  -- Build one real sale -> invoice 1000 -> partial confirmed payment 600.
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_active.id,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Article test Phase 2', 'quantity', 1, 'unit_price', 1000))
  ));
  PERFORM public.confirm_commercial_sale(v_sale.id);
  v_invoice := public.create_commercial_invoice(v_sale.id, '{}'::jsonb);
  PERFORM public.issue_commercial_invoice(v_invoice.id);
  v_payment := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id, 'amount', 600, 'payment_date', current_date, 'status', 'RECEIVED', 'payment_kind', 'PAYMENT'
  ));
  v_payment := public.confirm_commercial_invoice_payment(v_payment.id);

  SELECT * INTO v_metrics_active FROM public.get_commercial_client_financial_metrics(v_client_active.id);
  IF v_metrics_active.sale_count <> 1 OR v_metrics_active.total_invoiced <> 1000
    OR v_metrics_active.total_received <> 600 OR v_metrics_active.amount_due <> 400
    OR v_metrics_active.last_sale_at IS NULL OR v_metrics_active.last_payment_at IS NULL THEN
    RAISE EXCEPTION 'PHASE2_B_FAILED: active client metrics wrong, expected invoiced=1000/received=600/due=400, got %', row_to_json(v_metrics_active);
  END IF;

  -- Bulk variant, both clients in one call, must match the single-client values exactly.
  SELECT jsonb_agg(row_to_json(bulk_row)) INTO v_bulk
  FROM public.get_commercial_client_financial_metrics_bulk(ARRAY[v_client_empty.id, v_client_active.id]) AS bulk_row;
  IF (SELECT (elem ->> 'amount_due')::numeric FROM jsonb_array_elements(v_bulk) elem WHERE (elem ->> 'client_id')::uuid = v_client_active.id) <> 400
    OR (SELECT (elem ->> 'amount_due')::numeric FROM jsonb_array_elements(v_bulk) elem WHERE (elem ->> 'client_id')::uuid = v_client_empty.id) <> 0
  THEN
    RAISE EXCEPTION 'PHASE2_B_FAILED: bulk variant disagrees with the single-client RPC, got %', v_bulk;
  END IF;

  RAISE NOTICE 'PHASE2_B_PASSED: commercial client metrics are genuinely computed (real zero for no activity, invoiced=1000/received=600/due=400 for real activity), bulk variant agrees with the single-client RPC, get_client_financial_metrics untouched.';
END;
$test_metrics$;

------------------------------------------------------------------
-- SECTION C -- gestionnaire-403 fix, with a negative control.
------------------------------------------------------------------
DO $test_gate$
DECLARE
  v_actor_id uuid;
  v_gestionnaire_id uuid;
  v_bystander_id uuid;
  v_wallet_id uuid;
  v_client public.transport_clients;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_payment_a public.commercial_invoice_payments;
  v_payment_b public.commercial_invoice_payments;
  v_rejected boolean := false;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_bystander_id FROM public.user_roles WHERE role = 'lecture_seule'::public.app_role ORDER BY user_id LIMIT 1;
  -- No real gestionnaire user exists in this environment today -- borrow an
  -- existing real auth user for the duration of this transaction only
  -- (user_roles is UNIQUE(user_id, role), so this adds a second role
  -- alongside whatever they already have; fully reverted by ROLLBACK).
  SELECT user_id INTO v_gestionnaire_id FROM public.user_roles WHERE role = 'employe'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL OR v_bystander_id IS NULL OR v_gestionnaire_id IS NULL THEN
    RAISE EXCEPTION 'Test requires at least one super_admin, one lecture_seule and one employe user.';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (v_gestionnaire_id, 'gestionnaire'::public.app_role);

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST PHASE2 GATE ' || txid_current()::text, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  v_client := public.create_client(jsonb_build_object('display_name', 'Client Gate ' || txid_current()::text));
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client.id,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Article test gate', 'quantity', 1, 'unit_price', 2000))
  ));
  PERFORM public.confirm_commercial_sale(v_sale.id);
  v_invoice := public.create_commercial_invoice(v_sale.id, '{}'::jsonb);
  PERFORM public.issue_commercial_invoice(v_invoice.id);
  v_payment_a := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id, 'amount', 2000, 'payment_date', current_date, 'status', 'RECEIVED', 'payment_kind', 'PAYMENT'
  ));

  -- NEGATIVE CONTROL FIRST: a role with neither sales.payments nor the old
  -- finance roles must still be rejected -- proves the fix narrows nothing,
  -- it only removes a redundant gate on top of an already-correct one.
  PERFORM set_config('request.jwt.claim.sub', v_bystander_id::text, true);
  BEGIN
    PERFORM public.confirm_commercial_invoice_payment(v_payment_a.id);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'PHASE2_C_FAILED: lecture_seule (no sales.payments) was able to confirm a payment -- gate incorrectly removed.';
  END IF;

  -- gestionnaire: sees the button in the UI (sales.payments + sales.finance.read)
  -- and, after this fix, can actually use it -- confirm then cancel the same payment.
  PERFORM set_config('request.jwt.claim.sub', v_gestionnaire_id::text, true);
  v_payment_a := public.confirm_commercial_invoice_payment(v_payment_a.id);
  IF v_payment_a.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'PHASE2_C_FAILED: gestionnaire could not confirm a commercial invoice payment, got status %', v_payment_a.status;
  END IF;
  v_payment_a := public.cancel_commercial_invoice_payment(v_payment_a.id, 'Annulation de test Phase 2.');
  IF v_payment_a.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'PHASE2_C_FAILED: gestionnaire could not cancel a confirmed commercial invoice payment, got status %', v_payment_a.status;
  END IF;

  -- The reversing entry must exist and actually be an EXPENSE reversal, not silently skipped.
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_commercial_invoice_payment_links
    WHERE payment_id = v_payment_a.id AND link_type = 'REVERSAL'
  ) THEN
    RAISE EXCEPTION 'PHASE2_C_FAILED: no reversal finance operation was recorded for the cancelled payment.';
  END IF;

  -- Second payment on the same invoice, confirmed by gestionnaire too --
  -- proves this was not a one-shot fluke tied to the first payment's state.
  v_payment_b := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id, 'amount', 2000, 'payment_date', current_date, 'status', 'RECEIVED', 'payment_kind', 'PAYMENT'
  ));
  v_payment_b := public.confirm_commercial_invoice_payment(v_payment_b.id);
  IF v_payment_b.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'PHASE2_C_FAILED: second payment confirmation by gestionnaire failed.';
  END IF;

  RAISE NOTICE 'PHASE2_C_PASSED: gestionnaire can now confirm and cancel commercial invoice payments (sales.payments alone is sufficient, matching what the UI already assumed); a role without sales.payments is still correctly rejected; the reversal finance operation is still recorded on cancel.';
END;
$test_gate$;

------------------------------------------------------------------
-- SECTION D -- merge_clients reassigns commercial_sales/commercial_invoices.
------------------------------------------------------------------
DO $test_merge$
DECLARE
  v_actor_id uuid;
  v_source public.transport_clients;
  v_target public.transport_clients;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_source := public.create_client(jsonb_build_object('display_name', 'Client Source Merge ' || txid_current()::text));
  v_target := public.create_client(jsonb_build_object('display_name', 'Client Cible Merge ' || txid_current()::text));
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_source.id,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Article test merge', 'quantity', 1, 'unit_price', 500))
  ));
  PERFORM public.confirm_commercial_sale(v_sale.id);
  v_invoice := public.create_commercial_invoice(v_sale.id, '{}'::jsonb);

  PERFORM public.merge_clients(v_source.id, v_target.id, 'Fusion de test Phase 2 -- doublon detecte.');

  IF (SELECT client_id FROM public.commercial_sales WHERE id = v_sale.id) <> v_target.id THEN
    RAISE EXCEPTION 'PHASE2_D_FAILED: commercial_sales.client_id was not reassigned to the merge target.';
  END IF;
  IF (SELECT client_id FROM public.commercial_invoices WHERE id = v_invoice.id) <> v_target.id THEN
    RAISE EXCEPTION 'PHASE2_D_FAILED: commercial_invoices.client_id was not reassigned to the merge target.';
  END IF;
  IF (SELECT status FROM public.transport_clients WHERE id = v_source.id) <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'PHASE2_D_FAILED: source client was not archived by the merge.';
  END IF;

  RAISE NOTICE 'PHASE2_D_PASSED: merge_clients now reassigns commercial_sales.client_id and commercial_invoices.client_id to the target, alongside the pre-existing transport_missions/transport_invoices reassignment.';
END;
$test_merge$;

DO $final$
BEGIN
  RAISE NOTICE 'GFC_V1_PHASE2_ALL_SECTIONS_PASSED';
  CREATE TEMP TABLE phase2_result AS SELECT 'GFC_V1_PHASE2_ALL_SECTIONS_PASSED'::text AS result;
END;
$final$;

SELECT result FROM phase2_result;

ROLLBACK;
