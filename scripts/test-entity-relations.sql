-- Transactional LOT 6 checks. Run with:
-- npx supabase db query --linked --file scripts/test-entity-relations.sql
-- The final ROLLBACK leaves the remote database unchanged.
BEGIN;

DO $test$
<<test>>
DECLARE
  actor_id uuid;
  employee_id uuid;
  driver_a_id uuid;
  driver_b_id uuid;
  vehicle_id uuid;
  motorcycle_id uuid;
  vehicle_assignment public.driver_vehicle_assignments;
  motorcycle_assignment public.driver_motorcycle_assignments;
  document_id uuid;
  contract_id uuid;
BEGIN
  SELECT user_id INTO actor_id FROM public.user_roles
  WHERE role IN ('super_admin', 'admin', 'gestionnaire')
  ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1;
  IF actor_id IS NULL THEN RAISE EXCEPTION 'No business actor available'; END IF;
  PERFORM set_config('request.jwt.claim.sub', actor_id::text, true);

  INSERT INTO public.employees(nom, statut) VALUES ('TEST LOT 6', 'actif') RETURNING id INTO employee_id;
  INSERT INTO public.drivers(employee_id, statut) VALUES (employee_id, 'actif') RETURNING id INTO driver_a_id;
  INSERT INTO public.drivers(statut) VALUES ('actif') RETURNING id INTO driver_b_id;
  INSERT INTO public.vehicles(registration, status) VALUES ('TEST-LOT6-' || substr(gen_random_uuid()::text, 1, 8), 'EN_SERVICE') RETURNING id INTO vehicle_id;
  INSERT INTO public.motorcycles(immatriculation, statut) VALUES ('TEST-LOT6-' || substr(gen_random_uuid()::text, 1, 8), 'actif') RETURNING id INTO motorcycle_id;

  SELECT * INTO vehicle_assignment FROM public.assign_driver_to_vehicle(driver_a_id, vehicle_id, current_date, 'test');
  PERFORM public.assign_driver_to_vehicle(driver_a_id, vehicle_id, current_date, 'idempotent');
  IF (SELECT count(*) FROM public.driver_vehicle_assignments a WHERE a.vehicle_id = test.vehicle_id AND a.status = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'Vehicle assignment was duplicated';
  END IF;
  PERFORM public.assign_driver_to_vehicle(driver_b_id, vehicle_id, current_date, 'replacement');
  IF (SELECT count(*) FROM public.driver_vehicle_assignments a WHERE a.vehicle_id = test.vehicle_id AND a.status = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'Vehicle has more than one active driver';
  END IF;
  IF (SELECT v.driver_id FROM public.vehicles v WHERE v.id = test.vehicle_id) <> test.driver_b_id THEN
    RAISE EXCEPTION 'Vehicle legacy projection was not updated';
  END IF;
  SELECT * INTO vehicle_assignment FROM public.driver_vehicle_assignments a WHERE a.vehicle_id = test.vehicle_id AND a.status = 'ACTIVE';
  PERFORM public.close_driver_vehicle_assignment(vehicle_assignment.id, current_date, 'close');
  IF (SELECT v.driver_id FROM public.vehicles v WHERE v.id = test.vehicle_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle legacy projection was not cleared';
  END IF;

  SELECT * INTO motorcycle_assignment FROM public.assign_driver_to_motorcycle(driver_a_id, motorcycle_id, current_date, 'test');
  IF (SELECT count(*) FROM public.driver_motorcycle_assignments a WHERE a.motorcycle_id = test.motorcycle_id AND a.status = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'Motorcycle assignment was not created';
  END IF;
  PERFORM public.close_driver_motorcycle_assignment(motorcycle_assignment.id, current_date, 'close');

  SELECT id INTO document_id FROM public.create_document_with_relation(
    jsonb_build_object('nom', 'test.pdf', 'type', 'TEST', 'url', 'https://example.invalid/test.pdf'), 'employee', employee_id
  );
  IF NOT EXISTS (SELECT 1 FROM public.document_employee_links l WHERE l.document_id = test.document_id AND l.employee_id = test.employee_id) THEN
    RAISE EXCEPTION 'Explicit employee document link was not created';
  END IF;
  PERFORM public.archive_document(document_id);
  IF (SELECT d.archived_at IS NOT NULL FROM public.documents d WHERE d.id = test.document_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Document archive failed';
  END IF;

  SELECT id INTO contract_id FROM public.create_contract_with_relations(
    jsonb_build_object('reference', 'TEST-LOT6'), jsonb_build_object('employee_ids', jsonb_build_array(employee_id), 'vehicle_ids', jsonb_build_array(vehicle_id))
  );
  IF NOT EXISTS (SELECT 1 FROM public.contract_employee_links l WHERE l.contract_id = test.contract_id AND l.employee_id = test.employee_id)
    OR NOT EXISTS (SELECT 1 FROM public.contract_vehicle_links l WHERE l.contract_id = test.contract_id AND l.vehicle_id = test.vehicle_id) THEN
    RAISE EXCEPTION 'Explicit contract links were not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'driver_vehicle_assignments' AND policyname = 'driver_vehicle_assignments_read')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'document_employee_links' AND policyname = 'document_employee_links_read') THEN
    RAISE EXCEPTION 'Required relation RLS policies are missing';
  END IF;
END
$test$;

ROLLBACK;
