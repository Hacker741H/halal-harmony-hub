-- CRM-01 client reference tests.
-- Run only after 20260731110000_add_clients_reference.sql is applied.
-- The complete script is transactional and leaves no test Client behind.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_read_only_id uuid;
  v_target public.transport_clients;
  v_source public.transport_clients;
  v_source_after public.transport_clients;
  v_metrics record;
  v_duplicate_count integer;
  v_audit_count integer;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
BEGIN
  -- Structural assertions are independent from the availability of test users.
  IF to_regclass('public.transport_clients') IS NULL THEN
    RAISE EXCEPTION 'transport_clients is missing';
  END IF;
  IF to_regclass('public.document_transport_client_links') IS NULL THEN
    RAISE EXCEPTION 'document_transport_client_links is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.document_transport_client_links'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.transport_clients'::regclass
      AND constraint_row.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'Document Client links must prevent deleting a referenced Client';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transport_clients'
      AND policyname = 'transport_clients_read'
  ) THEN
    RAISE EXCEPTION 'transport_clients_read RLS policy is missing';
  END IF;
  IF has_function_privilege('anon', 'public.create_client(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute create_client';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS table_row
    WHERE table_row.oid = 'public.transport_clients'::regclass
      AND table_row.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'transport_clients must have row-level security enabled';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transport_clients'
      AND cmd IN ('DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'transport_clients must not expose a direct DELETE RLS policy';
  END IF;
  IF has_table_privilege('authenticated', 'public.transport_clients', 'DELETE') THEN
    RAISE NOTICE 'Direct DELETE table privilege is present, but RLS has no DELETE policy; no physical DELETE is executed by this test.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute_row
    JOIN pg_attrdef AS default_row
      ON default_row.adrelid = attribute_row.attrelid
      AND default_row.adnum = attribute_row.attnum
    WHERE attribute_row.attrelid = 'public.company_settings'::regclass
      AND attribute_row.attname = 'vat_enabled'
      AND pg_get_expr(default_row.adbin, default_row.adrelid) LIKE 'false%'
  ) THEN
    RAISE EXCEPTION 'VAT must default to disabled before an explicit configuration';
  END IF;

  SELECT user_role.user_id
  INTO v_actor_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin'
    AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE NOTICE 'Client mutation tests skipped: no active super_admin test user is available.';
    RETURN;
  END IF;

  -- auth.uid() is the only actor source used by the RPCs.
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  v_target := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', 'Client cible ' || v_suffix,
    'legal_name', 'Cible SARL ' || v_suffix,
    'country_code', 'SN',
    'telephone', '+221 77 000 ' || substr(v_suffix, 1, 4),
    'email', 'cible-' || lower(v_suffix) || '@example.test',
    'registration_identifier_type', null,
    'registration_identifier_value', null
  ));

  v_source := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', 'Client source ' || v_suffix,
    'legal_name', v_target.legal_name,
    'country_code', 'SN',
    'telephone', '+221 78 000 ' || substr(v_suffix, 1, 4),
    'email', 'source-' || lower(v_suffix) || '@example.test',
    'registration_identifier_type', null,
    'registration_identifier_value', null
  ));

  IF v_target.client_number = v_source.client_number THEN
    RAISE EXCEPTION 'Client numbers must be unique';
  END IF;

  SELECT count(*)
  INTO v_duplicate_count
  FROM public.detect_client_duplicates(
    jsonb_build_object(
      'display_name', v_source.display_name,
      'telephone', v_source.telephone,
      'email', null,
      'registration_identifier_type', null,
      'registration_identifier_value', null
    ),
    v_source.id
  ) AS duplicate_row
  WHERE duplicate_row.id = v_source.id;

  IF v_duplicate_count <> 0 THEN
    RAISE EXCEPTION 'Duplicate detection must exclude the requested Client itself';
  END IF;

  SELECT count(*)
  INTO v_duplicate_count
  FROM public.detect_client_duplicates(
    jsonb_build_object(
      'display_name', 'Autre libellé',
      'telephone', v_source.telephone,
      'email', null,
      'registration_identifier_type', null,
      'registration_identifier_value', null
    ),
    null
  ) AS duplicate_row
  WHERE duplicate_row.id = v_source.id
    AND 'PHONE' = ANY(duplicate_row.matched_fields);

  IF v_duplicate_count <> 1 THEN
    RAISE EXCEPTION 'Phone duplicate detection failed';
  END IF;

  SELECT count(*)
  INTO v_duplicate_count
  FROM public.detect_client_duplicates(
    jsonb_build_object(
      'display_name', 'Raison différente',
      'legal_name', v_target.legal_name,
      'telephone', null,
      'email', null,
      'registration_identifier_type', null,
      'registration_identifier_value', null
    ),
    v_source.id
  ) AS duplicate_row
  WHERE duplicate_row.id = v_target.id
    AND 'LEGAL_NAME' = ANY(duplicate_row.matched_fields);

  IF v_duplicate_count <> 1 THEN
    RAISE EXCEPTION 'Legal name duplicate detection failed';
  END IF;

  v_source := public.update_client(v_source.id, jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', v_source.display_name,
    'legal_name', null,
    'country_code', 'SN',
    'city', 'Dakar',
    'address', null,
    'telephone', v_source.telephone,
    'email', v_source.email,
    'contact_name', 'Contact test',
    'contact_phone', null,
    'contact_email', null,
    'registration_identifier_type', null,
    'registration_identifier_value', null,
    'notes', 'Mise à jour transactionnelle test'
  ));
  IF v_source.city <> 'Dakar' THEN
    RAISE EXCEPTION 'Client update failed';
  END IF;

  v_source := public.archive_client(v_source.id);
  IF v_source.status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'Client archive failed';
  END IF;
  v_source := public.restore_client(v_source.id);
  IF v_source.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Client restore failed';
  END IF;

  PERFORM public.merge_clients(v_source.id, v_target.id, 'Fusion de vérification CRM-01 : doublon de test.');
  SELECT * INTO v_source_after FROM public.transport_clients WHERE id = v_source.id;
  IF v_source_after.status <> 'ARCHIVED' OR v_source_after.merged_into_client_id <> v_target.id THEN
    RAISE EXCEPTION 'Client merge must archive the source and preserve the target relation';
  END IF;

  SELECT * INTO v_metrics FROM public.get_client_financial_metrics(v_target.id);
  IF to_regclass('public.transport_missions') IS NULL THEN
    IF v_metrics.metrics_available OR v_metrics.amount_due IS NOT NULL THEN
      RAISE EXCEPTION 'CRM-01 must not expose invented financial values before mission tables exist';
    END IF;
  ELSIF NOT v_metrics.metrics_available
    OR COALESCE(v_metrics.amount_due, -1) <> 0
    OR COALESCE(v_metrics.total_billed, -1) <> 0
    OR COALESCE(v_metrics.total_received, -1) <> 0 THEN
    RAISE EXCEPTION 'Client financial metrics must be available and reconciled when Courses exist';
  END IF;

  SELECT count(*)
  INTO v_audit_count
  FROM public.business_finance_audit
  WHERE source_type = 'CLIENT'
    AND source_id IN (v_target.id, v_source.id)
    AND action IN ('CREATE', 'UPDATE', 'ARCHIVE', 'RESTORE', 'MERGE');
  IF v_audit_count < 6 THEN
    RAISE EXCEPTION 'Expected audited client lifecycle events were not written';
  END IF;

  SELECT user_role.user_id
  INTO v_read_only_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'lecture_seule'
    AND role_catalogue.is_active
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles AS other_role
      WHERE other_role.user_id = user_role.user_id
        AND other_role.role <> 'lecture_seule'
    )
  ORDER BY user_role.created_at
  LIMIT 1;

  IF v_read_only_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_read_only_id::text, true);
    BEGIN
      PERFORM * FROM public.get_client_financial_metrics(v_target.id);
      RAISE EXCEPTION 'lecture_seule must not read Client financial indicators';
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  ELSE
    RAISE NOTICE 'Client financial masking test skipped: no standalone lecture_seule test user is available.';
  END IF;
END;
$test$;

ROLLBACK;
