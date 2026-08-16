-- GFC V1 Phase 4C -- Transferts inter-magasins. CREATED -> DISPATCHED ->
-- RECEIVED, CANCELLED only before dispatch (no stock touched at CREATED,
-- so cancelling it is free). No Finance operation, ever -- an internal
-- transfer is not a treasury event. Reuses the exact same weighted-average
-- helper as Phase 4B (_internal_apply_commerce_inventory_valuation,
-- introduced in the previous migration) for both legs -- one shared
-- formula, not a second engine.

CREATE TABLE public.commerce_stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text NOT NULL UNIQUE,
  source_location_id uuid NOT NULL REFERENCES public.business_locations(id),
  destination_location_id uuid NOT NULL REFERENCES public.business_locations(id),
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'DISPATCHED', 'RECEIVED', 'CANCELLED')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_by uuid REFERENCES auth.users(id),
  dispatched_at timestamptz,
  received_by uuid REFERENCES auth.users(id),
  received_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_location_id <> destination_location_id)
);
CREATE INDEX commerce_stock_transfers_source_idx ON public.commerce_stock_transfers(source_location_id);
CREATE INDEX commerce_stock_transfers_destination_idx ON public.commerce_stock_transfers(destination_location_id);

CREATE TABLE public.commerce_stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.commerce_stock_transfers(id),
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  quantity_requested numeric(14, 3) NOT NULL CHECK (quantity_requested > 0),
  unit_cost numeric(14, 4),
  quantity_received numeric(14, 3),
  dispatch_stock_movement_id uuid REFERENCES public.stock_movements(id),
  receive_stock_movement_id uuid REFERENCES public.stock_movements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, inventory_item_id)
);
CREATE INDEX commerce_stock_transfer_lines_transfer_idx ON public.commerce_stock_transfer_lines(transfer_id);

CREATE OR REPLACE FUNCTION public._internal_next_commerce_stock_transfer_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'TRF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(split_part(transfer_number, '-', 3), '')::int)
      FROM public.commerce_stock_transfers
      WHERE transfer_number LIKE 'TRF-' || to_char(now(), 'YYYYMMDD') || '-%'
    ), 0) + 1
  )::text, 4, '0');
$function$;

-- No stock touched at creation.
CREATE OR REPLACE FUNCTION public.create_commerce_stock_transfer(p_transfer jsonb)
RETURNS public.commerce_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_source_id uuid := NULLIF(p_transfer ->> 'source_location_id', '')::uuid;
  v_destination_id uuid := NULLIF(p_transfer ->> 'destination_location_id', '')::uuid;
  v_notes text := NULLIF(btrim(p_transfer ->> 'notes'), '');
  v_lines jsonb := p_transfer -> 'lines';
  v_line jsonb;
  v_transfer public.commerce_stock_transfers;
BEGIN
  PERFORM public.permission_require('transfers.create');
  IF p_transfer IS NULL OR jsonb_typeof(p_transfer) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_transfer) AS key_name
    WHERE key_name NOT IN ('source_location_id', 'destination_location_id', 'notes', 'lines')
  ) THEN
    RAISE EXCEPTION 'Les données de transfert sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF v_source_id IS NULL OR v_destination_id IS NULL OR v_source_id = v_destination_id THEN
    RAISE EXCEPTION 'Les magasins source et destination doivent être distincts.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_source_id) THEN
    RAISE EXCEPTION 'Accès refusé au magasin source.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_locations loc JOIN public.business_units unit ON unit.id = loc.business_unit_id
    WHERE loc.id = v_source_id AND loc.status = 'ACTIVE' AND unit.code = 'COMMERCE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.business_locations loc JOIN public.business_units unit ON unit.id = loc.business_unit_id
    WHERE loc.id = v_destination_id AND loc.status = 'ACTIVE' AND unit.code = 'COMMERCE'
  ) THEN
    RAISE EXCEPTION 'Magasin Commerce actif introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Un transfert doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commerce_stock_transfers(transfer_number, source_location_id, destination_location_id, notes, created_by)
  VALUES (public._internal_next_commerce_stock_transfer_number(), v_source_id, v_destination_id, v_notes, auth.uid())
  RETURNING * INTO v_transfer;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_line) AS key_name WHERE key_name NOT IN ('inventory_item_id', 'quantity')
    ) THEN
      RAISE EXCEPTION 'Une ligne de transfert contient une propriété non autorisée.' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_line ->> 'inventory_item_id', '') IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = (v_line ->> 'inventory_item_id')::uuid) THEN
      RAISE EXCEPTION 'Article introuvable pour une ligne de transfert.' USING ERRCODE = '23503';
    END IF;
    IF NULLIF(v_line ->> 'quantity', '')::numeric IS NULL OR (v_line ->> 'quantity')::numeric <= 0 THEN
      RAISE EXCEPTION 'Quantité invalide pour une ligne de transfert.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.commerce_stock_transfer_lines(transfer_id, inventory_item_id, quantity_requested)
    VALUES (v_transfer.id, (v_line ->> 'inventory_item_id')::uuid, (v_line ->> 'quantity')::numeric);
  END LOOP;

  PERFORM public.business_finance_audit_event('COMMERCE_STOCK_TRANSFER', v_transfer.id, NULL, 'CREATE', NULL, to_jsonb(v_transfer));
  RETURN v_transfer;
