-- GFC V1 Phase 3 -- Fournisseurs/Achats. Minimal supplier referential per
-- explicit business decision: NOT stored in transport_clients (no FK just
-- because that table has a country_code), NOT a generic business_parties
-- refactor. Own table, mirrors transport_clients' proven CRUD/audit/
-- duplicate-detection pattern (CRM-01) at a smaller field set, and reuses
-- the SAME additive country-code policy as Phase 2 (explicit allow-list,
-- widened by a one-line migration per confirmed country -- never a second,
-- separate country system).

CREATE TABLE public.commerce_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_number text NOT NULL UNIQUE,
  display_name text NOT NULL,
  legal_name text,
  telephone text,
  email text,
  country_code text NOT NULL DEFAULT 'CI' CHECK (country_code IN ('CI', 'SN')),
  city text,
  address text,
  notes text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  archived_by uuid REFERENCES auth.users(id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commerce_suppliers_display_name_idx ON public.commerce_suppliers USING gin (display_name gin_trgm_ops);
CREATE INDEX commerce_suppliers_status_idx ON public.commerce_suppliers(status);

CREATE OR REPLACE FUNCTION public._internal_next_commerce_supplier_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'FRN-' || to_char(now(), 'YYYY') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(regexp_replace(supplier_number, '\D', '', 'g'), '')::int)
      FROM public.commerce_suppliers
      WHERE supplier_number LIKE 'FRN-' || to_char(now(), 'YYYY') || '-%'
    ), 0) + 1
  )::text, 5, '0');
$function$;

CREATE OR REPLACE FUNCTION public._internal_validate_supplier_payload(p_supplier jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_supplier ->> 'country_code'), ''), 'CI'));
BEGIN
  IF p_supplier IS NULL OR jsonb_typeof(p_supplier) <> 'object' THEN
    RAISE EXCEPTION 'Les données Fournisseur sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_supplier) AS key_name
    WHERE key_name NOT IN (
      'display_name', 'legal_name', 'telephone', 'email', 'country_code', 'city', 'address', 'notes'
    )
  ) THEN
    RAISE EXCEPTION 'Une propriété Fournisseur non autorisée a été fournie.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_supplier ->> 'display_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom ou la raison sociale du fournisseur est obligatoire.' USING ERRCODE = '22023';
  END IF;
  IF v_country_code NOT IN ('CI', 'SN') THEN
    RAISE EXCEPTION 'Le pays du fournisseur doit être CI (Côte d''Ivoire) ou SN (Sénégal).' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_supplier ->> 'email'), '') IS NOT NULL
    AND p_supplier ->> 'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'L''adresse e-mail est invalide.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_supplier(p_supplier jsonb)
RETURNS public.commerce_suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_supplier public.commerce_suppliers;
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_supplier ->> 'country_code'), ''), 'CI'));
BEGIN
  PERFORM public.permission_require('suppliers.create');
  PERFORM public._internal_validate_supplier_payload(p_supplier);

  INSERT INTO public.commerce_suppliers(
    supplier_number, display_name, legal_name, telephone, email, country_code, city, address, notes,
    created_by, updated_by
  ) VALUES (
    public._internal_next_commerce_supplier_number(),
    btrim(p_supplier ->> 'display_name'),
    NULLIF(btrim(p_supplier ->> 'legal_name'), ''),
    NULLIF(btrim(p_supplier ->> 'telephone'), ''),
    NULLIF(lower(btrim(p_supplier ->> 'email')), ''),
    v_country_code,
    NULLIF(btrim(p_supplier ->> 'city'), ''),
    NULLIF(btrim(p_supplier ->> 'address'), ''),
    NULLIF(btrim(p_supplier ->> 'notes'), ''),
    auth.uid(), auth.uid()
  ) RETURNING * INTO v_supplier;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER', v_supplier.id, NULL, 'CREATE', NULL, to_jsonb(v_supplier));
  RETURN v_supplier;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_supplier(p_supplier_id uuid, p_values jsonb)
