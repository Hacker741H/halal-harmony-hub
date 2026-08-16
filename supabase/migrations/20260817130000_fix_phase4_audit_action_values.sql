-- GFC V1 Phase 4D -- fixes a bug in the just-applied Phase 4B/4C
-- migrations, caught immediately by the mandatory E2E test before any
-- frontend work: business_finance_audit_event was called with action
-- values ('COMPLETE', 'DISPATCH', 'RECEIVE') that don't exist in
-- business_finance_audit_action_check's allow-list (CREATE/UPDATE/CANCEL/
-- DELETE/CLOSE/ARCHIVE/RESTORE/REPLACE/ASSIGN/UNASSIGN/MERGE/DEPARTURE/
-- DELIVERY/CORRECT/CONFIRM). Mapped to the closest existing values:
-- completing a count is a validation -> 'CONFIRM' (same word already used
-- by confirm_commercial_invoice_payment's own audit trail); dispatching a
-- transfer -> 'DEPARTURE' and receiving one -> 'DELIVERY' (both already in
-- the allow-list for exactly this shipment-left/shipment-arrived
-- semantic, reused rather than adding new values).

CREATE OR REPLACE FUNCTION public.complete_commerce_inventory_count(p_count_id uuid)
RETURNS public.commerce_inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_count public.commerce_inventory_counts;
  v_line record;
  v_delta numeric(14, 3);
  v_unit_cost numeric(14, 4);
  v_movement_type text;
  v_movement public.stock_movements;
BEGIN
  PERFORM public.permission_require('inventory.counts.complete');
  SELECT * INTO v_count FROM public.commerce_inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status = 'COMPLETED' THEN RETURN v_count; END IF;
  IF v_count.status <> 'OPEN' THEN RAISE EXCEPTION 'Seul un inventaire ouvert peut être validé.' USING ERRCODE = '22023'; END IF;
  IF NOT public.commerce_location_access_allowed(v_count.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;

  FOR v_line IN
    SELECT * FROM public.commerce_inventory_count_lines
    WHERE count_id = p_count_id AND counted_quantity IS NOT NULL AND NOT applied
    FOR UPDATE
  LOOP
    v_delta := v_line.counted_quantity - v_line.system_quantity;
    IF v_delta = 0 THEN
      UPDATE public.commerce_inventory_count_lines SET applied = true, updated_at = now() WHERE id = v_line.id;
      CONTINUE;
    END IF;

    SELECT current_unit_cost INTO v_unit_cost
    FROM public.commerce_inventory_cost_states
    WHERE business_location_id = v_count.business_location_id AND inventory_item_id = v_line.inventory_item_id;
    IF v_unit_cost IS NULL THEN
      RAISE EXCEPTION 'Aucun coût initialisé pour un article compté -- un coût d''ouverture est requis avant inventaire.' USING ERRCODE = '22023';
    END IF;
    v_movement_type := CASE WHEN v_delta > 0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END;

    INSERT INTO public.stock_movements(
      inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
      movement_date, reference, description, created_by
    ) VALUES (
      v_line.inventory_item_id, v_movement_type, abs(v_delta), v_unit_cost, NULL, v_count.business_location_id,
      current_date, v_count.count_number, 'Inventaire physique ' || v_count.count_number, auth.uid()
    ) RETURNING * INTO v_movement;

    UPDATE public.business_location_inventory_items
    SET quantity = quantity + v_delta, updated_at = now()
    WHERE business_location_id = v_count.business_location_id AND inventory_item_id = v_line.inventory_item_id
      AND quantity + v_delta >= 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cet ajustement rendrait le stock négatif.' USING ERRCODE = '22023'; END IF;

    UPDATE public.inventory_items SET stock_actuel = stock_actuel + v_delta, updated_at = now() WHERE id = v_line.inventory_item_id;

    PERFORM public._internal_apply_commerce_inventory_valuation(
      v_count.business_location_id, v_line.inventory_item_id, v_delta, v_unit_cost,
      CASE WHEN v_delta > 0 THEN 'ADJUSTMENT_SURPLUS' ELSE 'ADJUSTMENT_DEFICIT' END,
      v_movement.id, 'Inventaire physique ' || v_count.count_number, auth.uid()
    );

    UPDATE public.commerce_inventory_count_lines
    SET applied = true, stock_movement_id = v_movement.id, updated_at = now()
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.commerce_inventory_counts
  SET status = 'COMPLETED', completed_by = auth.uid(), completed_at = now(), updated_at = now()
  WHERE id = p_count_id
  RETURNING * INTO v_count;

  PERFORM public.business_finance_audit_event('COMMERCE_INVENTORY_COUNT', v_count.id, NULL, 'CONFIRM', NULL, to_jsonb(v_count));
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_commerce_stock_transfer(p_transfer_id uuid)
RETURNS public.commerce_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
  IF v_transfer.status = 'DISPATCHED' THEN RETURN v_transfer; END IF;
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

CREATE OR REPLACE FUNCTION public.receive_commerce_stock_transfer(p_transfer_id uuid, p_lines jsonb)
RETURNS public.commerce_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_transfer public.commerce_stock_transfers;
  v_line public.commerce_stock_transfer_lines;
  v_received_by_item jsonb;
  v_quantity_received numeric(14, 3);
  v_movement public.stock_movements;
BEGIN
  PERFORM public.permission_require('transfers.receive');
  SELECT * INTO v_transfer FROM public.commerce_stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_transfer.status = 'RECEIVED' THEN RETURN v_transfer; END IF;
  IF v_transfer.status <> 'DISPATCHED' THEN RAISE EXCEPTION 'Seul un transfert expédié peut être réceptionné.' USING ERRCODE = '22023'; END IF;
  IF NOT public.commerce_location_access_allowed(v_transfer.destination_location_id) THEN
    RAISE EXCEPTION 'Accès refusé au magasin destination.' USING ERRCODE = '42501';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Les lignes reçues sont invalides.' USING ERRCODE = '22023';
  END IF;

  v_received_by_item := (SELECT jsonb_object_agg(elem ->> 'inventory_item_id', elem ->> 'quantity_received') FROM jsonb_array_elements(p_lines) elem);

  FOR v_line IN SELECT * FROM public.commerce_stock_transfer_lines WHERE transfer_id = p_transfer_id FOR UPDATE
  LOOP
    v_quantity_received := NULLIF(v_received_by_item ->> v_line.inventory_item_id::text, '')::numeric;
    IF v_quantity_received IS NULL OR v_quantity_received < 0 THEN
      RAISE EXCEPTION 'Quantité reçue manquante ou invalide pour une ligne du transfert.' USING ERRCODE = '22023';
    END IF;
    IF v_quantity_received = 0 THEN
      UPDATE public.commerce_stock_transfer_lines SET quantity_received = 0, updated_at = now() WHERE id = v_line.id;
      CONTINUE;
    END IF;

    INSERT INTO public.stock_movements(
      inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
      movement_date, reference, description, created_by
    ) VALUES (
      v_line.inventory_item_id, 'TRANSFER_IN', v_quantity_received, v_line.unit_cost, NULL, v_transfer.destination_location_id,
      current_date, v_transfer.transfer_number, 'Transfert depuis magasin source -- ' || v_transfer.transfer_number, auth.uid()
    ) RETURNING * INTO v_movement;

    INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity)
    VALUES (v_transfer.destination_location_id, v_line.inventory_item_id, v_quantity_received)
    ON CONFLICT (business_location_id, inventory_item_id) DO UPDATE
    SET quantity = public.business_location_inventory_items.quantity + EXCLUDED.quantity, updated_at = now();

    UPDATE public.inventory_items SET stock_actuel = stock_actuel + v_quantity_received, updated_at = now() WHERE id = v_line.inventory_item_id;

    INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
    VALUES (v_transfer.destination_location_id, v_line.inventory_item_id, 0, 0, 0, 'TRANSFER')
    ON CONFLICT (business_location_id, inventory_item_id) DO NOTHING;

    PERFORM public._internal_apply_commerce_inventory_valuation(
      v_transfer.destination_location_id, v_line.inventory_item_id, v_quantity_received, v_line.unit_cost,
      'TRANSFER_IN', v_movement.id, 'Transfert ' || v_transfer.transfer_number, auth.uid()
    );

    UPDATE public.commerce_stock_transfer_lines
    SET quantity_received = v_quantity_received, receive_stock_movement_id = v_movement.id, updated_at = now()
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.commerce_stock_transfers
  SET status = 'RECEIVED', received_by = auth.uid(), received_at = now(), updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  PERFORM public.business_finance_audit_event('COMMERCE_STOCK_TRANSFER', v_transfer.id, NULL, 'DELIVERY', NULL, to_jsonb(v_transfer));
  RETURN v_transfer;
END;
$function$;
