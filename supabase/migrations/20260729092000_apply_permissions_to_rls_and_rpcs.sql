-- Lot 11: replace the Lot 10 role-name checks on current operational data
-- with explicit permissions. Legacy helpers remain for historical migrations.

CREATE OR REPLACE FUNCTION public.document_is_sensitive(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.document_employee_links WHERE document_id = p_document_id)
      OR EXISTS (SELECT 1 FROM public.document_driver_links WHERE document_id = p_document_id)
      OR EXISTS (SELECT 1 FROM public.document_contract_links WHERE document_id = p_document_id);
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_read_document(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT public.user_has_permission('documents.sensitive.read')
      OR (
        public.user_has_permission('documents.read')
        AND NOT public.document_is_sensitive(p_document_id)
      );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_read_document_path(p_storage_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.storage_path = p_storage_path
      AND d.archived_at IS NULL
      AND public.current_user_can_read_document(d.id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.security_require_finance_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.user_has_any_permission(ARRAY['finance.create', 'finance.update', 'finance.cancel', 'wallets.manage']::text[]) THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Called only by protected internal business functions. Public entry points
-- below perform the domain-specific permission check before they delegate.
CREATE OR REPLACE FUNCTION public.business_finance_require_write_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reporting_can_access_report(p_report_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT CASE upper(COALESCE(p_report_type, ''))
    WHEN 'FINANCE' THEN public.user_has_permission('reports.finance')
    WHEN 'TREASURY' THEN public.user_has_permission('reports.finance')
    WHEN 'EMPLOYEES' THEN public.user_has_permission('reports.hr')
    WHEN 'DRIVERS' THEN public.user_has_permission('reports.hr') OR public.user_has_permission('reports.operations')
    WHEN 'STOCKS' THEN public.user_has_permission('reports.stocks')
    WHEN 'VEHICLES' THEN public.user_has_permission('reports.operations')
    WHEN 'MOTORCYCLES' THEN public.user_has_permission('reports.operations')
    WHEN 'FARMS' THEN public.user_has_permission('reports.operations')
    WHEN 'MAINTENANCES' THEN public.user_has_permission('reports.operations')
    WHEN 'CONTRACTS_DOCUMENTS' THEN public.user_has_any_permission(ARRAY['reports.hr', 'reports.operations']::text[])
    WHEN 'ALERTS' THEN public.user_has_permission('notifications.read')
    WHEN 'OVERVIEW' THEN public.user_has_permission('reports.read')
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.record_reporting_export(p_report_type text, p_row_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  IF p_row_count < 0 OR NOT public.reporting_can_access_report(p_report_type) OR NOT public.user_has_permission('reports.export') THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, metadata)
  VALUES (auth.uid(), 'REPORT_EXPORT', 'REPORT', jsonb_build_object('report_type', upper(p_report_type), 'row_count', p_row_count));
END;
$function$;

-- Core table policies ------------------------------------------------------
DROP POLICY IF EXISTS employees_read ON public.employees;
DROP POLICY IF EXISTS employees_write ON public.employees;
CREATE POLICY employees_read ON public.employees FOR SELECT TO authenticated USING (public.user_has_permission('employees.read'));
CREATE POLICY employees_insert ON public.employees FOR INSERT TO authenticated WITH CHECK (public.user_has_permission('employees.create'));
CREATE POLICY employees_update ON public.employees FOR UPDATE TO authenticated USING (public.user_has_permission('employees.update')) WITH CHECK (public.user_has_permission('employees.update'));
CREATE POLICY employees_delete ON public.employees FOR DELETE TO authenticated USING (public.user_has_permission('employees.delete'));

DROP POLICY IF EXISTS drivers_read ON public.drivers;
DROP POLICY IF EXISTS drivers_write ON public.drivers;
CREATE POLICY drivers_read ON public.drivers FOR SELECT TO authenticated USING (public.user_has_permission('drivers.read'));
CREATE POLICY drivers_insert ON public.drivers FOR INSERT TO authenticated WITH CHECK (public.user_has_permission('drivers.create'));
CREATE POLICY drivers_update ON public.drivers FOR UPDATE TO authenticated USING (public.user_has_permission('drivers.update')) WITH CHECK (public.user_has_permission('drivers.update'));
CREATE POLICY drivers_delete ON public.drivers FOR DELETE TO authenticated USING (public.user_has_permission('drivers.delete'));

DROP POLICY IF EXISTS vehicles_read ON public.vehicles;
DROP POLICY IF EXISTS vehicles_write ON public.vehicles;
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['vehicles.read', 'vehicles.finance.read']::text[]));
CREATE POLICY vehicles_insert ON public.vehicles FOR INSERT TO authenticated WITH CHECK (public.user_has_permission('vehicles.create'));
CREATE POLICY vehicles_update ON public.vehicles FOR UPDATE TO authenticated USING (public.user_has_permission('vehicles.update')) WITH CHECK (public.user_has_permission('vehicles.update'));
CREATE POLICY vehicles_delete ON public.vehicles FOR DELETE TO authenticated USING (public.user_has_permission('vehicles.delete'));

DROP POLICY IF EXISTS motos_read ON public.motorcycles;
DROP POLICY IF EXISTS motorcycles_write ON public.motorcycles;
CREATE POLICY motorcycles_read ON public.motorcycles FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['motorcycles.read', 'motorcycles.finance.read']::text[]));
CREATE POLICY motorcycles_insert ON public.motorcycles FOR INSERT TO authenticated WITH CHECK (public.user_has_permission('motorcycles.create'));
CREATE POLICY motorcycles_update ON public.motorcycles FOR UPDATE TO authenticated USING (public.user_has_permission('motorcycles.update')) WITH CHECK (public.user_has_permission('motorcycles.update'));
CREATE POLICY motorcycles_delete ON public.motorcycles FOR DELETE TO authenticated USING (public.user_has_permission('motorcycles.delete'));

