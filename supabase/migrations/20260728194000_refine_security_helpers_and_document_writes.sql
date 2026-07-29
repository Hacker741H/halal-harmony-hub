-- Lot 10 follow-up: preserve policy compatibility while preventing a caller
-- from using the legacy role helpers to inspect arbitrary users.

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT (
    auth.uid() IS NULL
    OR _user_id = auth.uid()
    OR public.current_user_has_any_role(ARRAY['super_admin', 'admin']::public.app_role[])
  )
  AND EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    WHERE role_row.user_id = _user_id
      AND role_row.role = ANY(_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT public.has_any_role(_user_id, ARRAY[_role]::public.app_role[]);
$function$;

-- Documents are created and archived through their atomic relation RPCs only.
DROP POLICY IF EXISTS documents_write ON public.documents;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.documents FROM authenticated;

-- Match the documented matrix for contracts and audit history.
DROP POLICY IF EXISTS contracts_write ON public.contracts;
CREATE POLICY contracts_write ON public.contracts
  FOR ALL TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]))
  WITH CHECK (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS business_finance_audit_read ON public.business_finance_audit;
CREATE POLICY business_finance_audit_read ON public.business_finance_audit
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS finance_migration_runs_read ON public.finance_migration_runs;
CREATE POLICY finance_migration_runs_read ON public.finance_migration_runs
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

DROP POLICY IF EXISTS finance_migration_issues_read ON public.finance_legacy_migration_issues;
CREATE POLICY finance_migration_issues_read ON public.finance_legacy_migration_issues
  FOR SELECT TO authenticated
  USING (public.current_user_has_any_role(ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]));

-- This helper administers system metadata and was originally created with a
-- pg_catalog-only path. Keep that stricter path after the bulk definer audit.
ALTER FUNCTION public.rls_auto_enable() SET search_path TO pg_catalog;
