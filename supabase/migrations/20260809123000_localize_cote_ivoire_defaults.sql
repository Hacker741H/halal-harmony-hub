-- HALAL ERP operates from Côte d'Ivoire. This additive migration updates only
-- country/timezone defaults; it does not touch any financial operation or wallet.

DO $localize_clients$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.transport_clients
    WHERE country_code NOT IN ('SN', 'CI')
  ) THEN
    RAISE EXCEPTION 'Migration Côte d''Ivoire interrompue : un code pays Client non prévu doit être revu manuellement.';
  END IF;
END;
$localize_clients$;

ALTER TABLE public.transport_clients
  DROP CONSTRAINT IF EXISTS transport_clients_country_check;

UPDATE public.transport_clients
SET country_code = 'CI',
    updated_at = now()
WHERE country_code = 'SN';

ALTER TABLE public.transport_clients
  ALTER COLUMN country_code SET DEFAULT 'CI',
  ADD CONSTRAINT transport_clients_country_check CHECK (country_code = 'CI');

ALTER TABLE public.client_identifier_validation_rules
  DROP CONSTRAINT IF EXISTS client_identifier_validation_rules_country_check;

UPDATE public.client_identifier_validation_rules
SET country_code = 'CI',
    updated_at = now()
WHERE country_code = 'SN';

UPDATE public.client_identifier_validation_rules
SET is_active = false,
    updated_at = now()
WHERE country_code = 'CI'
  AND identifier_type = 'NINEA';

ALTER TABLE public.client_identifier_validation_rules
  ALTER COLUMN country_code SET DEFAULT 'CI',
  ADD CONSTRAINT client_identifier_validation_rules_country_check CHECK (country_code = 'CI');

ALTER TABLE public.company_settings
  ALTER COLUMN timezone SET DEFAULT 'Africa/Abidjan';

UPDATE public.company_settings
SET timezone = 'Africa/Abidjan',
    updated_at = now()
WHERE timezone = 'Africa/Dakar';

CREATE OR REPLACE FUNCTION public.notification_business_date()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.company_settings ORDER BY created_at ASC LIMIT 1),
    'Africa/Abidjan'
  ))::date;
$function$;

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
  IF v_country_code <> 'CI' THEN
    RAISE EXCEPTION 'Le pays du référentiel Client est la Côte d''Ivoire.' USING ERRCODE = '22023';
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
      RAISE EXCEPTION 'Le type d''identifiant légal est invalide pour la Côte d''Ivoire.' USING ERRCODE = '22023';
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
    NULLIF(btrim(p_client ->> 'legal_name'), ''), 'CI',
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
      country_code = 'CI',
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
