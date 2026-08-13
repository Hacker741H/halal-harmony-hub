-- COURSES-02: Kwame real-data workflow and A-R regression tests.
-- Transactional by design: every fixture and wallet effect is rolled back.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_client public.transport_clients;
  v_vehicle_id uuid;
  v_driver_id uuid;
  v_course public.transport_missions;
  v_unknown public.transport_missions;
  v_tonne public.transport_missions;
  v_flat public.transport_missions;
  v_expense_1 public.transport_mission_expenses;
  v_expense_2 public.transport_mission_expenses;
  v_expense_3 public.transport_mission_expenses;
  v_invoice public.transport_invoices;
  v_payment public.transport_invoice_payments;
  v_summary record;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_departure timestamptz := date_trunc('hour', now()) + interval '1 day 14 hours';
  v_arrival timestamptz := date_trunc('hour', now()) + interval '1 day 18 hours';
  v_before_links bigint;
BEGIN
  SELECT user_role.user_id INTO v_actor_id
  FROM public.user_roles user_role
  JOIN public.roles role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at LIMIT 1;
  SELECT id INTO v_wallet_id FROM public.wallets ORDER BY is_default DESC NULLS LAST, created_at LIMIT 1;
  IF v_actor_id IS NULL OR v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'COURSES-02 requires an active super_admin and one wallet.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  IF has_function_privilege('anon', 'public.update_transport_mission_actuals(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P: actual-data corrections must not be executable by anon';
  END IF;

  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES ('C02-' || v_suffix, 'actif', 'COURSES-02 Kwame') RETURNING id INTO v_driver_id;
  INSERT INTO public.vehicles(registration, status, description)
  VALUES ('C02-' || upper(v_suffix), 'EN_SERVICE', 'COURSES-02 Kwame') RETURNING id INTO v_vehicle_id;
  v_client := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION', 'display_name', 'Kwame ' || v_suffix, 'country_code', 'CI',
    'telephone', '+225 07 ' || substr(v_suffix, 1, 6),
    'email', 'kwame-' || lower(v_suffix) || '@example.test',
    'registration_identifier_type', null, 'registration_identifier_value', null
  ));

  -- A, B, C, H, M and R: minimal honest creation, no budget and no finance effect.
  v_course := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id, 'cargo_description', 'EVA',
    'departure_location', 'Abidjan', 'destination_location', 'Yamoussoukro',
    'planned_departure_at', v_departure, 'planned_arrival_at', v_arrival,
    'pricing_mode', 'PER_KG', 'unit_rate', 15
  ));
  IF v_course.status <> 'DRAFT' OR v_course.cargo_weight_kg IS NOT NULL
    OR v_course.actual_transport_amount IS NOT NULL OR v_course.quoted_amount IS NOT NULL
    OR v_course.start_odometer IS NOT NULL OR v_course.end_odometer IS NOT NULL THEN
    RAISE EXCEPTION 'A/B/C/H: unknown real values must stay NULL at creation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transport_mission_budget_lines WHERE mission_id = v_course.id) THEN
    RAISE EXCEPTION 'M: a real-data Course must not create planned expenses';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_transport_mission_expense_links link JOIN public.transport_mission_expenses expense ON expense.id = link.expense_id WHERE expense.mission_id = v_course.id)
    OR EXISTS (SELECT 1 FROM public.finance_transport_payment_links link JOIN public.transport_invoice_payments payment ON payment.id = link.payment_id WHERE payment.mission_id = v_course.id) THEN
    RAISE EXCEPTION 'R: Course creation must not create finance operations';
  END IF;

  -- Assignment remains on the same draft Course, then operational start without odometer.
  v_course := public.assign_transport_mission(v_course.id, jsonb_build_object(
    'vehicle_id', v_vehicle_id, 'driver_id', v_driver_id, 'override_reason', null
  ));
  v_course := public.set_transport_mission_status(v_course.id, 'PLANNED', null);
  v_course := public.confirm_transport_departure(v_course.id, jsonb_build_object(
    'actual_departure_at', v_departure, 'start_odometer', null
  ));
  IF v_course.status <> 'IN_PROGRESS' OR v_course.start_odometer IS NOT NULL THEN
    RAISE EXCEPTION 'I: departure without odometer must remain valid';
  END IF;

  -- D, E, J and K: weight and both readings become known only at delivery.
  v_course := public.update_transport_mission_actuals(v_course.id, jsonb_build_object(
    'cargo_weight_kg', 3000, 'pricing_mode', 'PER_KG', 'unit_rate', 15,
    'start_odometer', 125000, 'end_odometer', 125180
  ));
  IF v_course.actual_transport_amount <> 45000 OR v_course.end_odometer - v_course.start_odometer <> 180 THEN
    RAISE EXCEPTION 'D/E/J: expected 45,000 FCFA and 180 km';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_transport_payment_links link JOIN public.transport_invoice_payments payment ON payment.id = link.payment_id WHERE payment.mission_id = v_course.id) THEN
    RAISE EXCEPTION 'R: determining the real transport amount must not create revenue';
  END IF;
  BEGIN
    PERFORM public.update_transport_mission_actuals(v_course.id, jsonb_build_object('end_odometer', 124999));
    RAISE EXCEPTION 'K: arrival below departure should have failed';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_course := public.confirm_transport_delivery(v_course.id, jsonb_build_object(
    'delivery_status', 'DELIVERED', 'actual_arrival_at', v_arrival,
    'start_odometer', 125000, 'end_odometer', 125180,
    'recipient_name', 'Kwame', 'notes', 'Livraison réelle', 'reservations', null,
    'delivery_document_id', null
  ));

  -- L and Q: three confirmed actual expenses, each linked exactly once.
  v_expense_1 := public.create_transport_mission_expense(v_course.id, jsonb_build_object('wallet_id', v_wallet_id, 'category', 'FUEL', 'amount', 8000, 'expense_date', current_date, 'status', 'ENGAGED'));
  v_expense_2 := public.create_transport_mission_expense(v_course.id, jsonb_build_object('wallet_id', v_wallet_id, 'category', 'ROAD', 'amount', 2000, 'expense_date', current_date, 'status', 'ENGAGED'));
  v_expense_3 := public.create_transport_mission_expense(v_course.id, jsonb_build_object('wallet_id', v_wallet_id, 'category', 'HANDLING', 'amount', 2000, 'expense_date', current_date, 'status', 'ENGAGED'));
  v_expense_1 := public.confirm_transport_mission_expense(v_expense_1.id);
  v_expense_2 := public.confirm_transport_mission_expense(v_expense_2.id);
  v_expense_3 := public.confirm_transport_mission_expense(v_expense_3.id);
  SELECT count(*) INTO v_before_links FROM public.finance_transport_mission_expense_links
  WHERE expense_id IN (v_expense_1.id, v_expense_2.id, v_expense_3.id) AND link_type = 'EXPENSE';
  PERFORM public.confirm_transport_mission_expense(v_expense_1.id);
  IF v_before_links <> 3 OR (SELECT count(*) FROM public.finance_transport_mission_expense_links WHERE expense_id IN (v_expense_1.id, v_expense_2.id, v_expense_3.id) AND link_type = 'EXPENSE') <> 3 THEN
    RAISE EXCEPTION 'L/Q: confirmed expenses must create exactly three finance links, with no duplicate';
  END IF;
  SELECT * INTO v_summary FROM public.get_transport_mission_financial_summary(v_course.id);
  IF v_summary.quoted_amount <> 45000 OR v_summary.actual_expenses <> 12000 OR v_summary.gross_result <> 33000 THEN
    RAISE EXCEPTION 'L: expected transport 45,000, expenses 12,000 and result 33,000';
  END IF;

  -- F and G: tonne conversion is explicit; flat pricing is independent of weight.
  v_tonne := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id, 'cargo_description', 'EVA tonne', 'departure_location', 'Abidjan',
    'cargo_weight_kg', 3000, 'pricing_mode', 'PER_TONNE', 'unit_rate', 15000
  ));
  v_flat := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id, 'cargo_description', 'EVA forfait', 'departure_location', 'Abidjan',
    'pricing_mode', 'FLAT', 'actual_transport_amount', 50000
  ));
  IF v_tonne.actual_transport_amount <> 45000 OR v_flat.actual_transport_amount <> 50000 THEN
    RAISE EXCEPTION 'F/G: tonne or flat pricing calculation failed';
  END IF;

  -- N: a partial old-style Course remains honest; missing values are not backfilled.
  v_unknown := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id, 'cargo_description', 'Historique partiel', 'departure_location', 'Abidjan'
  ));
  v_unknown := public.update_transport_mission_actuals(v_unknown.id, jsonb_build_object('start_odometer', 10));
  IF v_unknown.end_odometer IS NOT NULL OR v_unknown.actual_transport_amount IS NOT NULL THEN
    RAISE EXCEPTION 'N: a partial historical Course must stay partial';
  END IF;

  -- O and P: post-final correction is audited and unauthorized users are denied.
  v_course := public.update_transport_mission_actuals(v_course.id, jsonb_build_object(
    'destination_location', 'Yamoussoukro Centre', 'reason', 'Correction destination confirmée par Kwame'
  ));
  IF NOT EXISTS (SELECT 1 FROM public.business_finance_audit WHERE source_type = 'COURSE' AND source_id = v_course.id AND action = 'CORRECT' AND performed_by = v_actor_id) THEN
    RAISE EXCEPTION 'O: post-final correction must be audited';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.update_transport_mission_actuals(v_unknown.id, jsonb_build_object('cargo_weight_kg', 1));
    RAISE EXCEPTION 'P: unauthorized correction should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  -- Finance is created only through an issued invoice and confirmed payment; retries are idempotent.
  v_invoice := public.create_transport_invoice(v_course.id, jsonb_build_object('subtotal_amount', 45000, 'tax_rate', 0));
  v_invoice := public.issue_transport_invoice(v_invoice.id);
  v_payment := public.create_transport_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id, 'amount', 45000, 'payment_date', current_date,
    'payment_kind', 'SETTLEMENT', 'reference', 'KWAME-' || v_suffix
  ));
  v_payment := public.confirm_transport_invoice_payment(v_payment.id);
  PERFORM public.confirm_transport_invoice_payment(v_payment.id);
  IF (SELECT count(*) FROM public.finance_transport_payment_links WHERE payment_id = v_payment.id AND link_type = 'PAYMENT') <> 1 THEN
    RAISE EXCEPTION 'Q: confirmed payment must create one revenue link only';
  END IF;
  BEGIN
    PERFORM public.update_transport_mission_actuals(v_course.id, jsonb_build_object(
      'unit_rate', 16, 'reason', 'Tentative de correction financière'
    ));
    RAISE EXCEPTION 'O: an active invoice must block silent amount mutation';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$test$;

ROLLBACK;
