-- The initial LOT 5 stock RPC passed one legacy nullable entity slot before
-- inventory_item_id. Keep the public helper backward compatible while routing
-- the call to the canonical 23-argument implementation.

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
  p_vehicle_id uuid,
  p_farm_id uuid,
  p_motorcycle_id uuid,
  p_employee_id uuid,
  p_driver_id uuid,
  p_contract_id uuid,
  p_harvest_id uuid,
  p_maintenance_id uuid,
  p_motorcycle_maintenance_id uuid,
  p_legacy_unused_id uuid,
  p_inventory_item_id uuid,
  p_supplier text,
  p_client text,
  p_reference text
)
RETURNS public.finance_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $compatibility_wrapper$
BEGIN
  RETURN public.business_upsert_finance_operation(
    p_operation_id, p_wallet_id, p_type, p_amount, p_operation_date,
    p_category, p_description, p_origin, p_module, p_module_id,
    p_vehicle_id, p_farm_id, p_motorcycle_id, p_employee_id, p_driver_id,
    p_contract_id, p_harvest_id, p_maintenance_id,
    p_motorcycle_maintenance_id, p_inventory_item_id, p_supplier, p_client,
    p_reference
  );
END;
$compatibility_wrapper$;

REVOKE ALL ON FUNCTION public.business_upsert_finance_operation(uuid, uuid, text, numeric, date, text, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC;
