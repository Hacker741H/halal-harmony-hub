-- Lot 10: least-privilege RLS, RPC execution rights, audit trail and private documents.
-- This migration is additive: it does not delete business data or historical tables.

-- ---------------------------------------------------------------------------
-- Trusted role helpers. The actor always comes from auth.uid(), never from a
-- browser parameter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_any_role(p_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS role_row
      WHERE role_row.user_id = auth.uid()
        AND role_row.role = ANY(p_roles)
    );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT role_row.role
  FROM public.user_roles AS role_row
  WHERE role_row.user_id = auth.uid()
  ORDER BY CASE role_row.role
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'comptable' THEN 3
    WHEN 'gestionnaire' THEN 4
    WHEN 'chauffeur' THEN 5
    WHEN 'employe' THEN 6
    WHEN 'lecture_seule' THEN 7
  END
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.security_require_finance_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à gérer les données financières.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Keep the generic finance journal reserved for finance roles. Business RPCs
-- retain their own business_finance_require_write_role() check for automatic
-- entries initiated by a gestionnaire.
CREATE OR REPLACE FUNCTION public.finance_require_write_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.security_require_finance_role();
END;
$function$;

-- ---------------------------------------------------------------------------
-- Security journal. Financial event detail remains in business_finance_audit;
-- this table records security-relevant actions without file content or secrets.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('ROLE_CHANGE', 'DOCUMENT_ARCHIVED', 'WALLET_CREATED', 'WALLET_UPDATED', 'WALLET_DELETED', 'REPORT_EXPORT')),
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_audit_log_actor_created_idx
  ON public.security_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_audit_log_resource_idx
  ON public.security_audit_log(resource_type, resource_id, created_at DESC);

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_audit_log_read ON public.security_audit_log;
CREATE POLICY security_audit_log_read ON public.security_audit_log
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.security_audit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (
    auth.uid(),
    'ROLE_CHANGE',
    'USER_ROLE',
    COALESCE(NEW.id, OLD.id),
    jsonb_strip_nulls(jsonb_build_object(
      'action', TG_OP,
      'target_user_id', COALESCE(NEW.user_id, OLD.user_id),
      'old_role', CASE WHEN OLD IS NULL THEN NULL ELSE OLD.role::text END,
      'new_role', CASE WHEN NEW IS NULL THEN NULL ELSE NEW.role::text END
    ))
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_security_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_security_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.security_audit_user_role_change();

CREATE OR REPLACE FUNCTION public.security_audit_document_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
    VALUES (
      COALESCE(NEW.archived_by, auth.uid()),
      'DOCUMENT_ARCHIVED',
      'DOCUMENT',
      NEW.id,
      jsonb_build_object('archived_at', NEW.archived_at)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_security_audit_document_archive ON public.documents;
CREATE TRIGGER trg_security_audit_document_archive
AFTER UPDATE OF archived_at ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.security_audit_document_archive();

CREATE OR REPLACE FUNCTION public.record_reporting_export(p_report_type text, p_row_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF p_report_type <> 'FINANCE' OR p_row_count < 0 THEN
    RAISE EXCEPTION 'Journal d''export invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.reporting_can_access_report(p_report_type) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à exporter ce rapport.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, metadata)
  VALUES (auth.uid(), 'REPORT_EXPORT', 'REPORT', jsonb_build_object('report_type', p_report_type, 'row_count', p_row_count));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Wallet mutations move behind explicitly checked RPCs. `balance` is never a
-- client-controlled input: it is recalculated from initial_balance + journal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_create(p_wallet jsonb)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_wallet public.wallets;
  v_name text := NULLIF(trim(p_wallet ->> 'name'), '');
  v_type text := NULLIF(trim(p_wallet ->> 'type'), '');
  v_initial_balance numeric(14, 2) := COALESCE(NULLIF(p_wallet ->> 'initial_balance', '')::numeric, 0);
  v_is_default boolean := COALESCE(NULLIF(p_wallet ->> 'is_default', '')::boolean, false);
BEGIN
  PERFORM public.security_require_finance_role();
  IF v_name IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'Le nom et le type du wallet sont obligatoires.' USING ERRCODE = '22023';
  END IF;
  IF v_is_default THEN
    UPDATE public.wallets SET is_default = false, updated_at = now() WHERE is_default = true;
  END IF;
  INSERT INTO public.wallets(name, type, initial_balance, balance, color, icon, is_default)
  VALUES (
    v_name,
    v_type,
    v_initial_balance,
    v_initial_balance,
    NULLIF(trim(p_wallet ->> 'color'), ''),
    NULLIF(trim(p_wallet ->> 'icon'), ''),
    v_is_default
  )
  RETURNING * INTO v_wallet;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (auth.uid(), 'WALLET_CREATED', 'WALLET', v_wallet.id, jsonb_build_object('name', v_wallet.name));
  RETURN v_wallet;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallet_update(p_wallet_id uuid, p_values jsonb)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.wallets;
  v_wallet public.wallets;
  v_make_default boolean;
BEGIN
  PERFORM public.security_require_finance_role();
  IF p_values ? 'balance' THEN
    RAISE EXCEPTION 'Le solde est calculé automatiquement et ne peut pas être modifié directement.' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'name' AND NULLIF(trim(p_values ->> 'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du wallet ne peut pas être vide.' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'type' AND NULLIF(trim(p_values ->> 'type'), '') IS NULL THEN
    RAISE EXCEPTION 'Le type du wallet ne peut pas être vide.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = 'P0002';
  END IF;
  v_make_default := CASE WHEN p_values ? 'is_default' THEN COALESCE(NULLIF(p_values ->> 'is_default', '')::boolean, false) ELSE v_before.is_default END;
  IF v_make_default THEN
    UPDATE public.wallets SET is_default = false, updated_at = now() WHERE is_default = true AND id <> p_wallet_id;
  END IF;
  UPDATE public.wallets
  SET name = CASE WHEN p_values ? 'name' THEN trim(p_values ->> 'name') ELSE name END,
      type = CASE WHEN p_values ? 'type' THEN trim(p_values ->> 'type') ELSE type END,
      initial_balance = CASE WHEN p_values ? 'initial_balance' THEN NULLIF(p_values ->> 'initial_balance', '')::numeric ELSE initial_balance END,
      color = CASE WHEN p_values ? 'color' THEN NULLIF(trim(p_values ->> 'color'), '') ELSE color END,
      icon = CASE WHEN p_values ? 'icon' THEN NULLIF(trim(p_values ->> 'icon'), '') ELSE icon END,
      is_default = v_make_default,
      updated_at = now()
  WHERE id = p_wallet_id
  RETURNING * INTO v_wallet;
  PERFORM public.update_wallet_balance(p_wallet_id);
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (auth.uid(), 'WALLET_UPDATED', 'WALLET', p_wallet_id, jsonb_build_object('name', v_wallet.name));
  RETURN v_wallet;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallet_delete(p_wallet_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_wallet public.wallets;
BEGIN
  PERFORM public.security_require_finance_role();
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_operations
    WHERE wallet_id = p_wallet_id OR destination_wallet_id = p_wallet_id
  ) THEN
    RAISE EXCEPTION 'Ce wallet ne peut pas être supprimé car il est utilisé par une opération financière.' USING ERRCODE = '23503';
  END IF;
  UPDATE public.vehicles SET purchase_wallet_id = NULL WHERE purchase_wallet_id = p_wallet_id;
  DELETE FROM public.wallets WHERE id = p_wallet_id;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (auth.uid(), 'WALLET_DELETED', 'WALLET', p_wallet_id, jsonb_build_object('name', v_wallet.name));
  RETURN true;
END;
$function$;

-- Finance users need a deliberately narrow directory for salary payments, not
-- unrestricted employee rows (which include base salary and personal fields).
CREATE OR REPLACE FUNCTION public.get_salary_payment_people()
RETURNS TABLE(employee_id uuid, nom text, prenom text, driver_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.security_require_finance_role();
  RETURN QUERY
  SELECT employee.id, employee.nom, employee.prenom, driver.id
  FROM public.employees AS employee
  LEFT JOIN public.drivers AS driver ON driver.employee_id = employee.id
  ORDER BY employee.nom, employee.prenom NULLS LAST;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Private document storage. Existing public URLs are preserved as data and
-- mapped to a storage path so callers can receive a signed URL after the
-- bucket becomes private.
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS storage_path text;
CREATE UNIQUE INDEX IF NOT EXISTS documents_storage_path_unique_idx
  ON public.documents(storage_path)
  WHERE storage_path IS NOT NULL;

UPDATE public.documents
SET storage_path = regexp_replace(url, '^.*/storage/v1/object/public/documents/', '')
WHERE storage_path IS NULL
  AND url ~ '^https?://.*/storage/v1/object/public/documents/.+';

COMMENT ON COLUMN public.documents.storage_path IS
  'Private Storage object name. The legacy url is retained for external documents and rollback.';

UPDATE storage.buckets SET public = false WHERE id = 'documents';

DROP POLICY IF EXISTS "documents_read flreew_0" ON storage.objects;
DROP POLICY IF EXISTS "documents_update flreew_0" ON storage.objects;
DROP POLICY IF EXISTS "documents_update flreew_1" ON storage.objects;
DROP POLICY IF EXISTS "documents_upload flreew_0" ON storage.objects;
DROP POLICY IF EXISTS documents_read_authorized ON storage.objects;
DROP POLICY IF EXISTS documents_upload_authorized ON storage.objects;

CREATE POLICY documents_read_authorized ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[])
  );

CREATE POLICY documents_upload_authorized ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[])
  );

CREATE OR REPLACE FUNCTION public.create_document_with_relation(
  p_document jsonb,
  p_relation text,
  p_entity_id uuid
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_document public.documents;
  v_storage_path text := NULLIF(trim(p_document ->> 'storage_path'), '');
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF NULLIF(trim(p_document ->> 'nom'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du document est obligatoire.' USING ERRCODE = '22023';
  END IF;
  IF p_relation NOT IN (
    'employee', 'driver', 'vehicle', 'motorcycle', 'farm', 'contract',
    'vehicle_maintenance', 'motorcycle_maintenance'
  ) THEN
    RAISE EXCEPTION 'Type de relation documentaire invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_storage_path IS NOT NULL THEN
    IF v_storage_path !~ ('^' || p_relation || '/' || p_entity_id::text || '/') THEN
      RAISE EXCEPTION 'Le chemin du fichier ne correspond pas à son entité.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'documents' AND name = v_storage_path
    ) THEN
      RAISE EXCEPTION 'Le fichier privé est introuvable.' USING ERRCODE = '23503';
    END IF;
  END IF;

  INSERT INTO public.documents(nom, type, url, storage_path, date_emission, date_expiration, entity_type, entity_id)
  VALUES (
    trim(p_document ->> 'nom'),
    NULLIF(trim(p_document ->> 'type'), ''),
    NULLIF(trim(p_document ->> 'url'), ''),
    v_storage_path,
    NULLIF(p_document ->> 'date_emission', '')::date,
    NULLIF(p_document ->> 'date_expiration', '')::date,
    NULL,
    NULL
  ) RETURNING * INTO v_document;

  IF p_relation = 'employee' THEN
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

-- ---------------------------------------------------------------------------
-- RLS: remove permissive reads and direct writes where mutations belong to an
-- atomic RPC. Existing operational write paths remain available only to the
-- management roles that already own those workflows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_read_all_auth ON public.profiles;
CREATE POLICY profiles_read_authorized ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[]));

DROP POLICY IF EXISTS employees_read ON public.employees;
CREATE POLICY employees_read ON public.employees
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS drivers_read ON public.drivers;
CREATE POLICY drivers_read ON public.drivers
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS contracts_read ON public.contracts;
CREATE POLICY contracts_read ON public.contracts
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS documents_read ON public.documents;
CREATE POLICY documents_read ON public.documents
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS vehicles_read ON public.vehicles;
CREATE POLICY vehicles_read ON public.vehicles
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS motos_read ON public.motorcycles;
CREATE POLICY motos_read ON public.motorcycles
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS farms_read ON public.farms;
CREATE POLICY farms_read ON public.farms
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS harvests_read ON public.harvests;
CREATE POLICY harvests_read ON public.harvests
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS maint_read ON public.maintenances;
CREATE POLICY maint_read ON public.maintenances
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS "Allow authenticated select" ON public.motorcycle_maintenances;
DROP POLICY IF EXISTS motorcycle_maintenances_read ON public.motorcycle_maintenances;
CREATE POLICY motorcycle_maintenances_read ON public.motorcycle_maintenances
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS inv_items_read ON public.inventory_items;
CREATE POLICY inv_items_read ON public.inventory_items
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS stock_movements_read ON public.stock_movements;
CREATE POLICY stock_movements_read ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS wallets_read ON public.wallets;
DROP POLICY IF EXISTS wallets_write ON public.wallets;
CREATE POLICY wallets_read ON public.wallets
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS finance_operations_read ON public.finance_operations;
DROP POLICY IF EXISTS finance_operations_write ON public.finance_operations;
CREATE POLICY finance_operations_read ON public.finance_operations
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS finance_links_read ON public.finance_links;
DROP POLICY IF EXISTS finance_links_write ON public.finance_links;
CREATE POLICY finance_links_read ON public.finance_links
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS salary_payments_read ON public.salary_payments;
CREATE POLICY salary_payments_read ON public.salary_payments
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS revenues_read ON public.revenues;
DROP POLICY IF EXISTS expenses_read ON public.expenses;
DROP POLICY IF EXISTS payments_read ON public.payments;
CREATE POLICY revenues_read ON public.revenues
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));
CREATE POLICY expenses_read ON public.expenses
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));
CREATE POLICY payments_read ON public.payments
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));
CREATE POLICY stocks_read_historical ON public.stocks
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS settings_read ON public.company_settings;
CREATE POLICY settings_read ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS notification_alert_rules_read ON public.notification_alert_rules;
CREATE POLICY notification_alert_rules_read ON public.notification_alert_rules
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS notion_map_read ON public.notion_database_mappings;
CREATE POLICY notion_map_read ON public.notion_database_mappings
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[]));