END;
$function$;

-- Source decreases, cost figé at the source's own current CUMP into each
-- line, transfer becomes in-transit. Idempotent: re-dispatching an
-- already-DISPATCHED transfer is a no-op (test G).
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

  PERFORM public.business_finance_audit_event('COMMERCE_STOCK_TRANSFER', v_transfer.id, NULL, 'DISPATCH', NULL, to_jsonb(v_transfer));
  RETURN v_transfer;
END;
$function$;

-- Destination increases at the figé source cost -- feeds the destination's
-- own weighted average via the same shared formula. quantity_received may
-- differ from quantity_requested (transit variance): recorded as-is, never
-- silently corrected. Idempotent: re-receiving an already-RECEIVED
-- transfer is a no-op (test H).
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

  PERFORM public.business_finance_audit_event('COMMERCE_STOCK_TRANSFER', v_transfer.id, NULL, 'RECEIVE', NULL, to_jsonb(v_transfer));
  RETURN v_transfer;
END;
$function$;

-- Only before dispatch -- nothing to reverse, matches the achat/vente
-- precedent (cancel is only ever offered while zero stock/Finance impact
-- exists). After dispatch, no cancellation path exists in V1: the only way
-- forward is to receive it (even partially) -- a return-to-source workflow
-- is explicitly deferred.
CREATE OR REPLACE FUNCTION public.cancel_commerce_stock_transfer(p_transfer_id uuid, p_reason text)
RETURNS public.commerce_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_stock_transfers;
  v_transfer public.commerce_stock_transfers;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('transfers.create');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commerce_stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'CREATED' THEN
    RAISE EXCEPTION 'Un transfert déjà expédié ne peut plus être annulé directement -- il doit être réceptionné.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_before.source_location_id) THEN
    RAISE EXCEPTION 'Accès refusé au magasin source.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.commerce_stock_transfers
  SET status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_at = now(), cancellation_reason = v_reason, updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  PERFORM public.business_finance_audit_event('COMMERCE_STOCK_TRANSFER', v_transfer.id, NULL, 'CANCEL', to_jsonb(v_before), to_jsonb(v_transfer));
  RETURN v_transfer;
END;
$function$;

ALTER TABLE public.commerce_stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_stock_transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_stock_transfers_authorized_read ON public.commerce_stock_transfers
  FOR SELECT TO authenticated USING (
    public.user_has_permission('transfers.read')
    AND (public.commerce_location_access_allowed(source_location_id) OR public.commerce_location_access_allowed(destination_location_id))
  );
CREATE POLICY commerce_stock_transfer_lines_authorized_read ON public.commerce_stock_transfer_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.commerce_stock_transfers t
    WHERE t.id = commerce_stock_transfer_lines.transfer_id
      AND public.user_has_permission('transfers.read')
      AND (public.commerce_location_access_allowed(t.source_location_id) OR public.commerce_location_access_allowed(t.destination_location_id))
  ));

REVOKE ALL ON TABLE public.commerce_stock_transfers, public.commerce_stock_transfer_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_stock_transfers, public.commerce_stock_transfer_lines TO authenticated;
REVOKE ALL ON FUNCTION public._internal_next_commerce_stock_transfer_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_commerce_stock_transfer(jsonb), public.dispatch_commerce_stock_transfer(uuid), public.receive_commerce_stock_transfer(uuid, jsonb), public.cancel_commerce_stock_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_stock_transfer(jsonb), public.dispatch_commerce_stock_transfer(uuid), public.receive_commerce_stock_transfer(uuid, jsonb), public.cancel_commerce_stock_transfer(uuid, text) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('transfers.read', 'transfers', 'read', 'Consulter les transferts de stock inter-magasins.', 'SENSITIVE'),
  ('transfers.create', 'transfers', 'create', 'Créer ou annuler un transfert de stock avant expédition.', 'SENSITIVE'),
  ('transfers.dispatch', 'transfers', 'dispatch', 'Expédier un transfert de stock (débite le magasin source).', 'CRITICAL'),
  ('transfers.receive', 'transfers', 'receive', 'Réceptionner un transfert de stock (crédite le magasin destination).', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'transfers.read'), ('admin', 'transfers.create'), ('admin', 'transfers.dispatch'), ('admin', 'transfers.receive'),
  ('gestionnaire', 'transfers.read'), ('gestionnaire', 'transfers.create'), ('gestionnaire', 'transfers.dispatch'), ('gestionnaire', 'transfers.receive');
