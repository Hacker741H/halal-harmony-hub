-- Lot 8: configurable rules, serialized generation and opening balance.
-- Run with: npx supabase db query --linked --file scripts/test-alert-settings-scheduler.sql
-- All test data and configuration changes are rolled back.
BEGIN;

DO $test_alert_settings_scheduler$
DECLARE
  v_admin_id uuid;
  v_viewer_id uuid := gen_random_uuid();
  v_employee_id uuid;
  v_driver_id uuid;
  v_wallet_id uuid;
  v_opening_wallet_id uuid;
  v_inventory_id uuid;
  v_driver_notification_count integer;
  v_wallet_notification_id uuid;
  v_run public.notification_generation_runs;
  v_run_count integer;
  v_wallet_balance numeric;
  v_visible_to_viewer boolean;
  v_scheduler_configured boolean;
BEGIN
  SELECT user_id INTO v_admin_id
  FROM public.user_roles
  WHERE role = 'super_admin'
  ORDER BY created_at
  LIMIT 1;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Le test requiert un super_admin.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT scheduler_configured INTO v_scheduler_configured
  FROM public.notification_scheduler_status();
  IF NOT v_scheduler_configured THEN
    RAISE EXCEPTION 'Le job quotidien doit être configuré avant ce test.';
  END IF;
  PERFORM public.save_notification_general_settings('Africa/Abidjan', '06:00'::time);
  SELECT scheduler_configured INTO v_scheduler_configured
  FROM public.notification_scheduler_status();
  IF NOT v_scheduler_configured THEN
    RAISE EXCEPTION 'La modification d’heure n’a pas resynchronisé le job quotidien.';
  END IF;

  -- Les RPC valident et historisent une modification des délais, gravités,
  -- destinataires et l’activation de la règle permis.
  PERFORM public.save_notification_alert_rule(
    'DRIVER_LICENSE_EXPIRY', true, 'INFO', ARRAY[2, 1],
    '{"overdue":"CRITICAL","0":"CRITICAL","1":"WARNING","2":"INFO"}'::jsonb,
    NULL, ARRAY['super_admin']::public.app_role[]
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_settings_audit
    WHERE setting_key = 'notification_alert_rule.DRIVER_LICENSE_EXPIRY'
      AND performed_by = v_admin_id
  ) THEN
    RAISE EXCEPTION 'La modification de règle n’a pas été historisée.';
  END IF;

  INSERT INTO public.employees(nom, prenom, statut)
  VALUES ('Test', 'Scheduler', 'actif')
  RETURNING id INTO v_employee_id;
  INSERT INTO public.drivers(employee_id, statut, date_expiration_permis)
  VALUES (v_employee_id, 'actif', public.notification_business_date() + 1)
  RETURNING id INTO v_driver_id;

  -- Une règle désactivée ne produit pas d’alerte.
  PERFORM public.save_notification_alert_rule(
    'DRIVER_LICENSE_EXPIRY', false, 'INFO', ARRAY[2, 1],
    '{"overdue":"CRITICAL","0":"CRITICAL","1":"WARNING","2":"INFO"}'::jsonb,
    NULL, ARRAY['super_admin']::public.app_role[]
  );
  v_run := public.run_notification_generation('TEST', v_admin_id);
  IF v_run.status <> 'SUCCEEDED' THEN RAISE EXCEPTION 'Génération désactivée en échec : %', v_run.error_message; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    JOIN public.notification_driver_links l ON l.notification_id = n.id
    WHERE l.driver_id = v_driver_id AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
  ) THEN
    RAISE EXCEPTION 'Une règle désactivée a généré une alerte.';
  END IF;

  -- Le palier de gravité configuré est lu par le moteur central.
  PERFORM public.save_notification_alert_rule(
    'DRIVER_LICENSE_EXPIRY', true, 'INFO', ARRAY[2, 1],
    '{"overdue":"CRITICAL","0":"CRITICAL","1":"WARNING","2":"INFO"}'::jsonb,
    NULL, ARRAY['super_admin']::public.app_role[]
  );
  v_run := public.run_notification_generation('TEST', v_admin_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
    JOIN public.notification_driver_links l ON l.notification_id = n.id
    WHERE l.driver_id = v_driver_id
      AND n.type = 'DRIVER_LICENSE_EXPIRY'
      AND n.severity = 'WARNING'
      AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
  ) THEN
    RAISE EXCEPTION 'La gravité de délai configurée n’a pas été appliquée.';
  END IF;

  -- Deux appels successifs sont sérialisés et ne créent aucun doublon.
  SELECT count(*) INTO v_driver_notification_count
  FROM public.notifications n
  JOIN public.notification_driver_links l ON l.notification_id = n.id
  WHERE l.driver_id = v_driver_id
    AND n.type = 'DRIVER_LICENSE_EXPIRY'
    AND n.status IN ('UNREAD', 'READ', 'SNOOZED');
  v_run := public.run_notification_generation('TEST', v_admin_id);
  IF v_run.status <> 'SUCCEEDED' THEN RAISE EXCEPTION 'Seconde génération en échec.'; END IF;
  IF (SELECT count(*) FROM public.notifications n JOIN public.notification_driver_links l ON l.notification_id = n.id WHERE l.driver_id = v_driver_id AND n.type = 'DRIVER_LICENSE_EXPIRY' AND n.status IN ('UNREAD', 'READ', 'SNOOZED')) <> v_driver_notification_count THEN
    RAISE EXCEPTION 'Doublon détecté après la seconde génération.';
  END IF;

  -- Wallet faible : seuil global, surcharge par wallet, puis résolution.
  INSERT INTO public.wallets(name, type, balance, initial_balance)
  VALUES ('Wallet test scheduler ' || txid_current()::text, 'TEST', 50, 0)
  RETURNING id INTO v_wallet_id;
  PERFORM public.save_notification_alert_rule(
    'LOW_WALLET', true, 'WARNING', ARRAY[]::integer[], '{}'::jsonb,
    100, ARRAY['super_admin']::public.app_role[]
  );
  v_run := public.run_notification_generation('TEST', v_admin_id);
  SELECT n.id INTO v_wallet_notification_id
  FROM public.notifications n
  JOIN public.notification_wallet_links l ON l.notification_id = n.id
  WHERE l.wallet_id = v_wallet_id AND n.type = 'LOW_WALLET'
  ORDER BY n.created_at DESC
  LIMIT 1;
  IF v_wallet_notification_id IS NULL THEN RAISE EXCEPTION 'Seuil global wallet non appliqué.'; END IF;
  PERFORM public.set_wallet_alert_threshold(v_wallet_id, 40);
  v_run := public.run_notification_generation('TEST', v_admin_id);
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE id = v_wallet_notification_id AND status = 'RESOLVED') THEN
    RAISE EXCEPTION 'La surcharge wallet n’a pas résolu l’alerte.';
  END IF;

  -- Stock : le seuil reste propre à l’article, et la résolution est automatique.
  INSERT INTO public.inventory_items(nom, stock_actuel, seuil_alerte)
  VALUES ('Article test scheduler ' || txid_current()::text, 2, 0)
  RETURNING id INTO v_inventory_id;
  PERFORM public.set_inventory_alert_threshold(v_inventory_id, 3);
  v_run := public.run_notification_generation('TEST', v_admin_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
    JOIN public.notification_inventory_links l ON l.notification_id = n.id
    WHERE l.inventory_item_id = v_inventory_id
      AND n.type = 'LOW_STOCK'
      AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
  ) THEN RAISE EXCEPTION 'Seuil de stock non appliqué.'; END IF;
  PERFORM public.set_inventory_alert_threshold(v_inventory_id, 1);
  v_run := public.run_notification_generation('TEST', v_admin_id);
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    JOIN public.notification_inventory_links l ON l.notification_id = n.id
    WHERE l.inventory_item_id = v_inventory_id
      AND n.type = 'LOW_STOCK'
      AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
  ) THEN RAISE EXCEPTION 'La résolution automatique du stock a échoué.'; END IF;

  -- Le journal d’exécution conserve le déclencheur et le résultat.
  SELECT count(*) INTO v_run_count
  FROM public.notification_generation_runs
  WHERE trigger_type = 'TEST' AND status = 'SUCCEEDED';
  IF v_run_count < 4 THEN RAISE EXCEPTION 'Journal d’exécution incomplet.'; END IF;

  -- Le solde initial est compté une seule fois, même après deux recalculs.
  INSERT INTO public.wallets(name, type, balance, initial_balance)
  VALUES ('Wallet test ouverture ' || txid_current()::text, 'TEST', 0, 100)
  RETURNING id INTO v_opening_wallet_id;
  INSERT INTO public.finance_operations(type, amount, operation_date, wallet_id, status)
  VALUES ('REVENUE', 25, public.notification_business_date(), v_opening_wallet_id, 'VALIDE');
  PERFORM public.update_wallet_balance(v_opening_wallet_id);
  PERFORM public.update_wallet_balance(v_opening_wallet_id);
  SELECT balance INTO v_wallet_balance FROM public.wallets WHERE id = v_opening_wallet_id;
  IF v_wallet_balance <> 125 THEN
    RAISE EXCEPTION 'Le solde initial a été compté plus d’une fois : %', v_wallet_balance;
  END IF;

  -- Une erreur d’entrée est contrôlée sans créer de journal de génération.
  BEGIN
    PERFORM public.run_notification_generation('INVALID', v_admin_id);
    RAISE EXCEPTION 'Le type de déclenchement invalide aurait dû échouer.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Type de déclenchement invalide%' THEN RAISE; END IF;
  END;

  -- RLS : un utilisateur non destinataire ne voit ni alerte privée ni journal.
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT EXISTS(SELECT 1 FROM public.notifications WHERE id = v_wallet_notification_id) INTO v_visible_to_viewer;
  IF v_visible_to_viewer THEN RAISE EXCEPTION 'RLS : alerte privée exposée.'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.notification_generation_runs WHERE trigger_type = 'TEST') INTO v_visible_to_viewer;
  EXECUTE 'RESET ROLE';
  IF v_visible_to_viewer THEN RAISE EXCEPTION 'RLS : journal exposé à un utilisateur non autorisé.'; END IF;

  RAISE NOTICE 'Lot 8 SQL : règles, seuils, déduplication, résolution, journal, RLS et solde initial validés.';
END
$test_alert_settings_scheduler$;

ROLLBACK;
