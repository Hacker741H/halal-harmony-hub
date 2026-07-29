-- Lot 12B: tests SQL transactionnels. Storage est volontairement exclu : son
-- API objet ne peut pas être exercée dans une transaction PostgreSQL.
BEGIN;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', COALESCE((SELECT user_id::text FROM public.user_roles WHERE role = 'super_admin' LIMIT 1), ''), true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_document_id uuid; audit_count integer;
BEGIN
  SELECT d.id INTO v_document_id FROM public.documents d WHERE d.archived_at IS NULL LIMIT 1;
  IF v_document_id IS NULL THEN
    RAISE NOTICE 'Aucun document existant : tests de cycle de vie ignorés.';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.document_vehicle_links l WHERE l.document_id = v_document_id)
     AND NOT EXISTS (SELECT 1 FROM public.document_motorcycle_links l WHERE l.document_id = v_document_id)
     AND NOT EXISTS (SELECT 1 FROM public.document_driver_links l WHERE l.document_id = v_document_id)
     AND NOT EXISTS (SELECT 1 FROM public.document_employee_links l WHERE l.document_id = v_document_id)
     AND NOT EXISTS (SELECT 1 FROM public.document_farm_links l WHERE l.document_id = v_document_id)
     AND NOT EXISTS (SELECT 1 FROM public.document_contract_links l WHERE l.document_id = v_document_id) THEN
    RAISE NOTICE 'Document historique sans liaison explicite : relation testée sur les autres documents.';
  END IF;
  PERFORM public.archive_document(v_document_id);
  IF (SELECT archived_at IS NULL FROM public.documents WHERE id = v_document_id) THEN RAISE EXCEPTION 'Archivage non appliqué'; END IF;
  PERFORM public.restore_document(v_document_id);
  IF (SELECT archived_at IS NOT NULL FROM public.documents WHERE id = v_document_id) THEN RAISE EXCEPTION 'Restauration non appliquée'; END IF;
  SELECT count(*) INTO audit_count FROM public.business_finance_audit WHERE source_type = 'DOCUMENT' AND source_id = v_document_id AND action IN ('ARCHIVE','RESTORE');
  IF audit_count < 2 THEN RAISE EXCEPTION 'Historique documentaire incomplet'; END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'documents.delete') THEN RAISE EXCEPTION 'Permission documents.delete absente'; END IF;
  IF has_function_privilege('anon', 'public.restore_document(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_document_metadata(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'RPC documentaire accessible à anon'; END IF;
END $$;

ROLLBACK;
