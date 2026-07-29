-- Lot 12B: audited document lifecycle. Storage is handled by the client with
-- compensating actions; database metadata changes remain atomic in each RPC.

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES ('documents.delete', 'documents', 'delete', 'Supprimer définitivement les métadonnées documentaires', 'SENSITIVE')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role, permission_code)
SELECT role_catalog.code, 'documents.delete'
FROM public.roles AS role_catalog
WHERE role_catalog.code IN ('super_admin', 'admin')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.restore_document(p_document_id uuid)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_before public.documents; v_document public.documents;
BEGIN
  PERFORM public.permission_require('documents.archive');
  IF public.document_is_sensitive(p_document_id) AND NOT public.user_has_permission('documents.sensitive.read') THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_before FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document introuvable.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.documents SET archived_at = NULL, archived_by = NULL, updated_at = now() WHERE id = p_document_id RETURNING * INTO v_document;
  PERFORM public.business_finance_audit_event('DOCUMENT', v_document.id, NULL, 'RESTORE', to_jsonb(v_before), to_jsonb(v_document));
  RETURN v_document;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_document_metadata(
  p_document_id uuid,
  p_storage_path text,
  p_nom text DEFAULT NULL
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_temp
AS $$
DECLARE v_before public.documents; v_document public.documents;
BEGIN
  PERFORM public.permission_require('documents.upload');
  IF NULLIF(trim(p_storage_path), '') IS NULL THEN RAISE EXCEPTION 'Le nouveau fichier est obligatoire.' USING ERRCODE = '22023'; END IF;
  IF public.document_is_sensitive(p_document_id) AND NOT public.user_has_permission('documents.sensitive.read') THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_before FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'documents' AND name = trim(p_storage_path)) THEN
    RAISE EXCEPTION 'Le nouveau fichier Storage est introuvable.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.documents SET storage_path = trim(p_storage_path), nom = COALESCE(NULLIF(trim(p_nom), ''), nom), url = NULL, updated_at = now()
  WHERE id = p_document_id RETURNING * INTO v_document;
  PERFORM public.business_finance_audit_event('DOCUMENT', v_document.id, NULL, 'REPLACE', to_jsonb(v_before), to_jsonb(v_document));
  RETURN v_document;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_document_metadata(p_document_id uuid)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_document public.documents;
BEGIN
  PERFORM public.permission_require('documents.delete');
  IF public.document_is_sensitive(p_document_id) AND NOT public.user_has_permission('documents.sensitive.read') THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_document FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document introuvable.' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM public.documents WHERE id = p_document_id;
  PERFORM public.business_finance_audit_event('DOCUMENT', v_document.id, NULL, 'DELETE', to_jsonb(v_document), NULL);
  RETURN v_document;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_document(uuid), public.replace_document_metadata(uuid, text, text), public.delete_document_metadata(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_document(uuid), public.replace_document_metadata(uuid, text, text), public.delete_document_metadata(uuid) TO authenticated;
