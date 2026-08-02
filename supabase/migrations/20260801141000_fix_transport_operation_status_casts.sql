-- EXP-01 corrective migration: drivers.statut is a statut_general enum.
-- Cast it to text before applying text functions; no tables, policies,
-- permissions, constraints, finance operations or wallet balances are changed.

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
  IF NOT FOUND OR lower(coalesce(v_driver.statut::text, '')) NOT IN ('actif', 'active') THEN
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
  IF NOT FOUND OR lower(coalesce(v_driver.statut::text, '')) NOT IN ('actif', 'active') THEN
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
    ('DRIVER_AVAILABILITY', 'Chauffeur disponible', v_driver.id IS NOT NULL AND lower(coalesce(v_driver.statut::text, '')) IN ('actif', 'active'), true,
      CASE WHEN v_driver.id IS NULL THEN 'Chauffeur introuvable.' WHEN lower(coalesce(v_driver.statut::text, '')) NOT IN ('actif', 'active') THEN 'Le chauffeur n’est pas actif.' ELSE 'Chauffeur disponible.' END),
    ('SCHEDULE_CONFLICT', 'Absence de conflit de planning', NOT v_has_conflict, true,
      CASE WHEN v_has_conflict THEN 'Un conflit actif existe pour le véhicule ou le chauffeur.' WHEN v_mission.overlap_exception_reason IS NOT NULL THEN 'Dérogation de planning justifiée : ' || v_mission.overlap_exception_reason ELSE 'Aucun conflit détecté.' END),
    ('DOCUMENTS', 'Documents obligatoires', true, false, 'Aucune règle de document obligatoire n’est configurée pour les Courses.'),
    ('BUDGET', 'Budget requis', true, false, 'Aucune règle imposant un budget minimum n’est configurée pour les Courses.');
END;
$get_transport_departure_readiness$;
