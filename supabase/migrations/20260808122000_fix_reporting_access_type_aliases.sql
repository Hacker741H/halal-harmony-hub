-- L'interface de rapports utilise les identifiants historiques singuliers.
-- Conserver ces alias dans le garde d'accès évite un refus injustifié sans
-- modifier les permissions accordées à chaque rôle.
CREATE OR REPLACE FUNCTION public.reporting_can_access_report(p_report_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT CASE upper(COALESCE(p_report_type, ''))
    WHEN 'FINANCE' THEN public.user_has_permission('reports.finance')
    WHEN 'TREASURY' THEN public.user_has_permission('reports.finance')
    WHEN 'EMPLOYEES' THEN public.user_has_permission('reports.hr')
    WHEN 'DRIVERS' THEN public.user_has_permission('reports.hr') OR public.user_has_permission('reports.operations')
    WHEN 'STOCK' THEN public.user_has_permission('reports.stocks')
    WHEN 'STOCKS' THEN public.user_has_permission('reports.stocks')
    WHEN 'VEHICLES' THEN public.user_has_permission('reports.operations')
    WHEN 'MOTORCYCLES' THEN public.user_has_permission('reports.operations')
    WHEN 'FARMS' THEN public.user_has_permission('reports.operations')
    WHEN 'MAINTENANCE' THEN public.user_has_permission('reports.operations')
    WHEN 'MAINTENANCES' THEN public.user_has_permission('reports.operations')
    WHEN 'COMPLIANCE' THEN public.user_has_any_permission(ARRAY['reports.hr', 'reports.operations']::text[])
    WHEN 'CONTRACTS_DOCUMENTS' THEN public.user_has_any_permission(ARRAY['reports.hr', 'reports.operations']::text[])
    WHEN 'ALERTS' THEN public.user_has_permission('notifications.read')
    WHEN 'OVERVIEW' THEN public.user_has_permission('reports.read')
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.reporting_can_access_report(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporting_can_access_report(text) TO authenticated;
