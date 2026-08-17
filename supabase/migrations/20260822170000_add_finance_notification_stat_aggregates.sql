-- Performance fix (P0/P1): getFinanceStats and getNotificationSummary each
-- fetched the ENTIRE finance_operations / notifications table client-side
-- and computed totals via multiple JS .filter().reduce() passes. Both
-- tables are explicitly flagged as likely to grow to thousands of rows.
-- dashboard.functions.ts independently duplicated the same notifications
-- computation a second time. Replaced with two lightweight server-side
-- aggregate RPCs, each replicating the exact same access-control rule the
-- existing RLS policy already enforces (finance.read; own notifications or
-- admin/super_admin) since SECURITY DEFINER bypasses RLS.

CREATE OR REPLACE FUNCTION public.get_finance_operation_stats()
 RETURNS TABLE(total_operations bigint, recettes numeric, depenses numeric, versements numeric, transferts numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.permission_require('finance.read');
  RETURN QUERY
  SELECT
    count(*)::bigint,
    COALESCE(sum(fo.amount) FILTER (WHERE fo.type = 'REVENUE'), 0)::numeric,
    COALESCE(sum(fo.amount) FILTER (WHERE fo.type = 'EXPENSE'), 0)::numeric,
    COALESCE(sum(fo.amount) FILTER (WHERE fo.type = 'DEPOSIT'), 0)::numeric,
    COALESCE(sum(fo.amount) FILTER (WHERE fo.type = 'TRANSFER'), 0)::numeric
  FROM public.finance_operations fo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_notification_summary_counts()
 RETURNS TABLE(unread bigint, critical bigint, due_in_seven_days bigint, due_in_thirty_days bigint, low_stock bigint, overdue_maintenance bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE n.status = 'UNREAD')::bigint,
    count(*) FILTER (WHERE n.severity = 'CRITICAL')::bigint,
    count(*) FILTER (WHERE n.due_date IS NOT NULL AND n.due_date >= current_date AND n.due_date <= current_date + 7)::bigint,
    count(*) FILTER (WHERE n.due_date IS NOT NULL AND n.due_date >= current_date AND n.due_date <= current_date + 30)::bigint,
    count(*) FILTER (WHERE n.type = 'LOW_STOCK')::bigint,
    count(*) FILTER (WHERE n.type LIKE 'MOTORCYCLE_MAINTENANCE%' AND (n.due_date IS NULL OR n.due_date < current_date))::bigint
  FROM public.notifications n
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND (n.user_id = v_actor OR public.has_any_role(v_actor, ARRAY['super_admin', 'admin']::public.app_role[]));
END;
$function$;
