-- CM-03 follow-up: expose only the Commerce locations usable by the current operator.
CREATE OR REPLACE FUNCTION public.get_commerce_pos_locations()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', location_row.id, 'name', location_row.name, 'code', location_row.code) ORDER BY location_row.name), '[]'::jsonb)
  FROM public.business_locations location_row
  JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.status = 'ACTIVE'
    AND unit_row.code = 'COMMERCE'
    AND public.commerce_location_access_allowed(location_row.id)
    AND public.user_has_permission('commerce.pos.read');
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_pos_locations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_locations() TO authenticated;
