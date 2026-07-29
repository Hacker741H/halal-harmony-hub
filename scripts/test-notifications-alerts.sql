-- Lot 7 notification checks. Run against the linked database with a privileged
-- migration/query role. The transaction is deliberately rolled back.
BEGIN;

DO $test_notifications$
DECLARE
  v_manager_id uuid;
  v_viewer_id uuid;
  v_employee_id uuid;
  v_driver_id uuid;
  v_contract_id uuid;
  v_document_id uuid;
  v_motorcycle_id uuid;
  v_maintenance_id uuid;
  v_wallet_id uuid;
  v_inventory_id uuid;
  v_driver_notification_id uuid;
  v_wallet_notification_id uuid;
  v_expected_recipients integer;
  v_before integer;
  v_after integer;
  v_visible_to_viewer boolean;
BEGIN
  SELECT user_id INTO v_manager_id
  FROM public.user_roles
  WHERE role = 'super_admin'
  ORDER BY created_at
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Le test requiert un super_admin.';
  END IF;
  -- The linked database assigns super_admin and lecture_seule to the same
  -- account. This unprivileged subject still verifies the RLS predicate.
  v_viewer_id := gen_random_uuid();

  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.employees(nom, prenom, statut)
  VALUES ('Test', 'Notifications', 'actif')
  RETURNING id INTO v_employee_id;

  INSERT INTO public.drivers(employee_id, statut, date_expiration_permis)
  VALUES (v_employee_id, 'actif', current_date + 7)
  RETURNING id INTO v_driver_id;

  INSERT INTO public.contracts(type, partie, date_fin, statut)
  VALUES ('TEST', 'Notification', current_date + 7, 'actif')
  RETURNING id INTO v_contract_id;

  INSERT INTO public.documents(nom, type, date_expiration)
  VALUES ('Document test notifications', 'TEST', current_date + 7)
  RETURNING id INTO v_document_id;

  INSERT INTO public.motorcycles(immatriculation, statut, assurance_expiration, visite_expiration, kilometrage)
  VALUES ('NOTIF-TEST-' || txid_current()::text, 'actif', current_date + 7, current_date - 1, 5000)
  RETURNING id INTO v_motorcycle_id;

  INSERT INTO public.motorcycle_maintenances(motorcycle_id, type, maintenance_date, next_date, next_kilometrage)
  VALUES (v_motorcycle_id, 'TEST', current_date, current_date - 1, 4500)
  RETURNING id INTO v_maintenance_id;

  INSERT INTO public.wallets(name, type, balance)
  VALUES ('Wallet test notifications ' || txid_current()::text, 'TEST', -1)
  RETURNING id INTO v_wallet_id;

  INSERT INTO public.inventory_items(nom, stock_actuel, seuil_alerte)
  VALUES ('Article test notifications ' || txid_current()::text, 0, 1)
  RETURNING id INTO v_inventory_id;

  SELECT count(DISTINCT user_id) INTO v_expected_recipients
  FROM public.user_roles
  WHERE role = ANY(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]);

  PERFORM public.generate_notifications();

  -- Permis, contrat, document, assurance/visite, entretien date/km, wallet
  -- négatif et stock faible doivent tous être créés et liés explicitement.
  IF (SELECT count(*) FROM public.notifications n JOIN public.notification_driver_links l ON l.notification_id = n.id WHERE l.driver_id = v_driver_id AND n.type = 'DRIVER_LICENSE_EXPIRY' AND n.status = 'UNREAD') <> v_expected_recipients THEN
    RAISE EXCEPTION 'Alerte permis absente ou destinataires incorrects.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n JOIN public.notification_contract_links l ON l.notification_id = n.id WHERE l.contract_id = v_contract_id AND n.type = 'CONTRACT_EXPIRY') THEN
    RAISE EXCEPTION 'Alerte contrat absente.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n JOIN public.notification_document_links l ON l.notification_id = n.id WHERE l.document_id = v_document_id AND n.type = 'DOCUMENT_EXPIRY') THEN
    RAISE EXCEPTION 'Alerte document absente.';
  END IF;
  IF (SELECT count(*) FROM public.notifications n JOIN public.notification_motorcycle_links l ON l.notification_id = n.id WHERE l.motorcycle_id = v_motorcycle_id AND n.type IN ('MOTORCYCLE_ASSURANCE_EXPIRY', 'MOTORCYCLE_VISIT_EXPIRY')) <> v_expected_recipients * 2 THEN
    RAISE EXCEPTION 'Alertes réglementaires moto absentes.';
  END IF;
  IF (SELECT count(*) FROM public.notifications n JOIN public.notification_motorcycle_maintenance_links l ON l.notification_id = n.id WHERE l.motorcycle_maintenance_id = v_maintenance_id AND n.type IN ('MOTORCYCLE_MAINTENANCE_DATE', 'MOTORCYCLE_MAINTENANCE_KILOMETRAGE')) <> v_expected_recipients * 2 THEN
    RAISE EXCEPTION 'Alertes entretien moto absentes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n JOIN public.notification_inventory_links l ON l.notification_id = n.id WHERE l.inventory_item_id = v_inventory_id AND n.type = 'LOW_STOCK') THEN
    RAISE EXCEPTION 'Alerte stock faible absente.';
  END IF;

  SELECT n.id INTO v_driver_notification_id
  FROM public.notifications n
  JOIN public.notification_driver_links l ON l.notification_id = n.id
  WHERE l.driver_id = v_driver_id AND n.user_id = v_manager_id
  ORDER BY n.created_at DESC
  LIMIT 1;
  SELECT n.id INTO v_wallet_notification_id
  FROM public.notifications n
  JOIN public.notification_wallet_links l ON l.notification_id = n.id
  WHERE l.wallet_id = v_wallet_id AND n.user_id = v_manager_id
  ORDER BY n.created_at DESC
  LIMIT 1;

  SELECT count(*) INTO v_before
  FROM public.notifications n JOIN public.notification_driver_links l ON l.notification_id = n.id
  WHERE l.driver_id = v_driver_id AND n.type = 'DRIVER_LICENSE_EXPIRY';
  PERFORM public.generate_notifications();
  SELECT count(*) INTO v_after
  FROM public.notifications n JOIN public.notification_driver_links l ON l.notification_id = n.id
  WHERE l.driver_id = v_driver_id AND n.type = 'DRIVER_LICENSE_EXPIRY';
  IF v_before <> v_after THEN
    RAISE EXCEPTION 'La seconde génération a créé un doublon.';
  END IF;

  PERFORM public.update_notification_status(v_driver_notification_id, 'SNOOZED', now() + interval '1 day');
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE id = v_driver_notification_id AND status = 'SNOOZED' AND snoozed_until > now()) THEN
    RAISE EXCEPTION 'Le report de notification a échoué.';
  END IF;

  -- Le retour à un solde normal et le réapprovisionnement résolvent les alertes.
  UPDATE public.wallets SET balance = 0 WHERE id = v_wallet_id;
  UPDATE public.inventory_items SET stock_actuel = 2 WHERE id = v_inventory_id;
  PERFORM public.resolve_obsolete_notifications();
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE id = v_wallet_notification_id AND status = 'RESOLVED') THEN
    RAISE EXCEPTION 'L''alerte wallet n''a pas été résolue automatiquement.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n JOIN public.notification_inventory_links l ON l.notification_id = n.id WHERE l.inventory_item_id = v_inventory_id AND n.status IN ('UNREAD', 'READ', 'SNOOZED')) THEN
    RAISE EXCEPTION 'L''alerte de stock faible n''a pas été résolue automatiquement.';
  END IF;

  -- RLS : un lecteur ne doit pas voir une alerte adressée seulement au manager.
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT EXISTS(SELECT 1 FROM public.notifications WHERE id = v_driver_notification_id)
  INTO v_visible_to_viewer;
  EXECUTE 'RESET ROLE';
  IF v_visible_to_viewer THEN
    RAISE EXCEPTION 'RLS : une notification privée est visible par lecture_seule.';
  END IF;

  RAISE NOTICE 'Tests notifications réussis : déduplication, liens, report, résolution et RLS vérifiés.';
END
$test_notifications$;

ROLLBACK;
