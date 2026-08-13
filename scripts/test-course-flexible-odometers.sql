-- COURSES-FINAL: flexible odometer workflow regression tests (A-K).
-- This script always rolls back and leaves no test data.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_client public.transport_clients;
  v_vehicle_1 uuid;
  v_vehicle_2 uuid;
  v_vehicle_3 uuid;
  v_vehicle_4 uuid;
  v_driver_1 uuid;
  v_driver_2 uuid;
  v_driver_3 uuid;
  v_driver_4 uuid;
  v_no_odometer public.transport_missions;
  v_measured public.transport_missions;
  v_repaired public.transport_missions;
  v_end_only public.transport_missions;
  v_readiness record;
  v_financial record;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_base timestamptz := date_trunc('hour', now()) + interval '20 days';
BEGIN
  SELECT user_role.user_id INTO v_actor_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE NOTICE 'COURSES-FINAL skipped: an active super_admin is required.';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  IF has_function_privilege('anon', 'public.confirm_transport_departure(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_transport_delivery(uuid,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.correct_transport_delivery(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Operational mutation RPCs must remain unavailable to anon';
  END IF;

  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('CF-1-' || v_suffix, 'actif', 'COURSES-FINAL') RETURNING id INTO v_driver_1;
  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('CF-2-' || v_suffix, 'actif', 'COURSES-FINAL') RETURNING id INTO v_driver_2;
  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('CF-3-' || v_suffix, 'actif', 'COURSES-FINAL') RETURNING id INTO v_driver_3;
  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('CF-4-' || v_suffix, 'actif', 'COURSES-FINAL') RETURNING id INTO v_driver_4;

  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('CF1-' || upper(v_suffix), 'EN_SERVICE', 'COURSES-FINAL') RETURNING id INTO v_vehicle_1;
  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('CF2-' || upper(v_suffix), 'EN_SERVICE', 'COURSES-FINAL') RETURNING id INTO v_vehicle_2;
  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('CF3-' || upper(v_suffix), 'EN_SERVICE', 'COURSES-FINAL') RETURNING id INTO v_vehicle_3;
  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('CF4-' || upper(v_suffix), 'EN_SERVICE', 'COURSES-FINAL') RETURNING id INTO v_vehicle_4;

  v_client := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', 'Client COURSES-FINAL ' || v_suffix,
    'country_code', 'CI',
    'telephone', '+225 07 ' || substr(v_suffix, 1, 6),
    'email', 'courses-final-' || lower(v_suffix) || '@example.test',
    'registration_identifier_type', null,
    'registration_identifier_value', null
  ));

  -- A: creation and planning without either odometer.
  v_no_odometer := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'departure_location', 'Abidjan',
    'destination_location', 'Bouaké',
    'planned_departure_at', v_base,
    'planned_arrival_at', v_base + interval '5 hours',
    'quoted_amount', 100000
  ));
  IF v_no_odometer.start_odometer IS NOT NULL OR v_no_odometer.end_odometer IS NOT NULL THEN
    RAISE EXCEPTION 'A: odometers must remain null when unknown';
  END IF;
  v_no_odometer := public.set_transport_mission_status(v_no_odometer.id, 'PLANNED', null);
  v_no_odometer := public.assign_transport_mission(v_no_odometer.id, jsonb_build_object(
    'vehicle_id', v_vehicle_1, 'driver_id', v_driver_1, 'override_reason', null
  ));
  IF v_no_odometer.vehicle_id <> v_vehicle_1 OR v_no_odometer.driver_id <> v_driver_1 THEN
    RAISE EXCEPTION 'J: assignment must remain functional';
  END IF;
  SELECT * INTO v_readiness FROM public.get_transport_departure_readiness(v_no_odometer.id)
  WHERE check_code = 'SCHEDULE_CONFLICT';
  IF NOT v_readiness.is_ready THEN
    RAISE EXCEPTION 'J: a valid assignment must remain ready';
  END IF;

  -- B and I: departure and delivery may remain historically without readings.
  v_no_odometer := public.confirm_transport_departure(v_no_odometer.id, jsonb_build_object(
    'actual_departure_at', v_base,
    'start_odometer', null
  ));
  IF v_no_odometer.status <> 'IN_PROGRESS' OR v_no_odometer.start_odometer IS NOT NULL THEN
    RAISE EXCEPTION 'B: departure without odometer must be accepted';
  END IF;
  v_no_odometer := public.confirm_transport_delivery(v_no_odometer.id, jsonb_build_object(
    'delivery_status', 'DELIVERED',
    'actual_arrival_at', v_base + interval '5 hours',
    'start_odometer', null,
    'end_odometer', null,
    'recipient_name', 'Réception test',
    'notes', null,
    'reservations', null,
    'delivery_document_id', null
  ));
  IF v_no_odometer.status <> 'COMPLETED'
    OR v_no_odometer.start_odometer IS NOT NULL
    OR v_no_odometer.end_odometer IS NOT NULL THEN
    RAISE EXCEPTION 'I: null legacy readings must remain honest after delivery';
  END IF;

  -- C, D, F and G: known departure, coherent distance and explicit refusals.
  v_measured := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'departure_location', 'Abidjan',
    'destination_location', 'Yamoussoukro',
    'planned_departure_at', v_base + interval '1 day',
    'planned_arrival_at', v_base + interval '1 day 4 hours',
    'quoted_amount', 120000
  ));
  v_measured := public.set_transport_mission_status(v_measured.id, 'PLANNED', null);
  v_measured := public.assign_transport_mission(v_measured.id, jsonb_build_object(
    'vehicle_id', v_vehicle_2, 'driver_id', v_driver_2, 'override_reason', null
  ));
  BEGIN
    PERFORM public.confirm_transport_departure(v_measured.id, jsonb_build_object(
      'actual_departure_at', v_base + interval '1 day', 'start_odometer', -1
    ));
    RAISE EXCEPTION 'G: a negative departure reading must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_measured := public.confirm_transport_departure(v_measured.id, jsonb_build_object(
    'actual_departure_at', v_base + interval '1 day', 'start_odometer', 125000
  ));
  IF v_measured.start_odometer <> 125000 THEN
    RAISE EXCEPTION 'C: the known departure reading must persist';
  END IF;
  BEGIN
    PERFORM public.confirm_transport_delivery(v_measured.id, jsonb_build_object(
      'delivery_status', 'DELIVERED', 'actual_arrival_at', v_base + interval '1 day 4 hours',
      'end_odometer', 124999
    ));
    RAISE EXCEPTION 'F: arrival below departure must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.confirm_transport_delivery(v_measured.id, jsonb_build_object(
      'delivery_status', 'DELIVERED', 'actual_arrival_at', v_base + interval '1 day 4 hours',
      'end_odometer', -1
    ));
    RAISE EXCEPTION 'G: a negative arrival reading must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_measured := public.confirm_transport_delivery(v_measured.id, jsonb_build_object(
    'delivery_status', 'DELIVERED',
    'actual_arrival_at', v_base + interval '1 day 4 hours',
    'end_odometer', 125180,
    'recipient_name', 'Réception test',
    'notes', null,
    'reservations', null,
    'delivery_document_id', null
  ));
  IF v_measured.end_odometer - v_measured.start_odometer <> 180 THEN
    RAISE EXCEPTION 'D: actual distance must equal 180 km';
  END IF;
  IF v_measured.delivery_confirmed_by <> v_actor_id OR v_measured.delivery_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Delivery actor and timestamp must remain auditable';
  END IF;

  -- H: correction remains permissioned and audited through the existing engine.
  v_measured := public.correct_transport_delivery(v_measured.id, jsonb_build_object(
    'reason', 'Correction kilométrique COURSES-FINAL'
  ));
  IF v_measured.status <> 'IN_PROGRESS' OR v_measured.end_odometer IS NOT NULL THEN
    RAISE EXCEPTION 'H: correction must reopen delivery and clear its arrival reading';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_finance_audit
    WHERE source_type = 'COURSE' AND source_id = v_measured.id AND action = 'CORRECT'
      AND performed_by = v_actor_id
  ) THEN
    RAISE EXCEPTION 'H: correction must be permissioned and audited';
  END IF;

  -- E: a missing departure reading can be completed together with arrival.
  v_repaired := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'departure_location', 'Abidjan',
    'destination_location', 'San Pedro',
    'planned_departure_at', v_base + interval '2 days',
    'planned_arrival_at', v_base + interval '2 days 7 hours',
    'quoted_amount', 150000
  ));
  v_repaired := public.set_transport_mission_status(v_repaired.id, 'PLANNED', null);
  v_repaired := public.assign_transport_mission(v_repaired.id, jsonb_build_object(
    'vehicle_id', v_vehicle_3, 'driver_id', v_driver_3, 'override_reason', null
  ));
  v_repaired := public.confirm_transport_departure(v_repaired.id, jsonb_build_object(
    'actual_departure_at', v_base + interval '2 days', 'start_odometer', null
  ));
  v_repaired := public.confirm_transport_delivery(v_repaired.id, jsonb_build_object(
    'delivery_status', 'DELIVERED',
    'actual_arrival_at', v_base + interval '2 days 7 hours',
    'start_odometer', 125000,
    'end_odometer', 125180,
    'recipient_name', null,
    'notes', null,
    'reservations', null,
    'delivery_document_id', null
  ));
  IF v_repaired.start_odometer <> 125000 OR v_repaired.end_odometer <> 125180 THEN
    RAISE EXCEPTION 'E: both readings supplied at delivery must persist';
  END IF;

  -- I: an end-only historical reading is valid but must not invent distance.
  v_end_only := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'departure_location', 'Abidjan',
    'destination_location', 'Daloa',
    'planned_departure_at', v_base + interval '3 days',
    'planned_arrival_at', v_base + interval '3 days 6 hours',
    'quoted_amount', 130000
  ));
  v_end_only := public.set_transport_mission_status(v_end_only.id, 'PLANNED', null);
  v_end_only := public.assign_transport_mission(v_end_only.id, jsonb_build_object(
    'vehicle_id', v_vehicle_4, 'driver_id', v_driver_4, 'override_reason', null
  ));
  v_end_only := public.confirm_transport_departure(v_end_only.id, jsonb_build_object(
    'actual_departure_at', v_base + interval '3 days', 'start_odometer', null
  ));
  v_end_only := public.confirm_transport_delivery(v_end_only.id, jsonb_build_object(
    'delivery_status', 'DELIVERED',
    'actual_arrival_at', v_base + interval '3 days 6 hours',
    'start_odometer', null,
    'end_odometer', 130000,
    'recipient_name', null,
    'notes', null,
    'reservations', null,
    'delivery_document_id', null
  ));
  IF v_end_only.start_odometer IS NOT NULL OR v_end_only.end_odometer <> 130000 THEN
    RAISE EXCEPTION 'I: a partial historical reading must remain unchanged';
  END IF;
  SELECT * INTO v_financial
  FROM public.get_transport_mission_financial_summary(v_end_only.id);
  IF v_financial.cost_per_km IS NOT NULL THEN
    RAISE EXCEPTION 'I: a distance-dependent metric must remain null with one reading missing';
  END IF;

  -- K: odometer operations must not create unrelated finance/document rows.
  IF EXISTS (SELECT 1 FROM public.transport_invoices WHERE mission_id IN (v_no_odometer.id, v_measured.id, v_repaired.id, v_end_only.id))
    OR EXISTS (SELECT 1 FROM public.document_transport_mission_links WHERE mission_id IN (v_no_odometer.id, v_measured.id, v_repaired.id, v_end_only.id)) THEN
    RAISE EXCEPTION 'K: odometer workflow must not mutate payments or documents';
  END IF;
END;
$test$;

ROLLBACK;
