-- LOT 5: business events must create one explicit, auditable financial entry.
-- This migration is additive. It leaves legacy finance archives and existing
-- business data untouched.

ALTER TABLE public.harvests
  ADD COLUMN IF NOT EXISTS sale_wallet_id uuid;

ALTER TABLE public.motorcycles
  ADD COLUMN IF NOT EXISTS purchase_wallet_id uuid;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'harvests_sale_wallet_id_fkey'
      AND conrelid = 'public.harvests'::regclass
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT harvests_sale_wallet_id_fkey
      FOREIGN KEY (sale_wallet_id) REFERENCES public.wallets(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'motorcycles_purchase_wallet_id_fkey'
      AND conrelid = 'public.motorcycles'::regclass
  ) THEN
    ALTER TABLE public.motorcycles
      ADD CONSTRAINT motorcycles_purchase_wallet_id_fkey
      FOREIGN KEY (purchase_wallet_id) REFERENCES public.wallets(id) ON DELETE RESTRICT;
  END IF;
END
$constraints$;

CREATE TABLE IF NOT EXISTS public.salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  paid_at date NOT NULL DEFAULT current_date,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  is_partial boolean NOT NULL DEFAULT false,
  reference text,
  description text,
  status text NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID', 'CANCELLED')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS salary_payments_single_full_payment_uidx
  ON public.salary_payments(employee_id, period_start)
  WHERE status = 'PAID' AND NOT is_partial;
CREATE INDEX IF NOT EXISTS salary_payments_driver_idx
  ON public.salary_payments(driver_id, period_start DESC);
