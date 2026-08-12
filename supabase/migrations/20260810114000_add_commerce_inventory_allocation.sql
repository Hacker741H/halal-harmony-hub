-- CM-04: place existing ERP inventory in a Commerce location without changing
-- the global physical stock or creating a financial movement.

CREATE OR REPLACE FUNCTION public.get_commerce_inventory_catalogue(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.stock.receive');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'name', item.nom,
    'sku', item.sku,
    'unit', item.unite,
    'globalQuantity', item.stock_actuel,
    'locationQuantity', COALESCE(local_item.quantity, 0),
    'availableToAllocate', GREATEST(item.stock_actuel - COALESCE(allocated.quantity, 0), 0),
    'salePrice', local_item.sale_price,
    'reorderLevel', local_item.reorder_level
  ) ORDER BY item.nom), '[]'::jsonb)
  INTO v_result
  FROM public.inventory_items item
  LEFT JOIN public.business_location_inventory_items local_item
    ON local_item.inventory_item_id = item.id
   AND local_item.business_location_id = p_location_id
  LEFT JOIN LATERAL (
    SELECT sum(quantity) AS quantity
    FROM public.business_location_inventory_items
    WHERE inventory_item_id = item.id
  ) allocated ON true
  WHERE item.is_active;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.configure_commerce_location_item(p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_item ->> 'business_location_id', '')::uuid;
  v_item_id uuid := NULLIF(p_item ->> 'inventory_item_id', '')::uuid;
  v_quantity numeric(14,3) := NULLIF(p_item ->> 'quantity', '')::numeric;
  v_price numeric(14,2) := NULLIF(p_item ->> 'sale_price', '')::numeric;
  v_reorder_level numeric(14,3) := NULLIF(p_item ->> 'reorder_level', '')::numeric;
  v_inventory public.inventory_items;
  v_existing public.business_location_inventory_items;
  v_allocated_elsewhere numeric(14,3);
  v_result public.business_location_inventory_items;
BEGIN
  PERFORM public.permission_require('commerce.stock.receive');
  IF v_location_id IS NULL OR v_item_id IS NULL OR v_quantity IS NULL OR v_quantity < 0
    OR v_price IS NULL OR v_price < 0 OR (v_reorder_level IS NOT NULL AND v_reorder_level < 0) THEN
    RAISE EXCEPTION 'Article, quantité, prix ou seuil invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_locations location_row
    JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
    WHERE location_row.id = v_location_id AND location_row.status = 'ACTIVE' AND unit_row.code = 'COMMERCE'
  ) THEN
    RAISE EXCEPTION 'Magasin Commerce actif introuvable.' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_inventory FROM public.inventory_items WHERE id = v_item_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Article de stock actif introuvable.' USING ERRCODE = '23503';
  END IF;
  SELECT * INTO v_existing FROM public.business_location_inventory_items
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id FOR UPDATE;
  SELECT COALESCE(sum(quantity), 0) INTO v_allocated_elsewhere
  FROM public.business_location_inventory_items
  WHERE inventory_item_id = v_item_id AND business_location_id <> v_location_id;

  IF v_quantity + v_allocated_elsewhere > v_inventory.stock_actuel THEN
    RAISE EXCEPTION 'La quantité affectée dépasse le stock global disponible.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.business_location_inventory_items(
    business_location_id, inventory_item_id, quantity, sale_price, reorder_level
  ) VALUES (v_location_id, v_item_id, v_quantity, v_price, v_reorder_level)
  ON CONFLICT (business_location_id, inventory_item_id) DO UPDATE
  SET quantity = EXCLUDED.quantity,
      sale_price = EXCLUDED.sale_price,
      reorder_level = EXCLUDED.reorder_level,
      updated_at = now()
  RETURNING * INTO v_result;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_LOCATION_INVENTORY', v_result.id, NULL, 'CONFIGURE',
    CASE WHEN v_existing.id IS NULL THEN NULL ELSE to_jsonb(v_existing) END,
    to_jsonb(v_result)
  );
  RETURN jsonb_build_object('id', v_result.id, 'quantity', v_result.quantity, 'salePrice', v_result.sale_price);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_inventory_catalogue(uuid), public.configure_commerce_location_item(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_inventory_catalogue(uuid), public.configure_commerce_location_item(jsonb) TO authenticated;
