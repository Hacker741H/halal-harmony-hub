-- One-off, targeted regularization for a single real cash session closed
-- BEFORE the legacy CASH fallback (migration 20260815110000) was deployed:
-- cash-session-b9604df6-6e51-4f5a-b683-4ec5bf641282 closed with
-- server_cash_total/cash_expected = 1800 instead of 2800, because its
-- theoretical was computed while _internal_commerce_pos_session_commercial_totals
-- still only matched commercial_invoice_payments.payment_method = 'CASH'
-- directly, never a NULL value.
--
-- Read-only audit basis (both payments CONFIRMED; both already correctly
-- counted into ticket_count/article_total/service_total -- only the
-- CASH-specific split undercounted them):
--   payment 01088a64-c357-4c3f-8a21-54f16f784f6a  amount 1000.00
--     payment_method NULL (pre-Phase-2 payment, by migration design, never
--     retroactively backfilled)
--     linked finance_operations a5ad2399-2bed-4754-9904-a8413945f0ee,
--       payment_method='CASH', status='VALIDE'
--       (module='COMMERCIAL_INVOICE_PAYMENT', module_id=payment.id -- the
--       same stable link the fallback function itself relies on)
--   payment 0244f2ec-f297-44eb-90fd-acf4f5a98714  amount 1800.00
--     payment_method='CASH' directly (post-Phase-2 payment)
--   => true CASH theoretical = 1000 + 1800 = 2800.00
--
-- Scope, deliberately narrow:
--   * touches exactly 2 rows: the one closure, the one report, matched by id
--     AND by their current known-wrong value (1800) -- never a blind UPDATE;
--   * touches exactly 2 columns: server_cash_total, cash_expected;
--   * never touches commercial_sales, commercial_invoice_payments,
--     finance_operations, or any revenue/ticket/article/service figure --
--     those were already correct;
--   * never creates a finance_operations row and never calls any RPC --
--     this is data correction, not a sale or a Finance movement;
--   * each UPDATE checks its own row count via GET DIAGNOSTICS and aborts
--     the whole transaction if it is not exactly 1 -- a partial/unexpected
--     match fails loudly instead of silently doing nothing or doing more
--     than intended.
--
-- This file is committed with a trailing ROLLBACK so it is always safe to
-- run as-is (rehearsal only). To actually apply the correction, run a copy
-- with ROLLBACK changed to COMMIT under an explicit, separate authorization
-- -- never edit this committed file to a live COMMIT.
--
-- These tables have no direct authenticated GRANT (RPC-only writes under
-- RLS): this script must run with the same privileged/service-role
-- connection already used for migrations, not through the app.

BEGIN;

DO $regularize$
DECLARE
  v_closure_id CONSTANT uuid := '7a7002db-ceb4-43fc-a58f-c7987cfb83c7';
  v_report_id CONSTANT uuid := '7b0d25d8-a342-4bce-8c8d-4b80a04fcdff';
  v_cash_session_id CONSTANT text := 'cash-session-b9604df6-6e51-4f5a-b683-4ec5bf641282';
  v_wrong_value CONSTANT numeric(14, 2) := 1800.00;
  v_correct_value CONSTANT numeric(14, 2) := 2800.00;
  v_row_count integer;
  v_current_closure_value numeric(14, 2);
  v_current_report_value numeric(14, 2);
BEGIN
  -- Pre-check: refuse to proceed unless both rows are found in exactly the
  -- state this script was written against. Any drift since the audit
  -- (another process already touched these rows, or they no longer match
  -- the expected ids/session) must stop the script, not guess.
  SELECT server_cash_total INTO v_current_closure_value
  FROM public.commerce_pos_cash_session_closures
  WHERE id = v_closure_id AND cash_session_id = v_cash_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: closure % (session %) not found.', v_closure_id, v_cash_session_id;
  END IF;
  IF v_current_closure_value <> v_wrong_value THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: closure % server_cash_total is %, expected % -- refusing to guess, state has drifted since the audit.',
      v_closure_id, v_current_closure_value, v_wrong_value;
  END IF;

  SELECT cash_expected INTO v_current_report_value
  FROM public.commerce_pos_control_reports
  WHERE id = v_report_id AND closure_id = v_closure_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: report % (closure %) not found.', v_report_id, v_closure_id;
  END IF;
  IF v_current_report_value <> v_wrong_value THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: report % cash_expected is % , expected % -- refusing to guess, state has drifted since the audit.',
      v_report_id, v_current_report_value, v_wrong_value;
  END IF;

  -- Correction 1/2: the closure.
  UPDATE public.commerce_pos_cash_session_closures
  SET server_cash_total = v_correct_value
  WHERE id = v_closure_id
    AND cash_session_id = v_cash_session_id
    AND server_cash_total = v_wrong_value;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: closure update touched % row(s), expected exactly 1.', v_row_count;
  END IF;

  -- Correction 2/2: the report.
  UPDATE public.commerce_pos_control_reports
  SET cash_expected = v_correct_value,
      updated_at = now()
  WHERE id = v_report_id
    AND closure_id = v_closure_id
    AND cash_expected = v_wrong_value;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: report update touched % row(s), expected exactly 1.', v_row_count;
  END IF;

  RAISE NOTICE 'REGULARIZE_OK: closure % and report % updated from % to % (session %).',
    v_closure_id, v_report_id, v_wrong_value, v_correct_value, v_cash_session_id;
END;
$regularize$;

-- In-transaction verification (visible whether this run ends in ROLLBACK or
-- COMMIT): confirms both rows now read 2800 before the transaction closes.
SELECT
  (SELECT server_cash_total FROM public.commerce_pos_cash_session_closures WHERE id = '7a7002db-ceb4-43fc-a58f-c7987cfb83c7') AS closure_server_cash_total,
  (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = '7b0d25d8-a342-4bce-8c8d-4b80a04fcdff') AS report_cash_expected;

ROLLBACK; -- change to COMMIT on a deliberate, separately-authorized copy to actually apply
