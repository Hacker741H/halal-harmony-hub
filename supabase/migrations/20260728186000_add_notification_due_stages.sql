-- Lot 7: apply the 30 / 15 / 7 day urgency stages to an existing
-- deterministic notification instead of creating a notification per stage.

CREATE OR REPLACE FUNCTION public.tg_apply_notification_due_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $apply_notification_due_stage$
DECLARE
  v_days_remaining integer;
BEGIN
  IF NEW.due_date IS NULL OR NEW.type NOT IN (
    'DRIVER_LICENSE_EXPIRY',
    'CONTRACT_EXPIRY',
    'DOCUMENT_EXPIRY',
    'MOTORCYCLE_ASSURANCE_EXPIRY',
    'MOTORCYCLE_VISIT_EXPIRY',
    'MOTORCYCLE_MAINTENANCE_DATE'
  ) THEN
    RETURN NEW;
  END IF;

  v_days_remaining := NEW.due_date - current_date;
  IF v_days_remaining < 0 THEN
    NEW.severity := 'CRITICAL';
    NEW.message := 'Cette échéance est dépassée et nécessite une action immédiate.';
  ELSIF v_days_remaining = 0 THEN
    NEW.severity := 'CRITICAL';
    NEW.message := 'Cette échéance arrive à terme aujourd’hui.';
  ELSIF v_days_remaining <= 7 THEN
    NEW.severity := 'WARNING';
    NEW.message := 'Cette échéance intervient dans les 7 prochains jours.';
  ELSIF v_days_remaining <= 15 THEN
    NEW.severity := 'WARNING';
    NEW.message := 'Cette échéance intervient dans les 15 prochains jours.';
  ELSE
    NEW.severity := 'INFO';
    NEW.message := 'Cette échéance intervient dans les 30 prochains jours.';
  END IF;
  RETURN NEW;
END
$apply_notification_due_stage$;

DROP TRIGGER IF EXISTS trg_apply_notification_due_stage ON public.notifications;
CREATE TRIGGER trg_apply_notification_due_stage
  BEFORE INSERT OR UPDATE OF due_date, type ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_notification_due_stage();

-- Refresh current active rows on deployment. Future generator runs touch their
-- rows as well, so a 15- or 7-day transition is applied without duplication.
UPDATE public.notifications
SET due_date = due_date
WHERE status IN ('UNREAD', 'READ', 'SNOOZED')
  AND due_date IS NOT NULL;
