-- Lot 6: atomic creation and archival of relational documents and contracts.

CREATE OR REPLACE FUNCTION public.create_document_with_relation(
  p_document jsonb,
  p_relation text,
  p_entity_id uuid
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_document_with_relation$
DECLARE
  v_document public.documents;
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF NULLIF(trim(p_document ->> 'nom'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du document est obligatoire.' USING ERRCODE = '22023';
  END IF;
  IF p_relation NOT IN (
    'employee', 'driver', 'vehicle', 'motorcycle', 'farm', 'contract',
    'vehicle_maintenance', 'motorcycle_maintenance'
  ) THEN
    RAISE EXCEPTION 'Type de relation documentaire invalide.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.documents(nom, type, url, date_emission, date_expiration, entity_type, entity_id)
  VALUES (
    trim(p_document ->> 'nom'), NULLIF(trim(p_document ->> 'type'), ''),
    NULLIF(trim(p_document ->> 'url'), ''),
    NULLIF(p_document ->> 'date_emission', '')::date,
    NULLIF(p_document ->> 'date_expiration', '')::date,
    NULL, NULL
  ) RETURNING * INTO v_document;

  IF p_relation = 'employee' THEN
    INSERT INTO public.document_employee_links(document_id, employee_id) VALUES (v_document.id, p_entity_id);
  ELSIF p_relation = 'driver' THEN
    INSERT INTO public.document_driver_links(document_id, driver_id) VALUES (v_document.id, p_entity_id);
  ELSIF p_relation = 'vehicle' THEN
    INSERT INTO public.document_vehicle_links(document_id, vehicle_id) VALUES (v_document.id, p_entity_id);
  ELSIF p_relation = 'motorcycle' THEN
    INSERT INTO public.document_motorcycle_links(document_id, motorcycle_id) VALUES (v_document.id, p_entity_id);
  ELSIF p_relation = 'farm' THEN
    INSERT INTO public.document_farm_links(document_id, farm_id) VALUES (v_document.id, p_entity_id);
  ELSIF p_relation = 'contract' THEN
    INSERT INTO public.document_contract_links(document_id, contract_id) VALUES (v_document.id, p_entity_id);
  ELSIF p_relation = 'vehicle_maintenance' THEN
    INSERT INTO public.document_vehicle_maintenance_links(document_id, maintenance_id) VALUES (v_document.id, p_entity_id);
  ELSE
    INSERT INTO public.document_motorcycle_maintenance_links(document_id, motorcycle_maintenance_id) VALUES (v_document.id, p_entity_id);
  END IF;

  PERFORM public.business_finance_audit_event(
    'DOCUMENT', v_document.id, NULL, 'CREATE', NULL,
    to_jsonb(v_document) || jsonb_build_object('relation', p_relation, 'entity_id', p_entity_id)
  );
  RETURN v_document;
END;
$create_document_with_relation$;

CREATE OR REPLACE FUNCTION public.archive_document(p_document_id uuid)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $archive_document$
DECLARE
  v_before public.documents;
  v_document public.documents;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document introuvable.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.documents
  SET archived_at = now(), archived_by = auth.uid(), updated_at = now()
  WHERE id = p_document_id RETURNING * INTO v_document;
  PERFORM public.business_finance_audit_event('DOCUMENT', v_document.id, NULL, 'ARCHIVE', to_jsonb(v_before), to_jsonb(v_document));
  RETURN v_document;
END;
$archive_document$;

CREATE OR REPLACE FUNCTION public.create_contract_with_relations(
  p_contract jsonb,
  p_relations jsonb DEFAULT '{}'::jsonb
)
RETURNS public.contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_contract_with_relations$
DECLARE
  v_contract public.contracts;
BEGIN
  PERFORM public.business_finance_require_write_role();
  INSERT INTO public.contracts(
    reference, type, partie, date_debut, date_fin, montant, statut, description, entity_type, entity_id
  ) VALUES (
    NULLIF(trim(p_contract ->> 'reference'), ''), NULLIF(trim(p_contract ->> 'type'), ''),
    NULLIF(trim(p_contract ->> 'partie'), ''), NULLIF(p_contract ->> 'date_debut', '')::date,
    NULLIF(p_contract ->> 'date_fin', '')::date, NULLIF(p_contract ->> 'montant', '')::numeric,
    NULLIF(trim(p_contract ->> 'statut'), ''), NULLIF(trim(p_contract ->> 'description'), ''), NULL, NULL
  ) RETURNING * INTO v_contract;

  INSERT INTO public.contract_employee_links(contract_id, employee_id)
  SELECT v_contract.id, value::uuid FROM jsonb_array_elements_text(COALESCE(p_relations -> 'employee_ids', '[]'::jsonb));
  INSERT INTO public.contract_driver_links(contract_id, driver_id)
  SELECT v_contract.id, value::uuid FROM jsonb_array_elements_text(COALESCE(p_relations -> 'driver_ids', '[]'::jsonb));
  INSERT INTO public.contract_vehicle_links(contract_id, vehicle_id)
  SELECT v_contract.id, value::uuid FROM jsonb_array_elements_text(COALESCE(p_relations -> 'vehicle_ids', '[]'::jsonb));
  INSERT INTO public.contract_motorcycle_links(contract_id, motorcycle_id)
  SELECT v_contract.id, value::uuid FROM jsonb_array_elements_text(COALESCE(p_relations -> 'motorcycle_ids', '[]'::jsonb));
  INSERT INTO public.contract_farm_links(contract_id, farm_id)
  SELECT v_contract.id, value::uuid FROM jsonb_array_elements_text(COALESCE(p_relations -> 'farm_ids', '[]'::jsonb));

  PERFORM public.business_finance_audit_event(
    'CONTRACT', v_contract.id, NULL, 'CREATE', NULL, to_jsonb(v_contract) || jsonb_build_object('relations', p_relations)
  );
  RETURN v_contract;
END;
$create_contract_with_relations$;

REVOKE ALL ON FUNCTION public.create_document_with_relation(jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_document(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_contract_with_relations(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_document_with_relation(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contract_with_relations(jsonb, jsonb) TO authenticated;
