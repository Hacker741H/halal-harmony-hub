-- CM-03: a location-scoped point of sale.  This extends the shared commerce
-- foundation without creating a second ledger or allowing direct wallet edits.

INSERT INTO public.roles(code, label, description, is_system, is_active)
VALUES ('caissier', 'Caissier', 'Encaisse les ventes de son point de vente affecté.', true, true)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label, description = EXCLUDED.description, is_active = true, updated_at = now();

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('commerce.pos.read', 'commerce', 'pos_read', 'Consulter la caisse et le catalogue du point de vente affecté.', 'SENSITIVE'),
  ('commerce.pos.sell', 'commerce', 'pos_sell', 'Enregistrer une vente comptant dans le point de vente affecté.', 'CRITICAL'),
  ('commerce.stock.read', 'commerce', 'stock_read', 'Consulter le stock disponible du point de vente affecté.', 'SENSITIVE'),
  ('commerce.stock.receive', 'commerce', 'stock_receive', 'Réceptionner le stock d’un point de vente autorisé.', 'CRITICAL'),
  ('commerce.cash.read', 'commerce', 'cash_read', 'Consulter les encaissements de caisse autorisés.', 'SENSITIVE'),
  ('commerce.cash.close', 'commerce', 'cash_close', 'Déclarer une remise de caisse pour contrôle Finance.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity, updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('caissier', 'commerce.pos.read'), ('caissier', 'commerce.pos.sell'), ('caissier', 'commerce.stock.read'), ('caissier', 'commerce.cash.read'), ('caissier', 'commerce.cash.close'),
  ('gestionnaire', 'commerce.pos.read'), ('gestionnaire', 'commerce.pos.sell'), ('gestionnaire', 'commerce.stock.read'), ('gestionnaire', 'commerce.stock.receive'), ('gestionnaire', 'commerce.cash.read'), ('gestionnaire', 'commerce.cash.close'),
  ('comptable', 'commerce.pos.read'), ('comptable', 'commerce.cash.read'), ('comptable', 'commerce.cash.close'),
  ('stocks', 'commerce.pos.read'), ('stocks', 'commerce.stock.read'), ('stocks', 'commerce.stock.receive'),
  ('admin', 'commerce.pos.read'), ('admin', 'commerce.pos.sell'), ('admin', 'commerce.stock.read'), ('admin', 'commerce.stock.receive'), ('admin', 'commerce.cash.read'), ('admin', 'commerce.cash.close')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.business_location_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  sale_price numeric(14, 2) CHECK (sale_price IS NULL OR sale_price >= 0),
  reorder_level numeric(14, 3) CHECK (reorder_level IS NULL OR reorder_level >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_location_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS public.commerce_cash_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  source_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  destination_wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  remittance_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED', 'CONFIRMED', 'CANCELLED')),
  reference text,
  notes text,
  declared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_wallet_id <> destination_wallet_id)
);

CREATE TABLE IF NOT EXISTS public.finance_commerce_cash_remittance_links (
  remittance_id uuid NOT NULL REFERENCES public.commerce_cash_remittances(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remittance_id, operation_id),
  UNIQUE (remittance_id)
);

CREATE INDEX IF NOT EXISTS business_location_inventory_lookup_idx ON public.business_location_inventory_items(business_location_id, inventory_item_id);
CREATE INDEX IF NOT EXISTS commerce_cash_remittances_location_status_idx ON public.commerce_cash_remittances(business_location_id, status, remittance_date DESC);

