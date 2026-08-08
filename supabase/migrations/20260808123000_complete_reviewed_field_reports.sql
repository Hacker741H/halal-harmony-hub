-- HALAL Field — mark a report as reviewed only after every submitted
-- declaration has reached a final review outcome. This does not create or
-- alter finance operations: it only synchronises the report lifecycle.

CREATE OR REPLACE FUNCTION public.internal_review_field_report_if_complete(
  p_report_id uuid,
  p_reviewer_id uuid
)
RETURNS public.field_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_review_field_report_if_complete$
DECLARE
  v_before public.field_reports;
  v_report public.field_reports;
BEGIN
  SELECT *
  INTO v_before
  FROM public.field_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND OR v_before.status <> 'SUBMITTED' THEN
    RETURN v_before;
  END IF;

  -- A report remains in the review queue while at least one declaration has
  -- not reached a final decision. An empty report cannot be reviewed here.
  IF NOT EXISTS (
    SELECT 1
    FROM public.field_declarations
    WHERE report_id = p_report_id
  ) OR EXISTS (
    SELECT 1
    FROM public.field_declarations
    WHERE report_id = p_report_id
      AND status IN ('DRAFT', 'SUBMITTED')
  ) THEN
    RETURN v_before;
  END IF;

  UPDATE public.field_reports
  SET status = 'REVIEWED',
      reviewed_at = coalesce(reviewed_at, now()),
      reviewed_by = coalesce(reviewed_by, p_reviewer_id),
      updated_at = now()
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
$internal_review_field_report_if_complete$;

REVOKE ALL ON FUNCTION public.internal_review_field_report_if_complete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_field_declaration(p_declaration_id uuid)
RETURNS public.field_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_field_declaration$
DECLARE
  v_before public.field_declarations;
  v_declaration public.field_declarations;
  v_operation public.finance_operations;
  v_finance_type text;
