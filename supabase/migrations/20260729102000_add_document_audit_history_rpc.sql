CREATE OR REPLACE FUNCTION public.get_document_audit_history(p_document_id uuid)
RETURNS SETOF public.business_finance_audit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  PERFORM public.permission_require('documents.read');
  IF public.document_is_sensitive(p_document_id) AND NOT public.user_has_permission('documents.sensitive.read') THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT audit.* FROM public.business_finance_audit AS audit
  WHERE audit.source_type = 'DOCUMENT' AND audit.source_id = p_document_id
  ORDER BY audit.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_audit_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_audit_history(uuid) TO authenticated;