-- Explicit relation tables do not carry data by themselves; their read policy
-- follows the highest sensitivity of the linked entity, and direct writes are
-- removed because the relation RPCs are atomic.
DO $policy$
DECLARE
  relation_table text;
BEGIN
  FOREACH relation_table IN ARRAY ARRAY[
    'contract_employee_links', 'contract_driver_links', 'contract_vehicle_links', 'contract_motorcycle_links', 'contract_farm_links',
    'document_employee_links', 'document_driver_links', 'document_vehicle_links', 'document_motorcycle_links', 'document_farm_links', 'document_contract_links', 'document_vehicle_maintenance_links', 'document_motorcycle_maintenance_links',
    'driver_vehicle_assignments', 'driver_motorcycle_assignments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_read', relation_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_write', relation_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_has_any_role(ARRAY[''super_admin'', ''admin'', ''gestionnaire'']::public.app_role[]))',
      relation_table || '_read_authorized', relation_table
    );
  END LOOP;
END;
$policy$;

DO $policy$
DECLARE
  relation_table text;
BEGIN
  FOREACH relation_table IN ARRAY ARRAY[
    'finance_expense_links', 'finance_harvest_links', 'finance_links', 'finance_motorcycle_maintenance_links', 'finance_motorcycle_purchase_links', 'finance_payment_links', 'finance_revenue_links', 'finance_salary_links', 'finance_stock_movement_links', 'finance_vehicle_maintenance_links'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_read', relation_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_has_any_role(ARRAY[''super_admin'', ''admin'', ''comptable'']::public.app_role[]))',
      relation_table || '_read_authorized', relation_table
    );
  END LOOP;
