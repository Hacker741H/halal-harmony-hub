-- MF-01 HALAL Field tests.
-- Run after 20260801150000_add_halal_field_reports.sql. The script always rolls
-- back: it leaves no wallet assignment, report, declaration, audit entry or
-- finance operation in the database.

BEGIN;

CREATE TEMPORARY TABLE field_test_result (
  result text NOT NULL
) ON COMMIT DROP;

DO $test$
DECLARE
  v_finance_actor_id uuid;
  v_field_agent_id uuid;
  v_source_wallet_id uuid;
  v_destination_wallet_id uuid;
  v_source_before numeric;
  v_destination_before numeric;
  v_source_after numeric;
  v_destination_after numeric;
  v_report public.field_reports;
  v_cancelled_report public.field_reports;
  v_immediate_report public.field_reports;
  v_rejected_report public.field_reports;
  v_receipt public.field_declarations;
  v_cancelled_declaration public.field_declarations;
  v_immediate_receipt public.field_declarations;
  v_expense public.field_declarations;
  v_remittance public.field_declarations;
  v_rejected public.field_declarations;
  v_retried_receipt public.field_declarations;
  v_receipt_submission_id uuid := gen_random_uuid();
  v_immediate_submission_id uuid := gen_random_uuid();
  v_balance_after_second_confirmation numeric;
  v_source_before_immediate numeric;
  v_source_after_immediate numeric;
  v_cancel_blocked boolean := false;
