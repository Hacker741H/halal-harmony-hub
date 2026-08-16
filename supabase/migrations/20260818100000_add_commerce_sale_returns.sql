-- GFC V1 Phase 5B -- Retours de vente. A commercial sale is immutable
-- history: a return is a NEW auditable event, never a DELETE/UPDATE of the
-- original sale/lines/finance_operations/stock. Reuses every Phase 4
-- primitive unmodified (_internal_apply_commerce_inventory_valuation for
-- the weighted-average re-entry, RETURN_IN as a new dedicated movement
-- type rather than overloading ADJUSTMENT_IN, which means "inventory count
-- correction" -- a semantically different real-world event).
--
-- Phase 5A audit (live schema, not memory) found: only the POS cash-sale
-- path (_internal_create_commerce_cash_sale_at) ever creates a
-- commercial_sale_stock_movement_links row -- the generic credit-sale path
-- (create_commercial_sale/confirm_commercial_sale) never touches stock or
-- CUMP, even when a line references inventory_item_id. This is not a gap
-- to paper over: a return correctly only reverses what the original sale
-- actually did. A return line's disposition (RESTOCK/DAMAGED/SCRAPPED) is
-- therefore only meaningful when commercial_sale_line_costs exists for the
-- original line (proof stock was really decremented) -- otherwise the
-- return is commercial-only (CA/créance), and the RPC rejects a client
-- attempting to request a physical disposition on a line that never had
-- one.

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (
  movement_type = ANY (ARRAY['PURCHASE'::text, 'SALE'::text, 'IN'::text, 'OUT'::text, 'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'LOSS'::text, 'TRANSFER'::text, 'TRANSFER_OUT'::text, 'TRANSFER_IN'::text, 'RETURN_IN'::text])
);
-- stock_movements_check already buckets every non-PURCHASE/SALE type into
-- "wallet_id IS NULL" -- RETURN_IN needs no separate widening there.

CREATE OR REPLACE FUNCTION public.stock_movement_delta(p_movement_type text, p_quantity numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  CASE p_movement_type
    WHEN 'PURCHASE', 'IN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'RETURN_IN' THEN RETURN p_quantity;
    WHEN 'SALE', 'OUT', 'ADJUSTMENT_OUT', 'LOSS', 'TRANSFER_OUT' THEN RETURN -p_quantity;
    WHEN 'TRANSFER' THEN RETURN 0;
    ELSE RAISE EXCEPTION 'Type de mouvement de stock invalide : %', p_movement_type USING ERRCODE = '22023';
  END CASE;
END;
$function$;

-- SALE_RETURN is shaped exactly like PURCHASE in both cost-event
-- constraints (stock_movement_id required, sale_line_id NULL) rather than
-- like SALE (which requires sale_line_id) -- this avoids touching
-- _internal_apply_commerce_inventory_valuation's signature (a proven,
-- tested Phase 4 helper). Traceability back to the original sale line is
-- preserved via commerce_sale_return_lines.original_sale_line_id instead.
ALTER TABLE public.commerce_inventory_cost_events DROP CONSTRAINT commerce_cost_event_one_source;
ALTER TABLE public.commerce_inventory_cost_events ADD CONSTRAINT commerce_cost_event_one_source CHECK (
  (event_type = 'OPENING' AND stock_movement_id IS NULL AND sale_line_id IS NULL AND justification IS NOT NULL AND btrim(justification) <> '' AND approval_actor IS NOT NULL AND btrim(approval_actor::text) <> '')
  OR (event_type IN ('PURCHASE', 'ADJUSTMENT_SURPLUS', 'ADJUSTMENT_DEFICIT', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_RETURN') AND stock_movement_id IS NOT NULL AND sale_line_id IS NULL)
  OR (event_type = 'SALE' AND stock_movement_id IS NOT NULL AND sale_line_id IS NOT NULL)
);
ALTER TABLE public.commerce_inventory_cost_events DROP CONSTRAINT commerce_inventory_cost_events_event_type_check;
ALTER TABLE public.commerce_inventory_cost_events ADD CONSTRAINT commerce_inventory_cost_events_event_type_check CHECK (
  event_type = ANY (ARRAY['OPENING'::text, 'PURCHASE'::text, 'SALE'::text, 'ADJUSTMENT_SURPLUS'::text, 'ADJUSTMENT_DEFICIT'::text, 'TRANSFER_OUT'::text, 'TRANSFER_IN'::text, 'SALE_RETURN'::text])
);

CREATE TABLE public.commerce_sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text NOT NULL UNIQUE,
  sale_id uuid NOT NULL REFERENCES public.commercial_sales(id),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id),
  client_id uuid REFERENCES public.transport_clients(id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status = 'CONFIRMED'),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_by uuid REFERENCES auth.users(id),
  validated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, idempotency_key)
);
CREATE INDEX commerce_sale_returns_sale_idx ON public.commerce_sale_returns(sale_id);
CREATE INDEX commerce_sale_returns_location_idx ON public.commerce_sale_returns(business_location_id);

CREATE TABLE public.commerce_sale_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.commerce_sale_returns(id),
  original_sale_line_id uuid NOT NULL REFERENCES public.commercial_sale_lines(id),
  quantity_returned numeric(14, 3) NOT NULL CHECK (quantity_returned > 0),
  historical_unit_sale_price numeric(14, 2) NOT NULL,
  historical_unit_cost numeric(14, 4),
  disposition text CHECK (disposition IS NULL OR disposition IN ('RESTOCK', 'DAMAGED', 'SCRAPPED')),
  stock_movement_id uuid REFERENCES public.stock_movements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A physical disposition only exists where a historical cost was
  -- actually captured (proof the original sale touched stock).
  CHECK ((historical_unit_cost IS NULL AND disposition IS NULL) OR (historical_unit_cost IS NOT NULL AND disposition IS NOT NULL)),
  -- Only a restocked line ever produces a stock movement.
  CHECK ((disposition = 'RESTOCK' AND stock_movement_id IS NOT NULL) OR (disposition IS DISTINCT FROM 'RESTOCK' AND stock_movement_id IS NULL))
);
CREATE INDEX commerce_sale_return_lines_return_idx ON public.commerce_sale_return_lines(return_id);
CREATE INDEX commerce_sale_return_lines_original_line_idx ON public.commerce_sale_return_lines(original_sale_line_id);

CREATE OR REPLACE FUNCTION public._internal_next_commerce_sale_return_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'RET-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(split_part(return_number, '-', 3), '')::int)
      FROM public.commerce_sale_returns
      WHERE return_number LIKE 'RET-' || to_char(now(), 'YYYYMMDD') || '-%'
    ), 0) + 1
  )::text, 4, '0');
