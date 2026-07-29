-- Correct the Vault readiness check without changing the already-applied
-- scheduler model or any notification data.
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
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name IN ('notification_scheduler_project_url', 'notification_scheduler_secret')) <> 2 THEN
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
