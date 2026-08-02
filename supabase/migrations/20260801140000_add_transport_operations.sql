-- EXP-01: operational transport workflow built on transport_missions.
-- This additive migration never creates finance operations or changes wallets.

ALTER TABLE public.transport_missions
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_recipient_name text,
  ADD COLUMN IF NOT EXISTS delivery_notes text,
  ADD COLUMN IF NOT EXISTS delivery_reservations text,
  ADD COLUMN IF NOT EXISTS delivery_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.transport_missions
  DROP CONSTRAINT IF EXISTS transport_missions_odometer_check;
ALTER TABLE public.transport_missions
  ADD CONSTRAINT transport_missions_odometer_check CHECK (
    (start_odometer IS NULL OR start_odometer >= 0)
    AND (end_odometer IS NULL OR (start_odometer IS NOT NULL AND end_odometer >= start_odometer))
  );

ALTER TABLE public.transport_missions
  DROP CONSTRAINT IF EXISTS transport_missions_delivery_status_check;
ALTER TABLE public.transport_missions
  ADD CONSTRAINT transport_missions_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN ('DELIVERED', 'PARTIAL', 'INCIDENT'));

CREATE INDEX IF NOT EXISTS transport_missions_delivery_worklist_idx
  ON public.transport_missions(status, planned_arrival_at DESC)
  WHERE status IN ('IN_PROGRESS', 'COMPLETED');

ALTER TABLE public.business_finance_audit
  DROP CONSTRAINT IF EXISTS business_finance_audit_action_check;