-- Corrects an edge case in CM-02: reassigning with an earlier historical date
-- must never produce an invalid end_date < start_date row.
CREATE OR REPLACE FUNCTION public.assign_business_location_user(p_assignment jsonb)
RETURNS public.business_location_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_assignment public.business_location_assignments;
  v_location_id uuid := NULLIF(p_assignment ->> 'business_location_id', '')::uuid;
  v_user_id uuid := NULLIF(p_assignment ->> 'user_id', '')::uuid;
  v_role text := upper(coalesce(NULLIF(btrim(p_assignment ->> 'assignment_role'), ''), 'CASHIER'));
  v_start_date date := coalesce(NULLIF(p_assignment ->> 'start_date', '')::date, current_date);
  v_notes text := NULLIF(btrim(p_assignment ->> 'notes'), '');
BEGIN
  PERFORM public.permission_require('locations.assign');
  IF v_location_id IS NULL OR v_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.business_locations WHERE id = v_location_id AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Utilisateur ou point d’exploitation introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_role NOT IN ('CASHIER', 'STORE_MANAGER', 'STOCK_KEEPER', 'SALES_AGENT', 'OTHER') THEN
    RAISE EXCEPTION 'Rôle d’affectation invalide.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.business_location_assignments
  SET end_date = GREATEST(v_start_date, start_date), ended_by = auth.uid(), updated_at = now()
  WHERE business_location_id = v_location_id AND user_id = v_user_id AND end_date IS NULL;
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, notes, assigned_by)
  VALUES (v_location_id, v_user_id, v_role, v_start_date, v_notes, auth.uid()) RETURNING * INTO v_assignment;
  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION_ASSIGNMENT', v_assignment.id, NULL, 'ASSIGN', NULL, to_jsonb(v_assignment));
  RETURN v_assignment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commerce_location_access_allowed(p_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.business_location_is_assigned_to_current_user(p_location_id)
    OR public.user_has_permission('locations.manage')
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_commerce_pos_workspace(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.pos.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'location', jsonb_build_object('id', location_row.id, 'name', location_row.name, 'code', location_row.code),
    'wallets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', wallet_row.id, 'name', wallet_row.name, 'purpose', mapping.purpose, 'isPrimary', mapping.is_primary) ORDER BY mapping.is_primary DESC, wallet_row.name)
      FROM public.business_location_wallets mapping JOIN public.wallets wallet_row ON wallet_row.id = mapping.wallet_id
      WHERE mapping.business_location_id = p_location_id AND mapping.is_active), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', item.id, 'name', item.nom, 'sku', item.sku, 'unit', item.unite, 'quantity', local_item.quantity, 'salePrice', local_item.sale_price, 'reorderLevel', local_item.reorder_level) ORDER BY item.nom)
      FROM public.business_location_inventory_items local_item JOIN public.inventory_items item ON item.id = local_item.inventory_item_id
      WHERE local_item.business_location_id = p_location_id), '[]'::jsonb),
    'today', jsonb_build_object('saleCount', (SELECT count(*) FROM public.commercial_sales sale WHERE sale.business_location_id = p_location_id AND sale.status = 'CONFIRMED' AND sale.sale_date = current_date),
      'received', COALESCE((SELECT sum(payment.amount) FROM public.commercial_invoice_payments payment JOIN public.commercial_sales sale ON sale.id = payment.sale_id WHERE sale.business_location_id = p_location_id AND payment.status = 'CONFIRMED' AND payment.payment_date = current_date), 0))
  ) INTO v_result FROM public.business_locations location_row JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = p_location_id AND location_row.status = 'ACTIVE' AND unit_row.code = 'COMMERCE';
  IF v_result IS NULL THEN RAISE EXCEPTION 'Point de vente Commerce introuvable ou archivé.' USING ERRCODE = 'P0002'; END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_commerce_cash_sale(p_sale jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_sale ->> 'business_location_id', '')::uuid;
  v_client_id uuid := NULLIF(p_sale ->> 'client_id', '')::uuid;
  v_wallet_id uuid := NULLIF(p_sale ->> 'wallet_id', '')::uuid;
  v_payment_method text := upper(coalesce(NULLIF(btrim(p_sale ->> 'payment_method'), ''), 'CASH'));
  v_reference text := NULLIF(btrim(p_sale ->> 'reference'), '');
  v_notes text := NULLIF(btrim(p_sale ->> 'notes'), '');
  v_sale public.commercial_sales; v_invoice public.commercial_invoices; v_payment public.commercial_invoice_payments;
  v_operation public.finance_operations; v_client public.transport_clients; v_line jsonb; v_item public.inventory_items;
  v_local public.business_location_inventory_items; v_line_id uuid; v_quantity numeric(14,3); v_price numeric(14,2); v_total numeric(14,2) := 0; v_stock_movement public.stock_movements;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');
  IF p_sale IS NULL OR jsonb_typeof(p_sale) <> 'object' OR jsonb_typeof(p_sale -> 'lines') <> 'array' OR jsonb_array_length(p_sale -> 'lines') = 0 THEN RAISE EXCEPTION 'La vente caisse doit contenir au moins un article.' USING ERRCODE = '22023'; END IF;
  IF v_location_id IS NULL OR v_client_id IS NULL OR v_wallet_id IS NULL OR NOT public.commerce_location_access_allowed(v_location_id) THEN RAISE EXCEPTION 'Point de vente, client ou wallet non autorisé.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_location_wallets WHERE business_location_id = v_location_id AND wallet_id = v_wallet_id AND is_active AND purpose IN ('CASH_DRAWER', 'COLLECTION')) THEN RAISE EXCEPTION 'Le wallet doit être affecté à la caisse de ce point de vente.' USING ERRCODE = '23503'; END IF;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_client_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Client actif introuvable.' USING ERRCODE = '23503'; END IF;
  IF v_payment_method NOT IN ('CASH', 'WAVE', 'JEKO', 'CARD', 'OTHER') THEN RAISE EXCEPTION 'Moyen de paiement invalide.' USING ERRCODE = '22023'; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric; v_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
    SELECT * INTO v_local FROM public.business_location_inventory_items WHERE business_location_id = v_location_id AND inventory_item_id = NULLIF(v_line ->> 'inventory_item_id', '')::uuid FOR UPDATE;
    IF NOT FOUND OR v_quantity IS NULL OR v_quantity <= 0 OR v_price IS NULL OR v_price < 0 OR v_local.quantity < v_quantity THEN RAISE EXCEPTION 'Article, quantité ou prix de vente invalide.' USING ERRCODE = '22023'; END IF;
    v_total := v_total + round(v_quantity * v_price, 2);
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Le total de la vente doit être strictement positif.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.commercial_sales(sale_number, status, client_id, sale_date, reference, notes, business_unit_id, business_location_id, created_by, updated_by, confirmed_at)
  SELECT public._internal_next_commercial_sale_number(), 'CONFIRMED', v_client_id, current_date, v_reference, v_notes, unit_row.id, v_location_id, auth.uid(), auth.uid(), now() FROM public.business_locations location_row JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id WHERE location_row.id = v_location_id RETURNING * INTO v_sale;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sale -> 'lines') LOOP
    v_quantity := (v_line ->> 'quantity')::numeric; v_price := (v_line ->> 'unit_price')::numeric;
    SELECT * INTO v_item FROM public.inventory_items WHERE id = (v_line ->> 'inventory_item_id')::uuid;
    INSERT INTO public.commercial_sale_lines(sale_id, description, quantity, unit, unit_price, line_total, inventory_item_id) VALUES (v_sale.id, v_item.nom, v_quantity, coalesce(v_item.unite, 'UNITE'), v_price, round(v_quantity * v_price, 2), v_item.id) RETURNING id INTO v_line_id;
    UPDATE public.business_location_inventory_items SET quantity = quantity - v_quantity, updated_at = now() WHERE business_location_id = v_location_id AND inventory_item_id = v_item.id;
    UPDATE public.inventory_items SET stock_actuel = stock_actuel - v_quantity, updated_at = now() WHERE id = v_item.id;
    INSERT INTO public.stock_movements(inventory_item_id, movement_type, quantity, unit_price, wallet_id, movement_date, client, reference, description, status, created_by, business_location_id)
    VALUES (v_item.id, 'SALE', v_quantity, v_price, v_wallet_id, current_date, v_client.display_name, v_sale.sale_number, 'Vente caisse ' || v_sale.sale_number, 'VALID', auth.uid(), v_location_id) RETURNING * INTO v_stock_movement;
    INSERT INTO public.commercial_sale_stock_movement_links(sale_line_id, stock_movement_id) VALUES (v_line_id, v_stock_movement.id);
  END LOOP;
  INSERT INTO public.commercial_invoices(invoice_number, sale_id, client_id, status, issue_date, issued_at, subtotal_amount, tax_rate, tax_amount, total_amount, created_by, updated_by)
  VALUES (public._internal_next_commercial_invoice_number(), v_sale.id, v_client_id, 'PAID', current_date, now(), v_total, 0, 0, v_total, auth.uid(), auth.uid()) RETURNING * INTO v_invoice;
  INSERT INTO public.commercial_invoice_payments(invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind, reference, notes, created_by, updated_by, confirmed_at)
  VALUES (v_invoice.id, v_sale.id, v_wallet_id, v_total, current_date, 'CONFIRMED', 'PAYMENT', coalesce(v_reference, v_sale.sale_number), v_notes, auth.uid(), auth.uid(), now()) RETURNING * INTO v_payment;
  INSERT INTO public.finance_operations(wallet_id, type, amount, operation_date, category, description, reference, status, origin, module, module_id, payment_method, client, created_by)
  VALUES (v_wallet_id, 'REVENUE', v_total, current_date, 'VENTE MAGASIN', 'Encaissement caisse ' || v_invoice.invoice_number, coalesce(v_reference, v_payment.id::text), 'VALIDE', 'COMMERCE_POS_PAYMENT', 'COMMERCIAL_INVOICE_PAYMENT', v_payment.id, v_payment_method, v_client.display_name, auth.uid()) RETURNING * INTO v_operation;
  INSERT INTO public.finance_links(finance_operation_id, module, module_record_id) VALUES (v_operation.id, 'COMMERCIAL_INVOICE_PAYMENT', v_payment.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.finance_commercial_invoice_payment_links(payment_id, operation_id, link_type) VALUES (v_payment.id, v_operation.id, 'PAYMENT');
  PERFORM public.update_wallet_balance(v_wallet_id);
  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, v_operation.id, 'CREATE', NULL, jsonb_build_object('sale', to_jsonb(v_sale), 'invoice', to_jsonb(v_invoice), 'payment', to_jsonb(v_payment)));
  RETURN jsonb_build_object('saleId', v_sale.id, 'saleNumber', v_sale.sale_number, 'invoiceNumber', v_invoice.invoice_number, 'paymentId', v_payment.id, 'operationId', v_operation.id, 'amount', v_total);
END;
$function$;

ALTER TABLE public.business_location_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cash_remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_commerce_cash_remittance_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_location_inventory_items_read ON public.business_location_inventory_items FOR SELECT TO authenticated USING (public.commerce_location_access_allowed(business_location_id) AND public.user_has_permission('commerce.stock.read'));
CREATE POLICY commerce_cash_remittances_read ON public.commerce_cash_remittances FOR SELECT TO authenticated USING (public.commerce_location_access_allowed(business_location_id) AND public.user_has_permission('commerce.cash.read'));
REVOKE ALL ON TABLE public.business_location_inventory_items, public.commerce_cash_remittances, public.finance_commerce_cash_remittance_links FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_location_access_allowed(uuid), public.get_commerce_pos_workspace(uuid), public.create_commerce_cash_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_workspace(uuid), public.create_commerce_cash_sale(jsonb) TO authenticated;
