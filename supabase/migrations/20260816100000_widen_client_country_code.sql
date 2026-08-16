-- GFC V1 Phase 2 -- Clients/Creances. Widen transport_clients.country_code
-- additively (CI/SN) per explicit business decision: KEEP transport_clients
-- as the shared client referential, accept CI/SN/others per business/
-- location, and never silently rewrite existing rows.
--
-- Context: migration 20260809123000 already rewrote every historical SN row
-- to CI (raw UPDATE, outside update_client()) and locked the column to
-- CHECK (country_code = 'CI') only. That migration is already applied and
-- immutable -- it is not touched here. No audit trail exists to identify
-- which rows were originally SN, so this migration does not attempt to
-- restore anything; it only reopens the option going forward. DEFAULT
-- stays 'CI' (current active operating country).
--
-- A second, deeper bug found while designing this: create_client/
-- update_client parsed a country from the payload only to validate it
-- (_internal_validate_client_payload), then silently discarded that value
-- and inserted/updated the literal 'CI' regardless of what was supplied.
-- Both are corrected here so the widened validation is actually reachable.

ALTER TABLE public.transport_clients
  DROP CONSTRAINT IF EXISTS transport_clients_country_check;

ALTER TABLE public.transport_clients
  ADD CONSTRAINT transport_clients_country_check CHECK (country_code IN ('CI', 'SN'));

CREATE OR REPLACE FUNCTION public._internal_validate_client_payload(p_client jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_client ->> 'country_code'), ''), 'CI'));
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
  IF v_country_code NOT IN ('CI', 'SN') THEN
    RAISE EXCEPTION 'Le pays du référentiel Client doit être CI (Côte d''Ivoire) ou SN (Sénégal).' USING ERRCODE = '22023';
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
      RAISE EXCEPTION 'Ce type d''identifiant légal n''est pas configuré pour le pays sélectionné (%).', v_country_code USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.create_client(p_client jsonb)
RETURNS public.transport_clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_client public.transport_clients;
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_client ->> 'country_code'), ''), 'CI'));
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
    NULLIF(btrim(p_client ->> 'legal_name'), ''), v_country_code,
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
  v_country_code text := upper(COALESCE(NULLIF(btrim(p_values ->> 'country_code'), ''), 'CI'));
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
      country_code = v_country_code,
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
