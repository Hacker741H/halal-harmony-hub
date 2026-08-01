-- MF-01 — HALAL Field.
-- Field agents submit declarations; only an authorised finance reviewer confirms
-- them into the existing finance_operations journal. No wallet balance is ever
-- updated directly by an agent.

CREATE TABLE IF NOT EXISTS public.field_wallet_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  assignment_type text NOT NULL DEFAULT 'SOURCE' CHECK (assignment_type IN ('SOURCE', 'DESTINATION')),
  label text,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_wallet_assignments_user_wallet_key UNIQUE (user_id, wallet_id),
  CONSTRAINT field_wallet_assignments_revoked_check CHECK (
    (is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS field_wallet_assignments_active_user_idx
  ON public.field_wallet_assignments(user_id, wallet_id)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS public.field_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number text NOT NULL UNIQUE,
  report_type text NOT NULL CHECK (report_type IN ('DAILY', 'WEEKLY')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'REJECTED', 'CANCELLED')),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_reports_period_check CHECK (period_end >= period_start),
  CONSTRAINT field_reports_daily_period_check CHECK (report_type <> 'DAILY' OR period_end = period_start),
  CONSTRAINT field_reports_weekly_period_check CHECK (report_type <> 'WEEKLY' OR period_end <= period_start + 6)
);

