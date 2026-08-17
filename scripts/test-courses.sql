-- MT-03 transport Courses tests. Run after 20260731130000_add_transport_courses.sql.
-- The test is entirely transactional: it creates no durable client, Course,
-- finance operation, or wallet movement.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_other_driver_id uuid;
  v_other_vehicle_id uuid;
  v_draft_course public.transport_missions;
  v_archived_course public.transport_missions;
  v_planned_deletion_course public.transport_missions;
  v_accepted_course public.transport_missions;
  v_departure_at timestamptz := date_trunc('hour', now()) + interval '1 day';
  v_arrival_at timestamptz := date_trunc('hour', now()) + interval '1 day 4 hours';
  v_client public.transport_clients;
  v_course public.transport_missions;
  v_expense public.transport_mission_expenses;
  v_budget_expense public.transport_mission_expenses;
  v_insufficient_wallet_expense public.transport_mission_expenses;
  v_reversed_expense public.transport_mission_expenses;
  v_invoice public.transport_invoices;
  v_payment public.transport_invoice_payments;
  v_reversed_payment public.transport_invoice_payments;
  v_before_balance numeric;
  v_after_balance numeric;
  v_balance_after_expense_confirmation numeric;
  v_balance_after_payment_confirmation numeric;
  v_deletion_confirmed boolean;
  v_closure_refused boolean := false;
  v_summary record;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
