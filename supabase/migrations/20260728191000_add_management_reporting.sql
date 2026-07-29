-- LOT 9 — Reporting de gestion. Les rapports lisent exclusivement les données
-- opérationnelles et le journal finance_operations : aucune donnée agrégée n'est
-- persistée, aucune table historique revenue/expense/payment n'est consultée.

CREATE INDEX IF NOT EXISTS finance_operations_reporting_date_type_status_idx
  ON public.finance_operations (operation_date DESC, type, status)
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_wallet_date_idx
  ON public.finance_operations (wallet_id, operation_date DESC)
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_destination_wallet_date_idx
  ON public.finance_operations (destination_wallet_id, operation_date DESC)
  WHERE destination_wallet_id IS NOT NULL
    AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_vehicle_date_idx
  ON public.finance_operations (vehicle_id, operation_date DESC)
  WHERE vehicle_id IS NOT NULL AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_motorcycle_date_idx
  ON public.finance_operations (motorcycle_id, operation_date DESC)
  WHERE motorcycle_id IS NOT NULL AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_driver_date_idx
  ON public.finance_operations (driver_id, operation_date DESC)
  WHERE driver_id IS NOT NULL AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_employee_date_idx
  ON public.finance_operations (employee_id, operation_date DESC)
  WHERE employee_id IS NOT NULL AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS finance_operations_reporting_farm_date_idx
  ON public.finance_operations (farm_id, operation_date DESC)
  WHERE farm_id IS NOT NULL AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS stock_movements_reporting_date_status_idx
  ON public.stock_movements (movement_date DESC, status, inventory_item_id);

CREATE INDEX IF NOT EXISTS notifications_reporting_status_severity_due_date_idx
  ON public.notifications (status, severity, due_date DESC);

CREATE TABLE IF NOT EXISTS public.saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  report_type text NOT NULL CHECK (report_type IN (
    'OVERVIEW', 'FINANCE', 'TREASURY', 'VEHICLES', 'MOTORCYCLES',
    'DRIVERS', 'EMPLOYEES', 'FARMS', 'MAINTENANCE', 'STOCK', 'COMPLIANCE'
  )),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  visible_columns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(visible_columns) = 'array'),
  sort jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(sort) = 'object'),
  period_key text,
  is_shared boolean NOT NULL DEFAULT false,
  is_admin_template boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_reports_admin_template_is_shared
    CHECK (NOT is_admin_template OR is_shared)
);

CREATE INDEX IF NOT EXISTS saved_reports_owner_created_at_idx
  ON public.saved_reports (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS saved_reports_shared_type_idx
  ON public.saved_reports (report_type, created_at DESC)
  WHERE is_shared;

ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_saved_reports_updated ON public.saved_reports;
CREATE TRIGGER trg_saved_reports_updated
  BEFORE UPDATE ON public.saved_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.reporting_can_access_report(p_report_type text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $reporting_can_access_report$
DECLARE
  v_finance_roles public.app_role[] := ARRAY['super_admin', 'admin', 'comptable']::public.app_role[];
  v_operations_roles public.app_role[] := ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF p_report_type IN ('FINANCE', 'TREASURY') THEN
    RETURN public.has_any_role(auth.uid(), v_finance_roles);
  END IF;

  IF p_report_type IN ('OVERVIEW', 'VEHICLES', 'MOTORCYCLES', 'DRIVERS', 'EMPLOYEES', 'FARMS', 'MAINTENANCE', 'STOCK', 'COMPLIANCE') THEN
    RETURN public.has_any_role(auth.uid(), v_finance_roles)
      OR public.has_any_role(auth.uid(), v_operations_roles);
  END IF;

  RETURN false;
END;
$reporting_can_access_report$;

DROP POLICY IF EXISTS saved_reports_select ON public.saved_reports;
CREATE POLICY saved_reports_select ON public.saved_reports
  FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR ((is_shared OR is_admin_template) AND public.reporting_can_access_report(report_type))
  );

DROP POLICY IF EXISTS saved_reports_insert_own ON public.saved_reports;
CREATE POLICY saved_reports_insert_own ON public.saved_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    AND NOT is_admin_template
    AND public.reporting_can_access_report(report_type)
  );

