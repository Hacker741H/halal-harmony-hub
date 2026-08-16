-- GFC V1 Phase 4D -- fixes a real idempotence gap caught by the mandatory
-- E2E test (scenario G, retry dispatch): dispatch_commerce_stock_transfer
-- only treated status='DISPATCHED' as an already-done no-op. A retry that
-- arrives after the transfer has ALSO already been received (a realistic
-- delayed/offline retry, since dispatch and receive are two different
-- physical locations/users and this app's whole architecture assumes
-- retries can be arbitrarily late) fell through to the "must be CREATED"
-- guard and raised instead of returning the current state. status='RECEIVED'
-- is added to the idempotent early-return; status='CANCELLED' deliberately
-- stays a hard rejection so a stale dispatch retry can never resurrect a
-- cancelled transfer and silently move stock.

CREATE OR REPLACE FUNCTION public.dispatch_commerce_stock_transfer(p_transfer_id uuid)
 RETURNS commerce_stock_transfers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_transfer public.commerce_stock_transfers;
  v_line record;
  v_unit_cost numeric(14, 4);
  v_movement public.stock_movements;
BEGIN
  PERFORM public.permission_require('transfers.dispatch');
  SELECT * INTO v_transfer FROM public.commerce_stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_transfer.status IN ('DISPATCHED', 'RECEIVED') THEN RETURN v_transfer; END IF;
  IF v_transfer.status <> 'CREATED' THEN RAISE EXCEPTION 'Seul un transfert créé peut être expédié.' USING ERRCODE = '22023'; END IF;
  IF NOT public.commerce_location_access_allowed(v_transfer.source_location_id) THEN
    RAISE EXCEPTION 'Accès refusé au magasin source.' USING ERRCODE = '42501';
  END IF;

  FOR v_line IN SELECT * FROM public.commerce_stock_transfer_lines WHERE transfer_id = p_transfer_id FOR UPDATE
  LOOP
    SELECT current_unit_cost INTO v_unit_cost
    FROM public.commerce_inventory_cost_states
    WHERE business_location_id = v_transfer.source_location_id AND inventory_item_id = v_line.inventory_item_id;
    IF v_unit_cost IS NULL THEN
      RAISE EXCEPTION 'Aucun coût initialisé pour un article du transfert -- un coût d''ouverture est requis avant tout transfert.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.stock_movements(
      inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
      movement_date, reference, description, created_by
    ) VALUES (
      v_line.inventory_item_id, 'TRANSFER_OUT', v_line.quantity_requested, v_unit_cost, NULL, v_transfer.source_location_id,
      current_date, v_transfer.transfer_number, 'Transfert vers magasin destination -- ' || v_transfer.transfer_number, auth.uid()
    ) RETURNING * INTO v_movement;

    UPDATE public.business_location_inventory_items
    SET quantity = quantity - v_line.quantity_requested, updated_at = now()
    WHERE business_location_id = v_transfer.source_location_id AND inventory_item_id = v_line.inventory_item_id
      AND quantity - v_line.quantity_requested >= 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock source insuffisant pour ce transfert.' USING ERRCODE = '22023'; END IF;

    UPDATE public.inventory_items SET stock_actuel = stock_actuel - v_line.quantity_requested, updated_at = now() WHERE id = v_line.inventory_item_id;

    PERFORM public._internal_apply_commerce_inventory_valuation(
      v_transfer.source_location_id, v_line.inventory_item_id, -v_line.quantity_requested, v_unit_cost,
      'TRANSFER_OUT', v_movement.id, 'Transfert ' || v_transfer.transfer_number, auth.uid()
    );

    UPDATE public.commerce_stock_transfer_lines
    SET unit_cost = v_unit_cost, dispatch_stock_movement_id = v_movement.id, updated_at = now()
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.commerce_stock_transfers
  SET status = 'DISPATCHED', dispatched_by = auth.uid(), dispatched_at = now(), updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  PERFORM public.business_finance_audit_event('COMMERCE_STOCK_TRANSFER', v_transfer.id, NULL, 'DEPARTURE', NULL, to_jsonb(v_transfer));
  RETURN v_transfer;
END;
$function$;