RETURNS public.commerce_suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_suppliers;
  v_supplier public.commerce_suppliers;
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_values ->> 'country_code'), ''), 'CI'));
BEGIN
  PERFORM public.permission_require('suppliers.update');
  PERFORM public._internal_validate_supplier_payload(p_values);
  SELECT * INTO v_before FROM public.commerce_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fournisseur introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Un fournisseur archivé doit être restauré avant modification.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commerce_suppliers
  SET display_name = btrim(p_values ->> 'display_name'),
      legal_name = NULLIF(btrim(p_values ->> 'legal_name'), ''),
      telephone = NULLIF(btrim(p_values ->> 'telephone'), ''),
      email = NULLIF(lower(btrim(p_values ->> 'email')), ''),
      country_code = v_country_code,
      city = NULLIF(btrim(p_values ->> 'city'), ''),
      address = NULLIF(btrim(p_values ->> 'address'), ''),
      notes = NULLIF(btrim(p_values ->> 'notes'), ''),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_supplier_id
  RETURNING * INTO v_supplier;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER', v_supplier.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_supplier));
  RETURN v_supplier;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_supplier(p_supplier_id uuid)
RETURNS public.commerce_suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_suppliers;
  v_supplier public.commerce_suppliers;
BEGIN
  PERFORM public.permission_require('suppliers.archive');
  SELECT * INTO v_before FROM public.commerce_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'ARCHIVED' THEN RETURN v_before; END IF;

  UPDATE public.commerce_suppliers
  SET status = 'ARCHIVED', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_supplier_id
  RETURNING * INTO v_supplier;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER', v_supplier.id, NULL, 'ARCHIVE', to_jsonb(v_before), to_jsonb(v_supplier));
  RETURN v_supplier;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_supplier(p_supplier_id uuid)
RETURNS public.commerce_suppliers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_suppliers;
  v_supplier public.commerce_suppliers;
BEGIN
  PERFORM public.permission_require('suppliers.archive');
  SELECT * INTO v_before FROM public.commerce_suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'ACTIVE' THEN RETURN v_before; END IF;

  UPDATE public.commerce_suppliers
  SET status = 'ACTIVE', archived_at = NULL, archived_by = NULL, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_supplier_id
  RETURNING * INTO v_supplier;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER', v_supplier.id, NULL, 'RESTORE', to_jsonb(v_before), to_jsonb(v_supplier));
  RETURN v_supplier;
END;
$function$;

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
    ARRAY(SELECT unnest(ARRAY[
      CASE WHEN v_telephone IS NOT NULL AND s.telephone = v_telephone THEN 'telephone' END,
      CASE WHEN v_email IS NOT NULL AND s.email = v_email THEN 'email' END,
      CASE WHEN similarity(s.display_name, v_name) >= 0.55 THEN 'nom' END,
      CASE WHEN v_legal_name IS NOT NULL AND similarity(COALESCE(s.legal_name, ''), v_legal_name) >= 0.55 THEN 'raison_sociale' END
    ]) WHERE unnest IS NOT NULL),
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

ALTER TABLE public.commerce_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_suppliers_authorized_read ON public.commerce_suppliers
  FOR SELECT TO authenticated USING (public.user_has_permission('suppliers.read'));

REVOKE ALL ON TABLE public.commerce_suppliers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_suppliers TO authenticated;
REVOKE ALL ON FUNCTION public._internal_next_commerce_supplier_number(), public._internal_validate_supplier_payload(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_supplier(jsonb), public.update_supplier(uuid, jsonb), public.archive_supplier(uuid), public.restore_supplier(uuid), public.detect_supplier_duplicates(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier(jsonb), public.update_supplier(uuid, jsonb), public.archive_supplier(uuid), public.restore_supplier(uuid), public.detect_supplier_duplicates(jsonb, uuid) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('suppliers.read', 'suppliers', 'read', 'Consulter le référentiel Fournisseur.', 'SENSITIVE'),
  ('suppliers.create', 'suppliers', 'create', 'Créer un fournisseur.', 'SENSITIVE'),
  ('suppliers.update', 'suppliers', 'update', 'Modifier un fournisseur.', 'SENSITIVE'),
  ('suppliers.archive', 'suppliers', 'archive', 'Archiver ou restaurer un fournisseur.', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'suppliers.read'), ('admin', 'suppliers.create'), ('admin', 'suppliers.update'), ('admin', 'suppliers.archive'),
  ('comptable', 'suppliers.read'),
  ('gestionnaire', 'suppliers.read'), ('gestionnaire', 'suppliers.create'), ('gestionnaire', 'suppliers.update');