DROP POLICY IF EXISTS saved_reports_update_own ON public.saved_reports;
CREATE POLICY saved_reports_update_own ON public.saved_reports
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
  )
  WITH CHECK (
    (
      owner_user_id = auth.uid()
      AND NOT is_admin_template
      AND public.reporting_can_access_report(report_type)
    )
    OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
  );

DROP POLICY IF EXISTS saved_reports_delete_own ON public.saved_reports;
CREATE POLICY saved_reports_delete_own ON public.saved_reports
  FOR DELETE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
  );

CREATE OR REPLACE FUNCTION public.get_management_report(
  p_report_type text,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $get_management_report$
DECLARE
  v_start_date date := NULLIF(p_filters ->> 'startDate', '')::date;
  v_end_date date := NULLIF(p_filters ->> 'endDate', '')::date;
  v_wallet_id uuid := NULLIF(p_filters ->> 'walletId', '')::uuid;
  v_category text := NULLIF(btrim(p_filters ->> 'category'), '');
  v_status text := NULLIF(btrim(p_filters ->> 'status'), '');
  v_driver_id uuid := NULLIF(p_filters ->> 'driverId', '')::uuid;
  v_employee_id uuid := NULLIF(p_filters ->> 'employeeId', '')::uuid;
  v_vehicle_id uuid := NULLIF(p_filters ->> 'vehicleId', '')::uuid;
  v_motorcycle_id uuid := NULLIF(p_filters ->> 'motorcycleId', '')::uuid;
  v_farm_id uuid := NULLIF(p_filters ->> 'farmId', '')::uuid;
  v_inventory_item_id uuid := NULLIF(p_filters ->> 'inventoryItemId', '')::uuid;
  v_search text := NULLIF(btrim(p_filters ->> 'search'), '');
  v_can_view_finance boolean := public.has_any_role(
    auth.uid(), ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]
  );
  v_can_view_operations boolean := public.has_any_role(
    auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]
  );
