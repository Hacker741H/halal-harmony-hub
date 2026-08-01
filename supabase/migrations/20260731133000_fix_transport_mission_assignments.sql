-- MT-03 corrective migration: persist the vehicle and driver supplied at Course creation.
-- No table, constraint, RLS policy, permission, or other RPC is changed.

CREATE OR REPLACE FUNCTION public.create_transport_mission(p_mission jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_mission public.transport_missions;
BEGIN
  PERFORM public.permission_require('missions.create');

  IF NULLIF(btrim(p_mission ->> 'client_id'), '') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.transport_clients
      WHERE id = (p_mission ->> 'client_id')::uuid
        AND status = 'ACTIVE'
    ) THEN
    RAISE EXCEPTION 'Un client actif est obligatoire.' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.transport_missions(
    mission_number,
    client_id,
    vehicle_id,
    driver_id,
    departure_location,
    destination_location,
    cargo_description,
    cargo_quantity,
    cargo_unit,
    cargo_weight_kg,
    cargo_volume_m3,
    distance_km,
    planned_departure_at,
    planned_arrival_at,
    quoted_amount,
    reference,
    notes,
    created_by,
    updated_by
  )
  VALUES (
    public._internal_next_transport_mission_number(),
    (p_mission ->> 'client_id')::uuid,
    NULLIF(p_mission ->> 'vehicle_id', '')::uuid,
    NULLIF(p_mission ->> 'driver_id', '')::uuid,
    NULLIF(btrim(p_mission ->> 'departure_location'), ''),
    NULLIF(btrim(p_mission ->> 'destination_location'), ''),
    NULLIF(btrim(p_mission ->> 'cargo_description'), ''),
    NULLIF(p_mission ->> 'cargo_quantity', '')::numeric,
    NULLIF(btrim(p_mission ->> 'cargo_unit'), ''),
    NULLIF(p_mission ->> 'cargo_weight_kg', '')::numeric,
    NULLIF(p_mission ->> 'cargo_volume_m3', '')::numeric,
    NULLIF(p_mission ->> 'distance_km', '')::numeric,
    NULLIF(p_mission ->> 'planned_departure_at', '')::timestamptz,
    NULLIF(p_mission ->> 'planned_arrival_at', '')::timestamptz,
    COALESCE(NULLIF(p_mission ->> 'quoted_amount', '')::numeric, 0),
    NULLIF(btrim(p_mission ->> 'reference'), ''),
    NULLIF(btrim(p_mission ->> 'notes'), ''),
    auth.uid(),
    auth.uid()
  )
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event('COURSE', v_mission.id, NULL, 'CREATE', NULL, to_jsonb(v_mission));
  RETURN v_mission;
END;
$$;
