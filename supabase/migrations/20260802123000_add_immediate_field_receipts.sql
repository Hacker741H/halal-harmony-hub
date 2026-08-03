-- HALAL Field: explicitly trusted agents may credit an assigned terrain wallet
-- with a receipt immediately. Expenses and remittances remain subject to Finance.

ALTER TABLE public.field_wallet_assignments
  ADD COLUMN IF NOT EXISTS allow_immediate_receipts boolean NOT NULL DEFAULT false;

DO $add_field_wallet_immediate_receipts_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'field_wallet_assignments_immediate_receipts_check'
      AND conrelid = 'public.field_wallet_assignments'::regclass
  ) THEN
    ALTER TABLE public.field_wallet_assignments
      ADD CONSTRAINT field_wallet_assignments_immediate_receipts_check
      CHECK (assignment_type = 'SOURCE' OR NOT allow_immediate_receipts);
  END IF;
END;
$add_field_wallet_immediate_receipts_check$;

CREATE OR REPLACE FUNCTION public.assign_field_wallet(p_assignment jsonb)
RETURNS public.field_wallet_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $assign_field_wallet$
DECLARE
  v_assignment public.field_wallet_assignments;
  v_user_id uuid := NULLIF(p_assignment ->> 'user_id', '')::uuid;
  v_wallet_id uuid := NULLIF(p_assignment ->> 'wallet_id', '')::uuid;
  v_label text := NULLIF(btrim(p_assignment ->> 'label'), '');
  v_assignment_type text := upper(coalesce(NULLIF(btrim(p_assignment ->> 'assignment_type'), ''), 'SOURCE'));
  v_allow_immediate_receipts boolean := coalesce((p_assignment ->> 'allow_immediate_receipts')::boolean, false);
BEGIN
  PERFORM public.permission_require('field.wallets.assign');

  IF v_user_id IS NULL OR v_wallet_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id)
    OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Utilisateur ou wallet terrain introuvable.' USING ERRCODE = '23503';
  END IF;

  IF v_assignment_type NOT IN ('SOURCE', 'DESTINATION') THEN
    RAISE EXCEPTION 'Type d’affectation de wallet terrain invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_assignment_type <> 'SOURCE' AND v_allow_immediate_receipts THEN
    RAISE EXCEPTION 'Seul un wallet terrain peut autoriser les recettes immédiates.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.field_wallet_assignments(
    user_id, wallet_id, assignment_type, label, allow_immediate_receipts,
    is_active, assigned_by, revoked_at
  ) VALUES (
    v_user_id, v_wallet_id, v_assignment_type, v_label, v_allow_immediate_receipts,
    true, auth.uid(), NULL
  )
  ON CONFLICT (user_id, wallet_id) DO UPDATE
  SET assignment_type = EXCLUDED.assignment_type,
      label = EXCLUDED.label,
      allow_immediate_receipts = EXCLUDED.allow_immediate_receipts,
      is_active = true,
      assigned_by = auth.uid(),
      assigned_at = now(),
      revoked_at = NULL,
      updated_at = now()
  RETURNING * INTO v_assignment;

  PERFORM public.business_finance_audit_event(
    'FIELD_WALLET_ASSIGNMENT',
    v_assignment.id,
    NULL,
    'UPDATE',
    NULL,
    to_jsonb(v_assignment)
  );

  RETURN v_assignment;
END;
$assign_field_wallet$;

