-- 20260813143000_add_real_course_pricing_and_simplify_workflow.sql replaced
-- this function while reworking Course pricing, but its CREATE OR REPLACE
-- silently dropped the budget-vs-expense comparison and the create-notification
-- branch, leaving only the resolve half. transport_mission_budget_lines and
-- transport_mission_expenses are untouched by that migration and still hold
-- the real canonical inputs, so this restores the original 20260801120000
-- comparison verbatim rather than inventing a new threshold.
CREATE OR REPLACE FUNCTION public._internal_refresh_transport_course_budget_notification(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_refresh_transport_course_budget_notification$
DECLARE
  v_budget numeric := 0;
  v_expenses numeric := 0;
BEGIN
  SELECT COALESCE(sum(planned_amount), 0)
  INTO v_budget
  FROM public.transport_mission_budget_lines
  WHERE mission_id = p_mission_id;

  SELECT COALESCE(sum(amount), 0)
  INTO v_expenses
  FROM public.transport_mission_expenses
  WHERE mission_id = p_mission_id
    AND status = 'PAID';

  IF v_expenses > v_budget THEN
    RETURN public._internal_create_transport_course_notification(
      'COURSE_BUDGET_EXCEEDED',
      'Budget de Course dépassé',
      'Les dépenses validées de cette Course dépassent son budget prévisionnel.',
      'COURSE_BUDGET_EXCEEDED:' || p_mission_id,
      p_mission_id
    );
  END IF;

  UPDATE public.notifications n
  SET status = 'RESOLVED'
  FROM public.notification_transport_mission_links link
  WHERE link.notification_id = n.id
    AND link.mission_id = p_mission_id
    AND n.type = 'COURSE_BUDGET_EXCEEDED'
    AND n.status IN ('UNREAD', 'READ', 'SNOOZED');
  RETURN 0;
END;
$internal_refresh_transport_course_budget_notification$;