BEGIN
  IF to_regclass('public.transport_missions') IS NULL
    OR to_regclass('public.transport_mission_expenses') IS NULL
    OR to_regclass('public.transport_invoices') IS NULL
    OR to_regclass('public.transport_invoice_payments') IS NULL THEN
    RAISE EXCEPTION 'MT-03 tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.transport_missions'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'transport_missions must have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('transport_missions','transport_mission_expenses','transport_invoices','transport_invoice_payments') AND cmd IN ('DELETE','ALL')) THEN
    RAISE EXCEPTION 'Course operational tables must not expose direct DELETE/ALL RLS policies';
  END IF;
  IF has_table_privilege('authenticated', 'public.transport_missions', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated must not receive direct DELETE on transport_missions';
  END IF;
  IF has_function_privilege('anon', 'public.create_transport_mission(jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_transport_mission_expense(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_transport_invoice_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute Course mutation RPCs';
  END IF;

  SELECT user_role.user_id INTO v_actor_id
  FROM public.user_roles user_role JOIN public.roles role_catalogue ON role_catalogue.code=user_role.role
  WHERE user_role.role='super_admin' AND role_catalogue.is_active ORDER BY user_role.created_at LIMIT 1;
  SELECT id, balance INTO v_wallet_id, v_before_balance FROM public.wallets ORDER BY is_default DESC NULLS LAST, created_at LIMIT 1;
  IF v_actor_id IS NULL OR v_wallet_id IS NULL THEN
    RAISE NOTICE 'Lifecycle test skipped: an active super_admin and a wallet are required.';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES('TEST-' || v_suffix, 'actif', 'Référentiel transactionnel MT-03')
  RETURNING id INTO v_driver_id;
  INSERT INTO public.vehicles(registration, driver_id, status, description)
  VALUES('TEST-' || upper(v_suffix), v_driver_id, 'EN_SERVICE', 'Référentiel transactionnel MT-03')
  RETURNING id INTO v_vehicle_id;
  INSERT INTO public.drivers(numero_permis, statut, notes)
  VALUES('TEST-ALT-' || v_suffix, 'actif', 'Référentiel transactionnel MT-03')
  RETURNING id INTO v_other_driver_id;
  INSERT INTO public.vehicles(registration, driver_id, status, description)
  VALUES('TEST-ALT-' || upper(v_suffix), v_other_driver_id, 'EN_SERVICE', 'Référentiel transactionnel MT-03')
  RETURNING id INTO v_other_vehicle_id;

  v_client := public.create_client(jsonb_build_object('kind','ORGANIZATION','display_name','Client Course test ' || v_suffix,'country_code','CI','telephone','+225 07 ' || substr(v_suffix,1,6),'email','course-' || lower(v_suffix) || '@example.test','registration_identifier_type',null,'registration_identifier_value',null));
  v_draft_course := public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'quoted_amount',0));
  v_deletion_confirmed := public.delete_transport_mission(v_draft_course.id);
  IF v_deletion_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A draft Course without dependencies must be deleted through its dedicated RPC';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transport_missions WHERE id=v_draft_course.id)
    OR NOT EXISTS (SELECT 1 FROM public.business_finance_audit WHERE source_type='COURSE' AND source_id=v_draft_course.id AND action='DELETE') THEN
    RAISE EXCEPTION 'Course deletion must remove only the eligible Course and retain its audit event';
  END IF;
  v_archived_course := public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'quoted_amount',0));
  v_archived_course := public.set_transport_mission_status(v_archived_course.id,'CANCELLED','Archivage de test');
  IF v_archived_course.status <> 'CANCELLED'
    OR NOT EXISTS (SELECT 1 FROM public.business_finance_audit WHERE source_type='COURSE' AND source_id=v_archived_course.id AND action='CANCEL') THEN
    RAISE EXCEPTION 'Archiving a Course must retain the row and create an audit event';
  END IF;
  v_planned_deletion_course := public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'vehicle_id',v_other_vehicle_id,'driver_id',v_other_driver_id,'departure_location','Abidjan','destination_location','Bouaké','cargo_description','Suppression planifiée de test','planned_departure_at',v_departure_at,'planned_arrival_at',v_arrival_at,'quoted_amount',1000));
  v_planned_deletion_course := public.set_transport_mission_status(v_planned_deletion_course.id,'PLANNED',null);
  v_deletion_confirmed := public.delete_transport_mission(v_planned_deletion_course.id);
  IF v_deletion_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A planned Course without dependencies must be deleted through its dedicated RPC';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transport_missions WHERE id=v_planned_deletion_course.id) THEN
    RAISE EXCEPTION 'A planned Course without dependencies must be deleted through its dedicated RPC';
  END IF;
  -- create_transport_mission stopped reading quoted_amount when
  -- 20260813143000_add_real_course_pricing_and_simplify_workflow.sql moved
  -- pricing to pricing_mode/actual_transport_amount; create_transport_invoice
  -- (below, once expenses/budget are exercised) now requires
  -- actual_transport_amount to be set before it will invoice.
  v_course := public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'vehicle_id',v_vehicle_id,'driver_id',v_driver_id,'departure_location','Abidjan','destination_location','Bouaké','cargo_description','Marchandise de test','planned_departure_at',v_departure_at,'planned_arrival_at',v_arrival_at,'pricing_mode','FLAT','actual_transport_amount',100000));
  IF v_course.status <> 'DRAFT' OR v_course.mission_number IS NULL THEN RAISE EXCEPTION 'Course creation failed'; END IF;
  v_course := public.set_transport_mission_status(v_course.id,'PLANNED',null);
  BEGIN
    PERFORM public.set_transport_mission_status(v_course.id,'CLOSED',null);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_closure_refused := true;
  END;
  IF NOT v_closure_refused THEN RAISE EXCEPTION 'Closing with unpaid invoices or unvalidated expenses must be rejected'; END IF;
  BEGIN
    PERFORM public.set_transport_mission_status(
      (public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'vehicle_id',v_vehicle_id,'driver_id',v_other_driver_id,'departure_location','Abidjan','destination_location','Bouaké','cargo_description','Chevauchement véhicule de test','planned_departure_at',v_departure_at,'planned_arrival_at',v_arrival_at,'quoted_amount',1000))).id,
      'PLANNED',
      null
    );
    RAISE EXCEPTION 'Vehicle schedule overlap must be rejected';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.set_transport_mission_status(
      (public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'vehicle_id',v_other_vehicle_id,'driver_id',v_driver_id,'departure_location','Abidjan','destination_location','Bouaké','cargo_description','Chevauchement chauffeur de test','planned_departure_at',v_departure_at,'planned_arrival_at',v_arrival_at,'quoted_amount',1000))).id,
      'PLANNED',
      null
    );
    RAISE EXCEPTION 'Driver schedule overlap must be rejected';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;
  v_accepted_course := public.create_transport_mission(jsonb_build_object('client_id',v_client.id,'vehicle_id',v_other_vehicle_id,'driver_id',v_other_driver_id,'departure_location','Abidjan','destination_location','Bouaké','cargo_description','Paire disponible de test','planned_departure_at',v_departure_at,'planned_arrival_at',v_arrival_at,'quoted_amount',1000));
  v_accepted_course := public.set_transport_mission_status(v_accepted_course.id,'PLANNED',null);
  IF v_accepted_course.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'A Course with another vehicle and driver must be accepted';
  END IF;
  PERFORM public.create_transport_mission_budget_line(v_course.id,jsonb_build_object('category','FUEL','planned_amount',25000));
  v_expense := public.create_transport_mission_expense(v_course.id,jsonb_build_object('wallet_id',v_wallet_id,'category','FUEL','amount',10000,'expense_date',current_date,'status','ENGAGED'));
  v_expense := public.confirm_transport_mission_expense(v_expense.id);
  IF v_expense.status <> 'PAID' OR NOT EXISTS (SELECT 1 FROM public.finance_transport_mission_expense_links WHERE expense_id=v_expense.id AND link_type='EXPENSE') THEN RAISE EXCEPTION 'Expense confirmation must create exactly one linked finance operation'; END IF;
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id=v_wallet_id;
  IF v_after_balance <> v_before_balance - 10000 THEN RAISE EXCEPTION 'Confirmed expense did not recalculate the wallet'; END IF;
  v_balance_after_expense_confirmation := v_after_balance;
  PERFORM public.confirm_transport_mission_expense(v_expense.id);
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id=v_wallet_id;
  IF v_after_balance <> v_balance_after_expense_confirmation
    OR (SELECT count(*) FROM public.finance_transport_mission_expense_links WHERE expense_id=v_expense.id AND link_type='EXPENSE') <> 1 THEN
    RAISE EXCEPTION 'A second expense confirmation must not create a second debit';
  END IF;

  v_budget_expense := public.create_transport_mission_expense(v_course.id,jsonb_build_object('wallet_id',v_wallet_id,'category','ROAD','amount',20000,'expense_date',current_date,'status','ENGAGED'));
  v_budget_expense := public.confirm_transport_mission_expense(v_budget_expense.id);
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.notification_transport_mission_links link ON link.notification_id = notification.id
    WHERE link.mission_id = v_course.id
      AND notification.type = 'COURSE_BUDGET_EXCEEDED'
  ) THEN
    RAISE EXCEPTION 'A budget overrun must create a linked Course notification';
  END IF;
  v_budget_expense := public.cancel_transport_mission_expense(v_budget_expense.id,'Retour au budget de test');

  v_insufficient_wallet_expense := public.create_transport_mission_expense(
    v_course.id,
    jsonb_build_object(
      'wallet_id', v_wallet_id,
      'category', 'MISC',
      'amount', abs(v_before_balance) + 1,
      'expense_date', current_date,
      'status', 'ENGAGED'
    )
  );
  v_insufficient_wallet_expense := public.confirm_transport_mission_expense(v_insufficient_wallet_expense.id);
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.notification_transport_mission_links link ON link.notification_id = notification.id
    WHERE link.mission_id = v_course.id
      AND notification.type = 'COURSE_WALLET_INSUFFICIENT'
  ) THEN
    RAISE EXCEPTION 'A Course expense that makes a wallet negative must create a linked Course notification';
  END IF;
  v_insufficient_wallet_expense := public.cancel_transport_mission_expense(
    v_insufficient_wallet_expense.id,
    'Test de compensation de wallet insuffisant'
  );

  v_reversed_expense := public.create_transport_mission_expense(v_course.id,jsonb_build_object('wallet_id',v_wallet_id,'category','MISC','amount',5000,'expense_date',current_date,'status','ENGAGED'));
  v_reversed_expense := public.confirm_transport_mission_expense(v_reversed_expense.id);
  v_reversed_expense := public.cancel_transport_mission_expense(v_reversed_expense.id,'Test de contre-écriture');
  IF v_reversed_expense.status <> 'CANCELLED' OR NOT EXISTS (SELECT 1 FROM public.finance_transport_mission_expense_links WHERE expense_id=v_reversed_expense.id AND link_type='REVERSAL') THEN RAISE EXCEPTION 'Cancelling a confirmed expense must retain it and create a reversal'; END IF;

  v_invoice := public.create_transport_invoice(v_course.id,jsonb_build_object('subtotal_amount',100000,'tax_rate',0,'due_date',current_date - 1));
  v_invoice := public.issue_transport_invoice(v_invoice.id);
  IF v_invoice.status <> 'ISSUED' THEN RAISE EXCEPTION 'Invoice issue failed'; END IF;
  PERFORM public.run_notification_generation('TEST', v_actor_id);
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.notification_transport_invoice_links link ON link.notification_id = notification.id
    WHERE link.invoice_id = v_invoice.id
      AND notification.type = 'COURSE_INVOICE_OVERDUE'
  ) THEN
    RAISE EXCEPTION 'An overdue invoice must create a linked Course notification';
  END IF;
  v_payment := public.create_transport_invoice_payment(v_invoice.id,jsonb_build_object('wallet_id',v_wallet_id,'amount',99999,'payment_date',current_date,'payment_kind','PAYMENT'));
  v_payment := public.confirm_transport_invoice_payment(v_payment.id);
  IF v_payment.status <> 'CONFIRMED' OR NOT EXISTS (SELECT 1 FROM public.finance_transport_payment_links WHERE payment_id=v_payment.id AND link_type='PAYMENT') THEN RAISE EXCEPTION 'Payment confirmation must create a linked finance operation'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.notification_transport_mission_links link ON link.notification_id = notification.id
    WHERE link.mission_id = v_course.id
      AND notification.type = 'COURSE_PAYMENT_RECEIVED'
  ) THEN
    RAISE EXCEPTION 'A confirmed payment must create a linked Course notification';
  END IF;
  SELECT balance INTO v_balance_after_payment_confirmation FROM public.wallets WHERE id=v_wallet_id;
  PERFORM public.confirm_transport_invoice_payment(v_payment.id);
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id=v_wallet_id;
  IF v_after_balance <> v_balance_after_payment_confirmation
    OR (SELECT count(*) FROM public.finance_transport_payment_links WHERE payment_id=v_payment.id AND link_type='PAYMENT') <> 1 THEN
    RAISE EXCEPTION 'A second payment confirmation must not create a second credit';
  END IF;
  v_reversed_payment := public.create_transport_invoice_payment(v_invoice.id,jsonb_build_object('wallet_id',v_wallet_id,'amount',1,'payment_date',current_date,'payment_kind','PAYMENT'));
  v_reversed_payment := public.confirm_transport_invoice_payment(v_reversed_payment.id);
  v_reversed_payment := public.cancel_transport_invoice_payment(v_reversed_payment.id,'Test de contre-écriture');
  IF v_reversed_payment.status <> 'CANCELLED' OR NOT EXISTS (SELECT 1 FROM public.finance_transport_payment_links WHERE payment_id=v_reversed_payment.id AND link_type='REVERSAL') THEN RAISE EXCEPTION 'Cancelling a confirmed payment must retain it and create a reversal'; END IF;

  v_payment := public.create_transport_invoice_payment(v_invoice.id,jsonb_build_object('wallet_id',v_wallet_id,'amount',1,'payment_date',current_date,'payment_kind','SETTLEMENT'));
  v_payment := public.confirm_transport_invoice_payment(v_payment.id);
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id=v_wallet_id;
  IF v_after_balance <> v_before_balance + 90000 THEN
    RAISE EXCEPTION 'Confirmed payments and reversals did not credit the wallet exactly';
  END IF;
  SELECT * INTO v_summary FROM public.get_transport_mission_financial_summary(v_course.id);
  IF v_summary.amount_due <> 0 OR v_summary.actual_expenses <> 10000 OR v_summary.received_amount <> 100000 THEN RAISE EXCEPTION 'Course financial summary is not reconciled'; END IF;

  v_course := public.set_transport_mission_status(v_course.id,'IN_PROGRESS',null);
  v_course := public.set_transport_mission_status(v_course.id,'COMPLETED',null);
  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.notification_transport_mission_links link ON link.notification_id = notification.id
    WHERE link.mission_id = v_course.id
      AND notification.type = 'COURSE_COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Completing a Course must create a linked Course notification';
  END IF;
  PERFORM public.run_notification_generation('TEST', v_actor_id);
  IF EXISTS (
    SELECT 1
    FROM public.notifications notification
    JOIN public.notification_transport_invoice_links link ON link.notification_id = notification.id
    WHERE link.invoice_id = v_invoice.id
      AND notification.type = 'COURSE_INVOICE_OVERDUE'
      AND notification.status IN ('UNREAD','READ','SNOOZED')
  ) THEN
    RAISE EXCEPTION 'The overdue invoice notification must resolve after the invoice is paid';
  END IF;
  v_course := public.set_transport_mission_status(v_course.id,'CLOSED',null);
  IF v_course.status <> 'CLOSED' THEN RAISE EXCEPTION 'A paid invoice and settled expenses must allow closure'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_finance_audit WHERE source_type='COURSE' AND source_id=v_course.id AND action='CLOSE') THEN RAISE EXCEPTION 'Course closure must be audited'; END IF;
END;
$test$;

ROLLBACK;