BEGIN
  PERFORM public.permission_require('field.reports.confirm');
  PERFORM public.permission_require('finance.create');

  SELECT * INTO v_before
  FROM public.field_declarations
  WHERE id = p_declaration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Déclaration terrain introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status = 'CONFIRMED' THEN
    PERFORM public.internal_review_field_report_if_complete(v_before.report_id, auth.uid());
    RETURN v_before;
  END IF;

  IF v_before.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Seule une déclaration envoyée peut être confirmée.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.field_reports
    WHERE id = v_before.report_id AND status = 'SUBMITTED'
  ) THEN
    RAISE EXCEPTION 'Le rapport terrain doit être envoyé avant confirmation.' USING ERRCODE = '22023';
  END IF;

  IF v_before.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Une déclaration ne peut pas être confirmée par son auteur.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.field_wallet_assignments
    WHERE user_id = v_before.created_by
      AND wallet_id = v_before.field_wallet_id
      AND assignment_type = 'SOURCE'
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Le wallet terrain de l’agent n’est plus affecté.' USING ERRCODE = '22023';
  END IF;

  IF v_before.declaration_type = 'REMITTANCE' AND NOT EXISTS (
    SELECT 1
    FROM public.field_wallet_assignments
    WHERE user_id = v_before.created_by
      AND wallet_id = v_before.destination_wallet_id
      AND assignment_type = 'DESTINATION'
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Le wallet destinataire n’est plus autorisé pour cet agent.' USING ERRCODE = '22023';
  END IF;

  v_finance_type := CASE v_before.declaration_type
    WHEN 'RECEIPT' THEN 'REVENUE'
    WHEN 'EXPENSE' THEN 'EXPENSE'
    WHEN 'REMITTANCE' THEN 'TRANSFER'
  END;

  v_operation := public.finance_create_operation(
    jsonb_build_object(
      'type', v_finance_type,
      'amount', v_before.amount,
      'wallet_id', v_before.field_wallet_id,
      'destination_wallet_id', v_before.destination_wallet_id,
      'operation_date', (v_before.occurred_at AT TIME ZONE 'UTC')::date,
      'category', v_before.category,
      'description', coalesce(v_before.description, 'Déclaration terrain ' || v_before.declaration_type),
      'reference', v_before.reference,
      'status', 'VALIDE',
      'origin', 'HALAL_FIELD',
      'module', 'FIELD_DECLARATION',
      'module_id', v_before.id,
      'farm_id', v_before.farm_id,
      'inventory_item_id', v_before.inventory_item_id
    ),
    'FIELD_DECLARATION',
    v_before.id
  );

  INSERT INTO public.finance_field_declaration_links(operation_id, declaration_id)
  VALUES (v_operation.id, v_before.id)
  ON CONFLICT (declaration_id) DO NOTHING;

  UPDATE public.field_declarations
  SET status = 'CONFIRMED',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_declaration_id
  RETURNING * INTO v_declaration;

  PERFORM public.business_finance_audit_event(
    'FIELD_DECLARATION',
    v_declaration.id,
    v_operation.id,
    'UPDATE',
    to_jsonb(v_before),
    to_jsonb(v_declaration)
  );
  PERFORM public.internal_review_field_report_if_complete(v_declaration.report_id, auth.uid());

  RETURN v_declaration;
END;
$confirm_field_declaration$;

CREATE OR REPLACE FUNCTION public.reject_field_declaration(p_declaration_id uuid, p_reason text)
RETURNS public.field_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $reject_field_declaration$
DECLARE
  v_before public.field_declarations;
  v_declaration public.field_declarations;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('field.reports.review');

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Un motif de refus est obligatoire.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before
  FROM public.field_declarations
  WHERE id = p_declaration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Déclaration terrain introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Seule une déclaration envoyée peut être refusée.' USING ERRCODE = '22023';
  END IF;

  IF v_before.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Une déclaration ne peut pas être refusée par son auteur.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.field_declarations
  SET status = 'REJECTED',
      rejected_at = now(),
      rejected_by = auth.uid(),
      rejection_reason = v_reason,
      updated_at = now()
  WHERE id = p_declaration_id
  RETURNING * INTO v_declaration;

  PERFORM public.business_finance_audit_event(
    'FIELD_DECLARATION',
    v_declaration.id,
    NULL,
    'UPDATE',
    to_jsonb(v_before),
    to_jsonb(v_declaration)
  );
  PERFORM public.internal_review_field_report_if_complete(v_declaration.report_id, auth.uid());

  RETURN v_declaration;
END;
$reject_field_declaration$;

-- Reconcile reports that were fully processed before the lifecycle transition
-- existed. The linked declarations and their finance operations remain intact.
DO $reconcile_completed_reports$
DECLARE
  v_report record;
  v_reviewer_id uuid;
BEGIN
  FOR v_report IN
    SELECT report.id
    FROM public.field_reports AS report
    WHERE report.status = 'SUBMITTED'
      AND EXISTS (
        SELECT 1
        FROM public.field_declarations AS declaration
        WHERE declaration.report_id = report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.field_declarations AS declaration
        WHERE declaration.report_id = report.id
          AND declaration.status IN ('DRAFT', 'SUBMITTED')
      )
  LOOP
    SELECT coalesce(
      (
        SELECT declaration.confirmed_by
        FROM public.field_declarations AS declaration
        WHERE declaration.report_id = v_report.id
          AND declaration.confirmed_by IS NOT NULL
        ORDER BY declaration.confirmed_at DESC NULLS LAST
        LIMIT 1
      ),
      (
        SELECT declaration.rejected_by
        FROM public.field_declarations AS declaration
        WHERE declaration.report_id = v_report.id
          AND declaration.rejected_by IS NOT NULL
        ORDER BY declaration.rejected_at DESC NULLS LAST
        LIMIT 1
      )
    )
    INTO v_reviewer_id;

    PERFORM public.internal_review_field_report_if_complete(v_report.id, v_reviewer_id);
  END LOOP;
END;
$reconcile_completed_reports$;

REVOKE ALL ON FUNCTION public.confirm_field_declaration(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_field_declaration(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_field_declaration(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_field_declaration(uuid, text) TO authenticated;
