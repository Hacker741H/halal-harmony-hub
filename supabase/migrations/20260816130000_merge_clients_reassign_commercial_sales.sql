-- GFC V1 Phase 2 -- Clients/Creances. merge_clients currently reassigns
-- client_id on transport_missions/transport_invoices only. A client with
-- commercial (Commerce/POS) history was silently left behind on the
-- archived source client after a merge -- a real gap found during Phase 0/1
-- audit. commercial_sales.client_id and commercial_invoices.client_id are
-- both direct, independent FKs to transport_clients (not derived from one
-- another), so both need reassigning. Purely additive: extends the
-- existing generic to_regclass-guarded loop with two more table names,
-- nothing else in the function changes.

CREATE OR REPLACE FUNCTION public.merge_clients(
  p_source_client_id uuid,
  p_target_client_id uuid,
  p_reason text
)
RETURNS public.transport_clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_source public.transport_clients;
  v_target public.transport_clients;
  v_source_after public.transport_clients;
  v_table_name text;
BEGIN
  PERFORM public.permission_require('clients.merge');
  IF NOT public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Seul un administrateur peut fusionner des clients.' USING ERRCODE = '42501';
  END IF;
  IF p_source_client_id IS NULL OR p_target_client_id IS NULL OR p_source_client_id = p_target_client_id THEN
    RAISE EXCEPTION 'Les clients source et cible doivent être distincts.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'La justification de fusion est obligatoire.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.transport_clients
  WHERE id IN (p_source_client_id, p_target_client_id)
  ORDER BY id FOR UPDATE;
  SELECT * INTO v_source FROM public.transport_clients WHERE id = p_source_client_id;
  SELECT * INTO v_target FROM public.transport_clients WHERE id = p_target_client_id;
  IF v_source.id IS NULL OR v_target.id IS NULL THEN
    RAISE EXCEPTION 'Client source ou cible introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.merged_into_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Le client source a déjà été fusionné.' USING ERRCODE = '22023';
  END IF;
  IF v_target.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Le client cible doit être actif.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_table_name IN ARRAY ARRAY['transport_missions', 'transport_invoices', 'commercial_sales', 'commercial_invoices']
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET client_id = $1 WHERE client_id = $2', v_table_name)
      USING p_target_client_id, p_source_client_id;
    END IF;
  END LOOP;

  INSERT INTO public.document_transport_client_links(document_id, client_id, created_by)
  SELECT document_id, p_target_client_id, auth.uid()
  FROM public.document_transport_client_links
  WHERE client_id = p_source_client_id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.document_transport_client_links WHERE client_id = p_source_client_id;

  UPDATE public.transport_clients
  SET status = 'ARCHIVED',
      merged_into_client_id = p_target_client_id,
      archived_at = now(),
      archived_by = auth.uid(),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_source_client_id
  RETURNING * INTO v_source_after;

  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES (
    'CLIENT', p_source_client_id, 'MERGE', to_jsonb(v_source),
    to_jsonb(v_source_after) || jsonb_build_object('target_client_id', p_target_client_id, 'reason', btrim(p_reason)),
    auth.uid()
  );
  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES (
    'CLIENT', p_target_client_id, 'MERGE', to_jsonb(v_target),
    to_jsonb(v_target) || jsonb_build_object('source_client_id', p_source_client_id, 'reason', btrim(p_reason)),
    auth.uid()
  );
  RETURN v_target;
END;
$function$;