CREATE INDEX IF NOT EXISTS salary_payments_wallet_idx
  ON public.salary_payments(wallet_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'PURCHASE', 'SALE', 'IN', 'OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'LOSS', 'TRANSFER'
  )),
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14, 2),
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  movement_date date NOT NULL DEFAULT current_date,
  supplier text,
  client text,
  reference text,
  description text,
  status text NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'CANCELLED')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type IN ('PURCHASE', 'SALE') AND wallet_id IS NOT NULL AND unit_price IS NOT NULL AND unit_price >= 0)
    OR (movement_type NOT IN ('PURCHASE', 'SALE') AND wallet_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS stock_movements_item_date_idx
  ON public.stock_movements(inventory_item_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS stock_movements_wallet_idx
  ON public.stock_movements(wallet_id, movement_date DESC)
  WHERE wallet_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.business_finance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  operation_id uuid REFERENCES public.finance_operations(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'CANCEL', 'DELETE')),
  before_value jsonb,
  after_value jsonb,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_finance_audit_source_idx
  ON public.business_finance_audit(source_type, source_id, created_at DESC);

-- Every link represents at most one financial operation for a source event,
-- and a financial operation can belong to only one source event of that kind.
CREATE TABLE IF NOT EXISTS public.finance_harvest_links (
  operation_id uuid PRIMARY KEY REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  harvest_id uuid NOT NULL UNIQUE REFERENCES public.harvests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_motorcycle_maintenance_links (
  operation_id uuid PRIMARY KEY REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  motorcycle_maintenance_id uuid NOT NULL UNIQUE REFERENCES public.motorcycle_maintenances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_vehicle_maintenance_links (
  operation_id uuid PRIMARY KEY REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  maintenance_id uuid NOT NULL UNIQUE REFERENCES public.maintenances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_motorcycle_purchase_links (
  operation_id uuid PRIMARY KEY REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  motorcycle_id uuid NOT NULL UNIQUE REFERENCES public.motorcycles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_salary_links (
  operation_id uuid PRIMARY KEY REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  salary_payment_id uuid NOT NULL UNIQUE REFERENCES public.salary_payments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_stock_movement_links (
  operation_id uuid PRIMARY KEY REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  stock_movement_id uuid NOT NULL UNIQUE REFERENCES public.stock_movements(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_links_vehicle_purchase_source_uidx
  ON public.finance_links(module, module_record_id)
  WHERE module = 'VEHICLE';

CREATE INDEX IF NOT EXISTS finance_harvest_links_harvest_idx ON public.finance_harvest_links(harvest_id);
CREATE INDEX IF NOT EXISTS finance_motorcycle_maintenance_links_source_idx ON public.finance_motorcycle_maintenance_links(motorcycle_maintenance_id);
CREATE INDEX IF NOT EXISTS finance_vehicle_maintenance_links_source_idx ON public.finance_vehicle_maintenance_links(maintenance_id);
CREATE INDEX IF NOT EXISTS finance_motorcycle_purchase_links_source_idx ON public.finance_motorcycle_purchase_links(motorcycle_id);
CREATE INDEX IF NOT EXISTS finance_salary_links_source_idx ON public.finance_salary_links(salary_payment_id);
CREATE INDEX IF NOT EXISTS finance_stock_movement_links_source_idx ON public.finance_stock_movement_links(stock_movement_id);

-- CANCELLED operations must no longer contribute to the materialised wallet
-- balance. Existing valid entries retain their historical calculations.
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
  FROM public.finance_operations
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

  UPDATE public.wallets
  SET balance = calculated_balance,
      updated_at = now()
  WHERE id = p_wallet_id;
END;
$wallet_balance$;

CREATE OR REPLACE FUNCTION public.business_finance_require_write_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $require_business_role$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(
    auth.uid(),
    ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]
  ) THEN
    RAISE EXCEPTION 'Vous ne disposez pas des droits nécessaires pour modifier cet événement métier.'
      USING ERRCODE = '42501';
  END IF;
END;
$require_business_role$;

CREATE OR REPLACE FUNCTION public.business_finance_audit_event(
  p_source_type text,
  p_source_id uuid,
  p_operation_id uuid,
  p_action text,
  p_before_value jsonb DEFAULT NULL,
  p_after_value jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $audit_event$
  INSERT INTO public.business_finance_audit (
    source_type, source_id, operation_id, action, before_value, after_value, performed_by
  ) VALUES (
    p_source_type, p_source_id, p_operation_id, p_action,
    p_before_value, p_after_value, auth.uid()
  );
$audit_event$;

CREATE OR REPLACE FUNCTION public.business_upsert_finance_operation(
  p_operation_id uuid,
  p_wallet_id uuid,
  p_type text,
  p_amount numeric,
  p_operation_date date,
  p_category text,
  p_description text,
  p_origin text,
  p_module text,
  p_module_id uuid,
  p_vehicle_id uuid DEFAULT NULL,
  p_farm_id uuid DEFAULT NULL,
  p_motorcycle_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_driver_id uuid DEFAULT NULL,
  p_contract_id uuid DEFAULT NULL,
  p_harvest_id uuid DEFAULT NULL,
  p_maintenance_id uuid DEFAULT NULL,
  p_motorcycle_maintenance_id uuid DEFAULT NULL,
  p_inventory_item_id uuid DEFAULT NULL,
  p_supplier text DEFAULT NULL,
  p_client text DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS public.finance_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $upsert_finance$
DECLARE
  v_before public.finance_operations;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();

  IF p_type NOT IN ('REVENUE', 'EXPENSE') THEN
    RAISE EXCEPTION 'Type financier métier invalide : %', p_type USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant financier doit être strictement positif.' USING ERRCODE = '22023';
  END IF;
  IF p_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet sélectionné est introuvable.' USING ERRCODE = '23503';
  END IF;

  IF p_operation_id IS NULL THEN
    INSERT INTO public.finance_operations (
      wallet_id, type, amount, operation_date, category, description, origin,
      module, module_id, vehicle_id, farm_id, motorcycle_id, employee_id,
      driver_id, contract_id, harvest_id, maintenance_id,
      motorcycle_maintenance_id, inventory_item_id, supplier, client,
      reference, status, created_by
    ) VALUES (
      p_wallet_id, p_type, p_amount, COALESCE(p_operation_date, current_date),
      p_category, p_description, p_origin, p_module, p_module_id,
      p_vehicle_id, p_farm_id, p_motorcycle_id, p_employee_id, p_driver_id,
      p_contract_id, p_harvest_id, p_maintenance_id,
      p_motorcycle_maintenance_id, p_inventory_item_id, p_supplier, p_client,
      p_reference, 'VALIDE', auth.uid()
    ) RETURNING * INTO v_operation;
  ELSE
    SELECT * INTO v_before
    FROM public.finance_operations
    WHERE id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Opération financière liée introuvable.' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.finance_operations
    SET wallet_id = p_wallet_id,
        destination_wallet_id = NULL,
        type = p_type,
        amount = p_amount,
        operation_date = COALESCE(p_operation_date, current_date),
        category = p_category,
        description = p_description,
        origin = p_origin,
        module = p_module,
        module_id = p_module_id,
        vehicle_id = p_vehicle_id,
        farm_id = p_farm_id,
        motorcycle_id = p_motorcycle_id,
        employee_id = p_employee_id,
        driver_id = p_driver_id,
        contract_id = p_contract_id,
        harvest_id = p_harvest_id,
        maintenance_id = p_maintenance_id,
        motorcycle_maintenance_id = p_motorcycle_maintenance_id,
        inventory_item_id = p_inventory_item_id,
        supplier = p_supplier,
        client = p_client,
        reference = p_reference,
        status = 'VALIDE',
        updated_at = now()
    WHERE id = p_operation_id
    RETURNING * INTO v_operation;

    PERFORM public.update_wallet_balance(v_before.wallet_id);
  END IF;

  PERFORM public.update_wallet_balance(v_operation.wallet_id);
  RETURN v_operation;
END;
$upsert_finance$;

CREATE OR REPLACE FUNCTION public.business_cancel_finance_operation(p_operation_id uuid)
RETURNS public.finance_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $cancel_finance$
DECLARE
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();

  SELECT * INTO v_operation
  FROM public.finance_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opération financière liée introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_operation.status, 'VALIDE') <> 'CANCELLED' THEN
    UPDATE public.finance_operations
    SET status = 'CANCELLED', updated_at = now()
    WHERE id = v_operation.id
    RETURNING * INTO v_operation;
    PERFORM public.update_wallet_balance(v_operation.wallet_id);
  END IF;

  RETURN v_operation;
END;
$cancel_finance$;

CREATE OR REPLACE FUNCTION public.create_harvest_with_finance(p_harvest jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_harvest$
DECLARE
  v_harvest public.harvests;
  v_operation public.finance_operations;
  v_amount numeric(14, 2);
  v_wallet_id uuid := NULLIF(p_harvest ->> 'sale_wallet_id', '')::uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();

  INSERT INTO public.harvests (
    farm_id, date_recolte, produit, quantite_kg, prix_kg, acheteur,
    observations, sale_wallet_id
  ) VALUES (
    NULLIF(p_harvest ->> 'farm_id', '')::uuid,
    NULLIF(p_harvest ->> 'date_recolte', '')::date,
    NULLIF(trim(p_harvest ->> 'produit'), ''),
    NULLIF(p_harvest ->> 'quantite_kg', '')::numeric,
    NULLIF(p_harvest ->> 'prix_kg', '')::numeric,
    NULLIF(trim(p_harvest ->> 'acheteur'), ''),
    NULLIF(trim(p_harvest ->> 'observations'), ''),
    v_wallet_id
  ) RETURNING * INTO v_harvest;

  IF v_wallet_id IS NOT NULL THEN
    v_amount := v_harvest.quantite_kg * v_harvest.prix_kg;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Un encaissement de récolte exige un montant strictement positif.' USING ERRCODE = '22023';
    END IF;

    v_operation := public.business_upsert_finance_operation(
      NULL, v_wallet_id, 'REVENUE', v_amount, v_harvest.date_recolte,
      'VENTE AGRICOLE', 'Encaissement de la récolte ' || v_harvest.produit,
      'HARVEST_SALE', 'HARVEST', v_harvest.id, NULL, v_harvest.farm_id,
      NULL, NULL, NULL, NULL, v_harvest.id, NULL, NULL, NULL, NULL,
      v_harvest.acheteur, NULL
    );
    INSERT INTO public.finance_harvest_links(operation_id, harvest_id)
    VALUES (v_operation.id, v_harvest.id);
  END IF;

  PERFORM public.business_finance_audit_event(
    'HARVEST', v_harvest.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_harvest)
  );
  RETURN v_harvest;
END;
$create_harvest$;

CREATE OR REPLACE FUNCTION public.update_harvest_with_finance(p_harvest jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_harvest$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_wallet_id uuid := NULLIF(p_harvest ->> 'sale_wallet_id', '')::uuid;
  v_amount numeric(14, 2);
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.harvests
  WHERE id = NULLIF(p_harvest ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.harvests
  SET farm_id = NULLIF(p_harvest ->> 'farm_id', '')::uuid,
      date_recolte = NULLIF(p_harvest ->> 'date_recolte', '')::date,
      produit = NULLIF(trim(p_harvest ->> 'produit'), ''),
      quantite_kg = NULLIF(p_harvest ->> 'quantite_kg', '')::numeric,
      prix_kg = NULLIF(p_harvest ->> 'prix_kg', '')::numeric,
      acheteur = NULLIF(trim(p_harvest ->> 'acheteur'), ''),
      observations = NULLIF(trim(p_harvest ->> 'observations'), ''),
      sale_wallet_id = v_wallet_id,
      updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_harvest;

  SELECT operation_id INTO v_operation_id
  FROM public.finance_harvest_links WHERE harvest_id = v_harvest.id;

  IF v_wallet_id IS NOT NULL THEN
    v_amount := v_harvest.quantite_kg * v_harvest.prix_kg;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Un encaissement de récolte exige un montant strictement positif.' USING ERRCODE = '22023';
    END IF;
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_wallet_id, 'REVENUE', v_amount, v_harvest.date_recolte,
      'VENTE AGRICOLE', 'Encaissement de la récolte ' || v_harvest.produit,
      'HARVEST_SALE', 'HARVEST', v_harvest.id, NULL, v_harvest.farm_id,
      NULL, NULL, NULL, NULL, v_harvest.id, NULL, NULL, NULL, NULL,
      v_harvest.acheteur, NULL
    );
    IF v_operation_id IS NULL THEN
      INSERT INTO public.finance_harvest_links(operation_id, harvest_id)
      VALUES (v_operation.id, v_harvest.id);
    END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;

  PERFORM public.business_finance_audit_event(
    'HARVEST', v_harvest.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest)
  );
  RETURN v_harvest;
END;
$update_harvest$;

CREATE OR REPLACE FUNCTION public.delete_harvest_with_finance(p_harvest_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_harvest$
DECLARE
  v_harvest public.harvests;
  v_operation_id uuid;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_harvest FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_harvest_links WHERE harvest_id = p_harvest_id;
  IF v_operation_id IS NOT NULL THEN v_operation := public.business_cancel_finance_operation(v_operation_id); END IF;
  PERFORM public.business_finance_audit_event('HARVEST', p_harvest_id, v_operation.id, 'DELETE', to_jsonb(v_harvest), NULL);
  DELETE FROM public.harvests WHERE id = p_harvest_id;
  RETURN true;
END;
$delete_harvest$;

CREATE OR REPLACE FUNCTION public.create_motorcycle_maintenance_with_finance(p_maintenance jsonb)
RETURNS public.motorcycle_maintenances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_motorcycle_maintenance$
DECLARE
  v_maintenance public.motorcycle_maintenances;
  v_operation public.finance_operations;
  v_wallet_id uuid := NULLIF(p_maintenance ->> 'wallet_id', '')::uuid;
  v_cost numeric(14, 2) := COALESCE(NULLIF(p_maintenance ->> 'cost', '')::numeric, 0);
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_cost > 0 AND v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Un wallet est obligatoire pour un entretien avec coût.' USING ERRCODE = '22023';
  END IF;
  IF v_cost = 0 AND v_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un entretien sans coût ne doit pas sélectionner de wallet.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.motorcycle_maintenances (
    motorcycle_id, type, maintenance_date, kilometrage, cost, garage,
    next_date, next_kilometrage, description
  ) VALUES (
    NULLIF(p_maintenance ->> 'motorcycle_id', '')::uuid,
    NULLIF(trim(p_maintenance ->> 'type'), ''),
    NULLIF(p_maintenance ->> 'maintenance_date', '')::date,
    NULLIF(p_maintenance ->> 'kilometrage', '')::integer,
    v_cost,
    NULLIF(trim(p_maintenance ->> 'garage'), ''),
    NULLIF(p_maintenance ->> 'next_date', '')::date,
    NULLIF(p_maintenance ->> 'next_kilometrage', '')::integer,
    NULLIF(trim(p_maintenance ->> 'description'), '')
  ) RETURNING * INTO v_maintenance;

  IF v_cost > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      NULL, v_wallet_id, 'EXPENSE', v_cost, v_maintenance.maintenance_date,
      'ENTRETIEN MOTO', 'Entretien ' || v_maintenance.type,
      'MOTORCYCLE_MAINTENANCE', 'MOTORCYCLE_MAINTENANCE', v_maintenance.id,
      NULL, NULL, v_maintenance.motorcycle_id, NULL, NULL, NULL, NULL, NULL,
      v_maintenance.id, NULL, v_maintenance.garage, NULL, NULL
    );
    INSERT INTO public.finance_motorcycle_maintenance_links(operation_id, motorcycle_maintenance_id)
    VALUES (v_operation.id, v_maintenance.id);
  END IF;
  PERFORM public.business_finance_audit_event(
    'MOTORCYCLE_MAINTENANCE', v_maintenance.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_maintenance)
  );
  RETURN v_maintenance;
END;
$create_motorcycle_maintenance$;

CREATE OR REPLACE FUNCTION public.update_motorcycle_maintenance_with_finance(p_maintenance jsonb)
RETURNS public.motorcycle_maintenances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_motorcycle_maintenance$
DECLARE
  v_before public.motorcycle_maintenances;
  v_maintenance public.motorcycle_maintenances;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_wallet_id uuid := NULLIF(p_maintenance ->> 'wallet_id', '')::uuid;
  v_cost numeric(14, 2) := COALESCE(NULLIF(p_maintenance ->> 'cost', '')::numeric, 0);
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_cost > 0 AND v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Un wallet est obligatoire pour un entretien avec coût.' USING ERRCODE = '22023';
  END IF;
  IF v_cost = 0 AND v_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un entretien sans coût ne doit pas sélectionner de wallet.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.motorcycle_maintenances
  WHERE id = NULLIF(p_maintenance ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entretien moto introuvable.' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.motorcycle_maintenances
  SET motorcycle_id = NULLIF(p_maintenance ->> 'motorcycle_id', '')::uuid,
      type = NULLIF(trim(p_maintenance ->> 'type'), ''),
      maintenance_date = NULLIF(p_maintenance ->> 'maintenance_date', '')::date,
      kilometrage = NULLIF(p_maintenance ->> 'kilometrage', '')::integer,
      cost = v_cost,
      garage = NULLIF(trim(p_maintenance ->> 'garage'), ''),
      next_date = NULLIF(p_maintenance ->> 'next_date', '')::date,
      next_kilometrage = NULLIF(p_maintenance ->> 'next_kilometrage', '')::integer,
      description = NULLIF(trim(p_maintenance ->> 'description'), ''),
      updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_maintenance;

  SELECT operation_id INTO v_operation_id
  FROM public.finance_motorcycle_maintenance_links
  WHERE motorcycle_maintenance_id = v_maintenance.id;

  IF v_cost > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_wallet_id, 'EXPENSE', v_cost, v_maintenance.maintenance_date,
      'ENTRETIEN MOTO', 'Entretien ' || v_maintenance.type,
      'MOTORCYCLE_MAINTENANCE', 'MOTORCYCLE_MAINTENANCE', v_maintenance.id,
      NULL, NULL, v_maintenance.motorcycle_id, NULL, NULL, NULL, NULL, NULL,
      v_maintenance.id, NULL, v_maintenance.garage, NULL, NULL
    );
    IF v_operation_id IS NULL THEN
      INSERT INTO public.finance_motorcycle_maintenance_links(operation_id, motorcycle_maintenance_id)
      VALUES (v_operation.id, v_maintenance.id);
    END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;

  PERFORM public.business_finance_audit_event(
    'MOTORCYCLE_MAINTENANCE', v_maintenance.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_maintenance)
  );
  RETURN v_maintenance;
END;
$update_motorcycle_maintenance$;

CREATE OR REPLACE FUNCTION public.delete_motorcycle_maintenance_with_finance(p_maintenance_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_motorcycle_maintenance$
DECLARE
  v_maintenance public.motorcycle_maintenances;
  v_operation_id uuid;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_maintenance FROM public.motorcycle_maintenances WHERE id = p_maintenance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entretien moto introuvable.' USING ERRCODE = 'P0002'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_motorcycle_maintenance_links WHERE motorcycle_maintenance_id = p_maintenance_id;
  IF v_operation_id IS NOT NULL THEN v_operation := public.business_cancel_finance_operation(v_operation_id); END IF;
  PERFORM public.business_finance_audit_event('MOTORCYCLE_MAINTENANCE', p_maintenance_id, v_operation.id, 'DELETE', to_jsonb(v_maintenance), NULL);
  DELETE FROM public.motorcycle_maintenances WHERE id = p_maintenance_id;
  RETURN true;
END;
$delete_motorcycle_maintenance$;

CREATE OR REPLACE FUNCTION public.create_vehicle_maintenance_with_finance(p_maintenance jsonb)
RETURNS public.maintenances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_vehicle_maintenance$
DECLARE
  v_maintenance public.maintenances;
  v_operation public.finance_operations;
  v_wallet_id uuid := NULLIF(p_maintenance ->> 'wallet_id', '')::uuid;
  v_cost numeric(14, 2) := COALESCE(NULLIF(p_maintenance ->> 'cout', '')::numeric, 0);
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_cost > 0 AND v_wallet_id IS NULL THEN RAISE EXCEPTION 'Un wallet est obligatoire pour un entretien avec coût.' USING ERRCODE = '22023'; END IF;
  IF v_cost = 0 AND v_wallet_id IS NOT NULL THEN RAISE EXCEPTION 'Un entretien sans coût ne doit pas sélectionner de wallet.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.maintenances(entity_type, entity_id, date, type, cout, kilometrage, prestataire, notes)
  VALUES (
    'vehicule'::public.entity_kind, NULLIF(p_maintenance ->> 'vehicle_id', '')::uuid,
    COALESCE(NULLIF(p_maintenance ->> 'date', '')::date, current_date),
    NULLIF(trim(p_maintenance ->> 'type'), ''), v_cost,
    NULLIF(p_maintenance ->> 'kilometrage', '')::integer,
    NULLIF(trim(p_maintenance ->> 'prestataire'), ''), NULLIF(trim(p_maintenance ->> 'notes'), '')
  ) RETURNING * INTO v_maintenance;
  IF v_cost > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      NULL, v_wallet_id, 'EXPENSE', v_cost, v_maintenance.date, 'ENTRETIEN VEHICULE',
      'Entretien ' || COALESCE(v_maintenance.type, 'véhicule'), 'VEHICLE_MAINTENANCE',
      'VEHICLE_MAINTENANCE', v_maintenance.id, v_maintenance.entity_id,
      NULL, NULL, NULL, NULL, NULL, NULL, v_maintenance.id, NULL, NULL,
      v_maintenance.prestataire, NULL, NULL
    );
    INSERT INTO public.finance_vehicle_maintenance_links(operation_id, maintenance_id)
    VALUES (v_operation.id, v_maintenance.id);
  END IF;
  PERFORM public.business_finance_audit_event('VEHICLE_MAINTENANCE', v_maintenance.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_maintenance));
  RETURN v_maintenance;
END;
$create_vehicle_maintenance$;

CREATE OR REPLACE FUNCTION public.update_vehicle_maintenance_with_finance(p_maintenance jsonb)
RETURNS public.maintenances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_vehicle_maintenance$
DECLARE
  v_before public.maintenances;
  v_maintenance public.maintenances;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_wallet_id uuid := NULLIF(p_maintenance ->> 'wallet_id', '')::uuid;
  v_cost numeric(14, 2) := COALESCE(NULLIF(p_maintenance ->> 'cout', '')::numeric, 0);
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_cost > 0 AND v_wallet_id IS NULL THEN RAISE EXCEPTION 'Un wallet est obligatoire pour un entretien avec coût.' USING ERRCODE = '22023'; END IF;
  IF v_cost = 0 AND v_wallet_id IS NOT NULL THEN RAISE EXCEPTION 'Un entretien sans coût ne doit pas sélectionner de wallet.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.maintenances WHERE id = NULLIF(p_maintenance ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND OR v_before.entity_type <> 'vehicule'::public.entity_kind THEN RAISE EXCEPTION 'Entretien véhicule introuvable.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.maintenances
  SET entity_id = NULLIF(p_maintenance ->> 'vehicle_id', '')::uuid,
      date = COALESCE(NULLIF(p_maintenance ->> 'date', '')::date, current_date),
      type = NULLIF(trim(p_maintenance ->> 'type'), ''), cout = v_cost,
      kilometrage = NULLIF(p_maintenance ->> 'kilometrage', '')::integer,
      prestataire = NULLIF(trim(p_maintenance ->> 'prestataire'), ''),
      notes = NULLIF(trim(p_maintenance ->> 'notes'), ''), updated_at = now()
  WHERE id = v_before.id RETURNING * INTO v_maintenance;
  SELECT operation_id INTO v_operation_id FROM public.finance_vehicle_maintenance_links WHERE maintenance_id = v_maintenance.id;
  IF v_cost > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_wallet_id, 'EXPENSE', v_cost, v_maintenance.date, 'ENTRETIEN VEHICULE',
      'Entretien ' || COALESCE(v_maintenance.type, 'véhicule'), 'VEHICLE_MAINTENANCE',
      'VEHICLE_MAINTENANCE', v_maintenance.id, v_maintenance.entity_id,
      NULL, NULL, NULL, NULL, NULL, NULL, v_maintenance.id, NULL, NULL,
      v_maintenance.prestataire, NULL, NULL
    );
    IF v_operation_id IS NULL THEN INSERT INTO public.finance_vehicle_maintenance_links(operation_id, maintenance_id) VALUES (v_operation.id, v_maintenance.id); END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;
  PERFORM public.business_finance_audit_event('VEHICLE_MAINTENANCE', v_maintenance.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_maintenance));
  RETURN v_maintenance;
END;
$update_vehicle_maintenance$;

CREATE OR REPLACE FUNCTION public.delete_vehicle_maintenance_with_finance(p_maintenance_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_vehicle_maintenance$
DECLARE
  v_maintenance public.maintenances;
  v_operation_id uuid;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_maintenance FROM public.maintenances WHERE id = p_maintenance_id FOR UPDATE;
  IF NOT FOUND OR v_maintenance.entity_type <> 'vehicule'::public.entity_kind THEN RAISE EXCEPTION 'Entretien véhicule introuvable.' USING ERRCODE = 'P0002'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_vehicle_maintenance_links WHERE maintenance_id = p_maintenance_id;
  IF v_operation_id IS NOT NULL THEN v_operation := public.business_cancel_finance_operation(v_operation_id); END IF;
  PERFORM public.business_finance_audit_event('VEHICLE_MAINTENANCE', p_maintenance_id, v_operation.id, 'DELETE', to_jsonb(v_maintenance), NULL);
  DELETE FROM public.maintenances WHERE id = p_maintenance_id;
  RETURN true;
END;
$delete_vehicle_maintenance$;

CREATE OR REPLACE FUNCTION public.create_salary_payment_with_finance(p_payment jsonb)
RETURNS public.salary_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_salary_payment$
DECLARE
  v_payment public.salary_payments;
  v_operation public.finance_operations;
  v_employee_id uuid := NULLIF(p_payment ->> 'employee_id', '')::uuid;
  v_driver_id uuid := NULLIF(p_payment ->> 'driver_id', '')::uuid;
  v_driver_employee_id uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_driver_id IS NOT NULL THEN
    SELECT employee_id INTO v_driver_employee_id FROM public.drivers WHERE id = v_driver_id;
    IF NOT FOUND OR v_driver_employee_id IS NULL THEN RAISE EXCEPTION 'Le chauffeur doit être lié à un employé.' USING ERRCODE = '23503'; END IF;
    IF v_employee_id IS NULL THEN v_employee_id := v_driver_employee_id; END IF;
    IF v_employee_id <> v_driver_employee_id THEN RAISE EXCEPTION 'Le chauffeur ne correspond pas à l''employé sélectionné.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_employee_id IS NULL THEN RAISE EXCEPTION 'Un employé ou un chauffeur est obligatoire.' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.salary_payments(
    employee_id, driver_id, contract_id, wallet_id, period_start, paid_at,
    amount, is_partial, reference, description, created_by
  ) VALUES (
    v_employee_id, v_driver_id, NULLIF(p_payment ->> 'contract_id', '')::uuid,
    NULLIF(p_payment ->> 'wallet_id', '')::uuid,
    NULLIF(p_payment ->> 'period_start', '')::date,
    COALESCE(NULLIF(p_payment ->> 'paid_at', '')::date, current_date),
    NULLIF(p_payment ->> 'amount', '')::numeric,
    COALESCE(NULLIF(p_payment ->> 'is_partial', '')::boolean, false),
    NULLIF(trim(p_payment ->> 'reference'), ''),
    NULLIF(trim(p_payment ->> 'description'), ''), auth.uid()
  ) RETURNING * INTO v_payment;

  v_operation := public.business_upsert_finance_operation(
    NULL, v_payment.wallet_id, 'EXPENSE', v_payment.amount, v_payment.paid_at,
    'SALAIRE', 'Paiement de salaire ' || to_char(v_payment.period_start, 'YYYY-MM'),
    'SALARY_PAYMENT', 'SALARY_PAYMENT', v_payment.id, NULL, NULL, NULL,
    v_payment.employee_id, v_payment.driver_id, v_payment.contract_id, NULL,
    NULL, NULL, NULL, NULL, NULL, v_payment.reference
  );
  INSERT INTO public.finance_salary_links(operation_id, salary_payment_id)
  VALUES (v_operation.id, v_payment.id);
  PERFORM public.business_finance_audit_event('SALARY_PAYMENT', v_payment.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_payment));
  RETURN v_payment;
END;
$create_salary_payment$;

CREATE OR REPLACE FUNCTION public.update_salary_payment_with_finance(p_payment jsonb)
RETURNS public.salary_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_salary_payment$
DECLARE
  v_before public.salary_payments;
  v_payment public.salary_payments;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_employee_id uuid := NULLIF(p_payment ->> 'employee_id', '')::uuid;
  v_driver_id uuid := NULLIF(p_payment ->> 'driver_id', '')::uuid;
  v_driver_employee_id uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.salary_payments WHERE id = NULLIF(p_payment ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement de salaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_driver_id IS NOT NULL THEN
    SELECT employee_id INTO v_driver_employee_id FROM public.drivers WHERE id = v_driver_id;
    IF NOT FOUND OR v_driver_employee_id IS NULL THEN RAISE EXCEPTION 'Le chauffeur doit être lié à un employé.' USING ERRCODE = '23503'; END IF;
    IF v_employee_id IS NULL THEN v_employee_id := v_driver_employee_id; END IF;
    IF v_employee_id <> v_driver_employee_id THEN RAISE EXCEPTION 'Le chauffeur ne correspond pas à l''employé sélectionné.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_employee_id IS NULL THEN RAISE EXCEPTION 'Un employé ou un chauffeur est obligatoire.' USING ERRCODE = '22023'; END IF;

  UPDATE public.salary_payments
  SET employee_id = v_employee_id, driver_id = v_driver_id,
      contract_id = NULLIF(p_payment ->> 'contract_id', '')::uuid,
      wallet_id = NULLIF(p_payment ->> 'wallet_id', '')::uuid,
      period_start = NULLIF(p_payment ->> 'period_start', '')::date,
      paid_at = COALESCE(NULLIF(p_payment ->> 'paid_at', '')::date, current_date),
      amount = NULLIF(p_payment ->> 'amount', '')::numeric,
      is_partial = COALESCE(NULLIF(p_payment ->> 'is_partial', '')::boolean, false),
      reference = NULLIF(trim(p_payment ->> 'reference'), ''),
      description = NULLIF(trim(p_payment ->> 'description'), ''),
      status = 'PAID', updated_at = now()
  WHERE id = v_before.id RETURNING * INTO v_payment;
  SELECT operation_id INTO v_operation_id FROM public.finance_salary_links WHERE salary_payment_id = v_payment.id;
  IF v_operation_id IS NULL THEN RAISE EXCEPTION 'Lien financier du salaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  v_operation := public.business_upsert_finance_operation(
    v_operation_id, v_payment.wallet_id, 'EXPENSE', v_payment.amount, v_payment.paid_at,
    'SALAIRE', 'Paiement de salaire ' || to_char(v_payment.period_start, 'YYYY-MM'),
    'SALARY_PAYMENT', 'SALARY_PAYMENT', v_payment.id, NULL, NULL, NULL,
    v_payment.employee_id, v_payment.driver_id, v_payment.contract_id, NULL,
    NULL, NULL, NULL, NULL, NULL, v_payment.reference
  );
  PERFORM public.business_finance_audit_event('SALARY_PAYMENT', v_payment.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$update_salary_payment$;

CREATE OR REPLACE FUNCTION public.cancel_salary_payment_with_finance(p_payment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $cancel_salary_payment$
DECLARE
  v_payment public.salary_payments;
  v_operation_id uuid;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_payment FROM public.salary_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement de salaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_salary_links WHERE salary_payment_id = p_payment_id;
  IF v_operation_id IS NULL THEN RAISE EXCEPTION 'Lien financier du salaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  v_operation := public.business_cancel_finance_operation(v_operation_id);
  UPDATE public.salary_payments SET status = 'CANCELLED', updated_at = now() WHERE id = p_payment_id;
  PERFORM public.business_finance_audit_event('SALARY_PAYMENT', p_payment_id, v_operation.id, 'CANCEL', to_jsonb(v_payment), NULL);
  RETURN true;
END;
$cancel_salary_payment$;

CREATE OR REPLACE FUNCTION public.stock_movement_delta(p_movement_type text, p_quantity numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $stock_delta$
BEGIN
  CASE p_movement_type
    WHEN 'PURCHASE', 'IN', 'ADJUSTMENT_IN' THEN RETURN p_quantity;
    WHEN 'SALE', 'OUT', 'ADJUSTMENT_OUT', 'LOSS' THEN RETURN -p_quantity;
    WHEN 'TRANSFER' THEN RETURN 0;
    ELSE RAISE EXCEPTION 'Type de mouvement de stock invalide : %', p_movement_type USING ERRCODE = '22023';
  END CASE;
END;
$stock_delta$;

CREATE OR REPLACE FUNCTION public.create_stock_movement_with_finance(p_movement jsonb)
RETURNS public.stock_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_stock_movement$
DECLARE
  v_movement public.stock_movements;
  v_operation public.finance_operations;
  v_type text := upper(trim(COALESCE(p_movement ->> 'movement_type', '')));
  v_wallet_id uuid := NULLIF(p_movement ->> 'wallet_id', '')::uuid;
  v_amount numeric(14, 2);
BEGIN
  PERFORM public.business_finance_require_write_role();
  INSERT INTO public.stock_movements(
    inventory_item_id, movement_type, quantity, unit_price, wallet_id,
    movement_date, supplier, client, reference, description, created_by
  ) VALUES (
    NULLIF(p_movement ->> 'inventory_item_id', '')::uuid, v_type,
    NULLIF(p_movement ->> 'quantity', '')::numeric,
    NULLIF(p_movement ->> 'unit_price', '')::numeric, v_wallet_id,
    COALESCE(NULLIF(p_movement ->> 'movement_date', '')::date, current_date),
    NULLIF(trim(p_movement ->> 'supplier'), ''), NULLIF(trim(p_movement ->> 'client'), ''),
    NULLIF(trim(p_movement ->> 'reference'), ''), NULLIF(trim(p_movement ->> 'description'), ''), auth.uid()
  ) RETURNING * INTO v_movement;
  UPDATE public.inventory_items SET stock_actuel = stock_actuel + public.stock_movement_delta(v_movement.movement_type, v_movement.quantity), updated_at = now()
  WHERE id = v_movement.inventory_item_id AND stock_actuel + public.stock_movement_delta(v_movement.movement_type, v_movement.quantity) >= 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Le mouvement créerait un stock négatif.' USING ERRCODE = '22023'; END IF;
  IF v_movement.movement_type IN ('PURCHASE', 'SALE') THEN
    v_amount := v_movement.quantity * v_movement.unit_price;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Un achat ou une vente doit avoir un montant strictement positif.' USING ERRCODE = '22023'; END IF;
    v_operation := public.business_upsert_finance_operation(
      NULL, v_movement.wallet_id,
      CASE WHEN v_movement.movement_type = 'PURCHASE' THEN 'EXPENSE' ELSE 'REVENUE' END,
      v_amount, v_movement.movement_date,
      CASE WHEN v_movement.movement_type = 'PURCHASE' THEN 'ACHAT DE STOCK' ELSE 'VENTE DE STOCK' END,
      COALESCE(v_movement.description, CASE WHEN v_movement.movement_type = 'PURCHASE' THEN 'Achat de stock' ELSE 'Vente de stock' END),
      'STOCK_MOVEMENT', 'STOCK_MOVEMENT', v_movement.id, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, v_movement.inventory_item_id,
      v_movement.supplier, v_movement.client, v_movement.reference
    );
    INSERT INTO public.finance_stock_movement_links(operation_id, stock_movement_id) VALUES (v_operation.id, v_movement.id);
  END IF;
  PERFORM public.business_finance_audit_event('STOCK_MOVEMENT', v_movement.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_movement));
  RETURN v_movement;
END;
$create_stock_movement$;

CREATE OR REPLACE FUNCTION public.cancel_stock_movement_with_finance(p_movement_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $cancel_stock_movement$
DECLARE
  v_movement public.stock_movements;
  v_operation_id uuid;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement de stock introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_movement.status = 'CANCELLED' THEN RETURN true; END IF;
  UPDATE public.inventory_items SET stock_actuel = stock_actuel - public.stock_movement_delta(v_movement.movement_type, v_movement.quantity), updated_at = now()
  WHERE id = v_movement.inventory_item_id AND stock_actuel - public.stock_movement_delta(v_movement.movement_type, v_movement.quantity) >= 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'L''annulation créerait un stock négatif.' USING ERRCODE = '22023'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_stock_movement_links WHERE stock_movement_id = p_movement_id;
  IF v_operation_id IS NOT NULL THEN v_operation := public.business_cancel_finance_operation(v_operation_id); END IF;
  UPDATE public.stock_movements SET status = 'CANCELLED', updated_at = now() WHERE id = p_movement_id;
  PERFORM public.business_finance_audit_event('STOCK_MOVEMENT', p_movement_id, v_operation.id, 'CANCEL', to_jsonb(v_movement), NULL);
  RETURN true;
END;
$cancel_stock_movement$;

CREATE OR REPLACE FUNCTION public.create_motorcycle_with_purchase(p_motorcycle jsonb)
RETURNS public.motorcycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_motorcycle$
DECLARE
  v_motorcycle public.motorcycles;
  v_operation public.finance_operations;
  v_price numeric(14, 2) := COALESCE(NULLIF(p_motorcycle ->> 'prix_achat', '')::numeric, 0);
  v_wallet_id uuid := NULLIF(p_motorcycle ->> 'purchase_wallet_id', '')::uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_price > 0 AND v_wallet_id IS NULL THEN RAISE EXCEPTION 'Un wallet d''achat est obligatoire pour une moto achetée.' USING ERRCODE = '22023'; END IF;
  IF v_price = 0 AND v_wallet_id IS NOT NULL THEN RAISE EXCEPTION 'Une moto sans prix d''achat ne doit pas sélectionner de wallet.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.motorcycles(
    immatriculation, marque, modele, couleur, annee, kilometrage, prix_achat,
    date_achat, assurance_expiration, visite_expiration, derniere_revision,
    prochaine_revision, observations, statut, driver_id, purchase_wallet_id
  ) VALUES (
    NULLIF(trim(p_motorcycle ->> 'immatriculation'), ''),
    NULLIF(trim(p_motorcycle ->> 'marque'), ''), NULLIF(trim(p_motorcycle ->> 'modele'), ''),
    NULLIF(trim(p_motorcycle ->> 'couleur'), ''), NULLIF(p_motorcycle ->> 'annee', '')::integer,
    NULLIF(p_motorcycle ->> 'kilometrage', '')::integer, NULLIF(p_motorcycle ->> 'prix_achat', '')::numeric,
    NULLIF(p_motorcycle ->> 'date_achat', '')::date, NULLIF(p_motorcycle ->> 'assurance_expiration', '')::date,
    NULLIF(p_motorcycle ->> 'visite_expiration', '')::date, NULLIF(p_motorcycle ->> 'derniere_revision', '')::date,
    NULLIF(p_motorcycle ->> 'prochaine_revision', '')::date, NULLIF(trim(p_motorcycle ->> 'observations'), ''),
    COALESCE(NULLIF(p_motorcycle ->> 'statut', ''), 'actif')::public.statut_general,
    NULLIF(p_motorcycle ->> 'driver_id', '')::uuid, v_wallet_id
  ) RETURNING * INTO v_motorcycle;
  IF v_price > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      NULL, v_wallet_id, 'EXPENSE', v_price, COALESCE(v_motorcycle.date_achat, current_date),
      'ACHAT DE MOTO', 'Achat de la moto ' || v_motorcycle.immatriculation,
      'MOTORCYCLE_PURCHASE', 'MOTORCYCLE', v_motorcycle.id, NULL, NULL,
      v_motorcycle.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    INSERT INTO public.finance_motorcycle_purchase_links(operation_id, motorcycle_id) VALUES (v_operation.id, v_motorcycle.id);
  END IF;
  PERFORM public.business_finance_audit_event('MOTORCYCLE_PURCHASE', v_motorcycle.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_motorcycle));
  RETURN v_motorcycle;
END;
$create_motorcycle$;

CREATE OR REPLACE FUNCTION public.update_motorcycle_with_purchase(p_motorcycle jsonb)
RETURNS public.motorcycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_motorcycle$
DECLARE
  v_before public.motorcycles;
  v_motorcycle public.motorcycles;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_price numeric(14, 2) := COALESCE(NULLIF(p_motorcycle ->> 'prix_achat', '')::numeric, 0);
  v_wallet_id uuid := NULLIF(p_motorcycle ->> 'purchase_wallet_id', '')::uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_price > 0 AND v_wallet_id IS NULL THEN RAISE EXCEPTION 'Un wallet d''achat est obligatoire pour une moto achetée.' USING ERRCODE = '22023'; END IF;
  IF v_price = 0 AND v_wallet_id IS NOT NULL THEN RAISE EXCEPTION 'Une moto sans prix d''achat ne doit pas sélectionner de wallet.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.motorcycles WHERE id = NULLIF(p_motorcycle ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moto introuvable.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.motorcycles
  SET immatriculation = NULLIF(trim(p_motorcycle ->> 'immatriculation'), ''),
      marque = NULLIF(trim(p_motorcycle ->> 'marque'), ''), modele = NULLIF(trim(p_motorcycle ->> 'modele'), ''),
      couleur = NULLIF(trim(p_motorcycle ->> 'couleur'), ''), annee = NULLIF(p_motorcycle ->> 'annee', '')::integer,
      kilometrage = NULLIF(p_motorcycle ->> 'kilometrage', '')::integer, prix_achat = NULLIF(p_motorcycle ->> 'prix_achat', '')::numeric,
      date_achat = NULLIF(p_motorcycle ->> 'date_achat', '')::date, assurance_expiration = NULLIF(p_motorcycle ->> 'assurance_expiration', '')::date,
      visite_expiration = NULLIF(p_motorcycle ->> 'visite_expiration', '')::date, derniere_revision = NULLIF(p_motorcycle ->> 'derniere_revision', '')::date,
      prochaine_revision = NULLIF(p_motorcycle ->> 'prochaine_revision', '')::date, observations = NULLIF(trim(p_motorcycle ->> 'observations'), ''),
      statut = COALESCE(NULLIF(p_motorcycle ->> 'statut', ''), 'actif')::public.statut_general,
      driver_id = NULLIF(p_motorcycle ->> 'driver_id', '')::uuid, purchase_wallet_id = v_wallet_id, updated_at = now()
  WHERE id = v_before.id RETURNING * INTO v_motorcycle;
  SELECT operation_id INTO v_operation_id FROM public.finance_motorcycle_purchase_links WHERE motorcycle_id = v_motorcycle.id;
  IF v_price > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_wallet_id, 'EXPENSE', v_price, COALESCE(v_motorcycle.date_achat, current_date),
      'ACHAT DE MOTO', 'Achat de la moto ' || v_motorcycle.immatriculation,
      'MOTORCYCLE_PURCHASE', 'MOTORCYCLE', v_motorcycle.id, NULL, NULL,
      v_motorcycle.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    IF v_operation_id IS NULL THEN INSERT INTO public.finance_motorcycle_purchase_links(operation_id, motorcycle_id) VALUES (v_operation.id, v_motorcycle.id); END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;
  PERFORM public.business_finance_audit_event('MOTORCYCLE_PURCHASE', v_motorcycle.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_motorcycle));
  RETURN v_motorcycle;
END;
$update_motorcycle$;

CREATE OR REPLACE FUNCTION public.delete_motorcycle_with_purchase(p_motorcycle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_motorcycle$
DECLARE
  v_motorcycle public.motorcycles;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_other_operations integer;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_motorcycle FROM public.motorcycles WHERE id = p_motorcycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moto introuvable.' USING ERRCODE = 'P0002'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_motorcycle_purchase_links WHERE motorcycle_id = p_motorcycle_id;
  SELECT count(*) INTO v_other_operations FROM public.finance_operations
  WHERE motorcycle_id = p_motorcycle_id AND (v_operation_id IS NULL OR id <> v_operation_id);
  IF v_other_operations > 0 THEN RAISE EXCEPTION 'Cette moto possède des opérations financières historiques et ne peut pas être supprimée.' USING ERRCODE = '23503'; END IF;
  IF v_operation_id IS NOT NULL THEN v_operation := public.business_cancel_finance_operation(v_operation_id); END IF;
  PERFORM public.business_finance_audit_event('MOTORCYCLE_PURCHASE', p_motorcycle_id, v_operation.id, 'DELETE', to_jsonb(v_motorcycle), NULL);
  DELETE FROM public.motorcycles WHERE id = p_motorcycle_id;
  RETURN true;
END;
$delete_motorcycle$;

CREATE OR REPLACE FUNCTION public.create_vehicle_with_purchase(p_vehicle jsonb)
RETURNS public.vehicles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $create_vehicle$
DECLARE
  v_vehicle public.vehicles;
  v_operation public.finance_operations;
  v_price numeric(14, 2) := COALESCE(NULLIF(p_vehicle ->> 'purchase_price', '')::numeric, 0);
  v_wallet_id uuid := NULLIF(p_vehicle ->> 'purchase_wallet_id', '')::uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_price > 0 AND v_wallet_id IS NULL THEN RAISE EXCEPTION 'Un wallet d''achat est obligatoire pour un véhicule acheté.' USING ERRCODE = '22023'; END IF;
  IF v_price = 0 AND v_wallet_id IS NOT NULL THEN RAISE EXCEPTION 'Un véhicule sans prix d''achat ne doit pas sélectionner de wallet.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.vehicles(
    registration, brand, chassis_number, model, type, color, year, kilometrage,
    status, purchase_price, purchase_date, purchase_wallet_id, supplier,
    description, driver_id, engine_number, photo_url
  ) VALUES (
    NULLIF(trim(p_vehicle ->> 'registration'), ''), NULLIF(trim(p_vehicle ->> 'brand'), ''),
    NULLIF(trim(p_vehicle ->> 'chassis_number'), ''), NULLIF(trim(p_vehicle ->> 'model'), ''),
    NULLIF(trim(p_vehicle ->> 'type'), ''), NULLIF(trim(p_vehicle ->> 'color'), ''),
    NULLIF(p_vehicle ->> 'year', '')::integer, NULLIF(p_vehicle ->> 'kilometrage', '')::integer,
    COALESCE(NULLIF(p_vehicle ->> 'status', ''), 'EN_SERVICE'), NULLIF(p_vehicle ->> 'purchase_price', '')::numeric,
    NULLIF(p_vehicle ->> 'purchase_date', '')::date, v_wallet_id, NULLIF(trim(p_vehicle ->> 'supplier'), ''),
    NULLIF(trim(p_vehicle ->> 'description'), ''), NULLIF(p_vehicle ->> 'driver_id', '')::uuid,
    NULLIF(trim(p_vehicle ->> 'engine_number'), ''), NULLIF(trim(p_vehicle ->> 'photo_url'), '')
  ) RETURNING * INTO v_vehicle;
  IF v_price > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      NULL, v_wallet_id, 'EXPENSE', v_price, COALESCE(v_vehicle.purchase_date, current_date),
      'ACHAT DE VEHICULE', 'Achat du véhicule ' || v_vehicle.registration,
      'VEHICLE_PURCHASE', 'VEHICLE', v_vehicle.id, v_vehicle.id, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_vehicle.supplier, NULL, NULL
    );
    INSERT INTO public.finance_links(finance_operation_id, module, module_record_id)
    VALUES (v_operation.id, 'VEHICLE', v_vehicle.id);
  END IF;
  PERFORM public.business_finance_audit_event('VEHICLE_PURCHASE', v_vehicle.id, v_operation.id, 'CREATE', NULL, to_jsonb(v_vehicle));
  RETURN v_vehicle;
END;
$create_vehicle$;

CREATE OR REPLACE FUNCTION public.update_vehicle_with_purchase(p_vehicle jsonb)
RETURNS public.vehicles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_vehicle$
DECLARE
  v_before public.vehicles;
  v_vehicle public.vehicles;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_price numeric(14, 2) := COALESCE(NULLIF(p_vehicle ->> 'purchase_price', '')::numeric, 0);
  v_wallet_id uuid := NULLIF(p_vehicle ->> 'purchase_wallet_id', '')::uuid;
BEGIN
  PERFORM public.business_finance_require_write_role();
  IF v_price > 0 AND v_wallet_id IS NULL THEN RAISE EXCEPTION 'Un wallet d''achat est obligatoire pour un véhicule acheté.' USING ERRCODE = '22023'; END IF;
  IF v_price = 0 AND v_wallet_id IS NOT NULL THEN RAISE EXCEPTION 'Un véhicule sans prix d''achat ne doit pas sélectionner de wallet.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.vehicles WHERE id = NULLIF(p_vehicle ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Véhicule introuvable.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.vehicles
  SET registration = NULLIF(trim(p_vehicle ->> 'registration'), ''), brand = NULLIF(trim(p_vehicle ->> 'brand'), ''),
      chassis_number = NULLIF(trim(p_vehicle ->> 'chassis_number'), ''), model = NULLIF(trim(p_vehicle ->> 'model'), ''),
      type = NULLIF(trim(p_vehicle ->> 'type'), ''), color = NULLIF(trim(p_vehicle ->> 'color'), ''),
      year = NULLIF(p_vehicle ->> 'year', '')::integer, kilometrage = NULLIF(p_vehicle ->> 'kilometrage', '')::integer,
      status = COALESCE(NULLIF(p_vehicle ->> 'status', ''), 'EN_SERVICE'),
      purchase_price = NULLIF(p_vehicle ->> 'purchase_price', '')::numeric,
      purchase_date = NULLIF(p_vehicle ->> 'purchase_date', '')::date,
      purchase_wallet_id = v_wallet_id, supplier = NULLIF(trim(p_vehicle ->> 'supplier'), ''),
      description = NULLIF(trim(p_vehicle ->> 'description'), ''), driver_id = NULLIF(p_vehicle ->> 'driver_id', '')::uuid,
      engine_number = NULLIF(trim(p_vehicle ->> 'engine_number'), ''), photo_url = NULLIF(trim(p_vehicle ->> 'photo_url'), ''),
      updated_at = now()
  WHERE id = v_before.id RETURNING * INTO v_vehicle;
  SELECT finance_operation_id INTO v_operation_id FROM public.finance_links
  WHERE module = 'VEHICLE' AND module_record_id = v_vehicle.id;
  IF v_price > 0 THEN
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_wallet_id, 'EXPENSE', v_price, COALESCE(v_vehicle.purchase_date, current_date),
      'ACHAT DE VEHICULE', 'Achat du véhicule ' || v_vehicle.registration,
      'VEHICLE_PURCHASE', 'VEHICLE', v_vehicle.id, v_vehicle.id, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_vehicle.supplier, NULL, NULL
    );
    IF v_operation_id IS NULL THEN
      INSERT INTO public.finance_links(finance_operation_id, module, module_record_id)
      VALUES (v_operation.id, 'VEHICLE', v_vehicle.id);
    END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;
  PERFORM public.business_finance_audit_event('VEHICLE_PURCHASE', v_vehicle.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_vehicle));
  RETURN v_vehicle;
