-- HALAL Field: an unfinished report is never deleted. Its creator may cancel a
-- draft only when no declaration has been submitted or financially confirmed.

CREATE OR REPLACE FUNCTION public.cancel_field_report(p_report_id uuid)
RETURNS public.field_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $cancel_field_report$
DECLARE
  v_before public.field_reports;
  v_report public.field_reports;
  v_declaration_before public.field_declarations;
  v_declaration public.field_declarations;
BEGIN
  PERFORM public.permission_require('field.reports.create');

  SELECT *
  INTO v_before
  FROM public.field_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND OR v_before.created_by <> auth.uid() THEN
    RAISE EXCEPTION 'Rapport terrain introuvable ou non annulable.' USING ERRCODE = '42501';
  END IF;

  IF v_before.status = 'CANCELLED' THEN
    RETURN v_before;
  END IF;

  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seul un rapport brouillon peut être abandonné.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.field_declarations
    WHERE report_id = p_report_id
      AND status <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Ce rapport contient déjà une déclaration soumise ou confirmée et ne peut pas être abandonné.' USING ERRCODE = '22023';
  END IF;

  FOR v_declaration_before IN
    SELECT *
    FROM public.field_declarations
    WHERE report_id = p_report_id
      AND status = 'DRAFT'
    FOR UPDATE
  LOOP
    UPDATE public.field_declarations
    SET status = 'CANCELLED', updated_at = now()
    WHERE id = v_declaration_before.id
    RETURNING * INTO v_declaration;

    PERFORM public.business_finance_audit_event(
      'FIELD_DECLARATION',
      v_declaration.id,
      NULL,
      'UPDATE',
      to_jsonb(v_declaration_before),
      to_jsonb(v_declaration)
    );
  END LOOP;

  UPDATE public.field_reports
  SET status = 'CANCELLED', updated_at = now()
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
$cancel_field_report$;

REVOKE ALL ON FUNCTION public.cancel_field_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_field_report(uuid) TO authenticated;
