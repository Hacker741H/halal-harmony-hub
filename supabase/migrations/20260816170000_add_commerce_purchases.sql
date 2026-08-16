-- GFC V1 Phase 3 -- Fournisseurs/Achats. Purchase header + lines, reusing
-- the existing CUMP engine (stock_movements + apply_commerce_purchase_cost
-- trigger) exactly as-is -- no second cost engine. The key structural
-- change: a PURCHASE stock_movement no longer requires an immediate
-- wallet_id. Reception and payment are now two independent, separately
-- auditable events (mirroring commercial_sales/commercial_invoice_payments
-- from Phase 2): receiving stock never touches Finance or a wallet by
-- itself; only a later, explicit supplier payment does (added in the next
-- migration). stock_movements.wallet_id stays NULL for every purchase
-- created through this path, whether the debt is settled immediately or
-- later -- payment tracking lives entirely in commerce_supplier_payments,
-- never split across two representations of the same fact.
--
-- create_stock_movement_with_finance / _internal_create_stock_movement_
-- with_finance is NOT touched: it is still the live entry point for the
-- generic, cross-business-unit Stocks screen (stock-movement-form.tsx),
-- where "purchase = paid immediately" remains correct and unchanged.

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_check CHECK (
  (movement_type = 'SALE' AND wallet_id IS NOT NULL AND unit_price IS NOT NULL AND unit_price >= 0)
  OR (movement_type = 'PURCHASE' AND unit_price IS NOT NULL AND unit_price >= 0)
  OR (movement_type NOT IN ('PURCHASE', 'SALE') AND wallet_id IS NULL)
);

CREATE TABLE public.commerce_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES public.commerce_suppliers(id),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id),
  purchase_date date NOT NULL DEFAULT current_date,
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'CANCELLED')),
  subtotal_amount numeric(14, 2) NOT NULL,
  total_amount numeric(14, 2) NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commerce_purchases_supplier_idx ON public.commerce_purchases(supplier_id);
CREATE INDEX commerce_purchases_location_idx ON public.commerce_purchases(business_location_id);

CREATE TABLE public.commerce_purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.commerce_purchases(id),
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14, 2) NOT NULL CHECK (unit_cost > 0),
  line_total numeric(14, 2) NOT NULL,
  stock_movement_id uuid NOT NULL REFERENCES public.stock_movements(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commerce_purchase_lines_purchase_idx ON public.commerce_purchase_lines(purchase_id);

CREATE OR REPLACE FUNCTION public._internal_next_commerce_purchase_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'ACH-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(regexp_replace(purchase_number, '\D', '', 'g'), '')::int)
      FROM public.commerce_purchases
      WHERE purchase_number LIKE 'ACH-' || to_char(now(), 'YYYYMMDD') || '-%'
    ), 0) + 1
  )::text, 4, '0');
$function$;

