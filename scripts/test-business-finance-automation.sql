-- Transactional LOT 5 smoke tests. Run with:
-- supabase db query --linked --file scripts/test-business-finance-automation.sql
-- All data is rolled back at the end.

BEGIN;

DO $test$
DECLARE
  actor_id uuid;
  wallet_a uuid;
  wallet_b uuid;
  farm_id uuid;
  motorcycle_id uuid;
  vehicle_id uuid;
  employee_id uuid;
  item_id uuid;
  harvest public.harvests;
  motorcycle_maintenance public.motorcycle_maintenances;
  vehicle_maintenance public.maintenances;
  purchased_motorcycle public.motorcycles;
  salary public.salary_payments;
  movement public.stock_movements;
  finance_operation_id uuid;
BEGIN
  SELECT user_id INTO actor_id FROM public.user_roles
  WHERE role IN ('super_admin', 'admin', 'gestionnaire')
  ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END LIMIT 1;
  IF actor_id IS NULL THEN RAISE EXCEPTION 'No business actor available'; END IF;
  PERFORM set_config('request.jwt.claim.sub', actor_id::text, true);

  SELECT id INTO wallet_a FROM public.wallets ORDER BY created_at LIMIT 1;
  SELECT id INTO wallet_b FROM public.wallets WHERE id <> wallet_a ORDER BY created_at LIMIT 1;
  SELECT id INTO farm_id FROM public.farms ORDER BY created_at LIMIT 1;
  SELECT id INTO motorcycle_id FROM public.motorcycles ORDER BY created_at LIMIT 1;
  SELECT id INTO vehicle_id FROM public.vehicles ORDER BY created_at LIMIT 1;
  SELECT id INTO employee_id FROM public.employees ORDER BY created_at LIMIT 1;
  SELECT id INTO item_id FROM public.inventory_items ORDER BY created_at LIMIT 1;
  IF wallet_a IS NULL THEN
    INSERT INTO public.wallets(name, type, balance) VALUES ('TEST LOT 5 A', 'CASH', 0) RETURNING id INTO wallet_a;
  END IF;
  IF wallet_b IS NULL THEN
    INSERT INTO public.wallets(name, type, balance) VALUES ('TEST LOT 5 B', 'CASH', 0) RETURNING id INTO wallet_b;
  END IF;
  IF vehicle_id IS NULL THEN
    INSERT INTO public.vehicles(registration, status) VALUES ('TEST-VEH-' || substr(gen_random_uuid()::text, 1, 8), 'EN_SERVICE') RETURNING id INTO vehicle_id;
  END IF;
  IF farm_id IS NULL OR motorcycle_id IS NULL OR employee_id IS NULL OR item_id IS NULL THEN
    RAISE EXCEPTION 'Missing test reference data';
  END IF;

  SELECT * INTO harvest FROM public.create_harvest_with_finance(jsonb_build_object(
    'farm_id', farm_id, 'date_recolte', current_date, 'produit', 'TEST LOT 5', 'quantite_kg', 10, 'prix_kg', 100, 'sale_wallet_id', wallet_a
  ));
  SELECT link.operation_id INTO finance_operation_id FROM public.finance_harvest_links AS link WHERE link.harvest_id = harvest.id;
  SELECT * INTO harvest FROM public.update_harvest_with_finance(jsonb_build_object(
    'id', harvest.id, 'farm_id', farm_id, 'date_recolte', current_date, 'produit', 'TEST LOT 5', 'quantite_kg', 10, 'prix_kg', 120, 'sale_wallet_id', wallet_b
  ));
  IF (SELECT count(*) FROM public.finance_harvest_links WHERE harvest_id = harvest.id) <> 1 OR (SELECT amount FROM public.finance_operations WHERE id = finance_operation_id) <> 1200 THEN RAISE EXCEPTION 'Harvest update duplicated or failed'; END IF;
  PERFORM public.delete_harvest_with_finance(harvest.id);
  IF (SELECT status FROM public.finance_operations WHERE id = finance_operation_id) <> 'CANCELLED' THEN RAISE EXCEPTION 'Harvest cancellation failed'; END IF;

  SELECT * INTO motorcycle_maintenance FROM public.create_motorcycle_maintenance_with_finance(jsonb_build_object(
    'motorcycle_id', motorcycle_id, 'type', 'TEST', 'maintenance_date', current_date, 'cost', 1000, 'wallet_id', wallet_a
  ));
  SELECT link.operation_id INTO finance_operation_id FROM public.finance_motorcycle_maintenance_links AS link WHERE link.motorcycle_maintenance_id = motorcycle_maintenance.id;
  SELECT * INTO motorcycle_maintenance FROM public.update_motorcycle_maintenance_with_finance(jsonb_build_object(
    'id', motorcycle_maintenance.id, 'motorcycle_id', motorcycle_id, 'type', 'TEST', 'maintenance_date', current_date, 'cost', 1500, 'wallet_id', wallet_b
  ));
  IF (SELECT count(*) FROM public.finance_motorcycle_maintenance_links WHERE motorcycle_maintenance_id = motorcycle_maintenance.id) <> 1 OR (SELECT wallet_id FROM public.finance_operations WHERE id = finance_operation_id) <> wallet_b THEN RAISE EXCEPTION 'Motorcycle maintenance update failed'; END IF;
  PERFORM public.delete_motorcycle_maintenance_with_finance(motorcycle_maintenance.id);

  SELECT * INTO vehicle_maintenance FROM public.create_vehicle_maintenance_with_finance(jsonb_build_object(
    'vehicle_id', vehicle_id, 'date', current_date, 'type', 'TEST', 'cout', 2000, 'wallet_id', wallet_a
  ));
  SELECT link.operation_id INTO finance_operation_id FROM public.finance_vehicle_maintenance_links AS link WHERE link.maintenance_id = vehicle_maintenance.id;
  PERFORM public.delete_vehicle_maintenance_with_finance(vehicle_maintenance.id);
  IF (SELECT status FROM public.finance_operations WHERE id = finance_operation_id) <> 'CANCELLED' THEN RAISE EXCEPTION 'Vehicle maintenance cancellation failed'; END IF;

  SELECT * INTO purchased_motorcycle FROM public.create_motorcycle_with_purchase(jsonb_build_object(
    'immatriculation', 'TEST-LOT5-' || substr(gen_random_uuid()::text, 1, 8), 'statut', 'actif', 'prix_achat', 3000, 'date_achat', current_date, 'purchase_wallet_id', wallet_a
  ));
  SELECT link.operation_id INTO finance_operation_id FROM public.finance_motorcycle_purchase_links AS link WHERE link.motorcycle_id = purchased_motorcycle.id;
  PERFORM public.delete_motorcycle_with_purchase(purchased_motorcycle.id);
  IF (SELECT status FROM public.finance_operations WHERE id = finance_operation_id) <> 'CANCELLED' THEN RAISE EXCEPTION 'Motorcycle purchase cancellation failed'; END IF;

  SELECT * INTO salary FROM public.create_salary_payment_with_finance(jsonb_build_object(
    'employee_id', employee_id, 'wallet_id', wallet_a, 'period_start', '2099-01-01', 'paid_at', current_date, 'amount', 4000, 'is_partial', false
  ));
  SELECT link.operation_id INTO finance_operation_id FROM public.finance_salary_links AS link WHERE link.salary_payment_id = salary.id;
  SELECT * INTO salary FROM public.update_salary_payment_with_finance(jsonb_build_object(
    'id', salary.id, 'employee_id', employee_id, 'wallet_id', wallet_b, 'period_start', '2099-01-01', 'paid_at', current_date, 'amount', 4500, 'is_partial', false
  ));
  IF (SELECT count(*) FROM public.finance_salary_links WHERE salary_payment_id = salary.id) <> 1 OR (SELECT amount FROM public.finance_operations WHERE id = finance_operation_id) <> 4500 THEN RAISE EXCEPTION 'Salary update duplicated or failed'; END IF;
  PERFORM public.cancel_salary_payment_with_finance(salary.id);

  SELECT * INTO movement FROM public.create_stock_movement_with_finance(jsonb_build_object(
    'inventory_item_id', item_id, 'movement_type', 'PURCHASE', 'quantity', 2, 'unit_price', 500, 'wallet_id', wallet_a, 'movement_date', current_date
  ));
  SELECT link.operation_id INTO finance_operation_id FROM public.finance_stock_movement_links AS link WHERE link.stock_movement_id = movement.id;
  SELECT * INTO movement FROM public.update_stock_movement_with_finance(jsonb_build_object(
    'id', movement.id, 'inventory_item_id', item_id, 'movement_type', 'PURCHASE', 'quantity', 2, 'unit_price', 600, 'wallet_id', wallet_b, 'movement_date', current_date
  ));
  IF (SELECT count(*) FROM public.finance_stock_movement_links WHERE stock_movement_id = movement.id) <> 1 OR (SELECT amount FROM public.finance_operations WHERE id = finance_operation_id) <> 1200 THEN RAISE EXCEPTION 'Stock update duplicated or failed'; END IF;
  PERFORM public.cancel_stock_movement_with_finance(movement.id);

  IF EXISTS (SELECT 1 FROM public.finance_wallet_reconciliation WHERE stored_balance <> calculated_balance) THEN RAISE EXCEPTION 'Wallet reconciliation failed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'motorcycle_maintenances' AND policyname = 'Allow authenticated insert') THEN RAISE EXCEPTION 'Permissive maintenance RLS policy remains'; END IF;
END
$test$;

ROLLBACK;
