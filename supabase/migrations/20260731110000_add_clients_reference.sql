-- CRM-01: client master data. This migration is additive and intentionally
-- does not create transport missions, invoices, or payments.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The future invoicing engine reads this company-level configuration. CRM-01
-- deliberately keeps taxation disabled until Finance enables it explicitly.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS vat_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5, 2);

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_vat_rate_check;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_vat_rate_check
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100));

CREATE SEQUENCE IF NOT EXISTS public.client_number_sequence
  AS bigint
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1;

CREATE TABLE IF NOT EXISTS public.transport_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_number text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'ORGANIZATION',
  display_name text NOT NULL,
  legal_name text,
  country_code text NOT NULL DEFAULT 'SN',
  city text,
  address text,
  telephone text,
  email text,
  contact_name text,
  contact_phone text,
  contact_email text,
  registration_identifier_type text,
  registration_identifier_value text,
  notes text,
  status text NOT NULL DEFAULT 'ACTIVE',
  merged_into_client_id uuid REFERENCES public.transport_clients(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT transport_clients_kind_check CHECK (kind IN ('ORGANIZATION', 'INDIVIDUAL')),
  CONSTRAINT transport_clients_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT transport_clients_display_name_check CHECK (btrim(display_name) <> ''),
  CONSTRAINT transport_clients_country_check CHECK (country_code = 'SN'),
  CONSTRAINT transport_clients_identifier_pair_check CHECK (
    (registration_identifier_type IS NULL AND registration_identifier_value IS NULL)
    OR (registration_identifier_type IS NOT NULL AND registration_identifier_value IS NOT NULL)
  ),
  CONSTRAINT transport_clients_no_self_merge_check CHECK (
    merged_into_client_id IS NULL OR merged_into_client_id <> id
  )
);

CREATE TABLE IF NOT EXISTS public.client_identifier_validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'SN',
  identifier_type text NOT NULL,
  label text NOT NULL,
  validation_pattern text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_identifier_validation_rules_country_check CHECK (country_code = 'SN'),
  CONSTRAINT client_identifier_validation_rules_type_check CHECK (identifier_type IN ('NINEA', 'RCCM')),
  CONSTRAINT client_identifier_validation_rules_unique UNIQUE (country_code, identifier_type)
);

INSERT INTO public.client_identifier_validation_rules(country_code, identifier_type, label, validation_pattern)
VALUES
  ('SN', 'NINEA', 'NINEA', NULL),
  ('SN', 'RCCM', 'RCCM', NULL)
