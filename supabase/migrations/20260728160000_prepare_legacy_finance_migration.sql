-- Lot 4: prepare a non-destructive migration from the legacy financial
-- tables to the single finance_operations journal. This migration only adds
-- structures, relationships and guarded RPCs; the snapshot and backfill are
-- deliberately separate migrations.

-- Explicit business relationships -----------------------------------------
ALTER TABLE public.finance_operations
  ADD COLUMN IF NOT EXISTS farm_id uuid,
  ADD COLUMN IF NOT EXISTS motorcycle_id uuid,
  ADD COLUMN IF NOT EXISTS driver_id uuid,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS contract_id uuid,
  ADD COLUMN IF NOT EXISTS harvest_id uuid,
  ADD COLUMN IF NOT EXISTS maintenance_id uuid,
  ADD COLUMN IF NOT EXISTS motorcycle_maintenance_id uuid,
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid;

DO $foreign_keys$
BEGIN
  IF to_regclass('public.farms') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_farm_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_farm_id_fkey
      FOREIGN KEY (farm_id) REFERENCES public.farms(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.motorcycles') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_motorcycle_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_motorcycle_id_fkey
      FOREIGN KEY (motorcycle_id) REFERENCES public.motorcycles(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.drivers') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_driver_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.employees') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_employee_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.contracts') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_contract_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.harvests') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_harvest_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_harvest_id_fkey
      FOREIGN KEY (harvest_id) REFERENCES public.harvests(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.maintenances') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_maintenance_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_maintenance_id_fkey
      FOREIGN KEY (maintenance_id) REFERENCES public.maintenances(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.motorcycle_maintenances') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_motorcycle_maintenance_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_motorcycle_maintenance_id_fkey
      FOREIGN KEY (motorcycle_maintenance_id) REFERENCES public.motorcycle_maintenances(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('public.inventory_items') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_inventory_item_id_fkey') THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_inventory_item_id_fkey
      FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE SET NULL NOT VALID;
  END IF;
END
$foreign_keys$;

CREATE INDEX IF NOT EXISTS finance_operations_farm_date_idx
  ON public.finance_operations(farm_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_motorcycle_date_idx
  ON public.finance_operations(motorcycle_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_driver_date_idx
  ON public.finance_operations(driver_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_employee_date_idx
  ON public.finance_operations(employee_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_contract_date_idx
  ON public.finance_operations(contract_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_harvest_idx
  ON public.finance_operations(harvest_id);
CREATE INDEX IF NOT EXISTS finance_operations_maintenance_idx
  ON public.finance_operations(maintenance_id);
CREATE INDEX IF NOT EXISTS finance_operations_motorcycle_maintenance_idx
  ON public.finance_operations(motorcycle_maintenance_id);
CREATE INDEX IF NOT EXISTS finance_operations_inventory_item_idx
  ON public.finance_operations(inventory_item_id);
CREATE INDEX IF NOT EXISTS finance_operations_status_date_idx
  ON public.finance_operations(status, operation_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS finance_links_operation_module_record_key
  ON public.finance_links(finance_operation_id, module, module_record_id);

-- Immutable migration snapshots -------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_key text NOT NULL UNIQUE,
  snapshot_at timestamptz,
  backfilled_at timestamptz,
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED', 'SNAPSHOT_COMPLETE', 'BACKFILL_COMPLETE', 'BLOCKED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_snapshot_revenues (
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  legacy_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (migration_run_id, legacy_id)
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_snapshot_expenses (
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  legacy_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (migration_run_id, legacy_id)
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_snapshot_payments (
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  legacy_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (migration_run_id, legacy_id)
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_snapshot_operations (
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (migration_run_id, operation_id)
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_snapshot_links (
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  link_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (migration_run_id, link_id)
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_snapshot_wallets (
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (migration_run_id, wallet_id)
);

-- A future restoration containing legacy rows must select this wallet
-- explicitly. No default wallet is inferred by the backfill.
CREATE TABLE IF NOT EXISTS public.finance_legacy_migration_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_wallet_id uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  configured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  configured_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_legacy_migration_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  source_table text NOT NULL CHECK (source_table IN ('revenues', 'expenses', 'payments')),
  legacy_id uuid NOT NULL,
  issue_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (migration_run_id, source_table, legacy_id, issue_code)
);

-- Explicit links prevent a legacy row from being migrated more than once.
CREATE TABLE IF NOT EXISTS public.finance_revenue_links (
  operation_id uuid NOT NULL UNIQUE REFERENCES public.finance_operations(id) ON DELETE CASCADE,
  revenue_id uuid NOT NULL UNIQUE REFERENCES public.revenues(id) ON DELETE RESTRICT,
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  legacy_entity_type text,
  legacy_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, revenue_id)
);

CREATE TABLE IF NOT EXISTS public.finance_expense_links (
  operation_id uuid NOT NULL UNIQUE REFERENCES public.finance_operations(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL UNIQUE REFERENCES public.expenses(id) ON DELETE RESTRICT,
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, expense_id)
);

CREATE TABLE IF NOT EXISTS public.finance_payment_links (
  operation_id uuid NOT NULL UNIQUE REFERENCES public.finance_operations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  migration_run_id uuid NOT NULL REFERENCES public.finance_migration_runs(id) ON DELETE RESTRICT,
  legacy_payment_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, payment_id)
);

CREATE INDEX IF NOT EXISTS finance_revenue_links_run_idx ON public.finance_revenue_links(migration_run_id);
CREATE INDEX IF NOT EXISTS finance_expense_links_run_idx ON public.finance_expense_links(migration_run_id);
CREATE INDEX IF NOT EXISTS finance_payment_links_run_idx ON public.finance_payment_links(migration_run_id);

-- Wallet calculations accept the canonical vocabulary and the pre-existing
-- French vocabulary during the controlled migration window.
CREATE OR REPLACE FUNCTION public.update_wallet_balance(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $wallet_balance$
DECLARE
  calculated_balance numeric(14, 2);
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN wallet_id = p_wallet_id AND type IN ('REVENUE', 'DEPOSIT', 'RECETTE', 'VERSEMENT')
        THEN amount
      WHEN wallet_id = p_wallet_id AND type IN ('EXPENSE', 'TRANSFER', 'DEPENSE', 'TRANSFERT')
        THEN -amount
      WHEN destination_wallet_id = p_wallet_id AND type IN ('TRANSFER', 'TRANSFERT')
        THEN amount
      ELSE 0
    END
  ), 0)
  INTO calculated_balance
  FROM public.finance_operations;

  UPDATE public.wallets
  SET balance = calculated_balance,
      updated_at = now()
  WHERE id = p_wallet_id;

END;
$wallet_balance$;

CREATE OR REPLACE FUNCTION public.finance_require_write_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $require_role$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(
    auth.uid(),
    ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[]
  ) THEN
    RAISE EXCEPTION 'Vous ne disposez pas des droits nécessaires pour modifier le journal financier.'
      USING ERRCODE = '42501';
  END IF;
END;
$require_role$;

CREATE OR REPLACE FUNCTION public.finance_create_operation(
  p_operation jsonb,
  p_link_module text DEFAULT NULL,
  p_link_record_id uuid DEFAULT NULL
)
RETURNS public.finance_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_operation$
DECLARE
  v_operation public.finance_operations;
  v_type text := upper(trim(COALESCE(p_operation ->> 'type', '')));
  v_wallet_id uuid := NULLIF(p_operation ->> 'wallet_id', '')::uuid;
  v_destination_wallet_id uuid := NULLIF(p_operation ->> 'destination_wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_operation ->> 'amount', '')::numeric;
BEGIN
  PERFORM public.finance_require_write_role();

  IF v_type NOT IN ('REVENUE', 'EXPENSE', 'DEPOSIT', 'TRANSFER') THEN
    RAISE EXCEPTION 'Type financier invalide : %', v_type USING ERRCODE = '22023';
  END IF;

  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet source est obligatoire et doit exister.' USING ERRCODE = '23503';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  IF v_type = 'TRANSFER' THEN
    IF v_destination_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_destination_wallet_id) THEN
      RAISE EXCEPTION 'Le wallet destination est obligatoire pour un transfert.' USING ERRCODE = '23503';
    END IF;
    IF v_wallet_id = v_destination_wallet_id THEN
      RAISE EXCEPTION 'Les wallets source et destination doivent être différents.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_destination_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seul un transfert peut désigner un wallet destination.' USING ERRCODE = '22023';
  END IF;

  IF (p_link_module IS NULL) <> (p_link_record_id IS NULL) THEN
    RAISE EXCEPTION 'Le module et son identifiant doivent être fournis ensemble.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_operations (
    wallet_id, destination_wallet_id, type, amount, operation_date,
    category, description, reference, status, origin, module, module_id,
    payment_method, payment_reference, supplier, client, employee, project,
    vehicle_id, farm_id, motorcycle_id, driver_id, employee_id, contract_id,
    harvest_id, maintenance_id, motorcycle_maintenance_id, inventory_item_id,
    attachment_url, notes, created_by
  ) VALUES (
    v_wallet_id, v_destination_wallet_id, v_type, v_amount,
    COALESCE(NULLIF(p_operation ->> 'operation_date', '')::date, current_date),
    NULLIF(p_operation ->> 'category', ''), NULLIF(p_operation ->> 'description', ''),
    NULLIF(p_operation ->> 'reference', ''), COALESCE(NULLIF(p_operation ->> 'status', ''), 'VALIDE'),
    NULLIF(p_operation ->> 'origin', ''), NULLIF(p_operation ->> 'module', ''),
    NULLIF(p_operation ->> 'module_id', '')::uuid, NULLIF(p_operation ->> 'payment_method', ''),
    NULLIF(p_operation ->> 'payment_reference', ''), NULLIF(p_operation ->> 'supplier', ''),
    NULLIF(p_operation ->> 'client', ''), NULLIF(p_operation ->> 'employee', ''),
    NULLIF(p_operation ->> 'project', ''), NULLIF(p_operation ->> 'vehicle_id', '')::uuid,
    NULLIF(p_operation ->> 'farm_id', '')::uuid, NULLIF(p_operation ->> 'motorcycle_id', '')::uuid,
    NULLIF(p_operation ->> 'driver_id', '')::uuid, NULLIF(p_operation ->> 'employee_id', '')::uuid,
    NULLIF(p_operation ->> 'contract_id', '')::uuid, NULLIF(p_operation ->> 'harvest_id', '')::uuid,
    NULLIF(p_operation ->> 'maintenance_id', '')::uuid,
    NULLIF(p_operation ->> 'motorcycle_maintenance_id', '')::uuid,
    NULLIF(p_operation ->> 'inventory_item_id', '')::uuid,
    NULLIF(p_operation ->> 'attachment_url', ''), NULLIF(p_operation ->> 'notes', ''), auth.uid()
  ) RETURNING * INTO v_operation;

  IF p_link_module IS NOT NULL THEN
    INSERT INTO public.finance_links (finance_operation_id, module, module_record_id)
    VALUES (v_operation.id, p_link_module, p_link_record_id)
    ON CONFLICT (finance_operation_id, module, module_record_id) DO NOTHING;
  END IF;

  PERFORM public.update_wallet_balance(v_wallet_id);
  IF v_destination_wallet_id IS NOT NULL THEN
    PERFORM public.update_wallet_balance(v_destination_wallet_id);
  END IF;

  RETURN v_operation;
END;
$create_operation$;

CREATE OR REPLACE FUNCTION public.finance_update_operation(
  p_operation_id uuid,
  p_values jsonb
)
RETURNS public.finance_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_operation$
DECLARE
  v_before public.finance_operations;
  v_operation public.finance_operations;
  v_type text;
  v_wallet_id uuid;
  v_destination_wallet_id uuid;
  v_amount numeric(14, 2);
  v_wallet_to_recalculate uuid;
BEGIN
  PERFORM public.finance_require_write_role();

  SELECT * INTO v_before
  FROM public.finance_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opération financière introuvable.' USING ERRCODE = 'P0002';
  END IF;

  v_type := upper(trim(COALESCE(NULLIF(p_values ->> 'type', ''), v_before.type)));
  v_wallet_id := COALESCE(NULLIF(p_values ->> 'wallet_id', '')::uuid, v_before.wallet_id);
  v_destination_wallet_id := CASE
    WHEN p_values ? 'destination_wallet_id' THEN NULLIF(p_values ->> 'destination_wallet_id', '')::uuid
    ELSE v_before.destination_wallet_id
  END;
  v_amount := CASE
    WHEN p_values ? 'amount' THEN NULLIF(p_values ->> 'amount', '')::numeric
    ELSE v_before.amount
  END;

  IF v_type NOT IN ('REVENUE', 'EXPENSE', 'DEPOSIT', 'TRANSFER') THEN
    RAISE EXCEPTION 'Type financier invalide : %', v_type USING ERRCODE = '22023';
  END IF;
  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet source est obligatoire et doit exister.' USING ERRCODE = '23503';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'TRANSFER' AND (v_destination_wallet_id IS NULL OR v_destination_wallet_id = v_wallet_id) THEN
    RAISE EXCEPTION 'Un transfert exige un wallet destination différent.' USING ERRCODE = '22023';
  END IF;
  IF v_type <> 'TRANSFER' AND v_destination_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seul un transfert peut désigner un wallet destination.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.finance_operations
  SET
    wallet_id = v_wallet_id,
    destination_wallet_id = v_destination_wallet_id,
    type = v_type,
    amount = v_amount,
    operation_date = CASE WHEN p_values ? 'operation_date' THEN NULLIF(p_values ->> 'operation_date', '')::date ELSE v_before.operation_date END,
    category = CASE WHEN p_values ? 'category' THEN NULLIF(p_values ->> 'category', '') ELSE v_before.category END,
    description = CASE WHEN p_values ? 'description' THEN NULLIF(p_values ->> 'description', '') ELSE v_before.description END,
    reference = CASE WHEN p_values ? 'reference' THEN NULLIF(p_values ->> 'reference', '') ELSE v_before.reference END,
    status = CASE WHEN p_values ? 'status' THEN NULLIF(p_values ->> 'status', '') ELSE v_before.status END,
    origin = CASE WHEN p_values ? 'origin' THEN NULLIF(p_values ->> 'origin', '') ELSE v_before.origin END,
    module = CASE WHEN p_values ? 'module' THEN NULLIF(p_values ->> 'module', '') ELSE v_before.module END,
    module_id = CASE WHEN p_values ? 'module_id' THEN NULLIF(p_values ->> 'module_id', '')::uuid ELSE v_before.module_id END,
    payment_method = CASE WHEN p_values ? 'payment_method' THEN NULLIF(p_values ->> 'payment_method', '') ELSE v_before.payment_method END,
    payment_reference = CASE WHEN p_values ? 'payment_reference' THEN NULLIF(p_values ->> 'payment_reference', '') ELSE v_before.payment_reference END,
    supplier = CASE WHEN p_values ? 'supplier' THEN NULLIF(p_values ->> 'supplier', '') ELSE v_before.supplier END,
    client = CASE WHEN p_values ? 'client' THEN NULLIF(p_values ->> 'client', '') ELSE v_before.client END,
    employee = CASE WHEN p_values ? 'employee' THEN NULLIF(p_values ->> 'employee', '') ELSE v_before.employee END,
    project = CASE WHEN p_values ? 'project' THEN NULLIF(p_values ->> 'project', '') ELSE v_before.project END,
    vehicle_id = CASE WHEN p_values ? 'vehicle_id' THEN NULLIF(p_values ->> 'vehicle_id', '')::uuid ELSE v_before.vehicle_id END,
    farm_id = CASE WHEN p_values ? 'farm_id' THEN NULLIF(p_values ->> 'farm_id', '')::uuid ELSE v_before.farm_id END,
    motorcycle_id = CASE WHEN p_values ? 'motorcycle_id' THEN NULLIF(p_values ->> 'motorcycle_id', '')::uuid ELSE v_before.motorcycle_id END,
    driver_id = CASE WHEN p_values ? 'driver_id' THEN NULLIF(p_values ->> 'driver_id', '')::uuid ELSE v_before.driver_id END,
    employee_id = CASE WHEN p_values ? 'employee_id' THEN NULLIF(p_values ->> 'employee_id', '')::uuid ELSE v_before.employee_id END,
    contract_id = CASE WHEN p_values ? 'contract_id' THEN NULLIF(p_values ->> 'contract_id', '')::uuid ELSE v_before.contract_id END,
    harvest_id = CASE WHEN p_values ? 'harvest_id' THEN NULLIF(p_values ->> 'harvest_id', '')::uuid ELSE v_before.harvest_id END,
    maintenance_id = CASE WHEN p_values ? 'maintenance_id' THEN NULLIF(p_values ->> 'maintenance_id', '')::uuid ELSE v_before.maintenance_id END,
    motorcycle_maintenance_id = CASE WHEN p_values ? 'motorcycle_maintenance_id' THEN NULLIF(p_values ->> 'motorcycle_maintenance_id', '')::uuid ELSE v_before.motorcycle_maintenance_id END,
    inventory_item_id = CASE WHEN p_values ? 'inventory_item_id' THEN NULLIF(p_values ->> 'inventory_item_id', '')::uuid ELSE v_before.inventory_item_id END,
    attachment_url = CASE WHEN p_values ? 'attachment_url' THEN NULLIF(p_values ->> 'attachment_url', '') ELSE v_before.attachment_url END,
    notes = CASE WHEN p_values ? 'notes' THEN NULLIF(p_values ->> 'notes', '') ELSE v_before.notes END
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;

  FOR v_wallet_to_recalculate IN
    SELECT DISTINCT wallet_id
    FROM unnest(ARRAY[
      v_before.wallet_id,
      v_before.destination_wallet_id,
      v_operation.wallet_id,
      v_operation.destination_wallet_id
    ]) AS wallet_id
    WHERE wallet_id IS NOT NULL
  LOOP
    PERFORM public.update_wallet_balance(v_wallet_to_recalculate);
  END LOOP;

  RETURN v_operation;
END;
$update_operation$;

CREATE OR REPLACE FUNCTION public.finance_delete_operation(p_operation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_operation$
DECLARE
  v_operation public.finance_operations;
  v_wallet_to_recalculate uuid;
BEGIN
  PERFORM public.finance_require_write_role();

  SELECT * INTO v_operation
  FROM public.finance_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opération financière introuvable.' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.finance_operations WHERE id = p_operation_id;

  FOR v_wallet_to_recalculate IN
    SELECT DISTINCT wallet_id
    FROM unnest(ARRAY[v_operation.wallet_id, v_operation.destination_wallet_id]) AS wallet_id
    WHERE wallet_id IS NOT NULL
  LOOP
    PERFORM public.update_wallet_balance(v_wallet_to_recalculate);
  END LOOP;

  RETURN true;
END;
$delete_operation$;

CREATE OR REPLACE FUNCTION public.create_legacy_finance_snapshot(p_migration_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $snapshot$
DECLARE
  v_run_id uuid;
BEGIN
  SELECT id INTO v_run_id
  FROM public.finance_migration_runs
  WHERE migration_key = p_migration_key;

  IF FOUND THEN
    RETURN v_run_id;
  END IF;

  INSERT INTO public.finance_migration_runs (migration_key, status)
  VALUES (p_migration_key, 'PREPARED')
  RETURNING id INTO v_run_id;

  INSERT INTO public.finance_legacy_snapshot_revenues (migration_run_id, legacy_id, row_data)
  SELECT v_run_id, id, to_jsonb(revenues) FROM public.revenues;

  INSERT INTO public.finance_legacy_snapshot_expenses (migration_run_id, legacy_id, row_data)
  SELECT v_run_id, id, to_jsonb(expenses) FROM public.expenses;

  INSERT INTO public.finance_legacy_snapshot_payments (migration_run_id, legacy_id, row_data)
  SELECT v_run_id, id, to_jsonb(payments) FROM public.payments;

  INSERT INTO public.finance_legacy_snapshot_operations (migration_run_id, operation_id, row_data)
  SELECT v_run_id, id, to_jsonb(finance_operations) FROM public.finance_operations;

  INSERT INTO public.finance_legacy_snapshot_links (migration_run_id, link_id, row_data)
  SELECT v_run_id, id, to_jsonb(finance_links) FROM public.finance_links;

  INSERT INTO public.finance_legacy_snapshot_wallets (migration_run_id, wallet_id, row_data)
  SELECT v_run_id, id, to_jsonb(wallets) FROM public.wallets;

  UPDATE public.finance_migration_runs
  SET snapshot_at = now(),
      status = 'SNAPSHOT_COMPLETE',
      metadata = jsonb_build_object(
        'revenues', (SELECT count(*) FROM public.finance_legacy_snapshot_revenues WHERE migration_run_id = v_run_id),
        'expenses', (SELECT count(*) FROM public.finance_legacy_snapshot_expenses WHERE migration_run_id = v_run_id),
        'payments', (SELECT count(*) FROM public.finance_legacy_snapshot_payments WHERE migration_run_id = v_run_id),
        'finance_operations', (SELECT count(*) FROM public.finance_legacy_snapshot_operations WHERE migration_run_id = v_run_id),
        'finance_links', (SELECT count(*) FROM public.finance_legacy_snapshot_links WHERE migration_run_id = v_run_id),
        'wallets', (SELECT count(*) FROM public.finance_legacy_snapshot_wallets WHERE migration_run_id = v_run_id)
      ),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN v_run_id;
END;
$snapshot$;

-- Legacy data is retained as archive data: authenticated users may inspect it
-- but cannot create, update or delete it after the application cutover.
DROP POLICY IF EXISTS finance_select ON public.finance_operations;
DROP POLICY IF EXISTS finance_insert ON public.finance_operations;
DROP POLICY IF EXISTS finance_update ON public.finance_operations;
DROP POLICY IF EXISTS finance_delete ON public.finance_operations;
DROP POLICY IF EXISTS wallet_select ON public.wallets;
DROP POLICY IF EXISTS wallet_insert ON public.wallets;
DROP POLICY IF EXISTS wallet_update ON public.wallets;
DROP POLICY IF EXISTS wallet_delete ON public.wallets;

DROP POLICY IF EXISTS revenues_write ON public.revenues;
DROP POLICY IF EXISTS payments_write ON public.payments;
DROP POLICY IF EXISTS expenses_write ON public.expenses;
DROP POLICY IF EXISTS expenses_read ON public.expenses;
CREATE POLICY expenses_read ON public.expenses FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.revenues, public.expenses, public.payments FROM authenticated;
GRANT SELECT ON public.revenues, public.expenses, public.payments TO authenticated;

ALTER TABLE public.finance_migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_snapshot_revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_snapshot_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_snapshot_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_snapshot_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_snapshot_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_snapshot_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_migration_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_legacy_migration_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_revenue_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expense_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_migration_runs_read ON public.finance_migration_runs
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));
CREATE POLICY finance_migration_issues_read ON public.finance_legacy_migration_issues
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));
CREATE POLICY finance_revenue_links_read ON public.finance_revenue_links
  FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_expense_links_read ON public.finance_expense_links
  FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_payment_links_read ON public.finance_payment_links
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON FUNCTION public.finance_require_write_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_create_operation(jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_update_operation(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_delete_operation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_legacy_finance_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_create_operation(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_update_operation(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_delete_operation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_wallet_balance(uuid) TO authenticated;

DO $triggers$
BEGIN
  IF to_regprocedure('public.tg_touch_updated_at()') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.finance_migration_runs'::regclass AND tgname = 'trg_finance_migration_runs_updated' AND NOT tgisinternal) THEN
      CREATE TRIGGER trg_finance_migration_runs_updated
      BEFORE UPDATE ON public.finance_migration_runs
      FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
    END IF;
  END IF;
END
$triggers$;
