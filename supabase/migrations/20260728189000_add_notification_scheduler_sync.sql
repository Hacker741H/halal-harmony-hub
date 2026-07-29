-- Lot 8: schedule synchronization is optional at migration time. It becomes
-- active only when the hosted project enables pg_cron and pg_net and the two
-- named Vault secrets are present. No unavailable extension is assumed here.

CREATE OR REPLACE FUNCTION public.sync_notification_daily_schedule()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $sync_notification_daily_schedule$
DECLARE
  v_run_time time;
  v_timezone text;
  v_utc_timestamp timestamp;
  v_cron_expression text;
  v_command text;
  v_job_id bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name IN ('notification_scheduler_project_url', 'notification_scheduler_secret')
    GROUP BY true HAVING count(*) = 2
  ) THEN
    RETURN false;
  END IF;

  SELECT notification_daily_run_time, timezone
  INTO v_run_time, v_timezone
  FROM public.company_settings
  ORDER BY created_at ASC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paramètres entreprise introuvables.';
  END IF;

  v_utc_timestamp := ((public.notification_business_date() + v_run_time) AT TIME ZONE v_timezone AT TIME ZONE 'UTC');
  v_cron_expression := format('%s %s * * *', extract(minute FROM v_utc_timestamp)::integer, extract(hour FROM v_utc_timestamp)::integer);
  v_command :=
    'SELECT net.http_post(' ||
    'url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''notification_scheduler_project_url'') || ''/functions/v1/generate-notifications'', ' ||
    'headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-notification-scheduler-secret'', ' ||
      '(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''notification_scheduler_secret'')), ' ||
    'body := ''{}''::jsonb' ||
    ')';

  EXECUTE format('SELECT jobid FROM cron.job WHERE jobname = %L LIMIT 1', 'halal-erp-generate-notifications') INTO v_job_id;
  IF v_job_id IS NOT NULL THEN
    EXECUTE format('SELECT cron.unschedule(%s)', v_job_id);
  END IF;
  EXECUTE format(
    'SELECT cron.schedule(%L, %L, %L)',
    'halal-erp-generate-notifications',
    v_cron_expression,
    v_command
  );
  RETURN true;
END
$sync_notification_daily_schedule$;

CREATE OR REPLACE FUNCTION public.notification_scheduler_status()
RETURNS TABLE (
  scheduler_configured boolean,
  cron_expression text,
  job_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notification_scheduler_status$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à consulter l’état du planificateur.';
  END IF;
  IF to_regnamespace('cron') IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::bigint;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT true, schedule::text, jobid::bigint FROM cron.job WHERE jobname = ''halal-erp-generate-notifications'' LIMIT 1';
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::bigint;
  END IF;
END
$notification_scheduler_status$;

CREATE OR REPLACE FUNCTION public.save_notification_general_settings(
  p_timezone text,
  p_daily_run_time time
)
RETURNS public.company_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $save_notification_general_settings$
DECLARE
  v_before public.company_settings;
  v_after public.company_settings;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier les paramètres généraux.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Fuseau horaire invalide.';
  END IF;

  SELECT * INTO v_before FROM public.company_settings ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  UPDATE public.company_settings
  SET timezone = p_timezone, notification_daily_run_time = p_daily_run_time
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  -- If cron has been enabled and its Vault secrets exist, changing the time or
  -- timezone atomically refreshes the single daily job. Otherwise the setting
  -- is still saved and the UI reports that scheduling remains to be enabled.
  PERFORM public.sync_notification_daily_schedule();

  INSERT INTO public.notification_settings_audit(setting_key, before_value, after_value, performed_by)
  VALUES ('company.notification_schedule', to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$save_notification_general_settings$;

REVOKE ALL ON FUNCTION public.sync_notification_daily_schedule() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notification_scheduler_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_notification_daily_schedule() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_scheduler_status() TO authenticated, service_role;