DROP POLICY IF EXISTS farms_read ON public.farms;
DROP POLICY IF EXISTS farms_write ON public.farms;
CREATE POLICY farms_read ON public.farms FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['farms.read', 'farms.finance.read']::text[]));
CREATE POLICY farms_write ON public.farms FOR ALL TO authenticated USING (public.user_has_permission('farms.manage')) WITH CHECK (public.user_has_permission('farms.manage'));

DROP POLICY IF EXISTS harvests_read ON public.harvests;
DROP POLICY IF EXISTS harvests_write ON public.harvests;
CREATE POLICY harvests_read ON public.harvests FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['harvests.manage', 'farms.finance.read']::text[]));
CREATE POLICY harvests_write ON public.harvests FOR ALL TO authenticated USING (public.user_has_permission('harvests.manage')) WITH CHECK (public.user_has_permission('harvests.manage'));

DROP POLICY IF EXISTS contracts_read ON public.contracts;
DROP POLICY IF EXISTS contracts_write ON public.contracts;
CREATE POLICY contracts_read ON public.contracts FOR SELECT TO authenticated USING (public.user_has_permission('contracts.read'));
CREATE POLICY contracts_write ON public.contracts FOR ALL TO authenticated USING (public.user_has_permission('contracts.manage')) WITH CHECK (public.user_has_permission('contracts.manage'));

DROP POLICY IF EXISTS documents_read ON public.documents;
CREATE POLICY documents_read ON public.documents FOR SELECT TO authenticated USING (public.current_user_can_read_document(id));

DROP POLICY IF EXISTS inv_items_read ON public.inventory_items;
DROP POLICY IF EXISTS inv_items_write ON public.inventory_items;
CREATE POLICY inv_items_read ON public.inventory_items FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['stocks.read', 'stocks.finance.read']::text[]));
CREATE POLICY inv_items_write ON public.inventory_items FOR ALL TO authenticated USING (public.user_has_permission('stocks.manage')) WITH CHECK (public.user_has_permission('stocks.manage'));

DROP POLICY IF EXISTS stock_movements_read ON public.stock_movements;
CREATE POLICY stock_movements_read ON public.stock_movements FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['stocks.read', 'stocks.finance.read']::text[]));

DROP POLICY IF EXISTS wallets_read ON public.wallets;
CREATE POLICY wallets_read ON public.wallets FOR SELECT TO authenticated USING (public.user_has_permission('wallets.read'));
DROP POLICY IF EXISTS finance_operations_read ON public.finance_operations;
CREATE POLICY finance_operations_read ON public.finance_operations FOR SELECT TO authenticated USING (public.user_has_permission('finance.read'));
DROP POLICY IF EXISTS salary_payments_read ON public.salary_payments;
CREATE POLICY salary_payments_read ON public.salary_payments FOR SELECT TO authenticated USING (public.user_has_permission('salaries.read'));