END;
$policy$;

-- Saved report owners cannot silently make a report shared. Shared reports and
-- templates are an administration responsibility.
DROP POLICY IF EXISTS saved_reports_insert_own ON public.saved_reports;
DROP POLICY IF EXISTS saved_reports_update_own ON public.saved_reports;
DROP POLICY IF EXISTS saved_reports_delete_own ON public.saved_reports;
CREATE POLICY saved_reports_insert_own ON public.saved_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    AND NOT is_shared
    AND NOT is_admin_template
    AND public.reporting_can_access_report(report_type)
  );
CREATE POLICY saved_reports_update_own ON public.saved_reports
  FOR UPDATE TO authenticated
  USING (
    (owner_user_id = auth.uid() AND NOT is_shared AND NOT is_admin_template)
    OR public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[])
  )
  WITH CHECK (
    (owner_user_id = auth.uid() AND NOT is_shared AND NOT is_admin_template AND public.reporting_can_access_report(report_type))
    OR public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[])
  );
CREATE POLICY saved_reports_delete_own ON public.saved_reports
  FOR DELETE TO authenticated
  USING (
    (owner_user_id = auth.uid() AND NOT is_shared AND NOT is_admin_template)
    OR public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[])
  );

-- Public table privileges are unnecessary for unauthenticated users. Archives
-- and finance tables are also denied direct mutable SQL privileges for users.
DO $privileges$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT quote_ident(table_name) AS quoted_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%s FROM anon', table_record.quoted_name);
  END LOOP;