END;
$update_vehicle$;

CREATE OR REPLACE FUNCTION public.delete_vehicle_with_purchase(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $delete_vehicle$
DECLARE
  v_vehicle public.vehicles;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_other_operations integer;
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Véhicule introuvable.' USING ERRCODE = 'P0002'; END IF;
  SELECT finance_operation_id INTO v_operation_id FROM public.finance_links WHERE module = 'VEHICLE' AND module_record_id = p_vehicle_id;
  SELECT count(*) INTO v_other_operations FROM public.finance_operations
  WHERE vehicle_id = p_vehicle_id AND (v_operation_id IS NULL OR id <> v_operation_id);
  IF v_other_operations > 0 THEN RAISE EXCEPTION 'Ce véhicule possède des opérations financières historiques et ne peut pas être supprimé.' USING ERRCODE = '23503'; END IF;
  IF v_operation_id IS NOT NULL THEN v_operation := public.business_cancel_finance_operation(v_operation_id); END IF;
  PERFORM public.business_finance_audit_event('VEHICLE_PURCHASE', p_vehicle_id, v_operation.id, 'DELETE', to_jsonb(v_vehicle), NULL);
  DELETE FROM public.finance_links WHERE module = 'VEHICLE' AND module_record_id = p_vehicle_id;
  DELETE FROM public.vehicles WHERE id = p_vehicle_id;
  RETURN true;
END;
$delete_vehicle$;

CREATE OR REPLACE FUNCTION public.update_stock_movement_with_finance(p_movement jsonb)
RETURNS public.stock_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $update_stock_movement$
DECLARE
  v_before public.stock_movements;
  v_movement public.stock_movements;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_type text := upper(trim(COALESCE(p_movement ->> 'movement_type', '')));
  v_wallet_id uuid := NULLIF(p_movement ->> 'wallet_id', '')::uuid;
  v_amount numeric(14, 2);
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.stock_movements WHERE id = NULLIF(p_movement ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mouvement de stock introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RAISE EXCEPTION 'Un mouvement annulé ne peut pas être modifié.' USING ERRCODE = '22023'; END IF;
  UPDATE public.inventory_items SET stock_actuel = stock_actuel - public.stock_movement_delta(v_before.movement_type, v_before.quantity), updated_at = now()
  WHERE id = v_before.inventory_item_id AND stock_actuel - public.stock_movement_delta(v_before.movement_type, v_before.quantity) >= 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'La mise à jour créerait un stock négatif.' USING ERRCODE = '22023'; END IF;
  UPDATE public.stock_movements
  SET inventory_item_id = NULLIF(p_movement ->> 'inventory_item_id', '')::uuid, movement_type = v_type,
      quantity = NULLIF(p_movement ->> 'quantity', '')::numeric, unit_price = NULLIF(p_movement ->> 'unit_price', '')::numeric,
      wallet_id = v_wallet_id, movement_date = COALESCE(NULLIF(p_movement ->> 'movement_date', '')::date, current_date),
      supplier = NULLIF(trim(p_movement ->> 'supplier'), ''), client = NULLIF(trim(p_movement ->> 'client'), ''),
      reference = NULLIF(trim(p_movement ->> 'reference'), ''), description = NULLIF(trim(p_movement ->> 'description'), ''), updated_at = now()
  WHERE id = v_before.id RETURNING * INTO v_movement;
  UPDATE public.inventory_items SET stock_actuel = stock_actuel + public.stock_movement_delta(v_movement.movement_type, v_movement.quantity), updated_at = now()
  WHERE id = v_movement.inventory_item_id AND stock_actuel + public.stock_movement_delta(v_movement.movement_type, v_movement.quantity) >= 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'La mise à jour créerait un stock négatif.' USING ERRCODE = '22023'; END IF;
  SELECT operation_id INTO v_operation_id FROM public.finance_stock_movement_links WHERE stock_movement_id = v_movement.id;
  IF v_movement.movement_type IN ('PURCHASE', 'SALE') THEN
    v_amount := v_movement.quantity * v_movement.unit_price;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Un achat ou une vente doit avoir un montant strictement positif.' USING ERRCODE = '22023'; END IF;
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_movement.wallet_id,
      CASE WHEN v_movement.movement_type = 'PURCHASE' THEN 'EXPENSE' ELSE 'REVENUE' END,
      v_amount, v_movement.movement_date,
      CASE WHEN v_movement.movement_type = 'PURCHASE' THEN 'ACHAT DE STOCK' ELSE 'VENTE DE STOCK' END,
      COALESCE(v_movement.description, CASE WHEN v_movement.movement_type = 'PURCHASE' THEN 'Achat de stock' ELSE 'Vente de stock' END),
      'STOCK_MOVEMENT', 'STOCK_MOVEMENT', v_movement.id, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, v_movement.inventory_item_id,
      v_movement.supplier, v_movement.client, v_movement.reference
    );
    IF v_operation_id IS NULL THEN INSERT INTO public.finance_stock_movement_links(operation_id, stock_movement_id) VALUES (v_operation.id, v_movement.id); END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;
  PERFORM public.business_finance_audit_event('STOCK_MOVEMENT', v_movement.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_movement));
  RETURN v_movement;