-- Atomic: purchase header + lines + stock reception (fires the existing
-- CUMP trigger) + business_location_inventory_items quantity, all in one
-- transaction, zero Finance write, zero wallet touch. sale_price is
-- deliberately not part of this payload -- an achat is about cost, not
-- about setting a selling price (matches the existing catalog price-floor
-- screen's own scope); a genuinely new item/location combo gets sale_price
-- NULL until priced there, same as the nullable column already allows.
CREATE OR REPLACE FUNCTION public.create_commerce_purchase(p_purchase jsonb)
RETURNS public.commerce_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_supplier_id uuid := NULLIF(p_purchase ->> 'supplier_id', '')::uuid;
  v_location_id uuid := NULLIF(p_purchase ->> 'business_location_id', '')::uuid;
  v_purchase_date date := COALESCE(NULLIF(p_purchase ->> 'purchase_date', '')::date, current_date);
  v_reference text := NULLIF(btrim(p_purchase ->> 'reference'), '');
  v_notes text := NULLIF(btrim(p_purchase ->> 'notes'), '');
  v_lines jsonb := p_purchase -> 'lines';
  v_line jsonb;
  v_item_id uuid;
  v_quantity numeric(14, 3);
  v_unit_cost numeric(14, 2);
  v_line_total numeric(14, 2);
  v_subtotal numeric(14, 2) := 0;
  v_purchase public.commerce_purchases;
  v_movement public.stock_movements;
BEGIN
  PERFORM public.permission_require('purchases.create');
  IF p_purchase IS NULL OR jsonb_typeof(p_purchase) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_purchase) AS key_name
    WHERE key_name NOT IN ('supplier_id', 'business_location_id', 'purchase_date', 'reference', 'notes', 'lines')
  ) THEN
    RAISE EXCEPTION 'Les données d''achat sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF v_supplier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.commerce_suppliers WHERE id = v_supplier_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Un fournisseur actif est obligatoire pour un achat.' USING ERRCODE = '23503';
  END IF;
  IF v_location_id IS NULL OR NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_locations location_row
    JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
    WHERE location_row.id = v_location_id AND location_row.status = 'ACTIVE' AND unit_row.code = 'COMMERCE'
  ) THEN
    RAISE EXCEPTION 'Magasin Commerce actif introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Un achat doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commerce_purchases(
    purchase_number, supplier_id, business_location_id, purchase_date, reference, notes,
    subtotal_amount, total_amount, created_by, updated_by
  ) VALUES (
    public._internal_next_commerce_purchase_number(), v_supplier_id, v_location_id, v_purchase_date,
    v_reference, v_notes, 0, 0, auth.uid(), auth.uid()
  ) RETURNING * INTO v_purchase;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_line) AS key_name
      WHERE key_name NOT IN ('inventory_item_id', 'quantity', 'unit_cost')
    ) THEN
      RAISE EXCEPTION 'Une ligne d''achat contient une propriété non autorisée.' USING ERRCODE = '22023';
    END IF;
    v_item_id := NULLIF(v_line ->> 'inventory_item_id', '')::uuid;
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_unit_cost := NULLIF(v_line ->> 'unit_cost', '')::numeric;
    IF v_item_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = v_item_id) THEN
      RAISE EXCEPTION 'Article introuvable pour une ligne d''achat.' USING ERRCODE = '23503';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_unit_cost IS NULL OR v_unit_cost <= 0 THEN
      RAISE EXCEPTION 'Quantité ou coût unitaire invalide pour une ligne d''achat.' USING ERRCODE = '22023';
    END IF;
    v_line_total := round(v_quantity * v_unit_cost, 2);
    v_subtotal := v_subtotal + v_line_total;

    -- wallet_id NULL: reception never touches a wallet. business_location_id
    -- set directly (unlike the generic receive_commerce_inventory_item's
    -- insert-then-update dance) so apply_commerce_purchase_cost fires
    -- correctly on this single INSERT.
    INSERT INTO public.stock_movements(
      inventory_item_id, movement_type, quantity, unit_price, wallet_id, business_location_id,
      movement_date, supplier, reference, description, created_by
    ) VALUES (
      v_item_id, 'PURCHASE', v_quantity, v_unit_cost, NULL, v_location_id,
      v_purchase_date, (SELECT display_name FROM public.commerce_suppliers WHERE id = v_supplier_id),
      v_reference, 'Achat fournisseur ' || v_purchase.purchase_number, auth.uid()
    ) RETURNING * INTO v_movement;

    INSERT INTO public.commerce_purchase_lines(purchase_id, inventory_item_id, quantity, unit_cost, line_total, stock_movement_id)
    VALUES (v_purchase.id, v_item_id, v_quantity, v_unit_cost, v_line_total, v_movement.id);

    INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity)
    VALUES (v_location_id, v_item_id, v_quantity)
    ON CONFLICT (business_location_id, inventory_item_id) DO UPDATE
    SET quantity = public.business_location_inventory_items.quantity + EXCLUDED.quantity,
        updated_at = now();

    UPDATE public.inventory_items
    SET stock_actuel = stock_actuel + v_quantity, updated_at = now()
    WHERE id = v_item_id;
  END LOOP;

  UPDATE public.commerce_purchases
  SET subtotal_amount = v_subtotal, total_amount = v_subtotal, updated_at = now()
  WHERE id = v_purchase.id
  RETURNING * INTO v_purchase;

  PERFORM public.business_finance_audit_event('COMMERCE_PURCHASE', v_purchase.id, NULL, 'CREATE', NULL, to_jsonb(v_purchase));
  RETURN v_purchase;
END;
$function$;

ALTER TABLE public.commerce_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_purchase_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_purchases_authorized_read ON public.commerce_purchases
  FOR SELECT TO authenticated USING (public.user_has_permission('purchases.read') AND public.commerce_location_access_allowed(business_location_id));
CREATE POLICY commerce_purchase_lines_authorized_read ON public.commerce_purchase_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.commerce_purchases p
    WHERE p.id = commerce_purchase_lines.purchase_id
      AND public.user_has_permission('purchases.read') AND public.commerce_location_access_allowed(p.business_location_id)
  ));

REVOKE ALL ON TABLE public.commerce_purchases, public.commerce_purchase_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_purchases, public.commerce_purchase_lines TO authenticated;
REVOKE ALL ON FUNCTION public._internal_next_commerce_purchase_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_commerce_purchase(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_purchase(jsonb) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('purchases.read', 'purchases', 'read', 'Consulter les achats fournisseurs.', 'SENSITIVE'),
  ('purchases.create', 'purchases', 'create', 'Enregistrer un achat et sa réception de stock.', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'purchases.read'), ('admin', 'purchases.create'),
  ('comptable', 'purchases.read'),
  ('gestionnaire', 'purchases.read'), ('gestionnaire', 'purchases.create');