END;
$privileges$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.wallets,
  public.finance_operations,
  public.finance_links,
  public.finance_expense_links,
  public.finance_harvest_links,
  public.finance_motorcycle_maintenance_links,
  public.finance_motorcycle_purchase_links,
  public.finance_payment_links,
  public.finance_revenue_links,
  public.finance_salary_links,
  public.finance_stock_movement_links,
  public.finance_vehicle_maintenance_links,
  public.salary_payments,
  public.stock_movements,
  public.business_finance_audit,
  public.security_audit_log,
  public.revenues,
  public.expenses,
  public.payments,
  public.stocks
FROM authenticated;

REVOKE ALL ON public.finance_wallet_reconciliation FROM anon, authenticated;
REVOKE ALL ON public.finance_legacy_migration_reconciliation FROM anon, authenticated;

-- SECURITY DEFINER functions must never inherit the default PUBLIC execution
-- grant. Regrant only the RPCs reached by the authenticated application.
DO $functions$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure::text AS identity
    FROM pg_proc AS p
    JOIN pg_namespace AS namespace ON namespace.oid = p.pronamespace
    WHERE namespace.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_record.identity);
    IF function_record.identity NOT LIKE 'public.rls_auto_enable%' THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path TO public, auth, pg_temp', function_record.identity);
    END IF;
  END LOOP;
