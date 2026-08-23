CREATE OR REPLACE FUNCTION public.detect_supplier_duplicates(p_supplier jsonb, p_exclude_supplier_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  supplier_number text,
  display_name text,
  legal_name text,
  telephone text,
  email text,
  matched_fields text[],
  name_similarity real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_name text := NULLIF(btrim(p_supplier ->> 'display_name'), '');
  v_legal_name text := NULLIF(btrim(p_supplier ->> 'legal_name'), '');
  v_telephone text := NULLIF(btrim(p_supplier ->> 'telephone'), '');
  v_email text := NULLIF(lower(btrim(p_supplier ->> 'email')), '');
BEGIN
  PERFORM public.permission_require('suppliers.create');
  IF v_name IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    s.id, s.supplier_number, s.display_name, s.legal_name, s.telephone, s.email,
    array_remove(ARRAY[
      CASE WHEN v_telephone IS NOT NULL AND s.telephone = v_telephone THEN 'telephone' END,
      CASE WHEN v_email IS NOT NULL AND s.email = v_email THEN 'email' END,
      CASE WHEN similarity(s.display_name, v_name) >= 0.55 THEN 'nom' END,
      CASE WHEN v_legal_name IS NOT NULL AND similarity(COALESCE(s.legal_name, ''), v_legal_name) >= 0.55 THEN 'raison_sociale' END
    ]::text[], NULL),
    similarity(s.display_name, v_name)
  FROM public.commerce_suppliers s
  WHERE s.status = 'ACTIVE'
    AND (p_exclude_supplier_id IS NULL OR s.id <> p_exclude_supplier_id)
    AND (
      (v_telephone IS NOT NULL AND s.telephone = v_telephone)
      OR (v_email IS NOT NULL AND s.email = v_email)
      OR similarity(s.display_name, v_name) >= 0.55
      OR (v_legal_name IS NOT NULL AND similarity(COALESCE(s.legal_name, ''), v_legal_name) >= 0.55)
    )
  ORDER BY similarity(s.display_name, v_name) DESC
  LIMIT 10;
END;
$function$;
