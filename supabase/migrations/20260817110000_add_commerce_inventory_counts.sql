-- GFC V1 Phase 4B -- Inventaires physiques. Reuses the CUMP engine's own
-- weighted-average math (same formula the purchase trigger already uses:
-- new_value = old_value + delta*unit_cost, new_cost = new_value/new_qty)
-- via a new shared internal helper, called directly by this migration's
-- RPCs rather than through a trigger -- these RPCs are dedicated,
-- purpose-built entry points (unlike the generic create_stock_movement_
-- with_finance), so a trigger indirection buys nothing here and risks
-- nothing in the existing, proven purchase trigger, which stays untouched.
--
-- Deficit and surplus use the IDENTICAL formula (validated business
-- decision: surplus enters at current average cost, same as deficit is
-- removed at current average cost) -- both leave current_unit_cost
-- unchanged, only inventory_value moves. No fabricated cost, ever.
--
-- Zero-variance lines create no movement at all (test A: "aucun mouvement
-- stock inutile"). No Finance operation is ever created here.

CREATE OR REPLACE FUNCTION public._internal_apply_commerce_inventory_valuation(
  p_business_location_id uuid,
  p_inventory_item_id uuid,
  p_delta_quantity numeric,
  p_valuation_unit_cost numeric,
  p_event_type text,
  p_stock_movement_id uuid,
  p_justification text DEFAULT NULL,
  p_approval_actor uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_state public.commerce_inventory_cost_states;
  v_new_quantity numeric(14, 3);
  v_new_value numeric(16, 2);
  v_new_cost numeric(14, 4);
BEGIN
  SELECT * INTO v_state FROM public.commerce_inventory_cost_states
  WHERE business_location_id = p_business_location_id AND inventory_item_id = p_inventory_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun coût initialisé pour cet article à ce magasin -- un coût d''ouverture est requis avant tout ajustement.' USING ERRCODE = '22023';
  END IF;

  v_new_quantity := v_state.quantity_on_hand + p_delta_quantity;
  IF v_new_quantity < 0 THEN
    RAISE EXCEPTION 'Cette opération rendrait le stock négatif.' USING ERRCODE = '22023';
  END IF;

  IF v_new_quantity = 0 THEN
    v_new_value := 0;
    v_new_cost := v_state.current_unit_cost;
  ELSE
    v_new_value := GREATEST(0, round(v_state.inventory_value + round(p_delta_quantity * p_valuation_unit_cost, 2), 2));
    v_new_cost := round(v_new_value / v_new_quantity, 4);
  END IF;

  UPDATE public.commerce_inventory_cost_states
  SET quantity_on_hand = v_new_quantity, current_unit_cost = v_new_cost, inventory_value = v_new_value, updated_at = now()
  WHERE business_location_id = p_business_location_id AND inventory_item_id = p_inventory_item_id;

  INSERT INTO public.commerce_inventory_cost_events(
    business_location_id, inventory_item_id, event_type, stock_movement_id,
    quantity, unit_cost, total_cost, quantity_before, quantity_after,
    unit_cost_before, unit_cost_after, justification, approval_actor, created_by
  ) VALUES (
    p_business_location_id, p_inventory_item_id, p_event_type, p_stock_movement_id,
    abs(p_delta_quantity), p_valuation_unit_cost, round(abs(p_delta_quantity) * p_valuation_unit_cost, 2),
    v_state.quantity_on_hand, v_new_quantity, v_state.current_unit_cost, v_new_cost,
    p_justification, p_approval_actor, auth.uid()
  );
END;
$function$;

CREATE TABLE public.commerce_inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text NOT NULL UNIQUE,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  notes text,
  opened_by uuid REFERENCES auth.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_inventory_counts_location_idx ON public.commerce_inventory_counts(business_location_id);

CREATE TABLE public.commerce_inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.commerce_inventory_counts(id),
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  system_quantity numeric(14, 3) NOT NULL,
  counted_quantity numeric(14, 3),
  counted_by uuid REFERENCES auth.users(id),
  counted_at timestamptz,
  applied boolean NOT NULL DEFAULT false,
  stock_movement_id uuid REFERENCES public.stock_movements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, inventory_item_id)
);
CREATE INDEX commerce_inventory_count_lines_count_idx ON public.commerce_inventory_count_lines(count_id);

CREATE OR REPLACE FUNCTION public._internal_next_commerce_inventory_count_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(split_part(count_number, '-', 3), '')::int)
      FROM public.commerce_inventory_counts
      WHERE count_number LIKE 'INV-' || to_char(now(), 'YYYYMMDD') || '-%'
    ), 0) + 1
  )::text, 4, '0');
$function$;