BEGIN
  IF NOT public.reporting_can_access_report(p_report_type) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à consulter ce rapport.' USING ERRCODE = '42501';
  END IF;

  IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_start_date > v_end_date THEN
    RAISE EXCEPTION 'La date de début doit précéder la date de fin.' USING ERRCODE = '22007';
  END IF;

  IF p_report_type IN ('FINANCE', 'OVERVIEW') AND v_can_view_finance THEN
    RETURN (
      WITH filtered_operations AS (
        SELECT operation_date, amount, type, category, module
        FROM public.finance_operations
        WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED'
          AND (v_start_date IS NULL OR operation_date >= v_start_date)
          AND (v_end_date IS NULL OR operation_date <= v_end_date)
          AND (v_wallet_id IS NULL OR wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id)
          AND (v_category IS NULL OR category = v_category)
          AND (v_status IS NULL OR COALESCE(status, 'VALIDE') = v_status)
          AND (v_driver_id IS NULL OR driver_id = v_driver_id)
          AND (v_employee_id IS NULL OR employee_id = v_employee_id)
          AND (v_vehicle_id IS NULL OR vehicle_id = v_vehicle_id)
          AND (v_motorcycle_id IS NULL OR motorcycle_id = v_motorcycle_id)
          AND (v_farm_id IS NULL OR farm_id = v_farm_id)
          AND (v_inventory_item_id IS NULL OR inventory_item_id = v_inventory_item_id)
          AND (v_search IS NULL OR concat_ws(' ', category, description, reference, module) ILIKE '%' || v_search || '%')
      ), summary AS (
        SELECT
          count(*)::integer AS operation_count,
          COALESCE(sum(amount) FILTER (WHERE type = 'REVENUE'), 0) AS revenue,
          COALESCE(sum(amount) FILTER (WHERE type = 'EXPENSE'), 0) AS expense,
          COALESCE(sum(amount) FILTER (WHERE type = 'DEPOSIT'), 0) AS deposit,
          COALESCE(sum(amount) FILTER (WHERE type = 'TRANSFER'), 0) AS transfer
        FROM filtered_operations
      )
      SELECT jsonb_build_object(
        'reportType', p_report_type,
        'canViewFinance', true,
        'summary', (SELECT jsonb_build_object(
          'operationCount', operation_count,
          'revenue', revenue,
          'expense', expense,
          'deposit', deposit,
          'transfer', transfer,
          'netFlow', revenue + deposit - expense
        ) FROM summary),
        'monthly', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month', month_start,
            'revenue', revenue,
            'expense', expense,
            'deposit', deposit,
            'transfer', transfer,
            'netFlow', revenue + deposit - expense
          ) ORDER BY month_start)
          FROM (
            SELECT date_trunc('month', operation_date)::date AS month_start,
              COALESCE(sum(amount) FILTER (WHERE type = 'REVENUE'), 0) AS revenue,
              COALESCE(sum(amount) FILTER (WHERE type = 'EXPENSE'), 0) AS expense,
              COALESCE(sum(amount) FILTER (WHERE type = 'DEPOSIT'), 0) AS deposit,
              COALESCE(sum(amount) FILTER (WHERE type = 'TRANSFER'), 0) AS transfer
            FROM filtered_operations
            GROUP BY date_trunc('month', operation_date)::date
          ) monthly
        ), '[]'::jsonb),
        'categories', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'operationCount', operation_count) ORDER BY amount DESC, name)
          FROM (
            SELECT COALESCE(category, 'Sans catégorie') AS name, sum(amount) AS amount, count(*)::integer AS operation_count
            FROM filtered_operations
            GROUP BY COALESCE(category, 'Sans catégorie')
          ) categories
        ), '[]'::jsonb),
        'modules', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'operationCount', operation_count) ORDER BY amount DESC, name)
          FROM (
            SELECT COALESCE(module, 'Saisie manuelle') AS name, sum(amount) AS amount, count(*)::integer AS operation_count
            FROM filtered_operations
            GROUP BY COALESCE(module, 'Saisie manuelle')
          ) modules
        ), '[]'::jsonb)
      )
    );
  END IF;

  IF p_report_type = 'OVERVIEW' THEN
    RETURN jsonb_build_object(
      'reportType', 'OVERVIEW',
      'canViewFinance', false,
      'summary', NULL,
      'entityCounts', jsonb_build_object(
        'vehicles', (SELECT count(*) FROM public.vehicles),
        'motorcycles', (SELECT count(*) FROM public.motorcycles),
        'drivers', (SELECT count(*) FROM public.drivers),
        'employees', (SELECT count(*) FROM public.employees),
        'farms', (SELECT count(*) FROM public.farms),
        'lowStock', (SELECT count(*) FROM public.inventory_items WHERE seuil_alerte IS NOT NULL AND stock_actuel <= seuil_alerte),
        'unresolvedAlerts', (SELECT count(*) FROM public.notifications n WHERE n.status NOT IN ('RESOLVED', 'DISMISSED') AND (n.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])))
      )
    );
  END IF;

  IF p_report_type = 'TREASURY' THEN
    RETURN (
      WITH filtered_operations AS (
        SELECT wallet_id, destination_wallet_id, amount, type
        FROM public.finance_operations
        WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED'
          AND (v_start_date IS NULL OR operation_date >= v_start_date)
          AND (v_end_date IS NULL OR operation_date <= v_end_date)
          AND (v_wallet_id IS NULL OR wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id)
      )
      SELECT jsonb_build_object(
        'reportType', 'TREASURY',
        'wallets', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', w.id, 'name', w.name, 'type', w.type,
            'initialBalance', w.initial_balance, 'recordedBalance', w.balance,
            'revenue', COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type = 'REVENUE'), 0),
            'expense', COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type = 'EXPENSE'), 0),
            'deposit', COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type = 'DEPOSIT'), 0),
            'transferOut', COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type = 'TRANSFER'), 0),
            'transferIn', COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.destination_wallet_id = w.id AND f.type = 'TRANSFER'), 0),
            'calculatedBalance', w.initial_balance
              + COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type IN ('REVENUE', 'DEPOSIT')), 0)
              + COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.destination_wallet_id = w.id AND f.type = 'TRANSFER'), 0)
              - COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type IN ('EXPENSE', 'TRANSFER')), 0),
            'difference', w.balance - (
              w.initial_balance
              + COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type IN ('REVENUE', 'DEPOSIT')), 0)
              + COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.destination_wallet_id = w.id AND f.type = 'TRANSFER'), 0)
              - COALESCE((SELECT sum(amount) FROM filtered_operations f WHERE f.wallet_id = w.id AND f.type IN ('EXPENSE', 'TRANSFER')), 0)
            )
          ) ORDER BY w.name), '[]'::jsonb)
          FROM public.wallets w
          WHERE v_wallet_id IS NULL OR w.id = v_wallet_id
        )
      )
    );
  END IF;

  IF p_report_type IN ('VEHICLES', 'MOTORCYCLES') THEN
    RETURN (
      SELECT jsonb_build_object(
        'reportType', p_report_type,
        'assets', COALESCE(jsonb_agg(asset ORDER BY NULLIF(asset ->> 'costTotal', 'null')::numeric DESC NULLS LAST, asset ->> 'registration'), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'id', v.id, 'assetType', 'VEHICLE', 'registration', v.registration,
          'label', concat_ws(' ', v.brand, v.model), 'status', v.status,
          'kilometrage', v.kilometrage, 'purchasePrice', v.purchase_price,
          'maintenanceCount', (SELECT count(*) FROM public.maintenances m WHERE m.entity_type = 'vehicule'::public.entity_kind AND m.entity_id = v.id),
          'costTotal', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(f.amount) FROM public.finance_operations f WHERE f.vehicle_id = v.id AND f.type = 'EXPENSE' AND COALESCE(f.status, 'VALIDE') <> 'CANCELLED' AND (v_start_date IS NULL OR f.operation_date >= v_start_date) AND (v_end_date IS NULL OR f.operation_date <= v_end_date)), 0) ELSE NULL END,
          'currentDriver', (SELECT concat_ws(' ', e.nom, e.prenom) FROM public.driver_vehicle_assignments a JOIN public.drivers d ON d.id = a.driver_id LEFT JOIN public.employees e ON e.id = d.employee_id WHERE a.vehicle_id = v.id AND a.status = 'ACTIVE' ORDER BY a.start_date DESC NULLS LAST, a.created_at DESC LIMIT 1),
          'route', '/vehicles/' || v.id
        ) AS asset
        FROM public.vehicles v
        WHERE p_report_type = 'VEHICLES' AND (v_vehicle_id IS NULL OR v.id = v_vehicle_id)
        UNION ALL
        SELECT jsonb_build_object(
          'id', m.id, 'assetType', 'MOTORCYCLE', 'registration', m.immatriculation,
          'label', concat_ws(' ', m.marque, m.modele), 'status', m.statut::text,
          'kilometrage', m.kilometrage, 'purchasePrice', m.prix_achat,
          'maintenanceCount', (SELECT count(*) FROM public.motorcycle_maintenances mm WHERE mm.motorcycle_id = m.id),
          'costTotal', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(f.amount) FROM public.finance_operations f WHERE f.motorcycle_id = m.id AND f.type = 'EXPENSE' AND COALESCE(f.status, 'VALIDE') <> 'CANCELLED' AND (v_start_date IS NULL OR f.operation_date >= v_start_date) AND (v_end_date IS NULL OR f.operation_date <= v_end_date)), 0) ELSE NULL END,
          'currentDriver', (SELECT concat_ws(' ', e.nom, e.prenom) FROM public.driver_motorcycle_assignments a JOIN public.drivers d ON d.id = a.driver_id LEFT JOIN public.employees e ON e.id = d.employee_id WHERE a.motorcycle_id = m.id AND a.status = 'ACTIVE' ORDER BY a.start_date DESC NULLS LAST, a.created_at DESC LIMIT 1),
          'route', '/motorcycles/' || m.id
        ) AS asset
        FROM public.motorcycles m
        WHERE p_report_type = 'MOTORCYCLES' AND (v_motorcycle_id IS NULL OR m.id = v_motorcycle_id)
      ) assets
    );
  END IF;

  IF p_report_type IN ('DRIVERS', 'EMPLOYEES') THEN
    RETURN (
      SELECT jsonb_build_object(
        'reportType', p_report_type,
        'canViewSalary', v_can_view_finance,
        'people', COALESCE(jsonb_agg(person ORDER BY person ->> 'name'), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'id', d.id, 'employeeId', e.id, 'name', concat_ws(' ', e.nom, e.prenom),
          'role', 'DRIVER', 'status', d.statut::text, 'position', e.poste,
          'currentAsset', COALESCE(
            (SELECT v.registration FROM public.driver_vehicle_assignments a JOIN public.vehicles v ON v.id = a.vehicle_id WHERE a.driver_id = d.id AND a.status = 'ACTIVE' ORDER BY a.start_date DESC NULLS LAST LIMIT 1),
            (SELECT m.immatriculation FROM public.driver_motorcycle_assignments a JOIN public.motorcycles m ON m.id = a.motorcycle_id WHERE a.driver_id = d.id AND a.status = 'ACTIVE' ORDER BY a.start_date DESC NULLS LAST LIMIT 1)
          ),
          'salaryPaid', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(sp.amount) FROM public.salary_payments sp WHERE sp.driver_id = d.id AND sp.status <> 'CANCELLED' AND (v_start_date IS NULL OR sp.paid_at >= v_start_date) AND (v_end_date IS NULL OR sp.paid_at <= v_end_date)), 0) ELSE NULL END,
          'alertCount', (SELECT count(*) FROM public.notifications n JOIN public.notification_driver_links l ON l.notification_id = n.id WHERE l.driver_id = d.id AND n.status NOT IN ('RESOLVED', 'DISMISSED') AND (n.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]))),
          'route', '/drivers/' || d.id
        ) AS person
        FROM public.drivers d
        LEFT JOIN public.employees e ON e.id = d.employee_id
        WHERE p_report_type = 'DRIVERS' AND (v_driver_id IS NULL OR d.id = v_driver_id)
        UNION ALL
        SELECT jsonb_build_object(
          'id', e.id, 'employeeId', e.id, 'name', concat_ws(' ', e.nom, e.prenom),
          'role', CASE WHEN d.id IS NULL THEN 'EMPLOYEE' ELSE 'EMPLOYEE_DRIVER' END,
          'status', e.statut::text, 'position', e.poste,
          'currentAsset', NULL,
          'salaryPaid', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(sp.amount) FROM public.salary_payments sp WHERE sp.employee_id = e.id AND sp.status <> 'CANCELLED' AND (v_start_date IS NULL OR sp.paid_at >= v_start_date) AND (v_end_date IS NULL OR sp.paid_at <= v_end_date)), 0) ELSE NULL END,
          'alertCount', (SELECT count(*) FROM public.notifications n JOIN public.notification_employee_links l ON l.notification_id = n.id WHERE l.employee_id = e.id AND n.status NOT IN ('RESOLVED', 'DISMISSED') AND (n.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]))),
          'route', '/employees/' || e.id
        ) AS person
        FROM public.employees e
        LEFT JOIN public.drivers d ON d.employee_id = e.id
        WHERE p_report_type = 'EMPLOYEES' AND (v_employee_id IS NULL OR e.id = v_employee_id)
      ) people
    );
  END IF;

  IF p_report_type = 'FARMS' THEN
    RETURN (
      SELECT jsonb_build_object(
        'reportType', 'FARMS',
        'farms', COALESCE(jsonb_agg(row_data ORDER BY row_data ->> 'name'), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'id', f.id, 'name', f.nom, 'status', f.statut::text, 'surfaceHa', f.superficie_ha,
          'harvestQuantity', COALESCE((SELECT sum(h.quantite_kg) FROM public.harvests h WHERE h.farm_id = f.id AND (v_start_date IS NULL OR h.date_recolte >= v_start_date) AND (v_end_date IS NULL OR h.date_recolte <= v_end_date)), 0),
          'revenue', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(o.amount) FROM public.finance_operations o WHERE o.farm_id = f.id AND o.type = 'REVENUE' AND COALESCE(o.status, 'VALIDE') <> 'CANCELLED' AND (v_start_date IS NULL OR o.operation_date >= v_start_date) AND (v_end_date IS NULL OR o.operation_date <= v_end_date)), 0) ELSE NULL END,
          'expense', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(o.amount) FROM public.finance_operations o WHERE o.farm_id = f.id AND o.type = 'EXPENSE' AND COALESCE(o.status, 'VALIDE') <> 'CANCELLED' AND (v_start_date IS NULL OR o.operation_date >= v_start_date) AND (v_end_date IS NULL OR o.operation_date <= v_end_date)), 0) ELSE NULL END,
          'route', '/farms/' || f.id
        ) AS row_data
        FROM public.farms f
        WHERE v_farm_id IS NULL OR f.id = v_farm_id
      ) farms
    );
  END IF;

  IF p_report_type = 'MAINTENANCE' THEN
    RETURN (
      SELECT jsonb_build_object(
        'reportType', 'MAINTENANCE',
        'maintenances', COALESCE(jsonb_agg(row_data ORDER BY row_data ->> 'date' DESC), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'id', m.id, 'assetType', 'VEHICLE', 'assetId', m.entity_id,
          'assetLabel', v.registration, 'date', m.date, 'type', m.type,
          'status', NULL, 'cost', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(o.amount) FROM public.finance_operations o WHERE o.maintenance_id = m.id AND o.type = 'EXPENSE' AND COALESCE(o.status, 'VALIDE') <> 'CANCELLED'), 0) ELSE NULL END,
          'route', '/vehicles/' || m.entity_id
        ) AS row_data
        FROM public.maintenances m
        LEFT JOIN public.vehicles v ON v.id = m.entity_id
        WHERE m.entity_type = 'vehicule'::public.entity_kind
          AND (v_start_date IS NULL OR m.date >= v_start_date)
          AND (v_end_date IS NULL OR m.date <= v_end_date)
          AND (v_vehicle_id IS NULL OR m.entity_id = v_vehicle_id)
        UNION ALL
        SELECT jsonb_build_object(
          'id', m.id, 'assetType', 'MOTORCYCLE', 'assetId', m.motorcycle_id,
          'assetLabel', mo.immatriculation, 'date', m.maintenance_date, 'type', m.type,
          'status', NULL, 'cost', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(o.amount) FROM public.finance_operations o WHERE o.motorcycle_maintenance_id = m.id AND o.type = 'EXPENSE' AND COALESCE(o.status, 'VALIDE') <> 'CANCELLED'), 0) ELSE NULL END,
          'route', '/motorcycles/' || m.motorcycle_id
        ) AS row_data
        FROM public.motorcycle_maintenances m
        JOIN public.motorcycles mo ON mo.id = m.motorcycle_id
        WHERE (v_start_date IS NULL OR m.maintenance_date >= v_start_date)
          AND (v_end_date IS NULL OR m.maintenance_date <= v_end_date)
          AND (v_motorcycle_id IS NULL OR m.motorcycle_id = v_motorcycle_id)
      ) maintenance_rows
    );
  END IF;

  IF p_report_type = 'STOCK' THEN
    RETURN (
      SELECT jsonb_build_object(
        'reportType', 'STOCK',
        'items', COALESCE(jsonb_agg(row_data ORDER BY row_data ->> 'name'), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'id', i.id, 'name', i.nom, 'category', i.categorie, 'unit', i.unite,
          'stockCurrent', i.stock_actuel, 'threshold', i.seuil_alerte,
          'isLowStock', i.seuil_alerte IS NOT NULL AND i.stock_actuel <= i.seuil_alerte,
          'isOutOfStock', i.stock_actuel <= 0,
          'movementCount', (SELECT count(*) FROM public.stock_movements sm WHERE sm.inventory_item_id = i.id AND sm.status <> 'CANCELLED' AND (v_start_date IS NULL OR sm.movement_date >= v_start_date) AND (v_end_date IS NULL OR sm.movement_date <= v_end_date)),
          'purchases', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(o.amount) FROM public.finance_operations o WHERE o.inventory_item_id = i.id AND o.type = 'EXPENSE' AND COALESCE(o.status, 'VALIDE') <> 'CANCELLED' AND (v_start_date IS NULL OR o.operation_date >= v_start_date) AND (v_end_date IS NULL OR o.operation_date <= v_end_date)), 0) ELSE NULL END,
          'sales', CASE WHEN v_can_view_finance THEN COALESCE((SELECT sum(o.amount) FROM public.finance_operations o WHERE o.inventory_item_id = i.id AND o.type = 'REVENUE' AND COALESCE(o.status, 'VALIDE') <> 'CANCELLED' AND (v_start_date IS NULL OR o.operation_date >= v_start_date) AND (v_end_date IS NULL OR o.operation_date <= v_end_date)), 0) ELSE NULL END,
          'route', '/stocks?itemId=' || i.id
        ) AS row_data
        FROM public.inventory_items i
        WHERE v_inventory_item_id IS NULL OR i.id = v_inventory_item_id
      ) stock_rows
    );
  END IF;

  IF p_report_type = 'COMPLIANCE' THEN
    RETURN jsonb_build_object(
      'reportType', 'COMPLIANCE',
      'contracts', jsonb_build_object(
        'active', (SELECT count(*) FROM public.contracts WHERE COALESCE(statut, '') IN ('ACTIF', 'active')),
        'expiringSoon', (SELECT count(*) FROM public.contracts WHERE date_fin BETWEEN current_date AND current_date + 30),
        'expired', (SELECT count(*) FROM public.contracts WHERE date_fin < current_date)
      ),
      'documents', jsonb_build_object(
        'expiringSoon', (SELECT count(*) FROM public.documents WHERE archived_at IS NULL AND date_expiration BETWEEN current_date AND current_date + 30),
        'expired', (SELECT count(*) FROM public.documents WHERE archived_at IS NULL AND date_expiration < current_date)
      ),
      'alerts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('severity', severity, 'count', alert_count) ORDER BY severity)
        FROM (
          SELECT n.severity, count(*)::integer AS alert_count
          FROM public.notifications n
          WHERE n.status NOT IN ('RESOLVED', 'DISMISSED')
            AND (n.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]))
          GROUP BY n.severity
        ) alert_rows
      ), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'Type de rapport inconnu : %', p_report_type USING ERRCODE = '22023';