DROP POLICY IF EXISTS business_finance_audit_read ON public.business_finance_audit;
CREATE POLICY business_finance_audit_read ON public.business_finance_audit FOR SELECT TO authenticated USING (public.user_has_permission('finance.read'));
DROP POLICY IF EXISTS finance_migration_runs_read ON public.finance_migration_runs;
CREATE POLICY finance_migration_runs_read ON public.finance_migration_runs FOR SELECT TO authenticated USING (public.user_has_permission('finance.read'));
DROP POLICY IF EXISTS finance_migration_issues_read ON public.finance_legacy_migration_issues;
CREATE POLICY finance_migration_issues_read ON public.finance_legacy_migration_issues FOR SELECT TO authenticated USING (public.user_has_permission('finance.read'));

DROP POLICY IF EXISTS profiles_read_authorized ON public.profiles;
CREATE POLICY profiles_read_authorized ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.user_has_permission('roles.read'));

-- Relations inherit the authorization of the master data, and are never
-- writable directly by browser users.
DO $relations$
DECLARE
  relation_table text;
BEGIN
  FOREACH relation_table IN ARRAY ARRAY[
    'contract_employee_links', 'contract_driver_links', 'contract_vehicle_links', 'contract_motorcycle_links', 'contract_farm_links'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_read_authorized', relation_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_read', relation_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.user_has_permission(''contracts.read''))', relation_table || '_read_authorized', relation_table);
  END LOOP;
  FOREACH relation_table IN ARRAY ARRAY[
    'document_employee_links', 'document_driver_links', 'document_vehicle_links', 'document_motorcycle_links', 'document_farm_links', 'document_contract_links', 'document_vehicle_maintenance_links', 'document_motorcycle_maintenance_links'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_read_authorized', relation_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', relation_table || '_read', relation_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_can_read_document(document_id))', relation_table || '_read_authorized', relation_table);
  END LOOP;
END;
$relations$;

DROP POLICY IF EXISTS driver_vehicle_assignments_read_authorized ON public.driver_vehicle_assignments;
DROP POLICY IF EXISTS driver_motorcycle_assignments_read_authorized ON public.driver_motorcycle_assignments;
CREATE POLICY driver_vehicle_assignments_read_authorized ON public.driver_vehicle_assignments FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['drivers.assign', 'vehicles.assign']::text[]));
CREATE POLICY driver_motorcycle_assignments_read_authorized ON public.driver_motorcycle_assignments FOR SELECT TO authenticated USING (public.user_has_any_permission(ARRAY['drivers.assign', 'motorcycles.assign']::text[]));

-- Saved reports retain ownership but sharing is an explicit permission.
DROP POLICY IF EXISTS saved_reports_select ON public.saved_reports;
DROP POLICY IF EXISTS saved_reports_insert_own ON public.saved_reports;
DROP POLICY IF EXISTS saved_reports_update_own ON public.saved_reports;
DROP POLICY IF EXISTS saved_reports_delete_own ON public.saved_reports;
CREATE POLICY saved_reports_select ON public.saved_reports FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR (is_shared AND public.user_has_permission('reports.read')) OR public.user_has_permission('reports.share'));
CREATE POLICY saved_reports_insert_own ON public.saved_reports FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() AND public.user_has_permission('reports.read') AND (NOT is_shared OR public.user_has_permission('reports.share')) AND (NOT is_admin_template OR public.user_has_permission('reports.share')));
CREATE POLICY saved_reports_update_own ON public.saved_reports FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() OR public.user_has_permission('reports.share'))
  WITH CHECK ((owner_user_id = auth.uid() OR public.user_has_permission('reports.share')) AND (NOT is_shared OR public.user_has_permission('reports.share')) AND (NOT is_admin_template OR public.user_has_permission('reports.share')));
CREATE POLICY saved_reports_delete_own ON public.saved_reports FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid() OR public.user_has_permission('reports.share'));

-- Private Storage reads are tied to a document metadata row and its explicit
-- sensitivity; uploads remain private until metadata creation succeeds.
DROP POLICY IF EXISTS documents_read_authorized ON storage.objects;
DROP POLICY IF EXISTS documents_upload_authorized ON storage.objects;
CREATE POLICY documents_read_authorized ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.current_user_can_read_document_path(name));
CREATE POLICY documents_upload_authorized ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.user_has_permission('documents.upload'));