ALTER TABLE public.business_finance_audit
  ADD CONSTRAINT business_finance_audit_action_check
  CHECK (action = ANY (ARRAY[
    'CREATE', 'UPDATE', 'CANCEL', 'DELETE', 'CLOSE', 'ARCHIVE', 'RESTORE',
    'REPLACE', 'ASSIGN', 'UNASSIGN', 'MERGE', 'DEPARTURE', 'DELIVERY', 'CORRECT'
  ]));

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('planning.read', 'planning', 'read', 'Consulter le planning opérationnel des Courses.', 'SENSITIVE'),
  ('assignments.read', 'assignments', 'read', 'Consulter les affectations de Courses.', 'SENSITIVE'),
  ('assignments.manage', 'assignments', 'manage', 'Affecter un véhicule et un chauffeur à une Course planifiée.', 'SENSITIVE'),
  ('departures.read', 'departures', 'read', 'Consulter les Courses prêtes au départ.', 'SENSITIVE'),
  ('departures.confirm', 'departures', 'confirm', 'Autoriser et confirmer le départ d’une Course.', 'SENSITIVE'),
  ('deliveries.read', 'deliveries', 'read', 'Consulter les Courses à livrer ou livrées.', 'SENSITIVE'),
  ('deliveries.confirm', 'deliveries', 'confirm', 'Confirmer une livraison, une livraison partielle ou un incident.', 'SENSITIVE'),
  ('deliveries.correct', 'deliveries', 'correct', 'Corriger ou annuler une confirmation de livraison avec traçabilité.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('admin', 'planning.read'), ('admin', 'assignments.read'), ('admin', 'assignments.manage'),
  ('admin', 'departures.read'), ('admin', 'departures.confirm'), ('admin', 'deliveries.read'),
  ('admin', 'deliveries.confirm'), ('admin', 'deliveries.correct'),
  ('operations', 'planning.read'), ('operations', 'assignments.read'), ('operations', 'assignments.manage'),
  ('operations', 'departures.read'), ('operations', 'departures.confirm'), ('operations', 'deliveries.read'),
  ('operations', 'deliveries.confirm'),
  ('gestionnaire', 'planning.read'), ('gestionnaire', 'assignments.read'), ('gestionnaire', 'assignments.manage'),
  ('gestionnaire', 'departures.read'), ('gestionnaire', 'departures.confirm'), ('gestionnaire', 'deliveries.read'),
  ('gestionnaire', 'deliveries.confirm'),
  ('comptable', 'planning.read'), ('comptable', 'assignments.read'), ('comptable', 'departures.read'),
  ('comptable', 'deliveries.read'),
  ('lecture_seule', 'planning.read'), ('lecture_seule', 'assignments.read'), ('lecture_seule', 'departures.read'),
  ('lecture_seule', 'deliveries.read')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.assign_transport_mission(p_mission_id uuid, p_assignment jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $assign_transport_mission$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_vehicle_id uuid := NULLIF(p_assignment ->> 'vehicle_id', '')::uuid;
  v_driver_id uuid := NULLIF(p_assignment ->> 'driver_id', '')::uuid;
  v_reason text := NULLIF(btrim(p_assignment ->> 'override_reason'), '');
  v_vehicle public.vehicles;
  v_driver public.drivers;
  v_has_conflict boolean;
BEGIN
  PERFORM public.permission_require('assignments.manage');

  SELECT * INTO v_before
  FROM public.transport_missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Seule une Course planifiée peut être affectée depuis cet espace.' USING ERRCODE = '22023';
  END IF;
  IF v_before.planned_departure_at IS NULL OR v_before.planned_arrival_at IS NULL THEN
    RAISE EXCEPTION 'Les dates prévues sont obligatoires avant l’affectation.' USING ERRCODE = '22023';
  END IF;
  IF v_vehicle_id IS NULL OR v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Un véhicule et un chauffeur sont obligatoires.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_vehicle_id;
  IF NOT FOUND OR v_vehicle.status IS DISTINCT FROM 'EN_SERVICE' THEN
    RAISE EXCEPTION 'Le véhicule sélectionné est indisponible.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_driver FROM public.drivers WHERE id = v_driver_id;
  IF NOT FOUND OR lower(coalesce(v_driver.statut, '')) NOT IN ('actif', 'active') THEN
    RAISE EXCEPTION 'Le chauffeur sélectionné est indisponible.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.transport_missions AS scheduled
    WHERE scheduled.id <> p_mission_id
      AND scheduled.status IN ('PLANNED', 'IN_PROGRESS')
      AND scheduled.overlap_exception_reason IS NULL
      AND tstzrange(scheduled.planned_departure_at, scheduled.planned_arrival_at, '[)')
          && tstzrange(v_before.planned_departure_at, v_before.planned_arrival_at, '[)')
      AND (scheduled.vehicle_id = v_vehicle_id OR scheduled.driver_id = v_driver_id)
  ) INTO v_has_conflict;

  IF v_has_conflict AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Cette affectation entre en conflit avec une autre Course. Une dérogation administrateur justifiée est requise.' USING ERRCODE = '23P01';
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM public.permission_require('missions.override');
  END IF;

  IF v_before.vehicle_id = v_vehicle_id
    AND v_before.driver_id = v_driver_id
    AND v_before.overlap_exception_reason IS NOT DISTINCT FROM v_reason THEN
    RETURN v_before;
  END IF;

  UPDATE public.transport_missions
  SET vehicle_id = v_vehicle_id,
      driver_id = v_driver_id,
      overlap_exception_reason = v_reason,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event(
    'COURSE', v_mission.id, NULL, 'ASSIGN', to_jsonb(v_before), to_jsonb(v_mission)
  );
  RETURN v_mission;
END;
$assign_transport_mission$;

CREATE OR REPLACE FUNCTION public.confirm_transport_departure(p_mission_id uuid, p_departure jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_transport_departure$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_vehicle public.vehicles;
  v_driver public.drivers;
  v_started_at timestamptz := coalesce(NULLIF(p_departure ->> 'actual_departure_at', '')::timestamptz, now());
  v_start_odometer numeric := NULLIF(p_departure ->> 'start_odometer', '')::numeric;
  v_has_conflict boolean;
BEGIN
  PERFORM public.permission_require('departures.confirm');

  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'IN_PROGRESS' AND v_before.actual_departure_at IS NOT NULL THEN
    RETURN v_before;
  END IF;
  IF v_before.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Seule une Course planifiée peut recevoir une autorisation de départ.' USING ERRCODE = '22023';
  END IF;
  IF v_before.client_id IS NULL OR v_before.vehicle_id IS NULL OR v_before.driver_id IS NULL
    OR v_before.planned_departure_at IS NULL OR v_before.planned_arrival_at IS NULL THEN
    RAISE EXCEPTION 'Client, véhicule, chauffeur et dates prévues sont obligatoires avant le départ.' USING ERRCODE = '22023';
  END IF;
  IF v_start_odometer IS NULL OR v_start_odometer < 0 THEN
    RAISE EXCEPTION 'Le kilométrage de départ est obligatoire et doit être valide.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_before.vehicle_id;
  IF NOT FOUND OR v_vehicle.status IS DISTINCT FROM 'EN_SERVICE' THEN
    RAISE EXCEPTION 'Le véhicule affecté est indisponible.' USING ERRCODE = '22023';
  END IF;
  IF v_vehicle.kilometrage IS NOT NULL AND v_start_odometer < v_vehicle.kilometrage THEN
    RAISE EXCEPTION 'Le kilométrage de départ ne peut pas être inférieur au kilométrage connu du véhicule.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_driver FROM public.drivers WHERE id = v_before.driver_id;
  IF NOT FOUND OR lower(coalesce(v_driver.statut, '')) NOT IN ('actif', 'active') THEN
    RAISE EXCEPTION 'Le chauffeur affecté est indisponible.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.transport_missions AS scheduled
    WHERE scheduled.id <> p_mission_id
      AND scheduled.status IN ('PLANNED', 'IN_PROGRESS')
      AND scheduled.overlap_exception_reason IS NULL
      AND v_before.overlap_exception_reason IS NULL
      AND tstzrange(scheduled.planned_departure_at, scheduled.planned_arrival_at, '[)')
          && tstzrange(v_before.planned_departure_at, v_before.planned_arrival_at, '[)')
      AND (scheduled.vehicle_id = v_before.vehicle_id OR scheduled.driver_id = v_before.driver_id)
  ) INTO v_has_conflict;
  IF v_has_conflict THEN
    RAISE EXCEPTION 'Le départ est bloqué car une affectation concurrente est détectée.' USING ERRCODE = '23P01';
  END IF;

  UPDATE public.transport_missions
  SET status = 'IN_PROGRESS',
      actual_departure_at = v_started_at,
      start_odometer = v_start_odometer,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event(
    'COURSE', v_mission.id, NULL, 'DEPARTURE', to_jsonb(v_before), to_jsonb(v_mission)
  );
  RETURN v_mission;
END;
$confirm_transport_departure$;

CREATE OR REPLACE FUNCTION public.confirm_transport_delivery(p_mission_id uuid, p_delivery jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_transport_delivery$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_delivery_status text := upper(coalesce(NULLIF(btrim(p_delivery ->> 'delivery_status'), ''), 'DELIVERED'));
  v_arrived_at timestamptz := NULLIF(p_delivery ->> 'actual_arrival_at', '')::timestamptz;
  v_end_odometer numeric := NULLIF(p_delivery ->> 'end_odometer', '')::numeric;
  v_document_id uuid := NULLIF(p_delivery ->> 'delivery_document_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('deliveries.confirm');

  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'COMPLETED' AND v_before.delivery_status IN ('DELIVERED', 'PARTIAL') THEN
    RETURN v_before;
  END IF;
  IF v_before.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Seule une Course en cours peut être confirmée à la livraison.' USING ERRCODE = '22023';
  END IF;
  IF v_delivery_status NOT IN ('DELIVERED', 'PARTIAL', 'INCIDENT') THEN
    RAISE EXCEPTION 'Statut de livraison invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_delivery_status IN ('DELIVERED', 'PARTIAL') AND v_arrived_at IS NULL THEN
    RAISE EXCEPTION 'La date et l’heure réelles d’arrivée sont obligatoires.' USING ERRCODE = '22023';
  END IF;
  IF v_delivery_status IN ('DELIVERED', 'PARTIAL') AND (v_end_odometer IS NULL OR v_before.start_odometer IS NULL OR v_end_odometer < v_before.start_odometer) THEN
    RAISE EXCEPTION 'Le kilométrage d’arrivée doit être supérieur ou égal au kilométrage de départ.' USING ERRCODE = '22023';
  END IF;
  IF v_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.document_transport_mission_links
    WHERE mission_id = p_mission_id AND document_id = v_document_id
  ) THEN
    RAISE EXCEPTION 'La preuve de livraison doit déjà être liée à cette Course.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.transport_missions
  SET status = CASE WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
      actual_arrival_at = CASE WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') THEN v_arrived_at ELSE actual_arrival_at END,
      end_odometer = CASE WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') THEN v_end_odometer ELSE end_odometer END,
      delivery_status = v_delivery_status,
      delivery_recipient_name = NULLIF(btrim(p_delivery ->> 'recipient_name'), ''),
      delivery_notes = NULLIF(btrim(p_delivery ->> 'notes'), ''),
      delivery_reservations = NULLIF(btrim(p_delivery ->> 'reservations'), ''),
      delivery_document_id = v_document_id,
      delivery_confirmed_at = now(),
      delivery_confirmed_by = auth.uid(),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event(
    'COURSE', v_mission.id, NULL, 'DELIVERY', to_jsonb(v_before), to_jsonb(v_mission)
  );
  RETURN v_mission;
END;
$confirm_transport_delivery$;

CREATE OR REPLACE FUNCTION public.correct_transport_delivery(p_mission_id uuid, p_correction jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $correct_transport_delivery$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_reason text := NULLIF(btrim(p_correction ->> 'reason'), '');
BEGIN
  PERFORM public.permission_require('deliveries.correct');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'La justification de correction est obligatoire.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.delivery_status IS NULL THEN
    RAISE EXCEPTION 'Aucune confirmation de livraison ne peut être corrigée.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transport_missions
  SET status = 'IN_PROGRESS',
      actual_arrival_at = NULL,
      end_odometer = NULL,
      delivery_status = NULL,
      delivery_recipient_name = NULL,
      delivery_notes = concat_ws(E'\n', delivery_notes, 'Correction : ' || v_reason),
      delivery_reservations = NULL,
      delivery_document_id = NULL,
      delivery_confirmed_at = NULL,
      delivery_confirmed_by = NULL,
      delivery_corrected_at = now(),
      delivery_corrected_by = auth.uid(),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event(
    'COURSE', v_mission.id, NULL, 'CORRECT', to_jsonb(v_before), to_jsonb(v_mission) || jsonb_build_object('correction_reason', v_reason)
  );
  RETURN v_mission;
END;
$correct_transport_delivery$;

CREATE OR REPLACE FUNCTION public.get_transport_departure_readiness(p_mission_id uuid)
RETURNS TABLE(check_code text, label text, is_ready boolean, is_blocking boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $get_transport_departure_readiness$
DECLARE
  v_mission public.transport_missions;
  v_vehicle public.vehicles;
  v_driver public.drivers;
  v_has_conflict boolean := false;
BEGIN
  PERFORM public.permission_require('departures.read');
  SELECT * INTO v_mission FROM public.transport_missions WHERE id = p_mission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_mission.vehicle_id IS NOT NULL THEN
    SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_mission.vehicle_id;
  END IF;
  IF v_mission.driver_id IS NOT NULL THEN
    SELECT * INTO v_driver FROM public.drivers WHERE id = v_mission.driver_id;
  END IF;

  IF v_mission.planned_departure_at IS NOT NULL AND v_mission.planned_arrival_at IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.transport_missions AS scheduled
      WHERE scheduled.id <> v_mission.id
        AND scheduled.status IN ('PLANNED', 'IN_PROGRESS')
        AND scheduled.overlap_exception_reason IS NULL
        AND v_mission.overlap_exception_reason IS NULL
        AND tstzrange(scheduled.planned_departure_at, scheduled.planned_arrival_at, '[)')
            && tstzrange(v_mission.planned_departure_at, v_mission.planned_arrival_at, '[)')
        AND (scheduled.vehicle_id = v_mission.vehicle_id OR scheduled.driver_id = v_mission.driver_id)
    ) INTO v_has_conflict;
  END IF;

  RETURN QUERY VALUES
    ('CLIENT', 'Client renseigné', v_mission.client_id IS NOT NULL, true,
      CASE WHEN v_mission.client_id IS NULL THEN 'Un client actif est requis.' ELSE 'Client affecté.' END),
    ('VEHICLE', 'Véhicule affecté', v_mission.vehicle_id IS NOT NULL, true,
      CASE WHEN v_mission.vehicle_id IS NULL THEN 'Aucun véhicule n’est affecté.' ELSE coalesce(v_vehicle.registration, 'Véhicule introuvable.') END),
    ('DRIVER', 'Chauffeur affecté', v_mission.driver_id IS NOT NULL, true,
      CASE WHEN v_mission.driver_id IS NULL THEN 'Aucun chauffeur n’est affecté.' ELSE 'Chauffeur affecté.' END),
    ('DATES', 'Dates valides', v_mission.planned_departure_at IS NOT NULL AND v_mission.planned_arrival_at IS NOT NULL AND v_mission.planned_arrival_at > v_mission.planned_departure_at, true,
      CASE WHEN v_mission.planned_departure_at IS NULL OR v_mission.planned_arrival_at IS NULL THEN 'Les dates prévues sont obligatoires.' ELSE 'Créneau de la Course valide.' END),
    ('VEHICLE_AVAILABILITY', 'Véhicule disponible', v_vehicle.id IS NOT NULL AND v_vehicle.status = 'EN_SERVICE', true,
      CASE WHEN v_vehicle.id IS NULL THEN 'Véhicule introuvable.' WHEN v_vehicle.status <> 'EN_SERVICE' THEN 'Le véhicule n’est pas en service.' ELSE 'Véhicule opérationnel.' END),
    ('DRIVER_AVAILABILITY', 'Chauffeur disponible', v_driver.id IS NOT NULL AND lower(coalesce(v_driver.statut, '')) IN ('actif', 'active'), true,
      CASE WHEN v_driver.id IS NULL THEN 'Chauffeur introuvable.' WHEN lower(coalesce(v_driver.statut, '')) NOT IN ('actif', 'active') THEN 'Le chauffeur n’est pas actif.' ELSE 'Chauffeur disponible.' END),
    ('SCHEDULE_CONFLICT', 'Absence de conflit de planning', NOT v_has_conflict, true,
      CASE WHEN v_has_conflict THEN 'Un conflit actif existe pour le véhicule ou le chauffeur.' WHEN v_mission.overlap_exception_reason IS NOT NULL THEN 'Dérogation de planning justifiée : ' || v_mission.overlap_exception_reason ELSE 'Aucun conflit détecté.' END),
    ('DOCUMENTS', 'Documents obligatoires', true, false, 'Aucune règle de document obligatoire n’est configurée pour les Courses.'),
    ('BUDGET', 'Budget requis', true, false, 'Aucune règle imposant un budget minimum n’est configurée pour les Courses.');
END;
$get_transport_departure_readiness$;

CREATE OR REPLACE FUNCTION public.get_transport_operations_read_access(p_scope text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $get_transport_operations_read_access$
BEGIN
  CASE p_scope
    WHEN 'planning' THEN PERFORM public.permission_require('planning.read');
    WHEN 'assignments' THEN PERFORM public.permission_require('assignments.read');
    WHEN 'departures' THEN PERFORM public.permission_require('departures.read');
    WHEN 'deliveries' THEN PERFORM public.permission_require('deliveries.read');
    ELSE RAISE EXCEPTION 'Espace opérationnel invalide.' USING ERRCODE = '22023';
  END CASE;
  RETURN true;
END;
$get_transport_operations_read_access$;

REVOKE ALL ON FUNCTION public.assign_transport_mission(uuid, jsonb),
  public.confirm_transport_departure(uuid, jsonb),
  public.confirm_transport_delivery(uuid, jsonb),
  public.correct_transport_delivery(uuid, jsonb),
  public.get_transport_departure_readiness(uuid),
  public.get_transport_operations_read_access(text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.assign_transport_mission(uuid, jsonb),
  public.confirm_transport_departure(uuid, jsonb),
  public.confirm_transport_delivery(uuid, jsonb),
  public.correct_transport_delivery(uuid, jsonb),
  public.get_transport_departure_readiness(uuid),
  public.get_transport_operations_read_access(text)
TO authenticated;
