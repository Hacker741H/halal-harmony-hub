-- GFC V1 Phase 2 validation gate -- business_upsert_finance_operation
-- hardcoded `p_type NOT IN ('REVENUE', 'EXPENSE')` since its creation,
-- which is why confirm_commerce_pos_cash_reception had to bypass it with
-- a raw INSERT to be able to write type='DEPOSIT'. The migration just
-- before this one (20260816140000) switched commercial invoice payment
-- confirmation to DEPOSIT to fix a real Finance double-count (see that
-- migration's own comment), but never actually worked: every real call
-- would hit this exact CHECK and fail with "Type financier metier
-- invalide : DEPOSIT" -- caught immediately by the mandatory E2E test
-- before this was ever pushed.
--
-- Fix: widen the allow-list to ('REVENUE', 'EXPENSE', 'DEPOSIT'). TRANSFER
-- deliberately stays excluded -- this function's INSERT never had a
-- destination_wallet_id column to begin with, so it structurally cannot
-- represent a transfer; DEPOSIT has no such requirement (POS's own DEPOSIT
-- insert also leaves destination_wallet_id NULL), so it fits cleanly.
-- Zero behavior change for any existing caller: every current call site
-- (store expenses, stock/vehicle/motorcycle purchases and reversals,
-- salary payments, harvest/stock sales) already only ever used REVENUE or
-- EXPENSE, since DEPOSIT/TRANSFER were never legal here before.

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

  IF p_type NOT IN ('REVENUE', 'EXPENSE', 'DEPOSIT') THEN
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