-- Permission wrappers around every public business mutation used by the app.
DO $rename$
BEGIN
  IF to_regprocedure('public.create_harvest_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_harvest_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.create_harvest_with_finance(jsonb) RENAME TO _internal_create_harvest_with_finance; END IF;
  IF to_regprocedure('public.update_harvest_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_harvest_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.update_harvest_with_finance(jsonb) RENAME TO _internal_update_harvest_with_finance; END IF;
  IF to_regprocedure('public.delete_harvest_with_finance(uuid)') IS NOT NULL AND to_regprocedure('public._internal_delete_harvest_with_finance(uuid)') IS NULL THEN ALTER FUNCTION public.delete_harvest_with_finance(uuid) RENAME TO _internal_delete_harvest_with_finance; END IF;
  IF to_regprocedure('public.create_motorcycle_maintenance_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_motorcycle_maintenance_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.create_motorcycle_maintenance_with_finance(jsonb) RENAME TO _internal_create_motorcycle_maintenance_with_finance; END IF;
  IF to_regprocedure('public.update_motorcycle_maintenance_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_motorcycle_maintenance_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.update_motorcycle_maintenance_with_finance(jsonb) RENAME TO _internal_update_motorcycle_maintenance_with_finance; END IF;
  IF to_regprocedure('public.delete_motorcycle_maintenance_with_finance(uuid)') IS NOT NULL AND to_regprocedure('public._internal_delete_motorcycle_maintenance_with_finance(uuid)') IS NULL THEN ALTER FUNCTION public.delete_motorcycle_maintenance_with_finance(uuid) RENAME TO _internal_delete_motorcycle_maintenance_with_finance; END IF;
  IF to_regprocedure('public.create_vehicle_maintenance_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_vehicle_maintenance_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.create_vehicle_maintenance_with_finance(jsonb) RENAME TO _internal_create_vehicle_maintenance_with_finance; END IF;
  IF to_regprocedure('public.update_vehicle_maintenance_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_vehicle_maintenance_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.update_vehicle_maintenance_with_finance(jsonb) RENAME TO _internal_update_vehicle_maintenance_with_finance; END IF;
  IF to_regprocedure('public.delete_vehicle_maintenance_with_finance(uuid)') IS NOT NULL AND to_regprocedure('public._internal_delete_vehicle_maintenance_with_finance(uuid)') IS NULL THEN ALTER FUNCTION public.delete_vehicle_maintenance_with_finance(uuid) RENAME TO _internal_delete_vehicle_maintenance_with_finance; END IF;
  IF to_regprocedure('public.create_salary_payment_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_salary_payment_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.create_salary_payment_with_finance(jsonb) RENAME TO _internal_create_salary_payment_with_finance; END IF;
  IF to_regprocedure('public.update_salary_payment_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_salary_payment_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.update_salary_payment_with_finance(jsonb) RENAME TO _internal_update_salary_payment_with_finance; END IF;
  IF to_regprocedure('public.cancel_salary_payment_with_finance(uuid)') IS NOT NULL AND to_regprocedure('public._internal_cancel_salary_payment_with_finance(uuid)') IS NULL THEN ALTER FUNCTION public.cancel_salary_payment_with_finance(uuid) RENAME TO _internal_cancel_salary_payment_with_finance; END IF;
  IF to_regprocedure('public.create_stock_movement_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_stock_movement_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.create_stock_movement_with_finance(jsonb) RENAME TO _internal_create_stock_movement_with_finance; END IF;
  IF to_regprocedure('public.update_stock_movement_with_finance(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_stock_movement_with_finance(jsonb)') IS NULL THEN ALTER FUNCTION public.update_stock_movement_with_finance(jsonb) RENAME TO _internal_update_stock_movement_with_finance; END IF;
  IF to_regprocedure('public.cancel_stock_movement_with_finance(uuid)') IS NOT NULL AND to_regprocedure('public._internal_cancel_stock_movement_with_finance(uuid)') IS NULL THEN ALTER FUNCTION public.cancel_stock_movement_with_finance(uuid) RENAME TO _internal_cancel_stock_movement_with_finance; END IF;
  IF to_regprocedure('public.create_motorcycle_with_purchase(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_motorcycle_with_purchase(jsonb)') IS NULL THEN ALTER FUNCTION public.create_motorcycle_with_purchase(jsonb) RENAME TO _internal_create_motorcycle_with_purchase; END IF;
  IF to_regprocedure('public.update_motorcycle_with_purchase(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_motorcycle_with_purchase(jsonb)') IS NULL THEN ALTER FUNCTION public.update_motorcycle_with_purchase(jsonb) RENAME TO _internal_update_motorcycle_with_purchase; END IF;
  IF to_regprocedure('public.delete_motorcycle_with_purchase(uuid)') IS NOT NULL AND to_regprocedure('public._internal_delete_motorcycle_with_purchase(uuid)') IS NULL THEN ALTER FUNCTION public.delete_motorcycle_with_purchase(uuid) RENAME TO _internal_delete_motorcycle_with_purchase; END IF;
  IF to_regprocedure('public.create_vehicle_with_purchase(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_vehicle_with_purchase(jsonb)') IS NULL THEN ALTER FUNCTION public.create_vehicle_with_purchase(jsonb) RENAME TO _internal_create_vehicle_with_purchase; END IF;
  IF to_regprocedure('public.update_vehicle_with_purchase(jsonb)') IS NOT NULL AND to_regprocedure('public._internal_update_vehicle_with_purchase(jsonb)') IS NULL THEN ALTER FUNCTION public.update_vehicle_with_purchase(jsonb) RENAME TO _internal_update_vehicle_with_purchase; END IF;
  IF to_regprocedure('public.delete_vehicle_with_purchase(uuid)') IS NOT NULL AND to_regprocedure('public._internal_delete_vehicle_with_purchase(uuid)') IS NULL THEN ALTER FUNCTION public.delete_vehicle_with_purchase(uuid) RENAME TO _internal_delete_vehicle_with_purchase; END IF;
  IF to_regprocedure('public.assign_driver_to_vehicle(uuid,uuid,date,text)') IS NOT NULL AND to_regprocedure('public._internal_assign_driver_to_vehicle(uuid,uuid,date,text)') IS NULL THEN ALTER FUNCTION public.assign_driver_to_vehicle(uuid,uuid,date,text) RENAME TO _internal_assign_driver_to_vehicle; END IF;
  IF to_regprocedure('public.close_driver_vehicle_assignment(uuid,date,text)') IS NOT NULL AND to_regprocedure('public._internal_close_driver_vehicle_assignment(uuid,date,text)') IS NULL THEN ALTER FUNCTION public.close_driver_vehicle_assignment(uuid,date,text) RENAME TO _internal_close_driver_vehicle_assignment; END IF;
  IF to_regprocedure('public.assign_driver_to_motorcycle(uuid,uuid,date,text)') IS NOT NULL AND to_regprocedure('public._internal_assign_driver_to_motorcycle(uuid,uuid,date,text)') IS NULL THEN ALTER FUNCTION public.assign_driver_to_motorcycle(uuid,uuid,date,text) RENAME TO _internal_assign_driver_to_motorcycle; END IF;
  IF to_regprocedure('public.close_driver_motorcycle_assignment(uuid,date,text)') IS NOT NULL AND to_regprocedure('public._internal_close_driver_motorcycle_assignment(uuid,date,text)') IS NULL THEN ALTER FUNCTION public.close_driver_motorcycle_assignment(uuid,date,text) RENAME TO _internal_close_driver_motorcycle_assignment; END IF;
  IF to_regprocedure('public.create_document_with_relation(jsonb,text,uuid)') IS NOT NULL AND to_regprocedure('public._internal_create_document_with_relation(jsonb,text,uuid)') IS NULL THEN ALTER FUNCTION public.create_document_with_relation(jsonb,text,uuid) RENAME TO _internal_create_document_with_relation; END IF;
  IF to_regprocedure('public.archive_document(uuid)') IS NOT NULL AND to_regprocedure('public._internal_archive_document(uuid)') IS NULL THEN ALTER FUNCTION public.archive_document(uuid) RENAME TO _internal_archive_document; END IF;
  IF to_regprocedure('public.create_contract_with_relations(jsonb,jsonb)') IS NOT NULL AND to_regprocedure('public._internal_create_contract_with_relations(jsonb,jsonb)') IS NULL THEN ALTER FUNCTION public.create_contract_with_relations(jsonb,jsonb) RENAME TO _internal_create_contract_with_relations; END IF;
END;
$rename$;

CREATE OR REPLACE FUNCTION public.create_harvest_with_finance(p_harvest jsonb) RETURNS public.harvests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_create_harvest_with_finance(p_harvest); END; $$;
CREATE OR REPLACE FUNCTION public.update_harvest_with_finance(p_harvest jsonb) RETURNS public.harvests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_update_harvest_with_finance(p_harvest); END; $$;
CREATE OR REPLACE FUNCTION public.delete_harvest_with_finance(p_harvest_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_delete_harvest_with_finance(p_harvest_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_motorcycle_maintenance_with_finance(p_maintenance jsonb) RETURNS public.motorcycle_maintenances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.maintenance.manage'); RETURN public._internal_create_motorcycle_maintenance_with_finance(p_maintenance); END; $$;
CREATE OR REPLACE FUNCTION public.update_motorcycle_maintenance_with_finance(p_maintenance jsonb) RETURNS public.motorcycle_maintenances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.maintenance.manage'); RETURN public._internal_update_motorcycle_maintenance_with_finance(p_maintenance); END; $$;
CREATE OR REPLACE FUNCTION public.delete_motorcycle_maintenance_with_finance(p_maintenance_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.maintenance.manage'); RETURN public._internal_delete_motorcycle_maintenance_with_finance(p_maintenance_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_vehicle_maintenance_with_finance(p_maintenance jsonb) RETURNS public.maintenances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.maintenance.manage'); RETURN public._internal_create_vehicle_maintenance_with_finance(p_maintenance); END; $$;
CREATE OR REPLACE FUNCTION public.update_vehicle_maintenance_with_finance(p_maintenance jsonb) RETURNS public.maintenances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.maintenance.manage'); RETURN public._internal_update_vehicle_maintenance_with_finance(p_maintenance); END; $$;
CREATE OR REPLACE FUNCTION public.delete_vehicle_maintenance_with_finance(p_maintenance_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.maintenance.manage'); RETURN public._internal_delete_vehicle_maintenance_with_finance(p_maintenance_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_salary_payment_with_finance(p_payment jsonb) RETURNS public.salary_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('salaries.pay'); RETURN public._internal_create_salary_payment_with_finance(p_payment); END; $$;
CREATE OR REPLACE FUNCTION public.update_salary_payment_with_finance(p_payment jsonb) RETURNS public.salary_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('salaries.pay'); RETURN public._internal_update_salary_payment_with_finance(p_payment); END; $$;
CREATE OR REPLACE FUNCTION public.cancel_salary_payment_with_finance(p_payment_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('salaries.pay'); RETURN public._internal_cancel_salary_payment_with_finance(p_payment_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_stock_movement_with_finance(p_movement jsonb) RETURNS public.stock_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('stocks.manage'); RETURN public._internal_create_stock_movement_with_finance(p_movement); END; $$;
CREATE OR REPLACE FUNCTION public.update_stock_movement_with_finance(p_movement jsonb) RETURNS public.stock_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('stocks.manage'); RETURN public._internal_update_stock_movement_with_finance(p_movement); END; $$;
CREATE OR REPLACE FUNCTION public.cancel_stock_movement_with_finance(p_movement_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('stocks.manage'); RETURN public._internal_cancel_stock_movement_with_finance(p_movement_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_motorcycle_with_purchase(p_motorcycle jsonb) RETURNS public.motorcycles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.create'); RETURN public._internal_create_motorcycle_with_purchase(p_motorcycle); END; $$;
CREATE OR REPLACE FUNCTION public.update_motorcycle_with_purchase(p_motorcycle jsonb) RETURNS public.motorcycles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.update'); RETURN public._internal_update_motorcycle_with_purchase(p_motorcycle); END; $$;
CREATE OR REPLACE FUNCTION public.delete_motorcycle_with_purchase(p_motorcycle_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.delete'); RETURN public._internal_delete_motorcycle_with_purchase(p_motorcycle_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_vehicle_with_purchase(p_vehicle jsonb) RETURNS public.vehicles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.create'); RETURN public._internal_create_vehicle_with_purchase(p_vehicle); END; $$;
CREATE OR REPLACE FUNCTION public.update_vehicle_with_purchase(p_vehicle jsonb) RETURNS public.vehicles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.update'); RETURN public._internal_update_vehicle_with_purchase(p_vehicle); END; $$;
CREATE OR REPLACE FUNCTION public.delete_vehicle_with_purchase(p_vehicle_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.delete'); RETURN public._internal_delete_vehicle_with_purchase(p_vehicle_id); END; $$;
CREATE OR REPLACE FUNCTION public.assign_driver_to_vehicle(p_driver_id uuid, p_vehicle_id uuid, p_start_date date DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS public.driver_vehicle_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.assign'); RETURN public._internal_assign_driver_to_vehicle(p_driver_id, p_vehicle_id, p_start_date, p_notes); END; $$;
CREATE OR REPLACE FUNCTION public.close_driver_vehicle_assignment(p_assignment_id uuid, p_end_date date DEFAULT current_date, p_notes text DEFAULT NULL) RETURNS public.driver_vehicle_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('vehicles.assign'); RETURN public._internal_close_driver_vehicle_assignment(p_assignment_id, p_end_date, p_notes); END; $$;
CREATE OR REPLACE FUNCTION public.assign_driver_to_motorcycle(p_driver_id uuid, p_motorcycle_id uuid, p_start_date date DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS public.driver_motorcycle_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.assign'); RETURN public._internal_assign_driver_to_motorcycle(p_driver_id, p_motorcycle_id, p_start_date, p_notes); END; $$;
CREATE OR REPLACE FUNCTION public.close_driver_motorcycle_assignment(p_assignment_id uuid, p_end_date date DEFAULT current_date, p_notes text DEFAULT NULL) RETURNS public.driver_motorcycle_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('motorcycles.assign'); RETURN public._internal_close_driver_motorcycle_assignment(p_assignment_id, p_end_date, p_notes); END; $$;
CREATE OR REPLACE FUNCTION public.create_document_with_relation(p_document jsonb, p_relation text, p_entity_id uuid) RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('documents.upload'); IF p_relation IN ('employee', 'driver', 'contract') AND NOT public.user_has_permission('documents.sensitive.read') THEN RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501'; END IF; RETURN public._internal_create_document_with_relation(p_document, p_relation, p_entity_id); END; $$;
CREATE OR REPLACE FUNCTION public.archive_document(p_document_id uuid) RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('documents.archive'); IF public.document_is_sensitive(p_document_id) AND NOT public.user_has_permission('documents.sensitive.read') THEN RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer cette action.' USING ERRCODE = '42501'; END IF; RETURN public._internal_archive_document(p_document_id); END; $$;
CREATE OR REPLACE FUNCTION public.create_contract_with_relations(p_contract jsonb, p_relations jsonb DEFAULT '{}'::jsonb) RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$ BEGIN PERFORM public.permission_require('contracts.manage'); RETURN public._internal_create_contract_with_relations(p_contract, p_relations); END; $$;

-- Internal implementations are not callable through PostgREST. The public
-- wrappers above are the only authenticated entry points.
DO $grants$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT p.oid::regprocedure::text AS identity
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND left(p.proname, 9) = '_internal'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_record.identity);
  END LOOP;
END;
$grants$;

GRANT EXECUTE ON FUNCTION
  public.create_harvest_with_finance(jsonb), public.update_harvest_with_finance(jsonb), public.delete_harvest_with_finance(uuid),
  public.create_motorcycle_maintenance_with_finance(jsonb), public.update_motorcycle_maintenance_with_finance(jsonb), public.delete_motorcycle_maintenance_with_finance(uuid),
  public.create_vehicle_maintenance_with_finance(jsonb), public.update_vehicle_maintenance_with_finance(jsonb), public.delete_vehicle_maintenance_with_finance(uuid),
  public.create_salary_payment_with_finance(jsonb), public.update_salary_payment_with_finance(jsonb), public.cancel_salary_payment_with_finance(uuid),
  public.create_stock_movement_with_finance(jsonb), public.update_stock_movement_with_finance(jsonb), public.cancel_stock_movement_with_finance(uuid),
  public.create_motorcycle_with_purchase(jsonb), public.update_motorcycle_with_purchase(jsonb), public.delete_motorcycle_with_purchase(uuid),
  public.create_vehicle_with_purchase(jsonb), public.update_vehicle_with_purchase(jsonb), public.delete_vehicle_with_purchase(uuid),
  public.assign_driver_to_vehicle(uuid, uuid, date, text), public.close_driver_vehicle_assignment(uuid, date, text),
  public.assign_driver_to_motorcycle(uuid, uuid, date, text), public.close_driver_motorcycle_assignment(uuid, date, text),
  public.create_document_with_relation(jsonb, text, uuid), public.archive_document(uuid), public.create_contract_with_relations(jsonb, jsonb)
TO authenticated;