ON CONFLICT (country_code, identifier_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.document_transport_client_links (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.transport_clients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (document_id, client_id)
);

CREATE INDEX IF NOT EXISTS transport_clients_display_name_trgm_idx
  ON public.transport_clients USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS transport_clients_legal_name_trgm_idx
  ON public.transport_clients USING gin (legal_name gin_trgm_ops)
  WHERE legal_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS transport_clients_status_display_name_idx
  ON public.transport_clients(status, display_name);
CREATE INDEX IF NOT EXISTS transport_clients_email_normalized_idx
  ON public.transport_clients(lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS transport_clients_phone_normalized_idx
  ON public.transport_clients((regexp_replace(lower(telephone), '[^[:alnum:]]', '', 'g')))
  WHERE telephone IS NOT NULL;
CREATE INDEX IF NOT EXISTS transport_clients_identifier_normalized_idx
  ON public.transport_clients(
    registration_identifier_type,
    (regexp_replace(upper(registration_identifier_value), '[^[:alnum:]]', '', 'g'))
  )
  WHERE registration_identifier_value IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_transport_client_links_client_idx
  ON public.document_transport_client_links(client_id, document_id);

ALTER TABLE public.transport_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_identifier_validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_transport_client_links ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.transport_clients, public.document_transport_client_links TO authenticated;

DROP POLICY IF EXISTS transport_clients_read ON public.transport_clients;
CREATE POLICY transport_clients_read ON public.transport_clients
  FOR SELECT TO authenticated
  USING (public.user_has_permission('clients.read'));

DROP POLICY IF EXISTS document_transport_client_links_read ON public.document_transport_client_links;
CREATE POLICY document_transport_client_links_read ON public.document_transport_client_links
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission('clients.read')
    AND public.user_has_permission('documents.read')
  );

-- Identifier rules are configuration only. Mutations are deliberately not
-- exposed in CRM-01; the future Settings surface will use a dedicated RPC.
DROP POLICY IF EXISTS client_identifier_validation_rules_admin_read ON public.client_identifier_validation_rules;
CREATE POLICY client_identifier_validation_rules_admin_read ON public.client_identifier_validation_rules
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[]));

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('clients.read', 'clients', 'read', 'Consulter les clients et leurs relations autorisées.', 'SENSITIVE'),
  ('clients.create', 'clients', 'create', 'Créer un client.', 'SENSITIVE'),
  ('clients.update', 'clients', 'update', 'Modifier un client actif.', 'SENSITIVE'),
  ('clients.archive', 'clients', 'archive', 'Archiver ou restaurer un client.', 'SENSITIVE'),
  ('clients.merge', 'clients', 'merge', 'Fusionner deux clients avec audit.', 'CRITICAL'),
  ('clients.financial.read', 'clients', 'financial_read', 'Consulter les indicateurs financiers Client.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('admin', 'clients.read'), ('admin', 'clients.create'), ('admin', 'clients.update'),
  ('admin', 'clients.archive'), ('admin', 'clients.merge'), ('admin', 'clients.financial.read'),
  ('comptable', 'clients.read'), ('comptable', 'clients.create'), ('comptable', 'clients.update'),
  ('comptable', 'clients.financial.read'),
  ('operations', 'clients.read'), ('operations', 'clients.create'), ('operations', 'clients.update'),
  ('gestionnaire', 'clients.read'), ('gestionnaire', 'clients.create'), ('gestionnaire', 'clients.update'),
  ('lecture_seule', 'clients.read')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

ALTER TABLE public.business_finance_audit
  DROP CONSTRAINT IF EXISTS business_finance_audit_action_check;
ALTER TABLE public.business_finance_audit
  ADD CONSTRAINT business_finance_audit_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'ARCHIVE', 'RESTORE', 'REPLACE',
    'ASSIGN', 'CLOSE', 'UNASSIGN', 'MERGE'
  ));

CREATE OR REPLACE FUNCTION public._internal_validate_client_payload(p_client jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_client ->> 'country_code'), ''), 'SN'));
  v_identifier_type text := NULLIF(upper(btrim(p_client ->> 'registration_identifier_type')), '');
  v_identifier_value text := NULLIF(btrim(p_client ->> 'registration_identifier_value'), '');
  v_pattern text;
BEGIN
  IF p_client IS NULL OR jsonb_typeof(p_client) <> 'object' THEN
    RAISE EXCEPTION 'Les données Client sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_client) AS key_name
    WHERE key_name NOT IN (
      'kind', 'display_name', 'legal_name', 'country_code', 'city', 'address',
      'telephone', 'email', 'contact_name', 'contact_phone', 'contact_email',
      'registration_identifier_type', 'registration_identifier_value', 'notes'
    )
  ) THEN
    RAISE EXCEPTION 'Une propriété Client non autorisée a été fournie.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_client ->> 'display_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom ou la raison sociale du client est obligatoire.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_client ->> 'kind', 'ORGANIZATION') NOT IN ('ORGANIZATION', 'INDIVIDUAL') THEN
    RAISE EXCEPTION 'Le type de client est invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_country_code <> 'SN' THEN
    RAISE EXCEPTION 'Le pays initial du référentiel Client est le Sénégal.' USING ERRCODE = '22023';
  END IF;
  IF (v_identifier_type IS NULL) <> (v_identifier_value IS NULL) THEN
    RAISE EXCEPTION 'Le type et la valeur de l''identifiant légal doivent être renseignés ensemble.' USING ERRCODE = '22023';
  END IF;
  IF v_identifier_type IS NOT NULL THEN
    SELECT validation_pattern INTO v_pattern
    FROM public.client_identifier_validation_rules
    WHERE country_code = v_country_code
      AND identifier_type = v_identifier_type
      AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Le type d''identifiant légal est invalide pour le Sénégal.' USING ERRCODE = '22023';
    END IF;
    IF v_pattern IS NOT NULL AND v_identifier_value !~ v_pattern THEN
      RAISE EXCEPTION 'Le format de l''identifiant légal est invalide.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NULLIF(btrim(p_client ->> 'email'), '') IS NOT NULL
    AND p_client ->> 'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'L''adresse e-mail est invalide.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._internal_next_client_number()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT format('CLI-%s-%s', to_char(current_date, 'YYYY'), lpad(nextval('public.client_number_sequence')::text, 6, '0'));
