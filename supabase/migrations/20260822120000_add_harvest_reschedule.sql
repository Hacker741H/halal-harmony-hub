-- Small gap closed: the mission's own PLANNED action set is
-- [Démarrer] [Reporter] [Annuler] -- "Reporter" (reschedule the planned
-- date, distinct from postponing a recurrence cycle) had no RPC yet.

CREATE OR REPLACE FUNCTION public._internal_reschedule_harvest(p_harvest_id uuid, p_new_date date)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Seule une récolte encore planifiée peut être reportée (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;
  IF p_new_date IS NULL THEN
    RAISE EXCEPTION 'Une nouvelle date est obligatoire pour reporter une récolte.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.harvests SET planned_date = p_new_date, updated_at = now()
  WHERE id = p_harvest_id
  RETURNING * INTO v_harvest;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_harvest(p_harvest_id uuid, p_new_date date)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_reschedule_harvest(p_harvest_id, p_new_date); END; $function$;

REVOKE ALL ON FUNCTION public.reschedule_harvest(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_harvest(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public._internal_reschedule_harvest(uuid, date) FROM PUBLIC, anon, authenticated;
