-- GFC V1 Phase 5B -- fixes a real bug caught by the E2E test: the generic
-- credit-sale path (create_commercial_sale) never sets
-- commercial_sales.business_location_id at all (no location-specific stock
-- concept for that path -- confirmed in the Phase 5A audit). The return
-- RPC unconditionally required a location and location access, which
-- unconditionally rejected any return against such a sale ("Accès refusé
-- à ce magasin") -- exactly the stock-blind case the whole return design
-- is supposed to support (mission tests C/D). A return with no location
-- (because its sale has none) is legitimate: gated purely by the general
-- sales.returns.create/read permission, with no location-scoped check
-- possible since there is no location.

ALTER TABLE public.commerce_sale_returns ALTER COLUMN business_location_id DROP NOT NULL;

DROP POLICY commerce_sale_returns_authorized_read ON public.commerce_sale_returns;
CREATE POLICY commerce_sale_returns_authorized_read ON public.commerce_sale_returns
  FOR SELECT TO authenticated USING (
    public.user_has_permission('sales.returns.read')
    AND (business_location_id IS NULL OR public.commerce_location_access_allowed(business_location_id))
  );

CREATE OR REPLACE FUNCTION public.create_commerce_sale_return(p_return jsonb)
RETURNS public.commerce_sale_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_sale_id uuid := NULLIF(p_return ->> 'sale_id', '')::uuid;
  v_reason text := NULLIF(btrim(p_return ->> 'reason'), '');
  v_idempotency_key text := NULLIF(btrim(p_return ->> 'idempotency_key'), '');
  v_lines jsonb := p_return -> 'lines';
  v_line jsonb;
  v_sale public.commercial_sales;
  v_existing public.commerce_sale_returns;
  v_return public.commerce_sale_returns;
  v_sale_line public.commercial_sale_lines;
  v_line_cost public.commercial_sale_line_costs;
  v_quantity numeric(14, 3);
  v_disposition text;
  v_already_returned numeric(14, 3);
  v_movement public.stock_movements;
  v_stock_movement_id uuid;
  v_bli public.business_location_inventory_items;
BEGIN
  PERFORM public.permission_require('sales.returns.create');

  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif de retour est obligatoire.' USING ERRCODE = '22023'; END IF;
  IF v_idempotency_key IS NULL THEN RAISE EXCEPTION 'Une clé d''idempotence est obligatoire.' USING ERRCODE = '22023'; END IF;
  IF v_sale_id IS NULL THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_existing FROM public.commerce_sale_returns WHERE sale_id = v_sale_id AND idempotency_key = v_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_sale.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Seule une vente confirmée peut faire l''objet d''un retour.' USING ERRCODE = '22023';
  END IF;
  IF v_sale.business_location_id IS NOT NULL AND NOT public.commerce_location_access_allowed(v_sale.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;

  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Un retour doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commerce_sale_returns(return_number, sale_id, business_location_id, client_id, reason, idempotency_key, created_by, validated_by)
  VALUES (public._internal_next_commerce_sale_return_number(), v_sale_id, v_sale.business_location_id, v_sale.client_id, v_reason, v_idempotency_key, auth.uid(), auth.uid())
  RETURNING * INTO v_return;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_line) AS key_name WHERE key_name NOT IN ('original_sale_line_id', 'quantity_returned', 'disposition')
    ) THEN
      RAISE EXCEPTION 'Une ligne de retour contient une propriété non autorisée.' USING ERRCODE = '22023';
    END IF;

    v_quantity := NULLIF(v_line ->> 'quantity_returned', '')::numeric;
    v_disposition := NULLIF(btrim(v_line ->> 'disposition'), '');
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Quantité retournée invalide.' USING ERRCODE = '22023';
    END IF;
    IF v_disposition IS NOT NULL AND v_disposition NOT IN ('RESTOCK', 'DAMAGED', 'SCRAPPED') THEN
      RAISE EXCEPTION 'Disposition de retour invalide : %', v_disposition USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sale_line
    FROM public.commercial_sale_lines
    WHERE id = NULLIF(v_line ->> 'original_sale_line_id', '')::uuid AND sale_id = v_sale_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de vente introuvable pour cette vente.' USING ERRCODE = '23503'; END IF;
    IF v_sale_line.line_type <> 'ARTICLE' OR v_sale_line.inventory_item_id IS NULL THEN
      RAISE EXCEPTION 'Seules les lignes article peuvent faire l''objet d''un retour dans cette version.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(sum(rl.quantity_returned), 0) INTO v_already_returned
    FROM public.commerce_sale_return_lines rl
    WHERE rl.original_sale_line_id = v_sale_line.id;
    IF v_already_returned + v_quantity > v_sale_line.quantity THEN
      RAISE EXCEPTION 'Quantité retournée (%) dépasse la quantité encore retournable (% sur % vendu, % déjà retourné).',
        v_quantity, v_sale_line.quantity - v_already_returned, v_sale_line.quantity, v_already_returned USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_line_cost FROM public.commercial_sale_line_costs WHERE sale_line_id = v_sale_line.id;
    v_stock_movement_id := NULL;

    IF NOT FOUND THEN
      IF v_disposition IS NOT NULL THEN
        RAISE EXCEPTION 'Cette ligne n''a jamais eu d''impact stock (vente sans mouvement) -- aucune disposition physique n''est possible.' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.commerce_sale_return_lines(
        return_id, original_sale_line_id, quantity_returned, historical_unit_sale_price, historical_unit_cost, disposition, stock_movement_id
      ) VALUES (
        v_return.id, v_sale_line.id, v_quantity, v_sale_line.unit_price, NULL, NULL, NULL
      );
      CONTINUE;
    END IF;

    IF v_disposition IS NULL THEN
      RAISE EXCEPTION 'Une disposition (RESTOCK, DAMAGED ou SCRAPPED) est obligatoire pour une ligne ayant eu un impact stock.' USING ERRCODE = '22023';
    END IF;

    IF v_disposition = 'RESTOCK' THEN
      INSERT INTO public.stock_movements(
        inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
        movement_date, reference, description, status, created_by
      ) VALUES (
        v_sale_line.inventory_item_id, 'RETURN_IN', v_quantity, v_line_cost.unit_cost, NULL, v_sale.business_location_id,
        current_date, v_return.return_number, 'Retour vente ' || v_sale.sale_number || ' -- ' || v_return.return_number, 'VALID', auth.uid()
      ) RETURNING * INTO v_movement;
      v_stock_movement_id := v_movement.id;

      UPDATE public.business_location_inventory_items
      SET quantity = quantity + v_quantity, updated_at = now()
      WHERE business_location_id = v_sale.business_location_id AND inventory_item_id = v_sale_line.inventory_item_id
      RETURNING * INTO v_bli;
      IF NOT FOUND THEN RAISE EXCEPTION 'Stock introuvable pour cet article à ce magasin.' USING ERRCODE = '22023'; END IF;

      UPDATE public.inventory_items SET stock_actuel = stock_actuel + v_quantity, updated_at = now() WHERE id = v_sale_line.inventory_item_id;

      PERFORM public._internal_apply_commerce_inventory_valuation(
        v_sale.business_location_id, v_sale_line.inventory_item_id, v_quantity, v_line_cost.unit_cost,
        'SALE_RETURN', v_stock_movement_id, 'Retour ' || v_return.return_number, auth.uid()
      );
    END IF;

    INSERT INTO public.commerce_sale_return_lines(
      return_id, original_sale_line_id, quantity_returned, historical_unit_sale_price, historical_unit_cost, disposition, stock_movement_id
    ) VALUES (
      v_return.id, v_sale_line.id, v_quantity, v_sale_line.unit_price, v_line_cost.unit_cost, v_disposition, v_stock_movement_id
    );
  END LOOP;

  PERFORM public.business_finance_audit_event('COMMERCE_SALE_RETURN', v_return.id, NULL, 'CREATE', NULL, to_jsonb(v_return));
  RETURN v_return;
END;
$function$;