BEGIN
  IF to_regclass('public.field_wallet_assignments') IS NULL
    OR to_regclass('public.field_reports') IS NULL
    OR to_regclass('public.field_declarations') IS NULL
    OR to_regclass('public.finance_field_declaration_links') IS NULL THEN
    RAISE EXCEPTION 'MF-01 tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS table_row
    WHERE table_row.oid IN (
      'public.field_wallet_assignments'::regclass,
      'public.field_reports'::regclass,
      'public.field_declarations'::regclass,
      'public.finance_field_declaration_links'::regclass
    )
      AND NOT table_row.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'All HALAL Field tables must have RLS enabled';
  END IF;

  IF has_table_privilege('authenticated', 'public.field_reports', 'DELETE')
    OR has_table_privilege('authenticated', 'public.field_declarations', 'DELETE')
    OR has_table_privilege('authenticated', 'public.field_wallet_assignments', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated must not receive direct DELETE on HALAL Field tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('field_wallet_assignments', 'field_reports', 'field_declarations', 'finance_field_declaration_links')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'HALAL Field mutations must be limited to secured RPCs';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wallets'
      AND policyname = 'wallets_read'
      AND position('field.wallets.read' IN coalesce(qual, '')) > 0
      AND position('field_wallet_assignments' IN coalesce(qual, '')) > 0
  ) THEN
    RAISE EXCEPTION 'An assigned field wallet must be visible without granting global wallet access';
  END IF;

  IF has_function_privilege('anon', 'public.create_field_report(jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.cancel_field_report(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_field_declaration(uuid, jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_field_declaration(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_immediate_field_receipt(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute HALAL Field mutation RPCs';
  END IF;

  SELECT user_role.user_id
  INTO v_finance_actor_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;

  SELECT DISTINCT user_role.user_id
  INTO v_field_agent_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  JOIN public.role_permissions AS role_permission ON role_permission.role = user_role.role
  WHERE role_catalogue.is_active
    AND role_permission.permission_code = 'field.reports.create'
    AND user_role.user_id <> v_finance_actor_id
  ORDER BY user_role.user_id
  LIMIT 1;

  SELECT id, balance
  INTO v_source_wallet_id, v_source_before
  FROM public.wallets
  ORDER BY is_default DESC NULLS LAST, created_at
  LIMIT 1;

  SELECT id, balance
  INTO v_destination_wallet_id, v_destination_before
  FROM public.wallets
  WHERE id <> v_source_wallet_id
  ORDER BY is_default DESC NULLS LAST, created_at
  LIMIT 1;

  IF v_finance_actor_id IS NULL OR v_field_agent_id IS NULL
    OR v_source_wallet_id IS NULL OR v_destination_wallet_id IS NULL THEN
    INSERT INTO field_test_result(result)
    VALUES ('SKIPPED: a super_admin, a distinct field agent and two wallets are required for the lifecycle scenario.');
    RETURN;
  END IF;

  -- Finance gives the agent exactly one operational source wallet and one
  -- authorised company destination wallet.
  PERFORM set_config('request.jwt.claim.sub', v_finance_actor_id::text, true);
  PERFORM public.assign_field_wallet(jsonb_build_object(
    'user_id', v_field_agent_id,
    'wallet_id', v_source_wallet_id,
    'assignment_type', 'SOURCE',
    'label', 'Wallet terrain de test',
    'allow_immediate_receipts', true
  ));
  PERFORM public.assign_field_wallet(jsonb_build_object(
    'user_id', v_field_agent_id,
    'wallet_id', v_destination_wallet_id,
    'assignment_type', 'DESTINATION',
    'label', 'Wallet entreprise de test'
  ));

  -- The field agent can prepare and submit, but has no direct balance mutation.
  PERFORM set_config('request.jwt.claim.sub', v_field_agent_id::text, true);
  v_cancelled_report := public.create_field_report(jsonb_build_object(
    'report_type', 'DAILY',
    'period_start', current_date,
    'period_end', current_date,
    'notes', 'Brouillon à abandonner MF-01'
  ));
  v_cancelled_declaration := public.create_field_declaration(v_cancelled_report.id, jsonb_build_object(
    'declaration_type', 'RECEIPT',
    'amount', 1200,
    'field_wallet_id', v_source_wallet_id,
    'category', 'Brouillon à abandonner'
  ));
  v_cancelled_report := public.cancel_field_report(v_cancelled_report.id);
  IF v_cancelled_report.status <> 'CANCELLED'
    OR (SELECT status FROM public.field_declarations WHERE id = v_cancelled_declaration.id) <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelling a draft report must cancel only its draft declarations';
  END IF;
  SELECT balance INTO v_source_after FROM public.wallets WHERE id = v_source_wallet_id;
  IF v_source_after IS DISTINCT FROM v_source_before THEN
    RAISE EXCEPTION 'Cancelling a draft report must not affect a wallet';
  END IF;

  v_report := public.create_field_report(jsonb_build_object(
    'report_type', 'DAILY',
    'period_start', current_date,
    'period_end', current_date,
    'notes', 'Rapport transactionnel MF-01'
  ));
  v_receipt := public.create_field_declaration(v_report.id, jsonb_build_object(
    'declaration_type', 'RECEIPT',
    'amount', 10000,
    'field_wallet_id', v_source_wallet_id,
    'category', 'Vente terrain',
    'client_submission_id', v_receipt_submission_id
  ));
  v_retried_receipt := public.create_field_declaration(v_report.id, jsonb_build_object(
    'declaration_type', 'RECEIPT',
    'amount', 10000,
    'field_wallet_id', v_source_wallet_id,
    'category', 'Vente terrain',
    'client_submission_id', v_receipt_submission_id
  ));
  IF v_retried_receipt.id <> v_receipt.id
    OR (SELECT count(*) FROM public.field_declarations WHERE created_by = v_field_agent_id AND client_submission_id = v_receipt_submission_id) <> 1 THEN
    RAISE EXCEPTION 'Retrying the same offline declaration must be idempotent';
  END IF;
  v_expense := public.create_field_declaration(v_report.id, jsonb_build_object(
    'declaration_type', 'EXPENSE',
    'amount', 2000,
    'field_wallet_id', v_source_wallet_id,
    'category', 'Carburant'
  ));
  v_remittance := public.create_field_declaration(v_report.id, jsonb_build_object(
    'declaration_type', 'REMITTANCE',
    'amount', 3000,
    'field_wallet_id', v_source_wallet_id,
    'destination_wallet_id', v_destination_wallet_id,
    'category', 'Versement journalier'
  ));
  PERFORM public.submit_field_report(v_report.id);

  SELECT balance INTO v_source_after FROM public.wallets WHERE id = v_source_wallet_id;
  IF v_source_after IS DISTINCT FROM v_source_before THEN
    RAISE EXCEPTION 'Submitting a field report must not affect a wallet';
  END IF;

  -- Finance confirms independently. Each confirmation uses finance_operations
  -- and therefore recalculates the wallets through the official function.
  PERFORM set_config('request.jwt.claim.sub', v_finance_actor_id::text, true);
  v_receipt := public.confirm_field_declaration(v_receipt.id);
  v_expense := public.confirm_field_declaration(v_expense.id);
  v_remittance := public.confirm_field_declaration(v_remittance.id);
  IF v_receipt.status <> 'CONFIRMED' OR v_expense.status <> 'CONFIRMED' OR v_remittance.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Submitted declarations must be confirmed by Finance';
  END IF;
  IF (SELECT count(*) FROM public.finance_field_declaration_links WHERE declaration_id IN (v_receipt.id, v_expense.id, v_remittance.id)) <> 3 THEN
    RAISE EXCEPTION 'Each confirmed field declaration must have exactly one finance link';
  END IF;

  SELECT balance INTO v_source_after FROM public.wallets WHERE id = v_source_wallet_id;
  SELECT balance INTO v_destination_after FROM public.wallets WHERE id = v_destination_wallet_id;
  IF v_source_after <> v_source_before + 5000 THEN
    RAISE EXCEPTION 'Receipt, expense and remittance must change the field wallet by the exact net amount';
  END IF;
  IF v_destination_after <> v_destination_before + 3000 THEN
    RAISE EXCEPTION 'Remittance must credit the authorised destination wallet exactly once';
  END IF;

  PERFORM public.confirm_field_declaration(v_receipt.id);
  SELECT balance INTO v_balance_after_second_confirmation FROM public.wallets WHERE id = v_source_wallet_id;
  IF v_balance_after_second_confirmation <> v_source_after
    OR (SELECT count(*) FROM public.finance_field_declaration_links WHERE declaration_id = v_receipt.id) <> 1 THEN
    RAISE EXCEPTION 'A second confirmation must be idempotent and must not duplicate the finance operation';
  END IF;

  -- A trusted agent may post a receipt immediately to the explicitly assigned
  -- source wallet. The operation remains idempotent and uses the finance journal.
  PERFORM set_config('request.jwt.claim.sub', v_field_agent_id::text, true);
  SELECT balance INTO v_source_before_immediate FROM public.wallets WHERE id = v_source_wallet_id;
  v_immediate_report := public.create_field_report(jsonb_build_object(
    'report_type', 'DAILY',
    'period_start', current_date,
    'period_end', current_date,
    'notes', 'Recette immediate MF-01'
  ));
  v_immediate_receipt := public.create_immediate_field_receipt(v_immediate_report.id, jsonb_build_object(
    'declaration_type', 'RECEIPT',
    'amount', 7500,
    'field_wallet_id', v_source_wallet_id,
    'category', 'Vente terrain immediate',
    'client_submission_id', v_immediate_submission_id
  ));
  v_retried_receipt := public.create_immediate_field_receipt(v_immediate_report.id, jsonb_build_object(
    'declaration_type', 'RECEIPT',
    'amount', 7500,
    'field_wallet_id', v_source_wallet_id,
    'category', 'Vente terrain immediate',
    'client_submission_id', v_immediate_submission_id
  ));
  IF v_immediate_receipt.status <> 'CONFIRMED'
    OR v_retried_receipt.id <> v_immediate_receipt.id
    OR (SELECT count(*) FROM public.finance_field_declaration_links WHERE declaration_id = v_immediate_receipt.id) <> 1 THEN
    RAISE EXCEPTION 'An immediate field receipt must be confirmed and linked to exactly one finance operation';
  END IF;
  SELECT balance INTO v_source_after_immediate FROM public.wallets WHERE id = v_source_wallet_id;
  IF v_source_after_immediate <> v_source_before_immediate + 7500 THEN
    RAISE EXCEPTION 'An immediate field receipt must credit the assigned wallet exactly once';
  END IF;
  BEGIN
    PERFORM public.cancel_field_report(v_immediate_report.id);
  EXCEPTION WHEN OTHERS THEN
    v_cancel_blocked := true;
  END;
  IF NOT v_cancel_blocked THEN
    RAISE EXCEPTION 'A report with a confirmed declaration must not be cancellable';
  END IF;
  v_immediate_report := public.submit_field_report(v_immediate_report.id);
  IF v_immediate_report.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'A report containing only immediate receipts must remain submittable for the audit trail';
  END IF;

  -- A reviewer can refuse a submitted declaration and the reason stays in the audit trail.
  PERFORM set_config('request.jwt.claim.sub', v_field_agent_id::text, true);
  v_rejected_report := public.create_field_report(jsonb_build_object(
    'report_type', 'DAILY', 'period_start', current_date, 'period_end', current_date
  ));
  v_rejected := public.create_field_declaration(v_rejected_report.id, jsonb_build_object(
    'declaration_type', 'EXPENSE', 'amount', 500, 'field_wallet_id', v_source_wallet_id, 'category', 'À contrôler'
  ));
  PERFORM public.submit_field_report(v_rejected_report.id);
  PERFORM set_config('request.jwt.claim.sub', v_finance_actor_id::text, true);
  v_rejected := public.reject_field_declaration(v_rejected.id, 'Justificatif manquant pour le test.');
  IF v_rejected.status <> 'REJECTED' OR v_rejected.rejection_reason IS NULL THEN
    RAISE EXCEPTION 'Rejecting a declaration must retain its status and reason';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_finance_audit
    WHERE source_type IN ('FIELD_REPORT', 'FIELD_DECLARATION')
      AND source_id IN (v_report.id, v_receipt.id, v_expense.id, v_remittance.id, v_rejected.id)
  ) THEN
    RAISE EXCEPTION 'Field report lifecycle must be audited';
  END IF;

  INSERT INTO field_test_result(result)
  VALUES ('PASSED: draft cancellation, report lifecycle, standard and immediate receipt idempotence, wallet reconciliation, rejection and security assertions succeeded.');
END;
$test$;

SELECT result FROM field_test_result;

ROLLBACK;