-- Snapshots every currently-tracked item at this location as a counting
-- line. system_quantity is frozen here, at open time -- the variance
-- recorded and applied at completion is always against this snapshot, so
-- any real sale/purchase that happens during the physical count is never
-- clobbered by an absolute overwrite (the applied delta composes on top of
-- whatever the live quantity is at completion time, exactly like every
-- other movement type in this engine).
CREATE OR REPLACE FUNCTION public.open_commerce_inventory_count(p_business_location_id uuid, p_notes text DEFAULT NULL)
RETURNS public.commerce_inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_count public.commerce_inventory_counts;
BEGIN
  PERFORM public.permission_require('inventory.counts.create');
  IF NOT public.commerce_location_access_allowed(p_business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commerce_inventory_counts WHERE business_location_id = p_business_location_id AND status = 'OPEN') THEN
    RAISE EXCEPTION 'Un inventaire est déjà ouvert pour ce magasin.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.commerce_inventory_counts(count_number, business_location_id, notes, opened_by)
  VALUES (public._internal_next_commerce_inventory_count_number(), p_business_location_id, NULLIF(btrim(p_notes), ''), auth.uid())
  RETURNING * INTO v_count;

  INSERT INTO public.commerce_inventory_count_lines(count_id, inventory_item_id, system_quantity)
  SELECT v_count.id, bli.inventory_item_id, bli.quantity
  FROM public.business_location_inventory_items bli
  WHERE bli.business_location_id = p_business_location_id;

  PERFORM public.business_finance_audit_event('COMMERCE_INVENTORY_COUNT', v_count.id, NULL, 'CREATE', NULL, to_jsonb(v_count));
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_inventory_count_line(p_count_id uuid, p_inventory_item_id uuid, p_counted_quantity numeric)
RETURNS public.commerce_inventory_count_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_count public.commerce_inventory_counts;
  v_line public.commerce_inventory_count_lines;
BEGIN
  PERFORM public.permission_require('inventory.counts.create');
  SELECT * INTO v_count FROM public.commerce_inventory_counts WHERE id = p_count_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.commerce_location_access_allowed(v_count.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF v_count.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Seul un inventaire ouvert peut être compté.' USING ERRCODE = '22023';
  END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN
    RAISE EXCEPTION 'La quantité comptée doit être positive ou nulle.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.commerce_inventory_count_lines
  SET counted_quantity = p_counted_quantity, counted_by = auth.uid(), counted_at = now(), updated_at = now()
  WHERE count_id = p_count_id AND inventory_item_id = p_inventory_item_id
  RETURNING * INTO v_line;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne d''inventaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  RETURN v_line;
END;
$function$;

-- The "validation responsable" step: applies every counted, non-zero
-- variance atomically. Uncounted lines (counted_quantity IS NULL) are left
-- untouched -- a partial physical count is allowed, matching "V1
-- opérationnelle, pas bureaucratique". Idempotent: re-running on an
-- already-COMPLETED count is a no-op (test D).
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

  PERFORM public.business_finance_audit_event('COMMERCE_INVENTORY_COUNT', v_count.id, NULL, 'COMPLETE', NULL, to_jsonb(v_count));
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_commerce_inventory_count(p_count_id uuid, p_reason text)
RETURNS public.commerce_inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_inventory_counts;
  v_count public.commerce_inventory_counts;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('inventory.counts.create');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commerce_inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventaire introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'OPEN' THEN RAISE EXCEPTION 'Un inventaire déjà validé ne peut plus être annulé.' USING ERRCODE = '22023'; END IF;
  IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.commerce_inventory_counts
  SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = v_reason, updated_at = now()
  WHERE id = p_count_id
  RETURNING * INTO v_count;

  PERFORM public.business_finance_audit_event('COMMERCE_INVENTORY_COUNT', v_count.id, NULL, 'CANCEL', to_jsonb(v_before), to_jsonb(v_count));
  RETURN v_count;
END;
$function$;

ALTER TABLE public.commerce_inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_inventory_count_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_inventory_counts_authorized_read ON public.commerce_inventory_counts
  FOR SELECT TO authenticated USING (public.user_has_permission('inventory.counts.read') AND public.commerce_location_access_allowed(business_location_id));
CREATE POLICY commerce_inventory_count_lines_authorized_read ON public.commerce_inventory_count_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.commerce_inventory_counts c
    WHERE c.id = commerce_inventory_count_lines.count_id
      AND public.user_has_permission('inventory.counts.read') AND public.commerce_location_access_allowed(c.business_location_id)
  ));

REVOKE ALL ON TABLE public.commerce_inventory_counts, public.commerce_inventory_count_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_inventory_counts, public.commerce_inventory_count_lines TO authenticated;
REVOKE ALL ON FUNCTION public._internal_apply_commerce_inventory_valuation(uuid, uuid, numeric, numeric, text, uuid, text, uuid), public._internal_next_commerce_inventory_count_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_commerce_inventory_count(uuid, text), public.update_inventory_count_line(uuid, uuid, numeric), public.complete_commerce_inventory_count(uuid), public.cancel_commerce_inventory_count(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_commerce_inventory_count(uuid, text), public.update_inventory_count_line(uuid, uuid, numeric), public.complete_commerce_inventory_count(uuid), public.cancel_commerce_inventory_count(uuid, text) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('inventory.counts.read', 'inventory', 'read', 'Consulter les inventaires physiques.', 'SENSITIVE'),
  ('inventory.counts.create', 'inventory', 'create', 'Ouvrir, compter et annuler un inventaire physique.', 'SENSITIVE'),
  ('inventory.counts.complete', 'inventory', 'complete', 'Valider un inventaire physique et appliquer les écarts au stock.', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'inventory.counts.read'), ('admin', 'inventory.counts.create'), ('admin', 'inventory.counts.complete'),
  ('gestionnaire', 'inventory.counts.read'), ('gestionnaire', 'inventory.counts.create'), ('gestionnaire', 'inventory.counts.complete');
