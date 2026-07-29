-- Lot 6: explicit ERP relations, assignment history and relational documents.
-- This migration is additive. Historical polymorphic columns are preserved for
-- rollback and legacy reads; all new links use foreign keys.

-- Assignment history --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_vehicle_assignments_status_check
    CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
  CONSTRAINT driver_vehicle_assignments_dates_check
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT driver_vehicle_assignments_active_dates_check
    CHECK (status <> 'ACTIVE' OR end_date IS NULL)
);

CREATE TABLE IF NOT EXISTS public.driver_motorcycle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  motorcycle_id uuid NOT NULL REFERENCES public.motorcycles(id) ON DELETE RESTRICT,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_motorcycle_assignments_status_check
    CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
  CONSTRAINT driver_motorcycle_assignments_dates_check
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT driver_motorcycle_assignments_active_dates_check
    CHECK (status <> 'ACTIVE' OR end_date IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_vehicle_assignments_one_active_vehicle_uidx
  ON public.driver_vehicle_assignments(vehicle_id)
  WHERE status = 'ACTIVE' AND end_date IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS driver_motorcycle_assignments_one_active_motorcycle_uidx
  ON public.driver_motorcycle_assignments(motorcycle_id)
  WHERE status = 'ACTIVE' AND end_date IS NULL;
CREATE INDEX IF NOT EXISTS driver_vehicle_assignments_driver_idx
  ON public.driver_vehicle_assignments(driver_id, start_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS driver_motorcycle_assignments_driver_idx
  ON public.driver_motorcycle_assignments(driver_id, start_date DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_driver_vehicle_assignments_updated ON public.driver_vehicle_assignments;
CREATE TRIGGER trg_driver_vehicle_assignments_updated
  BEFORE UPDATE ON public.driver_vehicle_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
DROP TRIGGER IF EXISTS trg_driver_motorcycle_assignments_updated ON public.driver_motorcycle_assignments;
CREATE TRIGGER trg_driver_motorcycle_assignments_updated
  BEFORE UPDATE ON public.driver_motorcycle_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Explicit contract relations ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contract_employee_links (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, employee_id)
);
CREATE TABLE IF NOT EXISTS public.contract_driver_links (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, driver_id)
);
CREATE TABLE IF NOT EXISTS public.contract_vehicle_links (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, vehicle_id)
);
CREATE TABLE IF NOT EXISTS public.contract_motorcycle_links (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  motorcycle_id uuid NOT NULL REFERENCES public.motorcycles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, motorcycle_id)
);
CREATE TABLE IF NOT EXISTS public.contract_farm_links (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, farm_id)
);

CREATE INDEX IF NOT EXISTS contract_employee_links_employee_idx ON public.contract_employee_links(employee_id);
CREATE INDEX IF NOT EXISTS contract_driver_links_driver_idx ON public.contract_driver_links(driver_id);
CREATE INDEX IF NOT EXISTS contract_vehicle_links_vehicle_idx ON public.contract_vehicle_links(vehicle_id);
CREATE INDEX IF NOT EXISTS contract_motorcycle_links_motorcycle_idx ON public.contract_motorcycle_links(motorcycle_id);
CREATE INDEX IF NOT EXISTS contract_farm_links_farm_idx ON public.contract_farm_links(farm_id);

-- Explicit document relations ------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.document_employee_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, employee_id)
);
CREATE TABLE IF NOT EXISTS public.document_driver_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, driver_id)
);
CREATE TABLE IF NOT EXISTS public.document_vehicle_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, vehicle_id)
);
CREATE TABLE IF NOT EXISTS public.document_motorcycle_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  motorcycle_id uuid NOT NULL REFERENCES public.motorcycles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, motorcycle_id)
);
CREATE TABLE IF NOT EXISTS public.document_farm_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, farm_id)
);
CREATE TABLE IF NOT EXISTS public.document_contract_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, contract_id)
);
CREATE TABLE IF NOT EXISTS public.document_vehicle_maintenance_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  maintenance_id uuid NOT NULL REFERENCES public.maintenances(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, maintenance_id)
);
CREATE TABLE IF NOT EXISTS public.document_motorcycle_maintenance_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  motorcycle_maintenance_id uuid NOT NULL REFERENCES public.motorcycle_maintenances(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, motorcycle_maintenance_id)
);

