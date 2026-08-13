-- COURSES-FINAL: odometer readings must never block operations when unknown.
-- Partial historical readings remain honest; a distance exists only when both
-- readings are present and coherent.

ALTER TABLE public.transport_missions
  DROP CONSTRAINT IF EXISTS transport_missions_odometer_check;
ALTER TABLE public.transport_missions
  ADD CONSTRAINT transport_missions_odometer_check CHECK (
    (start_odometer IS NULL OR start_odometer >= 0)
    AND (end_odometer IS NULL OR end_odometer >= 0)
    AND (start_odometer IS NULL OR end_odometer IS NULL OR end_odometer >= start_odometer)
  );

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
  IF v_start_odometer IS NOT NULL AND v_start_odometer < 0 THEN
    RAISE EXCEPTION 'Le kilométrage de départ ne peut pas être négatif.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_before.vehicle_id;
  IF NOT FOUND OR v_vehicle.status IS DISTINCT FROM 'EN_SERVICE' THEN
    RAISE EXCEPTION 'Le véhicule affecté est indisponible.' USING ERRCODE = '22023';
  END IF;
  IF v_start_odometer IS NOT NULL
    AND v_vehicle.kilometrage IS NOT NULL
    AND v_start_odometer < v_vehicle.kilometrage THEN
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
  v_start_odometer numeric := NULLIF(p_delivery ->> 'start_odometer', '')::numeric;
  v_end_odometer numeric := NULLIF(p_delivery ->> 'end_odometer', '')::numeric;
  v_document_id uuid := NULLIF(p_delivery ->> 'delivery_document_id', '')::uuid;
  v_effective_start_odometer numeric;
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
    RAISE EXCEPTION 'La date et l''heure réelles d''arrivée sont obligatoires.' USING ERRCODE = '22023';
  END IF;
  IF v_start_odometer IS NOT NULL AND v_start_odometer < 0 THEN
    RAISE EXCEPTION 'Le kilométrage de départ ne peut pas être négatif.' USING ERRCODE = '22023';
  END IF;
  IF v_end_odometer IS NOT NULL AND v_end_odometer < 0 THEN
    RAISE EXCEPTION 'Le kilométrage d''arrivée ne peut pas être négatif.' USING ERRCODE = '22023';
  END IF;

  v_effective_start_odometer := COALESCE(v_before.start_odometer, v_start_odometer);
  IF v_delivery_status IN ('DELIVERED', 'PARTIAL')
    AND v_end_odometer IS NOT NULL
    AND v_effective_start_odometer IS NOT NULL
    AND v_end_odometer < v_effective_start_odometer THEN
    RAISE EXCEPTION 'Le kilométrage d''arrivée doit être supérieur ou égal au kilométrage de départ.' USING ERRCODE = '22023';
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
      start_odometer = COALESCE(start_odometer, v_start_odometer),
      end_odometer = CASE
        WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') AND v_end_odometer IS NOT NULL THEN v_end_odometer
        ELSE end_odometer
      END,
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
