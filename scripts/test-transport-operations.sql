-- EXP-01 operational workflow tests.
-- Run only after 20260801140000_add_transport_operations.sql is applied.
-- This script always finishes with ROLLBACK and keeps no test data.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_client public.transport_clients;
  v_vehicle_id uuid;
  v_other_vehicle_id uuid;
  v_driver_id uuid;
  v_other_driver_id uuid;
  v_course public.transport_missions;
  v_incident_course public.transport_missions;
  v_readiness record;
  v_departure_audit_count integer;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_departure_at timestamptz := date_trunc('hour', now()) + interval '4 days';
  v_arrival_at timestamptz := date_trunc('hour', now()) + interval '4 days 5 hours';
BEGIN
  IF to_regprocedure('public.assign_transport_mission(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.confirm_transport_departure(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.confirm_transport_delivery(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.correct_transport_delivery(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.get_transport_departure_readiness(uuid)') IS NULL THEN
    RAISE EXCEPTION 'EXP-01 RPCs are missing';
  END IF;
  IF has_function_privilege('anon', 'public.assign_transport_mission(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_transport_departure(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_transport_delivery(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.correct_transport_delivery(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute EXP-01 mutation RPCs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.transport_missions'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'transport_missions must retain RLS';
  END IF;

  SELECT user_role.user_id INTO v_actor_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE NOTICE 'EXP-01 lifecycle test skipped: an active super_admin is required.';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('EXP-01-' || v_suffix, 'actif', 'Référentiel transactionnel EXP-01')
  RETURNING id INTO v_driver_id;
  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('EXP-01-ALT-' || v_suffix, 'actif', 'Référentiel transactionnel EXP-01')
  RETURNING id INTO v_other_driver_id;
  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('EXP-' || upper(v_suffix), 'EN_SERVICE', 'Référentiel transactionnel EXP-01')
  RETURNING id INTO v_vehicle_id;
  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('EXP-ALT-' || upper(v_suffix), 'EN_SERVICE', 'Référentiel transactionnel EXP-01')
  RETURNING id INTO v_other_vehicle_id;

  v_client := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', 'Client EXP-01 ' || v_suffix,
    'country_code', 'SN',
    'telephone', '+221 78 ' || substr(v_suffix, 1, 6),
    'email', 'exp-' || lower(v_suffix) || '@example.test',
    'registration_identifier_type', null,
    'registration_identifier_value', null
  ));

  v_course := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'departure_location', 'Dakar',
    'destination_location', 'Thiès',
    'cargo_description', 'Marchandise de test EXP-01',
    'planned_departure_at', v_departure_at,
    'planned_arrival_at', v_arrival_at,
    'quoted_amount', 100000
  ));
  v_course := public.set_transport_mission_status(v_course.id, 'PLANNED', null);

  v_course := public.assign_transport_mission(v_course.id, jsonb_build_object(
    'vehicle_id', v_vehicle_id,
    'driver_id', v_driver_id,
    'override_reason', null
  ));
  IF v_course.vehicle_id <> v_vehicle_id OR v_course.driver_id <> v_driver_id THEN
    RAISE EXCEPTION 'A valid assignment must persist the vehicle and driver';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_finance_audit
    WHERE source_type = 'COURSE' AND source_id = v_course.id AND action = 'ASSIGN'
  ) THEN
    RAISE EXCEPTION 'A Course assignment must be audited';
  END IF;

  v_incident_course := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'vehicle_id', v_other_vehicle_id,
    'driver_id', v_other_driver_id,
    'departure_location', 'Dakar',
    'destination_location', 'Thiès',
    'cargo_description', 'Course de conflit EXP-01',
    'planned_departure_at', v_departure_at,
    'planned_arrival_at', v_arrival_at,
    'quoted_amount', 10000
  ));
  v_incident_course := public.set_transport_mission_status(v_incident_course.id, 'PLANNED', null);

  BEGIN
    PERFORM public.assign_transport_mission(v_incident_course.id, jsonb_build_object(
      'vehicle_id', v_vehicle_id,
      'driver_id', v_other_driver_id,
      'override_reason', null
    ));
    RAISE EXCEPTION 'A vehicle scheduling conflict must be rejected';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.assign_transport_mission(v_incident_course.id, jsonb_build_object(
      'vehicle_id', v_other_vehicle_id,
      'driver_id', v_driver_id,
      'override_reason', null
    ));
    RAISE EXCEPTION 'A driver scheduling conflict must be rejected';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  SELECT * INTO v_readiness
  FROM public.get_transport_departure_readiness(v_course.id)
  WHERE check_code = 'SCHEDULE_CONFLICT';
  IF NOT v_readiness.is_ready THEN
    RAISE EXCEPTION 'A valid Course must be ready to depart';
  END IF;

  v_course := public.confirm_transport_departure(v_course.id, jsonb_build_object(
    'actual_departure_at', v_departure_at,
    'start_odometer', 125000
  ));
  IF v_course.status <> 'IN_PROGRESS' OR v_course.start_odometer <> 125000 THEN
    RAISE EXCEPTION 'A valid departure must set IN_PROGRESS and retain the starting odometer';
  END IF;
  PERFORM public.confirm_transport_departure(v_course.id, jsonb_build_object(
    'actual_departure_at', v_departure_at,
    'start_odometer', 125000
  ));
  SELECT count(*) INTO v_departure_audit_count
  FROM public.business_finance_audit
  WHERE source_type = 'COURSE' AND source_id = v_course.id AND action = 'DEPARTURE';
  IF v_departure_audit_count <> 1 THEN
    RAISE EXCEPTION 'A repeated departure confirmation must be idempotent';
  END IF;

  BEGIN
    PERFORM public.confirm_transport_delivery(v_course.id, jsonb_build_object(
      'delivery_status', 'DELIVERED',
      'actual_arrival_at', v_arrival_at,
      'end_odometer', 124999
    ));
    RAISE EXCEPTION 'An incoherent arrival odometer must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_course := public.confirm_transport_delivery(v_course.id, jsonb_build_object(
    'delivery_status', 'DELIVERED',
    'actual_arrival_at', v_arrival_at,
    'end_odometer', 125450,
    'recipient_name', 'Réception EXP-01',
    'notes', 'Livraison complète',
    'reservations', null,
    'delivery_document_id', null
  ));
  IF v_course.status <> 'COMPLETED' OR v_course.delivery_status <> 'DELIVERED' OR v_course.end_odometer <> 125450 THEN
    RAISE EXCEPTION 'A completed delivery must finish the Course and retain its data';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_finance_audit
    WHERE source_type = 'COURSE' AND source_id = v_course.id AND action = 'DELIVERY'
  ) THEN
    RAISE EXCEPTION 'A delivery must be audited';
  END IF;

  v_incident_course := public.confirm_transport_departure(v_incident_course.id, jsonb_build_object(
    'actual_departure_at', v_departure_at + interval '1 day',
    'start_odometer', 200000
  ));
  v_incident_course := public.confirm_transport_delivery(v_incident_course.id, jsonb_build_object(
    'delivery_status', 'INCIDENT',
    'actual_arrival_at', null,
    'end_odometer', null,
    'recipient_name', null,
    'notes', 'Incident de test',
    'reservations', null,
    'delivery_document_id', null
  ));
  IF v_incident_course.status <> 'IN_PROGRESS' OR v_incident_course.delivery_status <> 'INCIDENT' THEN
    RAISE EXCEPTION 'An incident must preserve the Course as in progress';
  END IF;
  v_incident_course := public.correct_transport_delivery(v_incident_course.id, jsonb_build_object('reason', 'Correction de test EXP-01'));
  IF v_incident_course.delivery_status IS NOT NULL OR v_incident_course.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'A delivery correction must reopen the operational confirmation without deleting history';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_finance_audit
    WHERE source_type = 'COURSE' AND source_id = v_incident_course.id AND action = 'CORRECT'
  ) THEN
    RAISE EXCEPTION 'A delivery correction must be audited';
  END IF;
END;
$test$;

ROLLBACK;