END;
$update_stock_movement$;

-- Tighten the accidental permissive maintenance policy and expose only the
-- read paths of new relations. All writes are performed by the RPCs above.
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.motorcycle_maintenances;

ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_finance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_harvest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_motorcycle_maintenance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_vehicle_maintenance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_motorcycle_purchase_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_salary_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_stock_movement_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY salary_payments_read ON public.salary_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_movements_read ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY business_finance_audit_read ON public.business_finance_audit FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]));
CREATE POLICY finance_harvest_links_read ON public.finance_harvest_links FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_motorcycle_maintenance_links_read ON public.finance_motorcycle_maintenance_links FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_vehicle_maintenance_links_read ON public.finance_vehicle_maintenance_links FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_motorcycle_purchase_links_read ON public.finance_motorcycle_purchase_links FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_salary_links_read ON public.finance_salary_links FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_stock_movement_links_read ON public.finance_stock_movement_links FOR SELECT TO authenticated USING (true);

REVOKE ALL ON FUNCTION public.business_finance_require_write_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_finance_audit_event(text, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_upsert_finance_operation(uuid, uuid, text, numeric, date, text, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_cancel_finance_operation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stock_movement_delta(text, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_harvest_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_harvest_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_harvest_with_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_motorcycle_maintenance_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_motorcycle_maintenance_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_motorcycle_maintenance_with_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vehicle_maintenance_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_maintenance_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vehicle_maintenance_with_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_motorcycle_with_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_motorcycle_with_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_motorcycle_with_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vehicle_with_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_with_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vehicle_with_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_salary_payment_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_salary_payment_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_salary_payment_with_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_stock_movement_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_stock_movement_with_finance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stock_movement_with_finance(uuid) TO authenticated;