$function$;

-- The one entry point for a return. Idempotent on (sale_id, idempotency_key)
-- -- a retry with the same key returns the original return untouched, never
-- creating a second one (test K). Enforces the cumulative-quantity
-- invariant per original line (test B) and the stock-blind/stock-linked
-- distinction found in the Phase 5A audit (test C/D vs test A/G).
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
  IF v_sale.business_location_id IS NULL OR NOT public.commerce_location_access_allowed(v_sale.business_location_id) THEN
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
      -- Stock-blind original sale (generic credit path never touched
      -- stock): this return is commercial-only, exactly mirroring what the
      -- original sale actually did.
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
    -- DAMAGED/SCRAPPED: no stock movement, no cost re-entry -- the goods
    -- physically came back but are not available for sale. The return
    -- line itself is the complete audit trail.

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

ALTER TABLE public.commerce_sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_sale_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_sale_returns_authorized_read ON public.commerce_sale_returns
  FOR SELECT TO authenticated USING (public.user_has_permission('sales.returns.read') AND public.commerce_location_access_allowed(business_location_id));
CREATE POLICY commerce_sale_return_lines_authorized_read ON public.commerce_sale_return_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.commerce_sale_returns r
    WHERE r.id = commerce_sale_return_lines.return_id
      AND public.user_has_permission('sales.returns.read') AND public.commerce_location_access_allowed(r.business_location_id)
  ));

REVOKE ALL ON TABLE public.commerce_sale_returns, public.commerce_sale_return_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_sale_returns, public.commerce_sale_return_lines TO authenticated;
REVOKE ALL ON FUNCTION public._internal_next_commerce_sale_return_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_commerce_sale_return(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_sale_return(jsonb) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('sales.returns.read', 'sales', 'read', 'Consulter les retours de vente.', 'SENSITIVE'),
  ('sales.returns.create', 'sales', 'create', 'Enregistrer un retour de vente (stock et créance ajustés).', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'sales.returns.read'), ('admin', 'sales.returns.create'),
  ('super_admin', 'sales.returns.read'), ('super_admin', 'sales.returns.create'),
  ('gestionnaire', 'sales.returns.read'), ('gestionnaire', 'sales.returns.create'),
  ('comptable', 'sales.returns.read');