CREATE INDEX IF NOT EXISTS document_employee_links_employee_idx ON public.document_employee_links(employee_id);
CREATE INDEX IF NOT EXISTS document_driver_links_driver_idx ON public.document_driver_links(driver_id);
CREATE INDEX IF NOT EXISTS document_vehicle_links_vehicle_idx ON public.document_vehicle_links(vehicle_id);
CREATE INDEX IF NOT EXISTS document_motorcycle_links_motorcycle_idx ON public.document_motorcycle_links(motorcycle_id);
CREATE INDEX IF NOT EXISTS document_farm_links_farm_idx ON public.document_farm_links(farm_id);
CREATE INDEX IF NOT EXISTS document_contract_links_contract_idx ON public.document_contract_links(contract_id);
CREATE INDEX IF NOT EXISTS document_vehicle_maintenance_links_maintenance_idx ON public.document_vehicle_maintenance_links(maintenance_id);
CREATE INDEX IF NOT EXISTS document_motorcycle_maintenance_links_maintenance_idx ON public.document_motorcycle_maintenance_links(motorcycle_maintenance_id);

-- Backfill explicit links from valid historical polymorphic references. The
-- original values stay untouched and every insert is idempotent.
INSERT INTO public.contract_employee_links(contract_id, employee_id)
SELECT c.id, c.entity_id FROM public.contracts c
WHERE c.entity_type = 'employe' AND c.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = c.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.contract_driver_links(contract_id, driver_id)
SELECT c.id, c.entity_id FROM public.contracts c
WHERE c.entity_type = 'chauffeur' AND c.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = c.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.contract_vehicle_links(contract_id, vehicle_id)
SELECT c.id, c.entity_id FROM public.contracts c
WHERE c.entity_type = 'vehicule' AND c.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = c.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.contract_motorcycle_links(contract_id, motorcycle_id)
SELECT c.id, c.entity_id FROM public.contracts c
WHERE c.entity_type = 'moto' AND c.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.motorcycles m WHERE m.id = c.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.contract_farm_links(contract_id, farm_id)
SELECT c.id, c.entity_id FROM public.contracts c
WHERE c.entity_type = 'exploitation' AND c.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = c.entity_id)
ON CONFLICT DO NOTHING;

INSERT INTO public.document_employee_links(document_id, employee_id)
SELECT d.id, d.entity_id FROM public.documents d
WHERE d.entity_type = 'employe' AND d.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = d.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.document_driver_links(document_id, driver_id)
SELECT d.id, d.entity_id FROM public.documents d
WHERE d.entity_type = 'chauffeur' AND d.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.drivers r WHERE r.id = d.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.document_vehicle_links(document_id, vehicle_id)
SELECT d.id, d.entity_id FROM public.documents d
WHERE d.entity_type = 'vehicule' AND d.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = d.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.document_motorcycle_links(document_id, motorcycle_id)
SELECT d.id, d.entity_id FROM public.documents d
WHERE d.entity_type = 'moto' AND d.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.motorcycles m WHERE m.id = d.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.document_farm_links(document_id, farm_id)
SELECT d.id, d.entity_id FROM public.documents d
WHERE d.entity_type = 'exploitation' AND d.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = d.entity_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.document_contract_links(document_id, contract_id)
SELECT d.id, d.entity_id FROM public.documents d
WHERE d.entity_type = 'contrat' AND d.entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = d.entity_id)
ON CONFLICT DO NOTHING;

-- Existing current driver columns are backfilled as active assignments. Start
-- dates deliberately remain NULL: the source schema cannot provide them.
INSERT INTO public.driver_vehicle_assignments(driver_id, vehicle_id, start_date, status, notes)
SELECT v.driver_id, v.id, NULL, 'ACTIVE', 'Reprise automatique depuis vehicles.driver_id ; date de début inconnue.'
FROM public.vehicles v
WHERE v.driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.driver_vehicle_assignments a
    WHERE a.vehicle_id = v.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
  )
