-- Keep immediate receipts within the existing business_finance_audit action vocabulary.
-- The after-state explicitly records that this update was an immediate confirmation.

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
    'UPDATE',
    NULL,
    jsonb_build_object('immediate_receipt', true, 'declaration', to_jsonb(v_declaration))
  );

  RETURN v_declaration;
END;
$create_immediate_field_receipt$;
