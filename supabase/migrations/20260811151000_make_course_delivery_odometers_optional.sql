-- The start and end odometer readings are optional at delivery. When both are
-- available, keep protecting the integrity of the recorded distance.
CREATE OR REPLACE FUNCTION public.confirm_transport_delivery(p_mission_id uuid, p_delivery jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_transport_delivery$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_delivery_status text := upper(coalesce(NULLIF(btrim(p_delivery ->> 'delivery_status'), ''), 'DELIVERED'));
  v_arrived_at timestamptz := NULLIF(p_delivery ->> 'actual_arrival_at', '')::timestamptz;
  v_start_odometer numeric := NULLIF(p_delivery ->> 'start_odometer', '')::numeric;
  v_end_odometer numeric := NULLIF(p_delivery ->> 'end_odometer', '')::numeric;
  v_document_id uuid := NULLIF(p_delivery ->> 'delivery_document_id', '')::uuid;
  v_effective_start_odometer numeric;
BEGIN
  PERFORM public.permission_require('deliveries.confirm');

  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'COMPLETED' AND v_before.delivery_status IN ('DELIVERED', 'PARTIAL') THEN
    RETURN v_before;
  END IF;
  IF v_before.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Seule une Course en cours peut être confirmée à la livraison.' USING ERRCODE = '22023';
  END IF;
  IF v_delivery_status NOT IN ('DELIVERED', 'PARTIAL', 'INCIDENT') THEN
    RAISE EXCEPTION 'Statut de livraison invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_delivery_status IN ('DELIVERED', 'PARTIAL') AND v_arrived_at IS NULL THEN
    RAISE EXCEPTION 'La date et l''heure réelles d''arrivée sont obligatoires.' USING ERRCODE = '22023';
  END IF;

  v_effective_start_odometer := COALESCE(v_before.start_odometer, v_start_odometer);
  IF v_delivery_status IN ('DELIVERED', 'PARTIAL')
    AND v_end_odometer IS NOT NULL
    AND v_effective_start_odometer IS NOT NULL
    AND v_end_odometer < v_effective_start_odometer THEN
    RAISE EXCEPTION 'Le kilométrage d''arrivée doit être supérieur ou égal au kilométrage de départ.' USING ERRCODE = '22023';
  END IF;

  IF v_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.document_transport_mission_links
    WHERE mission_id = p_mission_id AND document_id = v_document_id
  ) THEN
    RAISE EXCEPTION 'La preuve de livraison doit déjà être liée à cette Course.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.transport_missions
  SET status = CASE WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
      actual_arrival_at = CASE WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') THEN v_arrived_at ELSE actual_arrival_at END,
      start_odometer = COALESCE(start_odometer, v_start_odometer),
      end_odometer = CASE
        WHEN v_delivery_status IN ('DELIVERED', 'PARTIAL') AND v_end_odometer IS NOT NULL THEN v_end_odometer
        ELSE end_odometer
      END,
      delivery_status = v_delivery_status,
      delivery_recipient_name = NULLIF(btrim(p_delivery ->> 'recipient_name'), ''),
      delivery_notes = NULLIF(btrim(p_delivery ->> 'notes'), ''),
      delivery_reservations = NULLIF(btrim(p_delivery ->> 'reservations'), ''),
      delivery_document_id = v_document_id,
      delivery_confirmed_at = now(),
      delivery_confirmed_by = auth.uid(),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event(
    'COURSE', v_mission.id, NULL, 'DELIVERY', to_jsonb(v_before), to_jsonb(v_mission)
  );
  RETURN v_mission;
END;
$confirm_transport_delivery$;
