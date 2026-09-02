-- Commerce simplification, Phase 1: a standalone stock write-off
-- (perte/casse/peremption), the one gesture that was entirely missing from
-- Commerce -- confirmed by exhaustive search before writing this migration.
-- Modeled line-for-line on complete_commerce_inventory_count's
-- ADJUSTMENT_OUT branch (20260817110000_add_commerce_inventory_counts.sql):
-- same CUMP lock, same dual quantity write, same
-- _internal_apply_commerce_inventory_valuation call, same "no Finance
-- operation, ever" rule (nothing was paid, so nothing financial happens --
-- confirmed with the user). Unlike a count, this is a single, standalone
-- action for one article at a time, with a mandatory reason, not a full
-- recount workflow.
--
-- Gated on commerce.stock.receive -- the same permission that already
-- gates the closest existing precedent (CommerceInventorySetup /
-- configure_commerce_location_item, "Mettre en rayon", also touches only
-- location stock, no wallet). Deliberately reuses it instead of adding a
-- new permission code, so this migration touches zero role_permissions rows.

-- WRITE_OFF joins the same event-type family as ADJUSTMENT_DEFICIT/
-- TRANSFER_OUT (stock_movement_id set, sale_line_id null) -- the exact
-- pattern already used to add SALE_RETURN in
-- 20260818100000_add_commerce_sale_returns.sql.
ALTER TABLE public.commerce_inventory_cost_events DROP CONSTRAINT commerce_cost_event_one_source;
ALTER TABLE public.commerce_inventory_cost_events ADD CONSTRAINT commerce_cost_event_one_source CHECK (
  (event_type = 'SALE' AND sale_line_id IS NOT NULL AND stock_movement_id IS NULL)
  OR (event_type IN ('PURCHASE', 'ADJUSTMENT_SURPLUS', 'ADJUSTMENT_DEFICIT', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_RETURN', 'WRITE_OFF') AND stock_movement_id IS NOT NULL AND sale_line_id IS NULL)
  OR (event_type = 'OPENING' AND stock_movement_id IS NULL AND sale_line_id IS NULL)
);

ALTER TABLE public.commerce_inventory_cost_events DROP CONSTRAINT commerce_inventory_cost_events_event_type_check;
ALTER TABLE public.commerce_inventory_cost_events ADD CONSTRAINT commerce_inventory_cost_events_event_type_check CHECK (
  event_type = ANY (ARRAY['OPENING'::text, 'PURCHASE'::text, 'SALE'::text, 'ADJUSTMENT_SURPLUS'::text, 'ADJUSTMENT_DEFICIT'::text, 'TRANSFER_OUT'::text, 'TRANSFER_IN'::text, 'SALE_RETURN'::text, 'WRITE_OFF'::text])
);

CREATE OR REPLACE FUNCTION public.write_off_commerce_inventory_item(p_writeoff jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_writeoff ->> 'business_location_id', '')::uuid;
  v_item_id uuid := NULLIF(p_writeoff ->> 'inventory_item_id', '')::uuid;
  v_quantity numeric(14, 3) := NULLIF(p_writeoff ->> 'quantity', '')::numeric;
  v_reason text := NULLIF(btrim(p_writeoff ->> 'reason'), '');
  v_unit_cost numeric(14, 4);
  v_movement public.stock_movements;
  v_location_item public.business_location_inventory_items;
BEGIN
  PERFORM public.permission_require('commerce.stock.receive');

  IF v_location_id IS NULL OR v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Magasin, article, quantite ou motif invalide.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;

  SELECT current_unit_cost INTO v_unit_cost
  FROM public.commerce_inventory_cost_states
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id
  FOR UPDATE;
  IF v_unit_cost IS NULL THEN
    RAISE EXCEPTION 'Aucun cout initialise pour cet article a ce magasin -- impossible de retirer un stock jamais recu ici.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stock_movements(
    inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
    movement_date, reference, description, created_by
  ) VALUES (
    v_item_id, 'LOSS', v_quantity, v_unit_cost, NULL, v_location_id,
    current_date, NULL, 'Retrait de stock -- ' || v_reason, auth.uid()
  ) RETURNING * INTO v_movement;

  UPDATE public.business_location_inventory_items
  SET quantity = quantity - v_quantity, updated_at = now()
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id AND quantity - v_quantity >= 0
  RETURNING * INTO v_location_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock insuffisant pour ce retrait.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_items SET stock_actuel = stock_actuel - v_quantity, updated_at = now() WHERE id = v_item_id;

  PERFORM public._internal_apply_commerce_inventory_valuation(
    v_location_id, v_item_id, -v_quantity, v_unit_cost, 'WRITE_OFF', v_movement.id, v_reason, auth.uid()
  );

  PERFORM public.business_finance_audit_event(
    'COMMERCE_INVENTORY_WRITEOFF', v_location_item.id, NULL, 'CREATE', NULL,
    jsonb_build_object(
      'location_id', v_location_id, 'inventory_item_id', v_item_id,
      'stock_movement_id', v_movement.id, 'quantity', v_quantity, 'unit_cost', v_unit_cost, 'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'inventoryItemId', v_item_id, 'stockMovementId', v_movement.id,
    'locationInventoryId', v_location_item.id, 'quantity', v_location_item.quantity, 'reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.write_off_commerce_inventory_item(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_off_commerce_inventory_item(jsonb) TO authenticated;

-- Phase 1 also fixes the restock click-path: prefilling purchaseUnitPrice
-- needs the last known CUMP cost, which the catalogue didn't expose.
-- Purely additive key (lastUnitCost, nullable -- an item never received at
-- this location has no cost-state yet); every existing caller (the receipt
-- dialog's own "new" mode, "Mettre en rayon") already ignores unknown keys.
CREATE OR REPLACE FUNCTION public.get_commerce_inventory_catalogue(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.stock.receive');

  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
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
    'reorderLevel', local_item.reorder_level,
    'lastUnitCost', cost_state.current_unit_cost
  ) ORDER BY item.nom), '[]'::jsonb)
  INTO v_result
  FROM public.inventory_items item
  LEFT JOIN public.business_location_inventory_items local_item
    ON local_item.inventory_item_id = item.id
   AND local_item.business_location_id = p_location_id
  LEFT JOIN public.commerce_inventory_cost_states cost_state
    ON cost_state.inventory_item_id = item.id
   AND cost_state.business_location_id = p_location_id
  LEFT JOIN LATERAL (
    SELECT sum(quantity) AS quantity
    FROM public.business_location_inventory_items
    WHERE inventory_item_id = item.id
  ) allocated ON true;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_inventory_catalogue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_inventory_catalogue(uuid) TO authenticated;