CREATE INDEX IF NOT EXISTS field_reports_creator_period_idx
  ON public.field_reports(created_by, period_end DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS field_reports_review_worklist_idx
  ON public.field_reports(status, submitted_at ASC)
  WHERE status = 'SUBMITTED';

CREATE TABLE IF NOT EXISTS public.field_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.field_reports(id) ON DELETE RESTRICT,
  declaration_type text NOT NULL CHECK (declaration_type IN ('RECEIPT', 'EXPENSE', 'REMITTANCE')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'CANCELLED')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  field_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  destination_wallet_id uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  category text NOT NULL,
  description text,
  reference text,
  client_id uuid REFERENCES public.transport_clients(id) ON DELETE SET NULL,
  farm_id uuid REFERENCES public.farms(id) ON DELETE SET NULL,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_declarations_wallet_flow_check CHECK (
    (declaration_type = 'REMITTANCE' AND destination_wallet_id IS NOT NULL AND destination_wallet_id <> field_wallet_id)
    OR (declaration_type IN ('RECEIPT', 'EXPENSE') AND destination_wallet_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS field_declarations_report_idx
  ON public.field_declarations(report_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS field_declarations_confirmation_worklist_idx
  ON public.field_declarations(status, occurred_at ASC)
  WHERE status = 'SUBMITTED';
CREATE INDEX IF NOT EXISTS field_declarations_wallet_idx
  ON public.field_declarations(field_wallet_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.finance_field_declaration_links (
  operation_id uuid NOT NULL UNIQUE REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  declaration_id uuid NOT NULL UNIQUE REFERENCES public.field_declarations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, declaration_id)
);

CREATE INDEX IF NOT EXISTS finance_field_declaration_links_declaration_idx
  ON public.finance_field_declaration_links(declaration_id);

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('field.reports.read', 'field', 'reports_read', 'Consulter les rapports terrain autorisés.', 'SENSITIVE'),
  ('field.reports.create', 'field', 'reports_create', 'Créer ses rapports et déclarations terrain.', 'SENSITIVE'),
  ('field.reports.submit', 'field', 'reports_submit', 'Soumettre ses déclarations terrain au contrôle.', 'SENSITIVE'),
  ('field.reports.review', 'field', 'reports_review', 'Examiner et refuser les déclarations terrain.', 'SENSITIVE'),
  ('field.reports.confirm', 'field', 'reports_confirm', 'Confirmer les déclarations terrain dans le journal financier.', 'CRITICAL'),
  ('field.wallets.read', 'field', 'wallets_read', 'Consulter ses wallets terrain affectés.', 'SENSITIVE'),
  ('field.wallets.assign', 'field', 'wallets_assign', 'Affecter ou révoquer un wallet terrain.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('super_admin', 'field.reports.read'), ('super_admin', 'field.reports.create'), ('super_admin', 'field.reports.submit'), ('super_admin', 'field.reports.review'), ('super_admin', 'field.reports.confirm'), ('super_admin', 'field.wallets.read'), ('super_admin', 'field.wallets.assign'),
  ('admin', 'field.reports.read'), ('admin', 'field.reports.create'), ('admin', 'field.reports.submit'), ('admin', 'field.reports.review'), ('admin', 'field.reports.confirm'), ('admin', 'field.wallets.read'), ('admin', 'field.wallets.assign'),
  ('comptable', 'field.reports.read'), ('comptable', 'field.reports.review'), ('comptable', 'field.reports.confirm'), ('comptable', 'field.wallets.read'), ('comptable', 'field.wallets.assign'),
  ('operations', 'field.reports.read'), ('operations', 'field.reports.create'), ('operations', 'field.reports.submit'), ('operations', 'field.wallets.read'),
  ('exploitations', 'field.reports.read'), ('exploitations', 'field.reports.create'), ('exploitations', 'field.reports.submit'), ('exploitations', 'field.wallets.read'),
  ('stocks', 'field.reports.read'), ('stocks', 'field.reports.create'), ('stocks', 'field.reports.submit'), ('stocks', 'field.wallets.read'),
  ('gestionnaire', 'field.reports.read'), ('gestionnaire', 'field.reports.create'), ('gestionnaire', 'field.reports.submit'), ('gestionnaire', 'field.reports.review'), ('gestionnaire', 'field.wallets.read'),
  ('chauffeur', 'field.reports.read'), ('chauffeur', 'field.reports.create'), ('chauffeur', 'field.reports.submit'), ('chauffeur', 'field.wallets.read'),
  ('employe', 'field.reports.read'), ('employe', 'field.reports.create'), ('employe', 'field.reports.submit'), ('employe', 'field.wallets.read')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

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

  INSERT INTO public.field_wallet_assignments(user_id, wallet_id, assignment_type, label, is_active, assigned_by, revoked_at)
  VALUES (v_user_id, v_wallet_id, v_assignment_type, v_label, true, auth.uid(), NULL)
  ON CONFLICT (user_id, wallet_id) DO UPDATE
  SET assignment_type = EXCLUDED.assignment_type,
      label = EXCLUDED.label,
      is_active = true,
      assigned_by = auth.uid(),
      assigned_at = now(),
      revoked_at = NULL,
      updated_at = now()
  RETURNING * INTO v_assignment;

  PERFORM public.business_finance_audit_event('FIELD_WALLET_ASSIGNMENT', v_assignment.id, NULL, 'UPDATE', NULL, to_jsonb(v_assignment));
  RETURN v_assignment;
END;
$assign_field_wallet$;

CREATE OR REPLACE FUNCTION public.create_field_report(p_report jsonb)
RETURNS public.field_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $create_field_report$
DECLARE
  v_report public.field_reports;
  v_type text := upper(coalesce(NULLIF(btrim(p_report ->> 'report_type'), ''), 'DAILY'));
  v_start date := coalesce(NULLIF(p_report ->> 'period_start', '')::date, current_date);
  v_end date := coalesce(NULLIF(p_report ->> 'period_end', '')::date, current_date);
BEGIN
  PERFORM public.permission_require('field.reports.create');
  IF v_type NOT IN ('DAILY', 'WEEKLY') THEN
    RAISE EXCEPTION 'Type de rapport terrain invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_end < v_start OR (v_type = 'DAILY' AND v_end <> v_start) OR (v_type = 'WEEKLY' AND v_end > v_start + 6) THEN
    RAISE EXCEPTION 'Période de rapport terrain invalide.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.field_reports(report_number, report_type, period_start, period_end, notes, created_by)
  VALUES (
    'FIELD-' || to_char(v_start, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    v_type, v_start, v_end, NULLIF(btrim(p_report ->> 'notes'), ''), auth.uid()
  )
  RETURNING * INTO v_report;

  PERFORM public.business_finance_audit_event('FIELD_REPORT', v_report.id, NULL, 'CREATE', NULL, to_jsonb(v_report));
  RETURN v_report;
END;
$create_field_report$;

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
BEGIN
  PERFORM public.permission_require('field.reports.create');
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
    category, description, reference, client_id, farm_id, inventory_item_id, document_id, created_by
  ) VALUES (
    p_report_id, v_type, v_amount, coalesce(NULLIF(p_declaration ->> 'occurred_at', '')::timestamptz, now()),
    v_wallet_id, v_destination_wallet_id, v_category,
    NULLIF(btrim(p_declaration ->> 'description'), ''), NULLIF(btrim(p_declaration ->> 'reference'), ''),
    NULLIF(p_declaration ->> 'client_id', '')::uuid, NULLIF(p_declaration ->> 'farm_id', '')::uuid,
    NULLIF(p_declaration ->> 'inventory_item_id', '')::uuid, NULLIF(p_declaration ->> 'document_id', '')::uuid, auth.uid()
  )
  RETURNING * INTO v_declaration;

  PERFORM public.business_finance_audit_event('FIELD_DECLARATION', v_declaration.id, NULL, 'CREATE', NULL, to_jsonb(v_declaration));
  RETURN v_declaration;
END;
$create_field_declaration$;

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
  SELECT * INTO v_before FROM public.field_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_before.created_by <> auth.uid() THEN
    RAISE EXCEPTION 'Rapport terrain introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'SUBMITTED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seul un rapport brouillon peut être envoyé.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.field_declarations WHERE report_id = p_report_id AND status = 'DRAFT') THEN
    RAISE EXCEPTION 'Ajoutez au moins une déclaration avant l’envoi.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.field_declarations
  SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
  WHERE report_id = p_report_id AND status = 'DRAFT';
  UPDATE public.field_reports
  SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  PERFORM public.business_finance_audit_event('FIELD_REPORT', v_report.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_report));
  RETURN v_report;
END;
$submit_field_report$;

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
  SELECT * INTO v_before FROM public.field_declarations WHERE id = p_declaration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Déclaration terrain introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
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
    SELECT 1 FROM public.field_wallet_assignments
    WHERE user_id = v_before.created_by AND wallet_id = v_before.field_wallet_id AND assignment_type = 'SOURCE' AND is_active
  ) THEN
    RAISE EXCEPTION 'Le wallet terrain de l’agent n’est plus affecté.' USING ERRCODE = '22023';
  END IF;
  IF v_before.declaration_type = 'REMITTANCE' AND NOT EXISTS (
    SELECT 1 FROM public.field_wallet_assignments
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
    'FIELD_DECLARATION', v_before.id
  );

  INSERT INTO public.finance_field_declaration_links(operation_id, declaration_id)
  VALUES (v_operation.id, v_before.id)
  ON CONFLICT (declaration_id) DO NOTHING;

  UPDATE public.field_declarations
  SET status = 'CONFIRMED', confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now()
  WHERE id = p_declaration_id
  RETURNING * INTO v_declaration;

  PERFORM public.business_finance_audit_event('FIELD_DECLARATION', v_declaration.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_declaration));
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
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif de refus est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.field_declarations WHERE id = p_declaration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Déclaration terrain introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Seule une déclaration envoyée peut être refusée.' USING ERRCODE = '22023';
  END IF;
  IF v_before.created_by = auth.uid() THEN
    RAISE EXCEPTION 'Une déclaration ne peut pas être refusée par son auteur.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.field_declarations
  SET status = 'REJECTED', rejected_at = now(), rejected_by = auth.uid(), rejection_reason = v_reason, updated_at = now()
  WHERE id = p_declaration_id
  RETURNING * INTO v_declaration;
  PERFORM public.business_finance_audit_event('FIELD_DECLARATION', v_declaration.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_declaration));
  RETURN v_declaration;