ON CONFLICT DO NOTHING;
INSERT INTO public.driver_motorcycle_assignments(driver_id, motorcycle_id, start_date, status, notes)
SELECT m.driver_id, m.id, NULL, 'ACTIVE', 'Reprise automatique depuis motorcycles.driver_id ; date de début inconnue.'
FROM public.motorcycles m
WHERE m.driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.driver_motorcycle_assignments a
    WHERE a.motorcycle_id = m.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
  )
ON CONFLICT DO NOTHING;

-- Assignment RPCs -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_driver_to_vehicle(
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_start_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.driver_vehicle_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $assign_driver_to_vehicle$
DECLARE
  v_previous public.driver_vehicle_assignments;
  v_assignment public.driver_vehicle_assignments;
  v_previous_before jsonb;
  v_start_date date := COALESCE(p_start_date, current_date);
BEGIN
  PERFORM public.business_finance_require_write_role();
  PERFORM 1 FROM public.drivers WHERE id = p_driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chauffeur introuvable.' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Véhicule introuvable.' USING ERRCODE = '23503'; END IF;

  SELECT * INTO v_previous FROM public.driver_vehicle_assignments
  WHERE vehicle_id = p_vehicle_id AND status = 'ACTIVE' AND end_date IS NULL
  FOR UPDATE;

  IF FOUND AND v_previous.driver_id = p_driver_id THEN
    UPDATE public.driver_vehicle_assignments
    SET notes = COALESCE(NULLIF(trim(p_notes), ''), notes), updated_at = now()
    WHERE id = v_previous.id RETURNING * INTO v_assignment;
    UPDATE public.vehicles SET driver_id = p_driver_id, updated_at = now() WHERE id = p_vehicle_id;
    RETURN v_assignment;
  END IF;

  IF FOUND THEN
    v_previous_before := to_jsonb(v_previous);
    UPDATE public.driver_vehicle_assignments
    SET status = 'CLOSED', end_date = CASE
          WHEN start_date IS NULL THEN v_start_date
          ELSE GREATEST(start_date, v_start_date)
        END,
        updated_at = now()
    WHERE id = v_previous.id RETURNING * INTO v_previous;
    PERFORM public.business_finance_audit_event(
      'DRIVER_VEHICLE_ASSIGNMENT', v_previous.id, NULL, 'CLOSE', v_previous_before, to_jsonb(v_previous)
    );
  END IF;

  INSERT INTO public.driver_vehicle_assignments(driver_id, vehicle_id, start_date, status, notes)
  VALUES (p_driver_id, p_vehicle_id, v_start_date, 'ACTIVE', NULLIF(trim(p_notes), ''))
  RETURNING * INTO v_assignment;
  UPDATE public.vehicles SET driver_id = p_driver_id, updated_at = now() WHERE id = p_vehicle_id;
  PERFORM public.business_finance_audit_event(
    'DRIVER_VEHICLE_ASSIGNMENT', v_assignment.id, NULL, 'CREATE',
    CASE WHEN v_previous.id IS NULL THEN NULL ELSE to_jsonb(v_previous) END, to_jsonb(v_assignment)
  );
  RETURN v_assignment;
END;
$assign_driver_to_vehicle$;

CREATE OR REPLACE FUNCTION public.close_driver_vehicle_assignment(
  p_assignment_id uuid,
  p_end_date date DEFAULT current_date,
  p_notes text DEFAULT NULL
)
RETURNS public.driver_vehicle_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $close_driver_vehicle_assignment$
DECLARE
  v_before public.driver_vehicle_assignments;
  v_assignment public.driver_vehicle_assignments;
  v_end_date date := COALESCE(p_end_date, current_date);
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.driver_vehicle_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Affectation véhicule introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status <> 'ACTIVE' OR v_before.end_date IS NOT NULL THEN
    RAISE EXCEPTION 'Cette affectation est déjà clôturée.' USING ERRCODE = '22023';
  END IF;
  IF v_before.start_date IS NOT NULL AND v_end_date < v_before.start_date THEN
    RAISE EXCEPTION 'La date de fin ne peut pas précéder la date de début.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.driver_vehicle_assignments
  SET status = 'CLOSED', end_date = v_end_date,
      notes = COALESCE(NULLIF(trim(p_notes), ''), notes), updated_at = now()
  WHERE id = p_assignment_id RETURNING * INTO v_assignment;
  UPDATE public.vehicles SET driver_id = NULL, updated_at = now()
  WHERE id = v_assignment.vehicle_id AND driver_id = v_assignment.driver_id;
  PERFORM public.business_finance_audit_event(
    'DRIVER_VEHICLE_ASSIGNMENT', v_assignment.id, NULL, 'CLOSE', to_jsonb(v_before), to_jsonb(v_assignment)
  );
  RETURN v_assignment;
END;
$close_driver_vehicle_assignment$;

CREATE OR REPLACE FUNCTION public.assign_driver_to_motorcycle(
  p_driver_id uuid,
  p_motorcycle_id uuid,
  p_start_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.driver_motorcycle_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $assign_driver_to_motorcycle$
DECLARE
  v_previous public.driver_motorcycle_assignments;
  v_assignment public.driver_motorcycle_assignments;
  v_previous_before jsonb;
  v_start_date date := COALESCE(p_start_date, current_date);
BEGIN
  PERFORM public.business_finance_require_write_role();
  PERFORM 1 FROM public.drivers WHERE id = p_driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chauffeur introuvable.' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM public.motorcycles WHERE id = p_motorcycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moto introuvable.' USING ERRCODE = '23503'; END IF;

  SELECT * INTO v_previous FROM public.driver_motorcycle_assignments
  WHERE motorcycle_id = p_motorcycle_id AND status = 'ACTIVE' AND end_date IS NULL
  FOR UPDATE;
  IF FOUND AND v_previous.driver_id = p_driver_id THEN
    UPDATE public.driver_motorcycle_assignments
    SET notes = COALESCE(NULLIF(trim(p_notes), ''), notes), updated_at = now()
    WHERE id = v_previous.id RETURNING * INTO v_assignment;
    UPDATE public.motorcycles SET driver_id = p_driver_id, updated_at = now() WHERE id = p_motorcycle_id;
    RETURN v_assignment;
  END IF;
  IF FOUND THEN
    v_previous_before := to_jsonb(v_previous);
    UPDATE public.driver_motorcycle_assignments
    SET status = 'CLOSED', end_date = CASE
          WHEN start_date IS NULL THEN v_start_date
          ELSE GREATEST(start_date, v_start_date)
        END,
        updated_at = now()
    WHERE id = v_previous.id RETURNING * INTO v_previous;
    PERFORM public.business_finance_audit_event(
      'DRIVER_MOTORCYCLE_ASSIGNMENT', v_previous.id, NULL, 'CLOSE', v_previous_before, to_jsonb(v_previous)
    );
  END IF;
  INSERT INTO public.driver_motorcycle_assignments(driver_id, motorcycle_id, start_date, status, notes)
  VALUES (p_driver_id, p_motorcycle_id, v_start_date, 'ACTIVE', NULLIF(trim(p_notes), ''))
  RETURNING * INTO v_assignment;
  UPDATE public.motorcycles SET driver_id = p_driver_id, updated_at = now() WHERE id = p_motorcycle_id;
  PERFORM public.business_finance_audit_event(
    'DRIVER_MOTORCYCLE_ASSIGNMENT', v_assignment.id, NULL, 'CREATE',
    CASE WHEN v_previous.id IS NULL THEN NULL ELSE to_jsonb(v_previous) END, to_jsonb(v_assignment)
  );
  RETURN v_assignment;
END;
$assign_driver_to_motorcycle$;

CREATE OR REPLACE FUNCTION public.close_driver_motorcycle_assignment(
  p_assignment_id uuid,
  p_end_date date DEFAULT current_date,
  p_notes text DEFAULT NULL
)
RETURNS public.driver_motorcycle_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $close_driver_motorcycle_assignment$
DECLARE
  v_before public.driver_motorcycle_assignments;
  v_assignment public.driver_motorcycle_assignments;
  v_end_date date := COALESCE(p_end_date, current_date);
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.driver_motorcycle_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Affectation moto introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status <> 'ACTIVE' OR v_before.end_date IS NOT NULL THEN
    RAISE EXCEPTION 'Cette affectation est déjà clôturée.' USING ERRCODE = '22023';
  END IF;
  IF v_before.start_date IS NOT NULL AND v_end_date < v_before.start_date THEN
    RAISE EXCEPTION 'La date de fin ne peut pas précéder la date de début.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.driver_motorcycle_assignments
  SET status = 'CLOSED', end_date = v_end_date,
      notes = COALESCE(NULLIF(trim(p_notes), ''), notes), updated_at = now()
  WHERE id = p_assignment_id RETURNING * INTO v_assignment;
  UPDATE public.motorcycles SET driver_id = NULL, updated_at = now()
  WHERE id = v_assignment.motorcycle_id AND driver_id = v_assignment.driver_id;
  PERFORM public.business_finance_audit_event(
    'DRIVER_MOTORCYCLE_ASSIGNMENT', v_assignment.id, NULL, 'CLOSE', to_jsonb(v_before), to_jsonb(v_assignment)
  );
  RETURN v_assignment;
END;
$close_driver_motorcycle_assignment$;

-- Relations are readable by authenticated users. Writes are exclusively
-- performed through the RPCs (assignments) or privileged Server Functions.
ALTER TABLE public.driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_motorcycle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_employee_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_driver_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_vehicle_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_motorcycle_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_farm_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_employee_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_driver_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_vehicle_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_motorcycle_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_farm_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_contract_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_vehicle_maintenance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_motorcycle_maintenance_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_vehicle_assignments_read ON public.driver_vehicle_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY driver_motorcycle_assignments_read ON public.driver_motorcycle_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY contract_employee_links_read ON public.contract_employee_links FOR SELECT TO authenticated USING (true);
CREATE POLICY contract_driver_links_read ON public.contract_driver_links FOR SELECT TO authenticated USING (true);
CREATE POLICY contract_vehicle_links_read ON public.contract_vehicle_links FOR SELECT TO authenticated USING (true);
CREATE POLICY contract_motorcycle_links_read ON public.contract_motorcycle_links FOR SELECT TO authenticated USING (true);
CREATE POLICY contract_farm_links_read ON public.contract_farm_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_employee_links_read ON public.document_employee_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_driver_links_read ON public.document_driver_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_vehicle_links_read ON public.document_vehicle_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_motorcycle_links_read ON public.document_motorcycle_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_farm_links_read ON public.document_farm_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_contract_links_read ON public.document_contract_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_vehicle_maintenance_links_read ON public.document_vehicle_maintenance_links FOR SELECT TO authenticated USING (true);
CREATE POLICY document_motorcycle_maintenance_links_read ON public.document_motorcycle_maintenance_links FOR SELECT TO authenticated USING (true);

DO $relation_write_policies$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'driver_vehicle_assignments', 'driver_motorcycle_assignments',
    'contract_employee_links', 'contract_driver_links', 'contract_vehicle_links',
    'contract_motorcycle_links', 'contract_farm_links',
    'document_employee_links', 'document_driver_links', 'document_vehicle_links',
    'document_motorcycle_links', 'document_farm_links', 'document_contract_links',
    'document_vehicle_maintenance_links', 'document_motorcycle_maintenance_links'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_write', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY[''super_admin'',''admin'',''gestionnaire'']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''super_admin'',''admin'',''gestionnaire'']::public.app_role[]))',
      v_table || '_write', v_table
    );
  END LOOP;
END;
$relation_write_policies$;

REVOKE ALL ON FUNCTION public.assign_driver_to_vehicle(uuid, uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_driver_vehicle_assignment(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_driver_to_motorcycle(uuid, uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_driver_motorcycle_assignment(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_driver_to_vehicle(uuid, uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_driver_vehicle_assignment(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_driver_to_motorcycle(uuid, uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_driver_motorcycle_assignment(uuid, date, text) TO authenticated;