$function$;

CREATE OR REPLACE FUNCTION public.create_client(p_client jsonb)
RETURNS public.transport_clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_client public.transport_clients;
BEGIN
  PERFORM public.permission_require('clients.create');
  PERFORM public._internal_validate_client_payload(p_client);

  INSERT INTO public.transport_clients (
    client_number, kind, display_name, legal_name, country_code, city, address,
    telephone, email, contact_name, contact_phone, contact_email,
    registration_identifier_type, registration_identifier_value, notes,
    created_by, updated_by
  ) VALUES (
    public._internal_next_client_number(),
    COALESCE(NULLIF(btrim(p_client ->> 'kind'), ''), 'ORGANIZATION'),
    btrim(p_client ->> 'display_name'),
    NULLIF(btrim(p_client ->> 'legal_name'), ''), 'SN',
    NULLIF(btrim(p_client ->> 'city'), ''), NULLIF(btrim(p_client ->> 'address'), ''),
    NULLIF(btrim(p_client ->> 'telephone'), ''), NULLIF(lower(btrim(p_client ->> 'email')), ''),
    NULLIF(btrim(p_client ->> 'contact_name'), ''), NULLIF(btrim(p_client ->> 'contact_phone'), ''),
    NULLIF(lower(btrim(p_client ->> 'contact_email')), ''),
    NULLIF(upper(btrim(p_client ->> 'registration_identifier_type')), ''),
    NULLIF(btrim(p_client ->> 'registration_identifier_value'), ''),
    NULLIF(btrim(p_client ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_client;

  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES ('CLIENT', v_client.id, 'CREATE', NULL, to_jsonb(v_client), auth.uid());
  RETURN v_client;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_client(p_client_id uuid, p_values jsonb)
RETURNS public.transport_clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.transport_clients;
  v_client public.transport_clients;
BEGIN
  PERFORM public.permission_require('clients.update');
  PERFORM public._internal_validate_client_payload(p_values);
  SELECT * INTO v_before FROM public.transport_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Un client archivé doit être restauré avant modification.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transport_clients
  SET kind = COALESCE(NULLIF(btrim(p_values ->> 'kind'), ''), 'ORGANIZATION'),
      display_name = btrim(p_values ->> 'display_name'),
      legal_name = NULLIF(btrim(p_values ->> 'legal_name'), ''),
      country_code = 'SN',
      city = NULLIF(btrim(p_values ->> 'city'), ''),
      address = NULLIF(btrim(p_values ->> 'address'), ''),
      telephone = NULLIF(btrim(p_values ->> 'telephone'), ''),
      email = NULLIF(lower(btrim(p_values ->> 'email')), ''),
      contact_name = NULLIF(btrim(p_values ->> 'contact_name'), ''),
      contact_phone = NULLIF(btrim(p_values ->> 'contact_phone'), ''),
      contact_email = NULLIF(lower(btrim(p_values ->> 'contact_email')), ''),
      registration_identifier_type = NULLIF(upper(btrim(p_values ->> 'registration_identifier_type')), ''),
      registration_identifier_value = NULLIF(btrim(p_values ->> 'registration_identifier_value'), ''),
      notes = NULLIF(btrim(p_values ->> 'notes'), ''),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_client_id
  RETURNING * INTO v_client;

  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES ('CLIENT', v_client.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_client), auth.uid());
  RETURN v_client;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_client(p_client_id uuid)
RETURNS public.transport_clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.transport_clients;
  v_client public.transport_clients;
BEGIN
  PERFORM public.permission_require('clients.archive');
  SELECT * INTO v_before FROM public.transport_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'ARCHIVED' THEN RETURN v_before; END IF;
  UPDATE public.transport_clients
  SET status = 'ARCHIVED', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_client_id RETURNING * INTO v_client;
  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES ('CLIENT', v_client.id, 'ARCHIVE', to_jsonb(v_before), to_jsonb(v_client), auth.uid());
  RETURN v_client;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_client(p_client_id uuid)
RETURNS public.transport_clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.transport_clients;
  v_client public.transport_clients;
BEGIN
  PERFORM public.permission_require('clients.archive');
  SELECT * INTO v_before FROM public.transport_clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.merged_into_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un client fusionné ne peut pas être restauré directement.' USING ERRCODE = '22023';
  END IF;
  IF v_before.status = 'ACTIVE' THEN RETURN v_before; END IF;
  UPDATE public.transport_clients
  SET status = 'ACTIVE', archived_at = NULL, archived_by = NULL, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_client_id RETURNING * INTO v_client;
  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES ('CLIENT', v_client.id, 'RESTORE', to_jsonb(v_before), to_jsonb(v_client), auth.uid());
  RETURN v_client;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_client_duplicates(
  p_client jsonb,
  p_exclude_client_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  client_number text,
  display_name text,
  legal_name text,
  telephone text,
  email text,
  registration_identifier_type text,
  registration_identifier_value text,
  matched_fields text[],
  name_similarity numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_display_name text := lower(NULLIF(btrim(p_client ->> 'display_name'), ''));
  v_legal_name text := lower(NULLIF(btrim(p_client ->> 'legal_name'), ''));
  v_phone text := NULLIF(regexp_replace(lower(COALESCE(p_client ->> 'telephone', '')), '[^[:alnum:]]', '', 'g'), '');
  v_email text := NULLIF(lower(btrim(COALESCE(p_client ->> 'email', ''))), '');
  v_identifier_type text := NULLIF(upper(btrim(p_client ->> 'registration_identifier_type')), '');
  v_identifier_value text := NULLIF(regexp_replace(upper(COALESCE(p_client ->> 'registration_identifier_value', '')), '[^[:alnum:]]', '', 'g'), '');
BEGIN
  IF NOT public.user_has_any_permission(ARRAY['clients.create', 'clients.update', 'clients.merge']) THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
  IF v_display_name IS NULL AND v_legal_name IS NULL AND v_phone IS NULL AND v_email IS NULL AND v_identifier_value IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    client.id,
    client.client_number,
    client.display_name,
    client.legal_name,
    client.telephone,
    client.email,
    client.registration_identifier_type,
    client.registration_identifier_value,
    array_remove(ARRAY[
      CASE WHEN v_phone IS NOT NULL AND regexp_replace(lower(COALESCE(client.telephone, '')), '[^[:alnum:]]', '', 'g') = v_phone THEN 'PHONE' END,
      CASE WHEN v_email IS NOT NULL AND lower(COALESCE(client.email, '')) = v_email THEN 'EMAIL' END,
      CASE WHEN v_identifier_type IS NOT NULL AND v_identifier_value IS NOT NULL
        AND client.registration_identifier_type = v_identifier_type
        AND regexp_replace(upper(COALESCE(client.registration_identifier_value, '')), '[^[:alnum:]]', '', 'g') = v_identifier_value THEN 'IDENTIFIER' END,
      CASE WHEN v_display_name IS NOT NULL AND similarity(lower(client.display_name), v_display_name) >= 0.55 THEN 'NAME' END,
      CASE WHEN v_legal_name IS NOT NULL AND client.legal_name IS NOT NULL
        AND similarity(lower(client.legal_name), v_legal_name) >= 0.55 THEN 'LEGAL_NAME' END
    ], NULL)::text[],
    GREATEST(
      CASE WHEN v_display_name IS NULL THEN 0::numeric ELSE similarity(lower(client.display_name), v_display_name)::numeric END,
      CASE WHEN v_legal_name IS NULL OR client.legal_name IS NULL THEN 0::numeric ELSE similarity(lower(client.legal_name), v_legal_name)::numeric END
    )
  FROM public.transport_clients AS client
  WHERE client.id IS DISTINCT FROM p_exclude_client_id
    AND (
      (v_phone IS NOT NULL AND regexp_replace(lower(COALESCE(client.telephone, '')), '[^[:alnum:]]', '', 'g') = v_phone)
      OR (v_email IS NOT NULL AND lower(COALESCE(client.email, '')) = v_email)
      OR (v_identifier_type IS NOT NULL AND v_identifier_value IS NOT NULL
        AND client.registration_identifier_type = v_identifier_type
        AND regexp_replace(upper(COALESCE(client.registration_identifier_value, '')), '[^[:alnum:]]', '', 'g') = v_identifier_value)
      OR (v_display_name IS NOT NULL AND similarity(lower(client.display_name), v_display_name) >= 0.55)
      OR (v_legal_name IS NOT NULL AND client.legal_name IS NOT NULL
        AND similarity(lower(client.legal_name), v_legal_name) >= 0.55)
    )
  ORDER BY
    cardinality(array_remove(ARRAY[
      CASE WHEN v_phone IS NOT NULL AND regexp_replace(lower(COALESCE(client.telephone, '')), '[^[:alnum:]]', '', 'g') = v_phone THEN 'PHONE' END,
      CASE WHEN v_email IS NOT NULL AND lower(COALESCE(client.email, '')) = v_email THEN 'EMAIL' END,
      CASE WHEN v_identifier_type IS NOT NULL AND v_identifier_value IS NOT NULL
        AND client.registration_identifier_type = v_identifier_type
        AND regexp_replace(upper(COALESCE(client.registration_identifier_value, '')), '[^[:alnum:]]', '', 'g') = v_identifier_value THEN 'IDENTIFIER' END,
      CASE WHEN v_display_name IS NOT NULL AND similarity(lower(client.display_name), v_display_name) >= 0.55 THEN 'NAME' END,
      CASE WHEN v_legal_name IS NOT NULL AND client.legal_name IS NOT NULL
        AND similarity(lower(client.legal_name), v_legal_name) >= 0.55 THEN 'LEGAL_NAME' END
    ], NULL)::text[]) DESC,
    GREATEST(
      CASE WHEN v_display_name IS NULL THEN 0::numeric ELSE similarity(lower(client.display_name), v_display_name)::numeric END,
      CASE WHEN v_legal_name IS NULL OR client.legal_name IS NULL THEN 0::numeric ELSE similarity(lower(client.legal_name), v_legal_name)::numeric END
    ) DESC,
    client.display_name
  LIMIT 20;
END;
$function$;

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

  FOREACH v_table_name IN ARRAY ARRAY['transport_missions', 'transport_invoices']
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

CREATE OR REPLACE FUNCTION public.get_client_financial_metrics(p_client_id uuid)
RETURNS TABLE(
  metrics_available boolean,
  mission_count bigint,
  total_billed numeric,
  total_received numeric,
  amount_due numeric,
  total_expenses numeric,
  gross_result numeric,
  cash_result numeric,
  last_mission_at timestamptz,
  last_payment_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('clients.financial.read');
  IF NOT EXISTS (SELECT 1 FROM public.transport_clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002';
  END IF;

  -- MT tables are intentionally absent in CRM-01. Returning NULL values is
  -- explicit: the interface must not display a financial zero as real data.
  RETURN QUERY SELECT false, NULL::bigint, NULL::numeric, NULL::numeric,
    NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
    NULL::timestamptz, NULL::timestamptz;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_audit_history(p_client_id uuid)
RETURNS TABLE(
  id uuid,
  action text,
  created_at timestamptz,
  performed_by uuid,
  before_value jsonb,
  after_value jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('clients.read');
  IF NOT EXISTS (SELECT 1 FROM public.transport_clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT audit.id, audit.action, audit.created_at, audit.performed_by,
    audit.before_value - 'registration_identifier_value' - 'telephone' - 'email' - 'address',
    audit.after_value - 'registration_identifier_value' - 'telephone' - 'email' - 'address'
  FROM public.business_finance_audit AS audit
  WHERE audit.source_type = 'CLIENT' AND audit.source_id = p_client_id
  ORDER BY audit.created_at DESC;
END;
$function$;

-- Extend the existing relational document RPC to support Client documents
-- while preserving all existing entity relations and private Storage checks.
CREATE OR REPLACE FUNCTION public.create_document_with_relation(
  p_document jsonb,
  p_relation text,
  p_entity_id uuid
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_temp
AS $function$
DECLARE
  v_document public.documents;
  v_storage_path text := NULLIF(btrim(p_document ->> 'storage_path'), '');
BEGIN
  PERFORM public.permission_require('documents.upload');
  IF NULLIF(btrim(p_document ->> 'nom'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du document est obligatoire.' USING ERRCODE = '22023';
  END IF;
  IF v_storage_path IS NULL THEN
    RAISE EXCEPTION 'Le fichier privé du document est obligatoire.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'documents' AND name = v_storage_path) THEN
    RAISE EXCEPTION 'Le fichier Storage est introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF p_relation NOT IN (
    'client', 'employee', 'driver', 'vehicle', 'motorcycle', 'farm', 'contract',
    'vehicle_maintenance', 'motorcycle_maintenance'
  ) THEN
    RAISE EXCEPTION 'Type de relation documentaire invalide.' USING ERRCODE = '22023';
  END IF;
  IF p_relation = 'client' THEN
    PERFORM public.permission_require('clients.read');
    IF NOT EXISTS (SELECT 1 FROM public.transport_clients WHERE id = p_entity_id) THEN
      RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.documents(nom, type, url, storage_path, date_emission, date_expiration, entity_type, entity_id)
  VALUES (
    btrim(p_document ->> 'nom'), NULLIF(btrim(p_document ->> 'type'), ''), NULL, v_storage_path,
    NULLIF(p_document ->> 'date_emission', '')::date, NULLIF(p_document ->> 'date_expiration', '')::date,
    NULL, NULL
  ) RETURNING * INTO v_document;

  IF p_relation = 'client' THEN
    INSERT INTO public.document_transport_client_links(document_id, client_id, created_by)
    VALUES (v_document.id, p_entity_id, auth.uid());
  ELSIF p_relation = 'employee' THEN
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
$function$;

REVOKE ALL ON FUNCTION
  public._internal_validate_client_payload(jsonb),
  public._internal_next_client_number(),
  public.create_client(jsonb),
  public.update_client(uuid, jsonb),
  public.archive_client(uuid),
  public.restore_client(uuid),
  public.detect_client_duplicates(jsonb, uuid),
  public.merge_clients(uuid, uuid, text),
  public.get_client_financial_metrics(uuid),
  public.get_client_audit_history(uuid),
  public.create_document_with_relation(jsonb, text, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.create_client(jsonb),
  public.update_client(uuid, jsonb),
  public.archive_client(uuid),
  public.restore_client(uuid),
  public.detect_client_duplicates(jsonb, uuid),
  public.merge_clients(uuid, uuid, text),
  public.get_client_financial_metrics(uuid),
  public.get_client_audit_history(uuid),
  public.create_document_with_relation(jsonb, text, uuid)
TO authenticated;