END;
$reject_field_declaration$;

ALTER TABLE public.field_wallet_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_field_declaration_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.field_wallet_assignments, public.field_reports, public.field_declarations, public.finance_field_declaration_links FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.field_wallet_assignments, public.field_reports, public.field_declarations, public.finance_field_declaration_links FROM authenticated;
GRANT SELECT ON TABLE public.field_wallet_assignments, public.field_reports, public.field_declarations, public.finance_field_declaration_links TO authenticated;

CREATE POLICY field_wallet_assignments_read ON public.field_wallet_assignments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.user_has_any_permission(ARRAY['field.reports.review', 'field.reports.confirm', 'field.wallets.assign']::text[]));
CREATE POLICY field_reports_read ON public.field_reports
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.user_has_any_permission(ARRAY['field.reports.review', 'field.reports.confirm']::text[]));
CREATE POLICY field_declarations_read ON public.field_declarations
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.user_has_any_permission(ARRAY['field.reports.review', 'field.reports.confirm']::text[]));
CREATE POLICY finance_field_declaration_links_read ON public.finance_field_declaration_links
  FOR SELECT TO authenticated
  USING (public.user_has_any_permission(ARRAY['field.reports.confirm', 'finance.read']::text[]));

REVOKE ALL ON FUNCTION public.assign_field_wallet(jsonb), public.create_field_report(jsonb), public.create_field_declaration(uuid, jsonb), public.submit_field_report(uuid), public.confirm_field_declaration(uuid), public.reject_field_declaration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_field_wallet(jsonb), public.create_field_report(jsonb), public.create_field_declaration(uuid, jsonb), public.submit_field_report(uuid), public.confirm_field_declaration(uuid), public.reject_field_declaration(uuid, text) TO authenticated;
