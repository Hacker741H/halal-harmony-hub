-- CM-06: manage active Commerce-store assignments from the POS administration
-- without modifying sales, stock, wallet balances or financial operations.

CREATE OR REPLACE FUNCTION public.get_commerce_location_assignments(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_assignments jsonb;
BEGIN
  PERFORM public.permission_require('locations.assign');

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_locations AS location_row
    JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
    WHERE location_row.id = p_location_id
      AND location_row.status = 'ACTIVE'
      AND unit_row.code = 'COMMERCE'
  ) THEN
    RAISE EXCEPTION 'Point de vente Commerce introuvable ou archivé.' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', assignment_row.id,
        'userId', assignment_row.user_id,
        'userName', coalesce(nullif(profile_row.full_name, ''), nullif(profile_row.username, ''), 'Utilisateur'),
        'username', profile_row.username,
        'assignmentRole', assignment_row.assignment_role,
        'startDate', assignment_row.start_date,
        'notes', assignment_row.notes
      )
      ORDER BY coalesce(nullif(profile_row.full_name, ''), nullif(profile_row.username, ''), 'Utilisateur'), assignment_row.created_at
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.business_location_assignments AS assignment_row
  LEFT JOIN public.profiles AS profile_row ON profile_row.id = assignment_row.user_id
  WHERE assignment_row.business_location_id = p_location_id
    AND assignment_row.end_date IS NULL;

  RETURN v_assignments;
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_commerce_location_assignment(p_assignment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.business_location_assignments;
  v_assignment public.business_location_assignments;
BEGIN
  PERFORM public.permission_require('locations.assign');

  SELECT assignment_row.*
  INTO v_before
  FROM public.business_location_assignments AS assignment_row
  JOIN public.business_locations AS location_row ON location_row.id = assignment_row.business_location_id
  JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
  WHERE assignment_row.id = p_assignment_id
    AND assignment_row.end_date IS NULL
    AND location_row.status = 'ACTIVE'
    AND unit_row.code = 'COMMERCE'
  FOR UPDATE OF assignment_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Affectation Commerce active introuvable.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.business_location_assignments
  SET end_date = greatest(current_date, start_date),
      ended_by = auth.uid(),
      updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_assignment;

  PERFORM public.business_finance_audit_event(
    'BUSINESS_LOCATION_ASSIGNMENT',
    v_assignment.id,
    NULL,
    'UNASSIGN',
    to_jsonb(v_before),
    to_jsonb(v_assignment)
  );

  RETURN jsonb_build_object(
    'id', v_assignment.id,
    'userId', v_assignment.user_id,
    'endedAt', v_assignment.end_date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_location_assignments(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_commerce_location_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_location_assignments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_commerce_location_assignment(uuid) TO authenticated;
