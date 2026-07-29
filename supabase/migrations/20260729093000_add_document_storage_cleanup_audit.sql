-- Lot 11: allow a user to delete only its just-uploaded orphan object, and
-- record the compensating cleanup without exposing Storage administration.

DROP POLICY IF EXISTS documents_delete_own_orphan ON storage.objects;
CREATE POLICY documents_delete_own_orphan ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND owner_id = auth.uid()::text
    AND public.user_has_permission('documents.upload')
    AND NOT EXISTS (
      SELECT 1 FROM public.documents d WHERE d.storage_path = storage.objects.name
    )
  );

CREATE OR REPLACE FUNCTION public.record_document_storage_cleanup(
  p_storage_path text,
  p_result text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('documents.upload');
  IF NULLIF(trim(p_storage_path), '') IS NULL OR p_result NOT IN ('METADATA_FAILED_REMOVED', 'METADATA_FAILED_REMOVE_FAILED') THEN
    RAISE EXCEPTION 'Journal de nettoyage invalide.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, metadata)
  VALUES (auth.uid(), 'DOCUMENT_ORPHAN_CLEANUP', 'DOCUMENT_STORAGE', jsonb_build_object('storage_path', p_storage_path, 'result', p_result));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_document_storage_cleanup(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_document_storage_cleanup(text, text) TO authenticated;