END;
$functions$;

DO $functions$
DECLARE
  function_record record;
  allowed_names text[] := ARRAY[
    'archive_document',
    'assign_driver_to_motorcycle', 'assign_driver_to_vehicle',
    'cancel_salary_payment_with_finance', 'cancel_stock_movement_with_finance',
    'close_driver_motorcycle_assignment', 'close_driver_vehicle_assignment',
    'create_contract_with_relations', 'create_document_with_relation',
    'create_harvest_with_finance', 'update_harvest_with_finance', 'delete_harvest_with_finance',
    'create_motorcycle_maintenance_with_finance', 'update_motorcycle_maintenance_with_finance', 'delete_motorcycle_maintenance_with_finance',
    'create_motorcycle_with_purchase', 'update_motorcycle_with_purchase', 'delete_motorcycle_with_purchase',
    'create_salary_payment_with_finance', 'update_salary_payment_with_finance',
    'create_stock_movement_with_finance', 'update_stock_movement_with_finance',
    'create_vehicle_maintenance_with_finance', 'update_vehicle_maintenance_with_finance', 'delete_vehicle_maintenance_with_finance',
    'create_vehicle_with_purchase', 'update_vehicle_with_purchase', 'delete_vehicle_with_purchase',
    'finance_create_operation', 'finance_update_operation', 'finance_delete_operation',
    'generate_notifications_dashboard_fallback', 'get_management_report', 'get_management_report_operations', 'get_management_treasury_report',
    'get_salary_payment_people',
    'has_any_role', 'has_role', 'current_user_has_any_role', 'current_user_role',
    'mark_all_notifications_read', 'notification_scheduler_status', 'reporting_can_access_report',
    'record_reporting_export', 'run_notification_generation',
    'save_notification_alert_rule', 'save_notification_general_settings',
    'set_inventory_alert_threshold', 'set_wallet_alert_threshold',
    'update_notification_status',
    'wallet_create', 'wallet_update', 'wallet_delete'
  ];
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure::text AS identity
    FROM pg_proc AS p
    JOIN pg_namespace AS namespace ON namespace.oid = p.pronamespace
    WHERE namespace.nspname = 'public'
      AND p.proname = ANY(allowed_names)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', function_record.identity);
  END LOOP;
END;
$functions$;

COMMENT ON TABLE public.revenues IS 'Archive historique en lecture seule. Les nouvelles recettes utilisent finance_operations.';
COMMENT ON TABLE public.expenses IS 'Archive historique en lecture seule. Les nouvelles dépenses utilisent finance_operations.';
COMMENT ON TABLE public.payments IS 'Archive historique en lecture seule. Les nouveaux versements utilisent finance_operations.';
COMMENT ON TABLE public.stocks IS 'Archive historique en lecture seule. Les mouvements actifs utilisent inventory_items et stock_movements.';