CREATE OR REPLACE FUNCTION public.create_immediate_field_receipt(p_report_id uuid, p_receipt jsonb)
RETURNS public.field_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $create_immediate_field_receipt$
DECLARE
  v_report public.field_reports;
  v_assignment public.field_wallet_assignments;
  v_declaration public.field_declarations;
  v_operation public.finance_operations;
  v_amount numeric := NULLIF(p_receipt ->> 'amount', '')::numeric;
  v_wallet_id uuid := NULLIF(p_receipt ->> 'field_wallet_id', '')::uuid;
  v_category text := NULLIF(btrim(p_receipt ->> 'category'), '');
  v_client_submission_id uuid := NULLIF(p_receipt ->> 'client_submission_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('field.reports.create');

  IF upper(coalesce(NULLIF(btrim(p_receipt ->> 'declaration_type'), ''), 'RECEIPT')) <> 'RECEIPT' THEN
    RAISE EXCEPTION 'Seules les recettes encaissées peuvent être créditées immédiatement.' USING ERRCODE = '22023';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 OR v_wallet_id IS NULL OR v_category IS NULL THEN
    RAISE EXCEPTION 'Recette terrain incomplète ou invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_client_submission_id IS NULL THEN
    RAISE EXCEPTION 'Une clé de synchronisation est obligatoire pour une recette immédiate.' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_declaration
  FROM public.field_declarations
  WHERE created_by = auth.uid()
    AND client_submission_id = v_client_submission_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_declaration.report_id <> p_report_id OR v_declaration.declaration_type <> 'RECEIPT' THEN
      RAISE EXCEPTION 'Cette clé de synchronisation appartient à une autre déclaration.' USING ERRCODE = '22023';
    END IF;
    RETURN v_declaration;
  END IF;

  SELECT *
  INTO v_report
  FROM public.field_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND OR v_report.created_by <> auth.uid() OR v_report.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Rapport terrain introuvable ou non modifiable.' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.field_wallet_assignments
  WHERE user_id = auth.uid()
    AND wallet_id = v_wallet_id
    AND assignment_type = 'SOURCE'
    AND is_active
    AND allow_immediate_receipts
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce wallet ne vous autorise pas à enregistrer une recette immédiate.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(p_receipt ->> 'destination_wallet_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Une recette immédiate ne possède pas de wallet destination.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.field_declarations(
    report_id, declaration_type, status, amount, occurred_at, field_wallet_id,
    category, description, reference, client_id, farm_id, inventory_item_id,
    document_id, client_submission_id, created_by, confirmed_at, confirmed_by
  ) VALUES (
    p_report_id, 'RECEIPT', 'CONFIRMED', v_amount,
    coalesce(NULLIF(p_receipt ->> 'occurred_at', '')::timestamptz, now()), v_wallet_id,
    v_category, NULLIF(btrim(p_receipt ->> 'description'), ''), NULLIF(btrim(p_receipt ->> 'reference'), ''),
    NULLIF(p_receipt ->> 'client_id', '')::uuid, NULLIF(p_receipt ->> 'farm_id', '')::uuid,
    NULLIF(p_receipt ->> 'inventory_item_id', '')::uuid, NULLIF(p_receipt ->> 'document_id', '')::uuid,
    v_client_submission_id, auth.uid(), now(), auth.uid()
  )
  RETURNING * INTO v_declaration;

  INSERT INTO public.finance_operations(
    wallet_id, type, amount, operation_date, category, description, reference,
    status, origin, module, module_id, farm_id, inventory_item_id, created_by
  ) VALUES (
    v_declaration.field_wallet_id, 'REVENUE', v_declaration.amount,
    (v_declaration.occurred_at AT TIME ZONE 'UTC')::date, v_declaration.category,
    coalesce(v_declaration.description, 'Recette terrain immédiate'), v_declaration.reference,
    'VALIDE', 'HALAL_FIELD', 'FIELD_DECLARATION', v_declaration.id,
    v_declaration.farm_id, v_declaration.inventory_item_id, auth.uid()
  )
  RETURNING * INTO v_operation;

  INSERT INTO public.finance_links(finance_operation_id, module, module_record_id)
  VALUES (v_operation.id, 'FIELD_DECLARATION', v_declaration.id)
  ON CONFLICT (finance_operation_id, module, module_record_id) DO NOTHING;

  INSERT INTO public.finance_field_declaration_links(operation_id, declaration_id)
  VALUES (v_operation.id, v_declaration.id)
  ON CONFLICT (declaration_id) DO NOTHING;

  PERFORM public.update_wallet_balance(v_declaration.field_wallet_id);
  PERFORM public.business_finance_audit_event(
    'FIELD_DECLARATION',
    v_declaration.id,
    v_operation.id,
    'IMMEDIATE_CONFIRM',
    NULL,
    to_jsonb(v_declaration)
  );

  RETURN v_declaration;
END;
$create_immediate_field_receipt$;

CREATE OR REPLACE FUNCTION public.submit_field_report(p_report_id uuid)
RETURNS public.field_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $submit_field_report$
DECLARE
  v_before public.field_reports;
  v_report public.field_reports;
BEGIN
  PERFORM public.permission_require('field.reports.submit');

  SELECT * INTO v_before
  FROM public.field_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND OR v_before.created_by <> auth.uid() THEN
    RAISE EXCEPTION 'Rapport terrain introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status = 'SUBMITTED' THEN
    RETURN v_before;
  END IF;

  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seul un rapport brouillon peut être envoyé.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.field_declarations
    WHERE report_id = p_report_id
      AND status IN ('DRAFT', 'CONFIRMED')
  ) THEN
    RAISE EXCEPTION 'Ajoutez au moins une déclaration avant l’envoi.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.field_declarations
  SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
  WHERE report_id = p_report_id
    AND status = 'DRAFT';

  UPDATE public.field_reports
  SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  PERFORM public.business_finance_audit_event(
    'FIELD_REPORT',
    v_report.id,
    NULL,
    'UPDATE',
    to_jsonb(v_before),
    to_jsonb(v_report)
  );

  RETURN v_report;
END;
$submit_field_report$;

REVOKE ALL ON FUNCTION public.create_immediate_field_receipt(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_immediate_field_receipt(uuid, jsonb) TO authenticated;