END;
$get_management_report$;

CREATE OR REPLACE FUNCTION public.get_management_report_operations(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  operation_date date,
  type text,
  status text,
  amount numeric,
  category text,
  description text,
  wallet_name text,
  destination_wallet_name text,
  source_label text,
  source_route text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $get_management_report_operations$
DECLARE
  v_start_date date := NULLIF(p_filters ->> 'startDate', '')::date;
  v_end_date date := NULLIF(p_filters ->> 'endDate', '')::date;
  v_wallet_id uuid := NULLIF(p_filters ->> 'walletId', '')::uuid;
  v_operation_type text := NULLIF(btrim(p_filters ->> 'operationType'), '');
  v_category text := NULLIF(btrim(p_filters ->> 'category'), '');
  v_status text := NULLIF(btrim(p_filters ->> 'status'), '');
  v_driver_id uuid := NULLIF(p_filters ->> 'driverId', '')::uuid;
  v_employee_id uuid := NULLIF(p_filters ->> 'employeeId', '')::uuid;
  v_vehicle_id uuid := NULLIF(p_filters ->> 'vehicleId', '')::uuid;
  v_motorcycle_id uuid := NULLIF(p_filters ->> 'motorcycleId', '')::uuid;
  v_farm_id uuid := NULLIF(p_filters ->> 'farmId', '')::uuid;
  v_inventory_item_id uuid := NULLIF(p_filters ->> 'inventoryItemId', '')::uuid;
  v_search text := NULLIF(btrim(p_filters ->> 'search'), '');
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100);
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à consulter les opérations financières.' USING ERRCODE = '42501';
  END IF;

  IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_start_date > v_end_date THEN
    RAISE EXCEPTION 'La date de début doit précéder la date de fin.' USING ERRCODE = '22007';
  END IF;

  RETURN QUERY
  WITH filtered_operations AS (
    SELECT o.*, count(*) OVER() AS row_total
    FROM public.finance_operations o
    WHERE COALESCE(o.status, 'VALIDE') <> 'CANCELLED'
      AND (v_start_date IS NULL OR o.operation_date >= v_start_date)
      AND (v_end_date IS NULL OR o.operation_date <= v_end_date)
      AND (v_wallet_id IS NULL OR o.wallet_id = v_wallet_id OR o.destination_wallet_id = v_wallet_id)
      AND (v_operation_type IS NULL OR o.type = v_operation_type)
      AND (v_category IS NULL OR o.category = v_category)
      AND (v_status IS NULL OR COALESCE(o.status, 'VALIDE') = v_status)
      AND (v_driver_id IS NULL OR o.driver_id = v_driver_id)
      AND (v_employee_id IS NULL OR o.employee_id = v_employee_id)
      AND (v_vehicle_id IS NULL OR o.vehicle_id = v_vehicle_id)
      AND (v_motorcycle_id IS NULL OR o.motorcycle_id = v_motorcycle_id)
      AND (v_farm_id IS NULL OR o.farm_id = v_farm_id)
      AND (v_inventory_item_id IS NULL OR o.inventory_item_id = v_inventory_item_id)
      AND (v_search IS NULL OR concat_ws(' ', o.category, o.description, o.reference, o.module) ILIKE '%' || v_search || '%')
    ORDER BY o.operation_date DESC, o.created_at DESC NULLS LAST
    OFFSET (v_page - 1) * v_page_size
    LIMIT v_page_size
  )
  SELECT
    o.id,
    o.operation_date,
    o.type,
    COALESCE(o.status, 'VALIDE'),
    o.amount,
    o.category,
    o.description,
    w.name,
    dw.name,
    COALESCE(v.registration, m.immatriculation, f.nom, i.nom, concat_ws(' ', e.nom, e.prenom), concat_ws(' ', de.nom, de.prenom), o.module, 'Opération financière'),
    CASE
      WHEN o.vehicle_id IS NOT NULL THEN '/vehicles/' || o.vehicle_id
      WHEN o.motorcycle_id IS NOT NULL THEN '/motorcycles/' || o.motorcycle_id
      WHEN o.farm_id IS NOT NULL THEN '/farms/' || o.farm_id
      WHEN o.driver_id IS NOT NULL THEN '/drivers/' || o.driver_id
      WHEN o.employee_id IS NOT NULL THEN '/employees/' || o.employee_id
      WHEN o.contract_id IS NOT NULL THEN '/contracts/' || o.contract_id
      ELSE '/finance'
    END,
    o.row_total
  FROM filtered_operations o
  JOIN public.wallets w ON w.id = o.wallet_id
  LEFT JOIN public.wallets dw ON dw.id = o.destination_wallet_id
  LEFT JOIN public.vehicles v ON v.id = o.vehicle_id
  LEFT JOIN public.motorcycles m ON m.id = o.motorcycle_id
  LEFT JOIN public.farms f ON f.id = o.farm_id
  LEFT JOIN public.inventory_items i ON i.id = o.inventory_item_id
  LEFT JOIN public.employees e ON e.id = o.employee_id
  LEFT JOIN public.drivers d ON d.id = o.driver_id
  LEFT JOIN public.employees de ON de.id = d.employee_id;
END;
$get_management_report_operations$;

REVOKE ALL ON FUNCTION public.reporting_can_access_report(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_management_report(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_management_report_operations(jsonb, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reporting_can_access_report(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_report(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_report_operations(jsonb, integer, integer) TO authenticated;
