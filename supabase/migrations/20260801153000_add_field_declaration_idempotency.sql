-- MF-02 — retry-safe synchronization of HALAL Field offline drafts.
-- A client-generated UUID makes a browser retry idempotent without allowing
-- offline devices to write finance_operations directly.

ALTER TABLE public.field_declarations
  ADD COLUMN IF NOT EXISTS client_submission_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS field_declarations_creator_client_submission_uidx
  ON public.field_declarations(created_by, client_submission_id)
  WHERE client_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_field_declaration(p_report_id uuid, p_declaration jsonb)
RETURNS public.field_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $create_field_declaration$
DECLARE
  v_report public.field_reports;
  v_declaration public.field_declarations;
  v_type text := upper(NULLIF(btrim(p_declaration ->> 'declaration_type'), ''));
  v_amount numeric := NULLIF(p_declaration ->> 'amount', '')::numeric;
  v_wallet_id uuid := NULLIF(p_declaration ->> 'field_wallet_id', '')::uuid;
  v_destination_wallet_id uuid := NULLIF(p_declaration ->> 'destination_wallet_id', '')::uuid;
  v_category text := NULLIF(btrim(p_declaration ->> 'category'), '');
  v_client_submission_id uuid := NULLIF(p_declaration ->> 'client_submission_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('field.reports.create');

  -- A timed-out mobile request can be safely repeated. The first accepted
  -- declaration wins and its original metadata remains the audit record.
  IF v_client_submission_id IS NOT NULL THEN
    SELECT * INTO v_declaration
    FROM public.field_declarations
    WHERE created_by = auth.uid()
      AND client_submission_id = v_client_submission_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_declaration.report_id <> p_report_id THEN
        RAISE EXCEPTION 'Cette déclaration hors connexion appartient à un autre rapport.' USING ERRCODE = '22023';
      END IF;
      RETURN v_declaration;
    END IF;
  END IF;

  SELECT * INTO v_report FROM public.field_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.created_by <> auth.uid() OR v_report.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Rapport terrain introuvable ou non modifiable.' USING ERRCODE = '42501';
  END IF;
  IF v_type NOT IN ('RECEIPT', 'EXPENSE', 'REMITTANCE') OR v_amount IS NULL OR v_amount <= 0 OR v_wallet_id IS NULL OR v_category IS NULL THEN
    RAISE EXCEPTION 'Déclaration terrain incomplète ou invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.field_wallet_assignments
    WHERE user_id = auth.uid() AND wallet_id = v_wallet_id AND assignment_type = 'SOURCE' AND is_active
  ) THEN
    RAISE EXCEPTION 'Ce wallet terrain ne vous est pas affecté.' USING ERRCODE = '42501';
  END IF;
  IF (v_type = 'REMITTANCE' AND (v_destination_wallet_id IS NULL OR v_destination_wallet_id = v_wallet_id))
    OR (v_type <> 'REMITTANCE' AND v_destination_wallet_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Configuration de wallet invalide pour cette déclaration.' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'REMITTANCE' AND NOT EXISTS (
    SELECT 1 FROM public.field_wallet_assignments
    WHERE user_id = auth.uid() AND wallet_id = v_destination_wallet_id AND assignment_type = 'DESTINATION' AND is_active
  ) THEN
    RAISE EXCEPTION 'Ce wallet d’entreprise ne vous est pas proposé pour les versements.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.field_declarations(
    report_id, declaration_type, amount, occurred_at, field_wallet_id, destination_wallet_id,
    category, description, reference, client_id, farm_id, inventory_item_id, document_id,
    client_submission_id, created_by
  ) VALUES (
    p_report_id, v_type, v_amount, coalesce(NULLIF(p_declaration ->> 'occurred_at', '')::timestamptz, now()),
    v_wallet_id, v_destination_wallet_id, v_category,
    NULLIF(btrim(p_declaration ->> 'description'), ''), NULLIF(btrim(p_declaration ->> 'reference'), ''),
    NULLIF(p_declaration ->> 'client_id', '')::uuid, NULLIF(p_declaration ->> 'farm_id', '')::uuid,
    NULLIF(p_declaration ->> 'inventory_item_id', '')::uuid, NULLIF(p_declaration ->> 'document_id', '')::uuid,
    v_client_submission_id, auth.uid()
  )
  RETURNING * INTO v_declaration;

  PERFORM public.business_finance_audit_event('FIELD_DECLARATION', v_declaration.id, NULL, 'CREATE', NULL, to_jsonb(v_declaration));
  RETURN v_declaration;
END;
$create_field_declaration$;
