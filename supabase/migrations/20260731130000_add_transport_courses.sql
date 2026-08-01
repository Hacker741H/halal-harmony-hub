-- MT-03: Courses are the transport operating entity.  This migration is
-- additive: finance_operations remains the only financial journal.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SEQUENCE IF NOT EXISTS public.transport_mission_number_sequence AS bigint START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.transport_invoice_number_sequence AS bigint START WITH 1;

CREATE TABLE IF NOT EXISTS public.transport_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'DRAFT',
  client_id uuid NOT NULL REFERENCES public.transport_clients(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE RESTRICT,
  departure_location text,
  destination_location text,
  cargo_description text,
  cargo_quantity numeric(14,3),
  cargo_unit text,
  cargo_weight_kg numeric(14,3),
  cargo_volume_m3 numeric(14,3),
  distance_km numeric(14,3),
  planned_departure_at timestamptz,
  planned_arrival_at timestamptz,
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  start_odometer numeric(14,3),
  end_odometer numeric(14,3),
  quoted_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'XOF',
  reference text,
  notes text,
  overlap_exception_reason text,
  close_exception_reason text,
  cancellation_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT transport_missions_status_check CHECK (status IN ('DRAFT','PLANNED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED')),
  CONSTRAINT transport_missions_currency_check CHECK (currency_code = 'XOF'),
  CONSTRAINT transport_missions_quoted_amount_check CHECK (quoted_amount >= 0),
  CONSTRAINT transport_missions_distance_check CHECK (distance_km IS NULL OR distance_km >= 0),
  CONSTRAINT transport_missions_odometer_check CHECK (
    (start_odometer IS NULL AND end_odometer IS NULL) OR
    (start_odometer IS NOT NULL AND end_odometer IS NOT NULL AND end_odometer >= start_odometer)
  ),
  CONSTRAINT transport_missions_planned_dates_check CHECK (
    planned_arrival_at IS NULL OR planned_departure_at IS NULL OR planned_arrival_at > planned_departure_at
  ),
  CONSTRAINT transport_missions_active_schedule_check CHECK (
    status NOT IN ('PLANNED','IN_PROGRESS') OR (planned_departure_at IS NOT NULL AND planned_arrival_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.transport_mission_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.transport_missions(id) ON DELETE RESTRICT,
  category text NOT NULL,
  planned_amount numeric(14,2) NOT NULL CHECK (planned_amount >= 0),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transport_mission_budget_lines_category_check CHECK (category IN ('FUEL','ROAD','MEALS','MISC','EXCEPTIONAL_MAINTENANCE')),
  CONSTRAINT transport_mission_budget_lines_unique UNIQUE (mission_id, category)
);

CREATE TABLE IF NOT EXISTS public.transport_mission_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.transport_missions(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  category text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'PLANNED',
  description text,
  receipt_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT transport_mission_expenses_category_check CHECK (category IN ('FUEL','ROAD','MEALS','MISC','EXCEPTIONAL_MAINTENANCE')),
  CONSTRAINT transport_mission_expenses_status_check CHECK (status IN ('PLANNED','ENGAGED','PAID','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS public.transport_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  mission_id uuid NOT NULL REFERENCES public.transport_missions(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.transport_clients(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT',
  issue_date date,
  due_date date,
  subtotal_amount numeric(14,2) NOT NULL CHECK (subtotal_amount >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  notes text,
  cancelled_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT transport_invoices_status_check CHECK (status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','CANCELLED')),
  CONSTRAINT transport_invoices_total_check CHECK (total_amount = round(subtotal_amount + tax_amount, 2))
);

CREATE UNIQUE INDEX IF NOT EXISTS transport_invoices_one_active_per_mission_idx
  ON public.transport_invoices(mission_id) WHERE status <> 'CANCELLED';

CREATE TABLE IF NOT EXISTS public.transport_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.transport_invoices(id) ON DELETE RESTRICT,
  mission_id uuid NOT NULL REFERENCES public.transport_missions(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'PLANNED',
  payment_kind text NOT NULL DEFAULT 'PAYMENT',
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT transport_invoice_payments_status_check CHECK (status IN ('PLANNED','RECEIVED','CONFIRMED','CANCELLED')),
  CONSTRAINT transport_invoice_payments_kind_check CHECK (payment_kind IN ('ADVANCE','PAYMENT','SETTLEMENT'))
);

CREATE TABLE IF NOT EXISTS public.finance_transport_mission_expense_links (
  expense_id uuid NOT NULL REFERENCES public.transport_mission_expenses(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  link_type text NOT NULL DEFAULT 'EXPENSE',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expense_id, operation_id),
  CONSTRAINT finance_transport_mission_expense_links_type_check CHECK (link_type IN ('EXPENSE','REVERSAL')),
  CONSTRAINT finance_transport_mission_expense_links_once_per_type UNIQUE (expense_id, link_type)
);

CREATE TABLE IF NOT EXISTS public.finance_transport_payment_links (
  payment_id uuid NOT NULL REFERENCES public.transport_invoice_payments(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  link_type text NOT NULL DEFAULT 'PAYMENT',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, operation_id),
  CONSTRAINT finance_transport_payment_links_type_check CHECK (link_type IN ('PAYMENT','REVERSAL')),
  CONSTRAINT finance_transport_payment_links_once_per_type UNIQUE (payment_id, link_type)
);

CREATE TABLE IF NOT EXISTS public.document_transport_mission_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  mission_id uuid NOT NULL REFERENCES public.transport_missions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (document_id, mission_id)
);

CREATE INDEX IF NOT EXISTS transport_missions_status_dates_idx ON public.transport_missions(status, planned_departure_at DESC);
CREATE INDEX IF NOT EXISTS transport_missions_client_idx ON public.transport_missions(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transport_missions_vehicle_idx ON public.transport_missions(vehicle_id, planned_departure_at DESC);
CREATE INDEX IF NOT EXISTS transport_missions_driver_idx ON public.transport_missions(driver_id, planned_departure_at DESC);
CREATE INDEX IF NOT EXISTS transport_mission_expenses_mission_idx ON public.transport_mission_expenses(mission_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS transport_invoices_client_idx ON public.transport_invoices(client_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS transport_invoices_mission_idx ON public.transport_invoices(mission_id, status);
CREATE INDEX IF NOT EXISTS transport_invoice_payments_invoice_idx ON public.transport_invoice_payments(invoice_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS document_transport_mission_links_mission_idx ON public.document_transport_mission_links(mission_id, document_id);

ALTER TABLE public.transport_missions DROP CONSTRAINT IF EXISTS transport_missions_vehicle_schedule_no_overlap;
ALTER TABLE public.transport_missions ADD CONSTRAINT transport_missions_vehicle_schedule_no_overlap
  EXCLUDE USING gist (vehicle_id WITH =, tstzrange(planned_departure_at, planned_arrival_at, '[)') WITH &&)
  WHERE (status IN ('PLANNED','IN_PROGRESS') AND vehicle_id IS NOT NULL AND overlap_exception_reason IS NULL);
ALTER TABLE public.transport_missions DROP CONSTRAINT IF EXISTS transport_missions_driver_schedule_no_overlap;
ALTER TABLE public.transport_missions ADD CONSTRAINT transport_missions_driver_schedule_no_overlap
  EXCLUDE USING gist (driver_id WITH =, tstzrange(planned_departure_at, planned_arrival_at, '[)') WITH &&)
  WHERE (status IN ('PLANNED','IN_PROGRESS') AND driver_id IS NOT NULL AND overlap_exception_reason IS NULL);

ALTER TABLE public.transport_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_mission_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_mission_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transport_mission_expense_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transport_payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_transport_mission_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_missions_read ON public.transport_missions;
CREATE POLICY transport_missions_read ON public.transport_missions FOR SELECT TO authenticated USING (public.user_has_permission('missions.read'));
DROP POLICY IF EXISTS transport_mission_budget_lines_read ON public.transport_mission_budget_lines;
CREATE POLICY transport_mission_budget_lines_read ON public.transport_mission_budget_lines FOR SELECT TO authenticated USING (public.user_has_permission('missions.read'));
DROP POLICY IF EXISTS transport_mission_expenses_read ON public.transport_mission_expenses;
CREATE POLICY transport_mission_expenses_read ON public.transport_mission_expenses FOR SELECT TO authenticated USING (public.user_has_permission('missions.read') AND public.user_has_permission('missions.finance.read'));
DROP POLICY IF EXISTS transport_invoices_read ON public.transport_invoices;
CREATE POLICY transport_invoices_read ON public.transport_invoices FOR SELECT TO authenticated USING (public.user_has_permission('missions.read') AND public.user_has_permission('missions.finance.read'));
DROP POLICY IF EXISTS transport_invoice_payments_read ON public.transport_invoice_payments;
CREATE POLICY transport_invoice_payments_read ON public.transport_invoice_payments FOR SELECT TO authenticated USING (public.user_has_permission('missions.read') AND public.user_has_permission('missions.finance.read'));
DROP POLICY IF EXISTS finance_transport_mission_expense_links_read ON public.finance_transport_mission_expense_links;
CREATE POLICY finance_transport_mission_expense_links_read ON public.finance_transport_mission_expense_links FOR SELECT TO authenticated USING (public.user_has_permission('missions.finance.read'));
DROP POLICY IF EXISTS finance_transport_payment_links_read ON public.finance_transport_payment_links;
CREATE POLICY finance_transport_payment_links_read ON public.finance_transport_payment_links FOR SELECT TO authenticated USING (public.user_has_permission('missions.finance.read'));
DROP POLICY IF EXISTS document_transport_mission_links_read ON public.document_transport_mission_links;
CREATE POLICY document_transport_mission_links_read ON public.document_transport_mission_links FOR SELECT TO authenticated USING (public.user_has_permission('missions.read') AND public.user_has_permission('documents.read'));

GRANT SELECT ON public.transport_missions, public.transport_mission_budget_lines, public.transport_mission_expenses,
  public.transport_invoices, public.transport_invoice_payments, public.finance_transport_mission_expense_links,
  public.finance_transport_payment_links, public.document_transport_mission_links TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('missions.read','missions','read','Consulter les Courses de transport autorisées.','SENSITIVE'),
  ('missions.create','missions','create','Créer une Course en brouillon.','SENSITIVE'),
  ('missions.update','missions','update','Modifier une Course non clôturée.','SENSITIVE'),
  ('missions.dispatch','missions','dispatch','Planifier une Course et affecter véhicule et chauffeur.','SENSITIVE'),
  ('missions.expenses.manage','missions','expenses_manage','Saisir et modifier les dépenses non validées d’une Course.','SENSITIVE'),
  ('missions.expenses.confirm','missions','expenses_confirm','Valider une dépense de Course et sa contre-écriture.','CRITICAL'),
  ('missions.invoice','missions','invoice','Créer et émettre les factures de Course.','CRITICAL'),
  ('missions.payments','missions','payments','Saisir et confirmer les paiements Client.','CRITICAL'),
  ('missions.close','missions','close','Clôturer une Course équilibrée.','CRITICAL'),
  ('missions.override','missions','override','Déroger de manière auditée aux règles de chevauchement ou clôture.','CRITICAL'),
  ('missions.cancel','missions','cancel','Annuler une Course sans effacer l’historique.','CRITICAL'),
  ('missions.finance.read','missions','finance_read','Consulter les montants et la rentabilité des Courses.','CRITICAL')
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description, sensitivity = EXCLUDED.sensitivity, updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('admin','missions.read'),('admin','missions.create'),('admin','missions.update'),('admin','missions.dispatch'),('admin','missions.expenses.manage'),('admin','missions.expenses.confirm'),('admin','missions.invoice'),('admin','missions.payments'),('admin','missions.close'),('admin','missions.override'),('admin','missions.cancel'),('admin','missions.finance.read'),
  ('comptable','missions.read'),('comptable','missions.expenses.confirm'),('comptable','missions.invoice'),('comptable','missions.payments'),('comptable','missions.finance.read'),
  ('operations','missions.read'),('operations','missions.create'),('operations','missions.update'),('operations','missions.dispatch'),('operations','missions.expenses.manage'),
  ('gestionnaire','missions.read'),('gestionnaire','missions.create'),('gestionnaire','missions.update'),('gestionnaire','missions.dispatch'),('gestionnaire','missions.expenses.manage'),
  ('lecture_seule','missions.read')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public._internal_next_transport_mission_number()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT format('CRS-%s-%s', to_char(current_date, 'YYYY'), lpad(nextval('public.transport_mission_number_sequence')::text, 6, '0'));
$$;
CREATE OR REPLACE FUNCTION public._internal_next_transport_invoice_number()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT format('FAC-%s-%s', to_char(current_date, 'YYYY'), lpad(nextval('public.transport_invoice_number_sequence')::text, 6, '0'));
$$;

CREATE OR REPLACE FUNCTION public._internal_course_upsert_finance(
  p_wallet_id uuid, p_type text, p_amount numeric, p_date date, p_category text,
  p_description text, p_mission public.transport_missions, p_reference text
) RETURNS public.finance_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_operation public.finance_operations;
BEGIN
  IF p_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_wallet_id) THEN RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = '23503'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_type NOT IN ('REVENUE','EXPENSE') THEN RAISE EXCEPTION 'Écriture financière de Course invalide.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.finance_operations(wallet_id, type, amount, operation_date, category, description, origin, module, module_id, vehicle_id, driver_id, reference, status, created_by)
  VALUES (p_wallet_id, p_type, p_amount, p_date, p_category, p_description, 'TRANSPORT_COURSE', 'COURSE', p_mission.id, p_mission.vehicle_id, p_mission.driver_id, p_reference, 'VALIDE', auth.uid())
  RETURNING * INTO v_operation;
  PERFORM public.update_wallet_balance(p_wallet_id);
  RETURN v_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transport_mission(p_mission jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_mission public.transport_missions;
BEGIN
  PERFORM public.permission_require('missions.create');
  IF NULLIF(btrim(p_mission ->> 'client_id'), '') IS NULL OR NOT EXISTS (SELECT 1 FROM public.transport_clients WHERE id = (p_mission ->> 'client_id')::uuid AND status = 'ACTIVE') THEN RAISE EXCEPTION 'Un client actif est obligatoire.' USING ERRCODE = '23503'; END IF;
  INSERT INTO public.transport_missions(mission_number, client_id, departure_location, destination_location, cargo_description, cargo_quantity, cargo_unit, cargo_weight_kg, cargo_volume_m3, distance_km, planned_departure_at, planned_arrival_at, quoted_amount, reference, notes, created_by, updated_by)
  VALUES (public._internal_next_transport_mission_number(), (p_mission ->> 'client_id')::uuid, NULLIF(btrim(p_mission ->> 'departure_location'), ''), NULLIF(btrim(p_mission ->> 'destination_location'), ''), NULLIF(btrim(p_mission ->> 'cargo_description'), ''), NULLIF(p_mission ->> 'cargo_quantity','')::numeric, NULLIF(btrim(p_mission ->> 'cargo_unit'), ''), NULLIF(p_mission ->> 'cargo_weight_kg','')::numeric, NULLIF(p_mission ->> 'cargo_volume_m3','')::numeric, NULLIF(p_mission ->> 'distance_km','')::numeric, NULLIF(p_mission ->> 'planned_departure_at','')::timestamptz, NULLIF(p_mission ->> 'planned_arrival_at','')::timestamptz, COALESCE(NULLIF(p_mission ->> 'quoted_amount','')::numeric,0), NULLIF(btrim(p_mission ->> 'reference'), ''), NULLIF(btrim(p_mission ->> 'notes'), ''), auth.uid(), auth.uid()) RETURNING * INTO v_mission;
  PERFORM public.business_finance_audit_event('COURSE', v_mission.id, NULL, 'CREATE', NULL, to_jsonb(v_mission));
  RETURN v_mission;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_transport_mission(p_mission_id uuid, p_values jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_missions; v_mission public.transport_missions;
BEGIN
  PERFORM public.permission_require('missions.update');
  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Une Course clôturée ou archivée ne peut plus être modifiée.' USING ERRCODE = '22023'; END IF;
  UPDATE public.transport_missions SET
    client_id = COALESCE(NULLIF(p_values ->> 'client_id','')::uuid, client_id),
    vehicle_id = CASE WHEN p_values ? 'vehicle_id' THEN NULLIF(p_values ->> 'vehicle_id','')::uuid ELSE vehicle_id END,
    driver_id = CASE WHEN p_values ? 'driver_id' THEN NULLIF(p_values ->> 'driver_id','')::uuid ELSE driver_id END,
    departure_location = CASE WHEN p_values ? 'departure_location' THEN NULLIF(btrim(p_values ->> 'departure_location'),'') ELSE departure_location END,
    destination_location = CASE WHEN p_values ? 'destination_location' THEN NULLIF(btrim(p_values ->> 'destination_location'),'') ELSE destination_location END,
    cargo_description = CASE WHEN p_values ? 'cargo_description' THEN NULLIF(btrim(p_values ->> 'cargo_description'),'') ELSE cargo_description END,
    cargo_quantity = CASE WHEN p_values ? 'cargo_quantity' THEN NULLIF(p_values ->> 'cargo_quantity','')::numeric ELSE cargo_quantity END,
    cargo_unit = CASE WHEN p_values ? 'cargo_unit' THEN NULLIF(btrim(p_values ->> 'cargo_unit'),'') ELSE cargo_unit END,
    cargo_weight_kg = CASE WHEN p_values ? 'cargo_weight_kg' THEN NULLIF(p_values ->> 'cargo_weight_kg','')::numeric ELSE cargo_weight_kg END,
    cargo_volume_m3 = CASE WHEN p_values ? 'cargo_volume_m3' THEN NULLIF(p_values ->> 'cargo_volume_m3','')::numeric ELSE cargo_volume_m3 END,
    distance_km = CASE WHEN p_values ? 'distance_km' THEN NULLIF(p_values ->> 'distance_km','')::numeric ELSE distance_km END,
    planned_departure_at = CASE WHEN p_values ? 'planned_departure_at' THEN NULLIF(p_values ->> 'planned_departure_at','')::timestamptz ELSE planned_departure_at END,
    planned_arrival_at = CASE WHEN p_values ? 'planned_arrival_at' THEN NULLIF(p_values ->> 'planned_arrival_at','')::timestamptz ELSE planned_arrival_at END,
    actual_departure_at = CASE WHEN p_values ? 'actual_departure_at' THEN NULLIF(p_values ->> 'actual_departure_at','')::timestamptz ELSE actual_departure_at END,
    actual_arrival_at = CASE WHEN p_values ? 'actual_arrival_at' THEN NULLIF(p_values ->> 'actual_arrival_at','')::timestamptz ELSE actual_arrival_at END,
    start_odometer = CASE WHEN p_values ? 'start_odometer' THEN NULLIF(p_values ->> 'start_odometer','')::numeric ELSE start_odometer END,
    end_odometer = CASE WHEN p_values ? 'end_odometer' THEN NULLIF(p_values ->> 'end_odometer','')::numeric ELSE end_odometer END,
    quoted_amount = CASE WHEN p_values ? 'quoted_amount' THEN COALESCE(NULLIF(p_values ->> 'quoted_amount','')::numeric,0) ELSE quoted_amount END,
    reference = CASE WHEN p_values ? 'reference' THEN NULLIF(btrim(p_values ->> 'reference'),'') ELSE reference END,
    notes = CASE WHEN p_values ? 'notes' THEN NULLIF(btrim(p_values ->> 'notes'),'') ELSE notes END,
    overlap_exception_reason = CASE WHEN p_values ? 'overlap_exception_reason' THEN NULLIF(btrim(p_values ->> 'overlap_exception_reason'),'') ELSE overlap_exception_reason END,
    updated_by = auth.uid(), updated_at = now()
  WHERE id = p_mission_id RETURNING * INTO v_mission;
  IF v_mission.overlap_exception_reason IS NOT NULL THEN PERFORM public.permission_require('missions.override'); END IF;
  PERFORM public.business_finance_audit_event('COURSE', v_mission.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_mission));
  RETURN v_mission;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_transport_mission_status(p_mission_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS public.transport_missions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_missions; v_mission public.transport_missions;
BEGIN
  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF p_status = 'PLANNED' OR p_status = 'IN_PROGRESS' THEN PERFORM public.permission_require('missions.dispatch');
  ELSIF p_status = 'CLOSED' THEN PERFORM public.permission_require('missions.close');
  ELSIF p_status = 'CANCELLED' THEN PERFORM public.permission_require('missions.cancel');
  ELSE PERFORM public.permission_require('missions.update'); END IF;
  IF p_status NOT IN ('DRAFT','PLANNED','IN_PROGRESS','COMPLETED','CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Statut de Course invalide.' USING ERRCODE = '22023'; END IF;
  IF p_status <> v_before.status
    AND NOT (
      (v_before.status = 'DRAFT' AND p_status IN ('PLANNED','CANCELLED'))
      OR (v_before.status = 'PLANNED' AND p_status IN ('IN_PROGRESS','CANCELLED'))
      OR (v_before.status = 'IN_PROGRESS' AND p_status IN ('COMPLETED','CANCELLED'))
      OR (v_before.status = 'COMPLETED' AND p_status IN ('CLOSED','CANCELLED'))
    )
    AND NOT public.user_has_permission('missions.override') THEN
    RAISE EXCEPTION 'Transition de statut de Course non autorisée.' USING ERRCODE='22023';
  END IF;
  IF p_status = 'CLOSED' AND NOT public.user_has_permission('missions.override') THEN
    IF EXISTS (SELECT 1 FROM public.transport_mission_expenses WHERE mission_id=p_mission_id AND status NOT IN ('PAID','CANCELLED')) THEN RAISE EXCEPTION 'Toutes les dépenses doivent être validées ou annulées avant clôture.' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.transport_invoices WHERE mission_id=p_mission_id AND status <> 'CANCELLED') OR EXISTS (SELECT 1 FROM public.transport_invoices WHERE mission_id=p_mission_id AND status NOT IN ('PAID','CANCELLED')) THEN RAISE EXCEPTION 'Toutes les factures actives doivent être émises et intégralement réglées avant clôture.' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.transport_mission_expenses expense LEFT JOIN public.finance_transport_mission_expense_links link ON link.expense_id=expense.id AND link.link_type='EXPENSE' LEFT JOIN public.finance_operations operation ON operation.id=link.operation_id WHERE expense.mission_id=p_mission_id AND expense.status='PAID' AND (link.operation_id IS NULL OR COALESCE(operation.status,'VALIDE') <> 'VALIDE')) OR EXISTS (SELECT 1 FROM public.transport_invoice_payments payment LEFT JOIN public.finance_transport_payment_links link ON link.payment_id=payment.id AND link.link_type='PAYMENT' LEFT JOIN public.finance_operations operation ON operation.id=link.operation_id WHERE payment.mission_id=p_mission_id AND payment.status='CONFIRMED' AND (link.operation_id IS NULL OR COALESCE(operation.status,'VALIDE') <> 'VALIDE')) THEN RAISE EXCEPTION 'Les écritures financières de la Course ne sont pas toutes équilibrées.' USING ERRCODE='22023'; END IF;
  ELSIF p_status = 'CLOSED' AND NULLIF(btrim(p_reason),'') IS NULL AND (EXISTS (SELECT 1 FROM public.transport_mission_expenses WHERE mission_id=p_mission_id AND status NOT IN ('PAID','CANCELLED')) OR NOT EXISTS (SELECT 1 FROM public.transport_invoices WHERE mission_id=p_mission_id AND status <> 'CANCELLED') OR EXISTS (SELECT 1 FROM public.transport_invoices WHERE mission_id=p_mission_id AND status NOT IN ('PAID','CANCELLED'))) THEN RAISE EXCEPTION 'Une dérogation de clôture doit être justifiée.' USING ERRCODE='22023'; END IF;
  UPDATE public.transport_missions SET status=p_status, close_exception_reason=CASE WHEN p_status='CLOSED' AND p_reason IS NOT NULL THEN btrim(p_reason) ELSE close_exception_reason END, cancellation_reason=CASE WHEN p_status='CANCELLED' THEN NULLIF(btrim(p_reason),'') ELSE cancellation_reason END, closed_at=CASE WHEN p_status='CLOSED' THEN now() ELSE closed_at END, cancelled_at=CASE WHEN p_status='CANCELLED' THEN now() ELSE cancelled_at END, updated_by=auth.uid(), updated_at=now() WHERE id=p_mission_id RETURNING * INTO v_mission;
  PERFORM public.business_finance_audit_event('COURSE', v_mission.id, NULL, CASE WHEN p_status='CLOSED' THEN 'CLOSE' WHEN p_status='CANCELLED' THEN 'CANCEL' ELSE 'UPDATE' END, to_jsonb(v_before), to_jsonb(v_mission));
  RETURN v_mission;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transport_mission_budget_line(p_mission_id uuid, p_line jsonb)
RETURNS public.transport_mission_budget_lines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_line public.transport_mission_budget_lines;
BEGIN
  PERFORM public.permission_require('missions.update');
  IF NOT EXISTS (SELECT 1 FROM public.transport_missions WHERE id=p_mission_id AND status NOT IN ('CLOSED','CANCELLED')) THEN RAISE EXCEPTION 'Course introuvable ou non modifiable.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.transport_mission_budget_lines(mission_id, category, planned_amount, notes, created_by, updated_by)
  VALUES (p_mission_id, upper(btrim(p_line ->> 'category')), COALESCE(NULLIF(p_line ->> 'planned_amount','')::numeric,0), NULLIF(btrim(p_line ->> 'notes'),''), auth.uid(), auth.uid())
  ON CONFLICT(mission_id,category) DO UPDATE SET planned_amount=EXCLUDED.planned_amount, notes=EXCLUDED.notes, updated_by=auth.uid(), updated_at=now()
  RETURNING * INTO v_line;
  PERFORM public.business_finance_audit_event('COURSE', p_mission_id, NULL, 'UPDATE', NULL, jsonb_build_object('budget_line', to_jsonb(v_line)));
  RETURN v_line;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transport_mission_expense(p_mission_id uuid, p_expense jsonb)
RETURNS public.transport_mission_expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_expense public.transport_mission_expenses;
BEGIN
  PERFORM public.permission_require('missions.expenses.manage');
  IF NOT EXISTS (SELECT 1 FROM public.transport_missions WHERE id=p_mission_id AND status NOT IN ('CLOSED','CANCELLED')) THEN RAISE EXCEPTION 'Course introuvable ou non modifiable.' USING ERRCODE='22023'; END IF;
  IF NULLIF(p_expense ->> 'wallet_id','') IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id=(p_expense ->> 'wallet_id')::uuid) THEN RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE='23503'; END IF;
  INSERT INTO public.transport_mission_expenses(mission_id,wallet_id,category,amount,expense_date,status,description,receipt_document_id,created_by,updated_by)
  VALUES(p_mission_id,(p_expense ->> 'wallet_id')::uuid,upper(btrim(p_expense ->> 'category')),(p_expense ->> 'amount')::numeric,COALESCE(NULLIF(p_expense ->> 'expense_date','')::date,current_date),COALESCE(NULLIF(upper(p_expense ->> 'status'),''),'PLANNED'),NULLIF(btrim(p_expense ->> 'description'),''),NULLIF(p_expense ->> 'receipt_document_id','')::uuid,auth.uid(),auth.uid())
  RETURNING * INTO v_expense;
  IF v_expense.status='PAID' THEN RAISE EXCEPTION 'Une dépense doit être confirmée via la commande de validation.' USING ERRCODE='22023'; END IF;
  PERFORM public.business_finance_audit_event('COURSE_EXPENSE', v_expense.id, NULL, 'CREATE', NULL, to_jsonb(v_expense));
  RETURN v_expense;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_transport_mission_expense(p_expense_id uuid, p_values jsonb)
RETURNS public.transport_mission_expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_mission_expenses; v_expense public.transport_mission_expenses;
BEGIN
  PERFORM public.permission_require('missions.expenses.manage');
  SELECT * INTO v_before FROM public.transport_mission_expenses WHERE id=p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable.' USING ERRCODE='P0002'; END IF;
  IF v_before.status IN ('PAID','CANCELLED') THEN RAISE EXCEPTION 'Une dépense validée ou annulée ne peut pas être modifiée.' USING ERRCODE='22023'; END IF;
  UPDATE public.transport_mission_expenses SET wallet_id=COALESCE(NULLIF(p_values ->> 'wallet_id','')::uuid,wallet_id), category=COALESCE(NULLIF(upper(btrim(p_values ->> 'category')),''),category), amount=COALESCE(NULLIF(p_values ->> 'amount','')::numeric,amount), expense_date=COALESCE(NULLIF(p_values ->> 'expense_date','')::date,expense_date), status=COALESCE(NULLIF(upper(p_values ->> 'status'),''),status), description=CASE WHEN p_values ? 'description' THEN NULLIF(btrim(p_values ->> 'description'),'') ELSE description END, receipt_document_id=CASE WHEN p_values ? 'receipt_document_id' THEN NULLIF(p_values ->> 'receipt_document_id','')::uuid ELSE receipt_document_id END, updated_by=auth.uid(),updated_at=now() WHERE id=p_expense_id RETURNING * INTO v_expense;
  IF v_expense.status='PAID' THEN RAISE EXCEPTION 'Une dépense doit être confirmée via la commande de validation.' USING ERRCODE='22023'; END IF;
  PERFORM public.business_finance_audit_event('COURSE_EXPENSE', v_expense.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_expense));
  RETURN v_expense;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_transport_mission_expense(p_expense_id uuid)
RETURNS public.transport_mission_expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_mission_expenses; v_expense public.transport_mission_expenses; v_mission public.transport_missions; v_operation public.finance_operations;
BEGIN
  PERFORM public.permission_require('missions.expenses.confirm');
  SELECT * INTO v_before FROM public.transport_mission_expenses WHERE id=p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable.' USING ERRCODE='P0002'; END IF;
  IF v_before.status='CANCELLED' THEN RAISE EXCEPTION 'Une dépense annulée ne peut pas être validée.' USING ERRCODE='22023'; END IF;
  IF v_before.status='PAID' THEN RETURN v_before; END IF;
  SELECT * INTO v_mission FROM public.transport_missions WHERE id=v_before.mission_id FOR UPDATE;
  IF v_mission.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'La Course n’accepte plus de dépenses.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.finance_transport_mission_expense_links WHERE expense_id=v_before.id AND link_type='EXPENSE') THEN RAISE EXCEPTION 'Une écriture financière existe déjà pour cette dépense.' USING ERRCODE='23505'; END IF;
  v_operation := public._internal_course_upsert_finance(v_before.wallet_id,'EXPENSE',v_before.amount,v_before.expense_date,'COURSE_' || v_before.category,'Dépense Course ' || v_mission.mission_number,v_mission,v_before.id::text);
  INSERT INTO public.finance_transport_mission_expense_links(expense_id,operation_id,link_type) VALUES(v_before.id,v_operation.id,'EXPENSE');
  UPDATE public.transport_mission_expenses SET status='PAID',confirmed_at=now(),updated_by=auth.uid(),updated_at=now() WHERE id=v_before.id RETURNING * INTO v_expense;
  PERFORM public.business_finance_audit_event('COURSE_EXPENSE', v_expense.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_expense));
  RETURN v_expense;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_transport_mission_expense(p_expense_id uuid, p_reason text)
RETURNS public.transport_mission_expenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_mission_expenses; v_expense public.transport_mission_expenses; v_mission public.transport_missions; v_operation public.finance_operations;
BEGIN
  PERFORM public.permission_require('missions.expenses.confirm');
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'La justification est obligatoire.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_before FROM public.transport_mission_expenses WHERE id=p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable.' USING ERRCODE='P0002'; END IF;
  IF v_before.status='CANCELLED' THEN RETURN v_before; END IF;
  SELECT * INTO v_mission FROM public.transport_missions WHERE id=v_before.mission_id;
  IF v_before.status='PAID' THEN
    IF EXISTS(SELECT 1 FROM public.finance_transport_mission_expense_links WHERE expense_id=v_before.id AND link_type='REVERSAL') THEN RAISE EXCEPTION 'La contre-écriture existe déjà.' USING ERRCODE='23505'; END IF;
    v_operation := public._internal_course_upsert_finance(v_before.wallet_id,'REVENUE',v_before.amount,current_date,'COURSE_EXPENSE_REVERSAL','Contre-écriture dépense Course ' || v_mission.mission_number,v_mission,'REV-' || v_before.id::text);
    INSERT INTO public.finance_transport_mission_expense_links(expense_id,operation_id,link_type) VALUES(v_before.id,v_operation.id,'REVERSAL');
  END IF;
  UPDATE public.transport_mission_expenses SET status='CANCELLED',cancelled_at=now(),description=concat_ws(E'\n',description,'Annulation : ' || btrim(p_reason)),updated_by=auth.uid(),updated_at=now() WHERE id=p_expense_id RETURNING * INTO v_expense;
  PERFORM public.business_finance_audit_event('COURSE_EXPENSE', v_expense.id, v_operation.id, 'CANCEL', to_jsonb(v_before), to_jsonb(v_expense));
  RETURN v_expense;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transport_invoice(p_mission_id uuid, p_invoice jsonb)
RETURNS public.transport_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_invoice public.transport_invoices; v_mission public.transport_missions; v_subtotal numeric; v_rate numeric; v_tax numeric; v_vat_enabled boolean;
BEGIN
  PERFORM public.permission_require('missions.invoice');
  SELECT * INTO v_mission FROM public.transport_missions WHERE id=p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.status IN ('CANCELLED','CLOSED') THEN RAISE EXCEPTION 'Course introuvable ou non facturable.' USING ERRCODE='22023'; END IF;
  v_subtotal := COALESCE(NULLIF(p_invoice ->> 'subtotal_amount','')::numeric,v_mission.quoted_amount);
  SELECT COALESCE(vat_enabled,false), COALESCE(vat_rate,0) INTO v_vat_enabled, v_rate FROM public.company_settings ORDER BY created_at LIMIT 1;
  IF NOT COALESCE(v_vat_enabled,false) THEN v_rate := 0; ELSE v_rate := COALESCE(NULLIF(p_invoice ->> 'tax_rate','')::numeric,v_rate,0); END IF;
  v_tax := round(v_subtotal*v_rate/100,2);
  INSERT INTO public.transport_invoices(invoice_number,mission_id,client_id,due_date,subtotal_amount,tax_rate,tax_amount,total_amount,notes,created_by,updated_by)
  VALUES(public._internal_next_transport_invoice_number(),p_mission_id,v_mission.client_id,NULLIF(p_invoice ->> 'due_date','')::date,v_subtotal,v_rate,v_tax,round(v_subtotal+v_tax,2),NULLIF(btrim(p_invoice ->> 'notes'),''),auth.uid(),auth.uid()) RETURNING * INTO v_invoice;
  PERFORM public.business_finance_audit_event('COURSE_INVOICE',v_invoice.id,NULL,'CREATE',NULL,to_jsonb(v_invoice));
  RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_transport_invoice(p_invoice_id uuid)
RETURNS public.transport_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_invoices; v_invoice public.transport_invoices;
BEGIN
  PERFORM public.permission_require('missions.invoice'); SELECT * INTO v_before FROM public.transport_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE='P0002'; END IF;
  IF v_before.status NOT IN ('DRAFT','ISSUED') THEN RAISE EXCEPTION 'Cette facture ne peut plus être émise.' USING ERRCODE='22023'; END IF;
  UPDATE public.transport_invoices SET status='ISSUED',issue_date=COALESCE(issue_date,current_date),issued_at=COALESCE(issued_at,now()),updated_by=auth.uid(),updated_at=now() WHERE id=p_invoice_id RETURNING * INTO v_invoice;
  PERFORM public.business_finance_audit_event('COURSE_INVOICE',v_invoice.id,NULL,'UPDATE',to_jsonb(v_before),to_jsonb(v_invoice)); RETURN v_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transport_invoice_payment(p_invoice_id uuid, p_payment jsonb)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_invoice public.transport_invoices; v_payment public.transport_invoice_payments;
BEGIN
  PERFORM public.permission_require('missions.payments');
  SELECT * INTO v_invoice FROM public.transport_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('ISSUED','PARTIALLY_PAID') THEN RAISE EXCEPTION 'La facture doit être émise avant de recevoir un paiement.' USING ERRCODE='22023'; END IF;
  IF NULLIF(p_payment ->> 'wallet_id','') IS NULL OR NOT EXISTS(SELECT 1 FROM public.wallets WHERE id=(p_payment ->> 'wallet_id')::uuid) THEN RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE='23503'; END IF;
  IF (p_payment ->> 'amount')::numeric > v_invoice.total_amount - COALESCE((SELECT sum(amount) FROM public.transport_invoice_payments WHERE invoice_id=v_invoice.id AND status='CONFIRMED'),0) THEN RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.transport_invoice_payments(invoice_id,mission_id,wallet_id,amount,payment_date,status,payment_kind,reference,notes,created_by,updated_by)
  VALUES(v_invoice.id,v_invoice.mission_id,(p_payment ->> 'wallet_id')::uuid,(p_payment ->> 'amount')::numeric,COALESCE(NULLIF(p_payment ->> 'payment_date','')::date,current_date),COALESCE(NULLIF(upper(p_payment ->> 'status'),''),'PLANNED'),COALESCE(NULLIF(upper(p_payment ->> 'payment_kind'),''),'PAYMENT'),NULLIF(btrim(p_payment ->> 'reference'),''),NULLIF(btrim(p_payment ->> 'notes'),''),auth.uid(),auth.uid()) RETURNING * INTO v_payment;
  IF v_payment.status='CONFIRMED' THEN RAISE EXCEPTION 'Un paiement doit être confirmé par la commande dédiée.' USING ERRCODE='22023'; END IF;
  PERFORM public.business_finance_audit_event('COURSE_PAYMENT',v_payment.id,NULL,'CREATE',NULL,to_jsonb(v_payment)); RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_transport_invoice_payment(p_payment_id uuid)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_invoice_payments; v_payment public.transport_invoice_payments; v_invoice public.transport_invoices; v_mission public.transport_missions; v_operation public.finance_operations; v_confirmed numeric;
BEGIN
  PERFORM public.permission_require('missions.payments');
  SELECT * INTO v_before FROM public.transport_invoice_payments WHERE id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE='P0002'; END IF;
  IF v_before.status='CANCELLED' THEN RAISE EXCEPTION 'Un paiement annulé ne peut pas être confirmé.' USING ERRCODE='22023'; END IF;
  IF v_before.status='CONFIRMED' THEN RETURN v_before; END IF;
  SELECT * INTO v_invoice FROM public.transport_invoices WHERE id=v_before.invoice_id FOR UPDATE;
  SELECT * INTO v_mission FROM public.transport_missions WHERE id=v_before.mission_id;
  IF v_invoice.status NOT IN ('ISSUED','PARTIALLY_PAID') THEN RAISE EXCEPTION 'La facture doit être émise pour confirmer un paiement.' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(sum(amount),0) INTO v_confirmed FROM public.transport_invoice_payments WHERE invoice_id=v_invoice.id AND status='CONFIRMED';
  IF v_confirmed + v_before.amount > v_invoice.total_amount THEN RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.finance_transport_payment_links WHERE payment_id=v_before.id AND link_type='PAYMENT') THEN RAISE EXCEPTION 'Une écriture financière existe déjà pour ce paiement.' USING ERRCODE='23505'; END IF;
  v_operation := public._internal_course_upsert_finance(v_before.wallet_id,'REVENUE',v_before.amount,v_before.payment_date,'COURSE_PAYMENT','Encaissement Course ' || v_mission.mission_number,v_mission,COALESCE(v_before.reference,v_before.id::text));
  INSERT INTO public.finance_transport_payment_links(payment_id,operation_id,link_type) VALUES(v_before.id,v_operation.id,'PAYMENT');
  UPDATE public.transport_invoice_payments SET status='CONFIRMED',confirmed_at=now(),updated_by=auth.uid(),updated_at=now() WHERE id=v_before.id RETURNING * INTO v_payment;
  v_confirmed := v_confirmed + v_payment.amount;
  UPDATE public.transport_invoices SET status=CASE WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_by=auth.uid(),updated_at=now() WHERE id=v_invoice.id RETURNING * INTO v_invoice;
  PERFORM public.business_finance_audit_event('COURSE_PAYMENT',v_payment.id,v_operation.id,'UPDATE',to_jsonb(v_before),to_jsonb(v_payment)); RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_transport_invoice_payment(p_payment_id uuid, p_reason text)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_before public.transport_invoice_payments; v_payment public.transport_invoice_payments; v_invoice public.transport_invoices; v_mission public.transport_missions; v_operation public.finance_operations; v_confirmed numeric;
BEGIN
  PERFORM public.permission_require('missions.payments'); IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'La justification est obligatoire.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_before FROM public.transport_invoice_payments WHERE id=p_payment_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE='P0002'; END IF;
  IF v_before.status='CANCELLED' THEN RETURN v_before; END IF;
  SELECT * INTO v_invoice FROM public.transport_invoices WHERE id=v_before.invoice_id FOR UPDATE; SELECT * INTO v_mission FROM public.transport_missions WHERE id=v_before.mission_id;
  IF v_before.status='CONFIRMED' THEN
    IF EXISTS(SELECT 1 FROM public.finance_transport_payment_links WHERE payment_id=v_before.id AND link_type='REVERSAL') THEN RAISE EXCEPTION 'La contre-écriture existe déjà.' USING ERRCODE='23505'; END IF;
    v_operation := public._internal_course_upsert_finance(v_before.wallet_id,'EXPENSE',v_before.amount,current_date,'COURSE_PAYMENT_REVERSAL','Contre-écriture encaissement Course ' || v_mission.mission_number,v_mission,'REV-' || v_before.id::text);
    INSERT INTO public.finance_transport_payment_links(payment_id,operation_id,link_type) VALUES(v_before.id,v_operation.id,'REVERSAL');
  END IF;
  UPDATE public.transport_invoice_payments SET status='CANCELLED',cancelled_at=now(),notes=concat_ws(E'\n',notes,'Annulation : ' || btrim(p_reason)),updated_by=auth.uid(),updated_at=now() WHERE id=p_payment_id RETURNING * INTO v_payment;
  SELECT COALESCE(sum(amount),0) INTO v_confirmed FROM public.transport_invoice_payments WHERE invoice_id=v_invoice.id AND status='CONFIRMED';
  UPDATE public.transport_invoices SET status=CASE WHEN v_confirmed=0 THEN 'ISSUED' WHEN v_confirmed>=total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_by=auth.uid(),updated_at=now() WHERE id=v_invoice.id;
  PERFORM public.business_finance_audit_event('COURSE_PAYMENT',v_payment.id,v_operation.id,'CANCEL',to_jsonb(v_before),to_jsonb(v_payment)); RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_transport_mission_financial_summary(p_mission_id uuid)
RETURNS TABLE(quoted_amount numeric, budget_amount numeric, actual_expenses numeric, invoiced_amount numeric, received_amount numeric, amount_due numeric, gross_result numeric, cash_result numeric, cost_per_km numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_mission public.transport_missions;
BEGIN
  PERFORM public.permission_require('missions.finance.read'); SELECT * INTO v_mission FROM public.transport_missions WHERE id=p_mission_id; IF NOT FOUND THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE='P0002'; END IF;
  RETURN QUERY SELECT v_mission.quoted_amount,
    COALESCE((SELECT sum(planned_amount) FROM public.transport_mission_budget_lines WHERE mission_id=v_mission.id),0),
    COALESCE((SELECT sum(amount) FROM public.transport_mission_expenses WHERE mission_id=v_mission.id AND status='PAID'),0),
    COALESCE((SELECT sum(total_amount) FROM public.transport_invoices WHERE mission_id=v_mission.id AND status<>'CANCELLED'),0),
    COALESCE((SELECT sum(amount) FROM public.transport_invoice_payments WHERE mission_id=v_mission.id AND status='CONFIRMED'),0),
    COALESCE((SELECT sum(total_amount) FROM public.transport_invoices WHERE mission_id=v_mission.id AND status<>'CANCELLED'),0)-COALESCE((SELECT sum(amount) FROM public.transport_invoice_payments WHERE mission_id=v_mission.id AND status='CONFIRMED'),0),
    v_mission.quoted_amount-COALESCE((SELECT sum(amount) FROM public.transport_mission_expenses WHERE mission_id=v_mission.id AND status='PAID'),0),
    COALESCE((SELECT sum(amount) FROM public.transport_invoice_payments WHERE mission_id=v_mission.id AND status='CONFIRMED'),0)-COALESCE((SELECT sum(amount) FROM public.transport_mission_expenses WHERE mission_id=v_mission.id AND status='PAID'),0),
    CASE WHEN v_mission.start_odometer IS NOT NULL AND v_mission.end_odometer > v_mission.start_odometer THEN round(COALESCE((SELECT sum(amount) FROM public.transport_mission_expenses WHERE mission_id=v_mission.id AND status='PAID'),0)/(v_mission.end_odometer-v_mission.start_odometer),2) ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_transport_mission_history(p_mission_id uuid)
RETURNS TABLE(id uuid,source_type text,source_id uuid,action text,created_at timestamptz,performed_by uuid,before_value jsonb,after_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  PERFORM public.permission_require('missions.read');
  RETURN QUERY SELECT audit.id,audit.source_type,audit.source_id,audit.action,audit.created_at,audit.performed_by,audit.before_value,audit.after_value
  FROM public.business_finance_audit audit WHERE (audit.source_type='COURSE' AND audit.source_id=p_mission_id) OR (audit.source_type='COURSE_EXPENSE' AND audit.source_id IN (SELECT id FROM public.transport_mission_expenses WHERE mission_id=p_mission_id)) OR (audit.source_type='COURSE_INVOICE' AND audit.source_id IN (SELECT id FROM public.transport_invoices WHERE mission_id=p_mission_id)) OR (audit.source_type='COURSE_PAYMENT' AND audit.source_id IN (SELECT id FROM public.transport_invoice_payments WHERE mission_id=p_mission_id)) ORDER BY audit.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_financial_metrics(p_client_id uuid)
RETURNS TABLE(metrics_available boolean,mission_count bigint,total_billed numeric,total_received numeric,amount_due numeric,total_expenses numeric,gross_result numeric,cash_result numeric,last_mission_at timestamptz,last_payment_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
BEGIN
  PERFORM public.permission_require('clients.financial.read');
  RETURN QUERY SELECT true,
    (SELECT count(*) FROM public.transport_missions WHERE client_id=p_client_id),
    COALESCE((SELECT sum(total_amount) FROM public.transport_invoices WHERE client_id=p_client_id AND status<>'CANCELLED'),0),
    COALESCE((SELECT sum(payment.amount) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id=payment.invoice_id WHERE invoice.client_id=p_client_id AND payment.status='CONFIRMED'),0),
    COALESCE((SELECT sum(total_amount) FROM public.transport_invoices WHERE client_id=p_client_id AND status<>'CANCELLED'),0)-COALESCE((SELECT sum(payment.amount) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id=payment.invoice_id WHERE invoice.client_id=p_client_id AND payment.status='CONFIRMED'),0),
    COALESCE((SELECT sum(expense.amount) FROM public.transport_mission_expenses expense JOIN public.transport_missions mission ON mission.id=expense.mission_id WHERE mission.client_id=p_client_id AND expense.status='PAID'),0),
    COALESCE((SELECT sum(mission.quoted_amount) FROM public.transport_missions mission WHERE mission.client_id=p_client_id),0)-COALESCE((SELECT sum(expense.amount) FROM public.transport_mission_expenses expense JOIN public.transport_missions mission ON mission.id=expense.mission_id WHERE mission.client_id=p_client_id AND expense.status='PAID'),0),
    COALESCE((SELECT sum(payment.amount) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id=payment.invoice_id WHERE invoice.client_id=p_client_id AND payment.status='CONFIRMED'),0)-COALESCE((SELECT sum(expense.amount) FROM public.transport_mission_expenses expense JOIN public.transport_missions mission ON mission.id=expense.mission_id WHERE mission.client_id=p_client_id AND expense.status='PAID'),0),
    (SELECT max(created_at) FROM public.transport_missions WHERE client_id=p_client_id),(SELECT max(payment.created_at) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id=payment.invoice_id WHERE invoice.client_id=p_client_id);
END;
$$;

-- Client document behaviour is preserved and extended for Course documents.
CREATE OR REPLACE FUNCTION public.create_document_with_relation(p_document jsonb, p_relation text, p_entity_id uuid)
RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, storage, pg_temp AS $$
DECLARE v_document public.documents; v_storage_path text := NULLIF(btrim(p_document ->> 'storage_path'), '');
BEGIN
  PERFORM public.permission_require('documents.upload');
  IF NULLIF(btrim(p_document ->> 'nom'),'') IS NULL OR v_storage_path IS NULL THEN RAISE EXCEPTION 'Le nom et le fichier privé du document sont obligatoires.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='documents' AND name=v_storage_path) THEN RAISE EXCEPTION 'Le fichier Storage est introuvable.' USING ERRCODE='P0002'; END IF;
  IF p_relation NOT IN('client','employee','driver','vehicle','motorcycle','farm','contract','vehicle_maintenance','motorcycle_maintenance','mission') THEN RAISE EXCEPTION 'Type de relation documentaire invalide.' USING ERRCODE='22023'; END IF;
  IF p_relation='client' AND NOT EXISTS(SELECT 1 FROM public.transport_clients WHERE id=p_entity_id) THEN RAISE EXCEPTION 'Client introuvable.' USING ERRCODE='P0002'; END IF;
  IF p_relation='mission' THEN PERFORM public.permission_require('missions.read'); IF NOT EXISTS(SELECT 1 FROM public.transport_missions WHERE id=p_entity_id) THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE='P0002'; END IF; END IF;
  INSERT INTO public.documents(nom,type,url,storage_path,date_emission,date_expiration,entity_type,entity_id) VALUES(btrim(p_document ->> 'nom'),NULLIF(btrim(p_document ->> 'type'),''),NULL,v_storage_path,NULLIF(p_document ->> 'date_emission','')::date,NULLIF(p_document ->> 'date_expiration','')::date,NULL,NULL) RETURNING * INTO v_document;
  CASE p_relation WHEN 'client' THEN INSERT INTO public.document_transport_client_links(document_id,client_id,created_by) VALUES(v_document.id,p_entity_id,auth.uid()); WHEN 'employee' THEN INSERT INTO public.document_employee_links(document_id,employee_id) VALUES(v_document.id,p_entity_id); WHEN 'driver' THEN INSERT INTO public.document_driver_links(document_id,driver_id) VALUES(v_document.id,p_entity_id); WHEN 'vehicle' THEN INSERT INTO public.document_vehicle_links(document_id,vehicle_id) VALUES(v_document.id,p_entity_id); WHEN 'motorcycle' THEN INSERT INTO public.document_motorcycle_links(document_id,motorcycle_id) VALUES(v_document.id,p_entity_id); WHEN 'farm' THEN INSERT INTO public.document_farm_links(document_id,farm_id) VALUES(v_document.id,p_entity_id); WHEN 'contract' THEN INSERT INTO public.document_contract_links(document_id,contract_id) VALUES(v_document.id,p_entity_id); WHEN 'vehicle_maintenance' THEN INSERT INTO public.document_vehicle_maintenance_links(document_id,maintenance_id) VALUES(v_document.id,p_entity_id); WHEN 'motorcycle_maintenance' THEN INSERT INTO public.document_motorcycle_maintenance_links(document_id,motorcycle_maintenance_id) VALUES(v_document.id,p_entity_id); ELSE INSERT INTO public.document_transport_mission_links(document_id,mission_id,created_by) VALUES(v_document.id,p_entity_id,auth.uid()); END CASE;
  PERFORM public.business_finance_audit_event('DOCUMENT',v_document.id,NULL,'CREATE',NULL,to_jsonb(v_document)||jsonb_build_object('relation',p_relation,'entity_id',p_entity_id)); RETURN v_document;
END;
$$;

REVOKE ALL ON FUNCTION public._internal_next_transport_mission_number(), public._internal_next_transport_invoice_number(), public._internal_course_upsert_finance(uuid,text,numeric,date,text,text,public.transport_missions,text), public.create_transport_mission(jsonb), public.update_transport_mission(uuid,jsonb), public.set_transport_mission_status(uuid,text,text), public.create_transport_mission_budget_line(uuid,jsonb), public.create_transport_mission_expense(uuid,jsonb), public.update_transport_mission_expense(uuid,jsonb), public.confirm_transport_mission_expense(uuid), public.cancel_transport_mission_expense(uuid,text), public.create_transport_invoice(uuid,jsonb), public.issue_transport_invoice(uuid), public.create_transport_invoice_payment(uuid,jsonb), public.confirm_transport_invoice_payment(uuid), public.cancel_transport_invoice_payment(uuid,text), public.get_transport_mission_financial_summary(uuid), public.get_transport_mission_history(uuid), public.get_client_financial_metrics(uuid), public.create_document_with_relation(jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transport_mission(jsonb), public.update_transport_mission(uuid,jsonb), public.set_transport_mission_status(uuid,text,text), public.create_transport_mission_budget_line(uuid,jsonb), public.create_transport_mission_expense(uuid,jsonb), public.update_transport_mission_expense(uuid,jsonb), public.confirm_transport_mission_expense(uuid), public.cancel_transport_mission_expense(uuid,text), public.create_transport_invoice(uuid,jsonb), public.issue_transport_invoice(uuid), public.create_transport_invoice_payment(uuid,jsonb), public.confirm_transport_invoice_payment(uuid), public.cancel_transport_invoice_payment(uuid,text), public.get_transport_mission_financial_summary(uuid), public.get_transport_mission_history(uuid), public.get_client_financial_metrics(uuid), public.create_document_with_relation(jsonb,text,uuid) TO authenticated;
