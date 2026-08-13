-- STORE-02 validation fix: inventory_items has no is_active column.
-- Preserve the established receipt/Finance workflow and only correct the
-- existing-item lookup used by a Commerce restock.

CREATE OR REPLACE FUNCTION public.receive_commerce_inventory_item(p_receipt jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_receipt ->> 'business_location_id', '')::uuid;
  v_inventory_item_id uuid := NULLIF(p_receipt ->> 'inventory_item_id', '')::uuid;
  v_wallet_id uuid := NULLIF(p_receipt ->> 'wallet_id', '')::uuid;
  v_name text := NULLIF(btrim(p_receipt ->> 'name'), '');
  v_category text := NULLIF(btrim(p_receipt ->> 'category'), '');
  v_sku text := NULLIF(btrim(p_receipt ->> 'sku'), '');
  v_unit text := NULLIF(btrim(p_receipt ->> 'unit'), '');
  v_supplier text := NULLIF(btrim(p_receipt ->> 'supplier'), '');
  v_reference text := NULLIF(btrim(p_receipt ->> 'reference'), '');
  v_quantity numeric(14, 3) := NULLIF(p_receipt ->> 'quantity', '')::numeric;
  v_purchase_unit_price numeric(14, 2) := NULLIF(p_receipt ->> 'purchase_unit_price', '')::numeric;
  v_sale_price numeric(14, 2) := NULLIF(p_receipt ->> 'sale_price', '')::numeric;
  v_reorder_level numeric(14, 3) := NULLIF(p_receipt ->> 'reorder_level', '')::numeric;
  v_movement_date date := COALESCE(NULLIF(p_receipt ->> 'movement_date', '')::date, current_date);
  v_item public.inventory_items;
  v_movement public.stock_movements;
  v_location_item public.business_location_inventory_items;
BEGIN
  PERFORM public.permission_require('commerce.stock.receive');

  IF p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object'
    OR v_location_id IS NULL OR v_wallet_id IS NULL
    OR v_quantity IS NULL OR v_quantity <= 0
    OR v_purchase_unit_price IS NULL OR v_purchase_unit_price <= 0
    OR v_sale_price IS NULL OR v_sale_price < 0
    OR (v_reorder_level IS NOT NULL AND v_reorder_level < 0) THEN
    RAISE EXCEPTION 'Produit, magasin, quantite, prix ou wallet invalide.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_locations location_row
    JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
    WHERE location_row.id = v_location_id AND location_row.status = 'ACTIVE'
      AND unit_row.code = 'COMMERCE'
  ) THEN
    RAISE EXCEPTION 'Magasin Commerce actif introuvable.' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Wallet debite introuvable.' USING ERRCODE = '23503';
  END IF;

  IF v_inventory_item_id IS NULL THEN
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Le nom du nouvel article est obligatoire.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.inventory_items WHERE lower(nom) = lower(v_name)) THEN
      RAISE EXCEPTION 'Cet article existe deja. Choisissez Reapprovisionner pour enregistrer un nouvel achat.' USING ERRCODE = '23505';
    END IF;
    IF v_sku IS NOT NULL AND EXISTS (SELECT 1 FROM public.inventory_items WHERE lower(sku) = lower(v_sku)) THEN
      RAISE EXCEPTION 'Cette reference article existe deja.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.inventory_items(nom, categorie, sku, unite, stock_actuel, seuil_alerte)
    VALUES (v_name, v_category, v_sku, COALESCE(v_unit, 'Piece'), 0, v_reorder_level)
    RETURNING * INTO v_item;
  ELSE
    SELECT * INTO v_item FROM public.inventory_items
    WHERE id = v_inventory_item_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Article introuvable.' USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT * INTO v_movement
  FROM public.create_stock_movement_with_finance(jsonb_build_object(
    'inventory_item_id', v_item.id, 'movement_type', 'PURCHASE',
    'quantity', v_quantity, 'unit_price', v_purchase_unit_price,
    'wallet_id', v_wallet_id, 'movement_date', v_movement_date,
    'supplier', v_supplier, 'client', NULL, 'reference', v_reference,
    'description', 'Reception Commerce - ' || v_item.nom
  ));

  UPDATE public.stock_movements
  SET business_location_id = v_location_id, updated_at = now()
  WHERE id = v_movement.id
  RETURNING * INTO v_movement;

  INSERT INTO public.business_location_inventory_items(
    business_location_id, inventory_item_id, quantity, sale_price, reorder_level
  ) VALUES (
    v_location_id, v_item.id, v_quantity, v_sale_price,
    COALESCE(v_reorder_level, v_item.seuil_alerte)
  )
  ON CONFLICT (business_location_id, inventory_item_id) DO UPDATE
  SET quantity = public.business_location_inventory_items.quantity + EXCLUDED.quantity,
      sale_price = EXCLUDED.sale_price,
      reorder_level = COALESCE(EXCLUDED.reorder_level, public.business_location_inventory_items.reorder_level),
      updated_at = now()
  RETURNING * INTO v_location_item;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_INVENTORY_RECEIPT', v_location_item.id, NULL, 'CREATE', NULL,
    jsonb_build_object(
      'location_id', v_location_id, 'inventory_item_id', v_item.id,
      'stock_movement_id', v_movement.id, 'wallet_id', v_wallet_id,
      'quantity', v_quantity, 'purchase_unit_price', v_purchase_unit_price,
      'sale_price', v_sale_price
    )
  );

  RETURN jsonb_build_object(
    'inventoryItemId', v_item.id, 'stockMovementId', v_movement.id,
    'locationInventoryId', v_location_item.id, 'quantity', v_location_item.quantity,
    'salePrice', v_location_item.sale_price
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_commerce_inventory_item(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_commerce_inventory_item(jsonb) TO authenticated;
