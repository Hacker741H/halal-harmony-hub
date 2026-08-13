-- STORE-02: authoritative store CUMP, immutable sale costs and profitability.
-- Additive only. Existing inventory is deliberately NOT backfilled with an
-- inferred cost: an approved opening cost must be recorded explicitly.

CREATE TABLE public.commercial_sale_line_costs (
  sale_line_id uuid PRIMARY KEY REFERENCES public.commercial_sale_lines(id) ON DELETE RESTRICT,
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost >= 0),
  total_cost numeric(14, 2) NOT NULL CHECK (total_cost >= 0),
  gross_margin numeric(14, 2) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.commerce_inventory_cost_states (
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity_on_hand numeric(14, 3) NOT NULL CHECK (quantity_on_hand >= 0),
  current_unit_cost numeric(14, 4) NOT NULL CHECK (current_unit_cost >= 0),
  inventory_value numeric(16, 2) NOT NULL CHECK (inventory_value >= 0),
  initialized_from text NOT NULL CHECK (initialized_from IN ('OPENING', 'PURCHASE')),
  initialized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_location_id, inventory_item_id),
  CHECK (inventory_value = round(quantity_on_hand * current_unit_cost, 2))
);

CREATE TABLE public.commerce_inventory_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('OPENING', 'PURCHASE', 'SALE')),
  stock_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  sale_line_id uuid REFERENCES public.commercial_sale_lines(id) ON DELETE RESTRICT,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0 OR event_type = 'OPENING'),
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost >= 0),
  total_cost numeric(16, 2) NOT NULL CHECK (total_cost = round(quantity * unit_cost, 2)),
  quantity_before numeric(14, 3) NOT NULL CHECK (quantity_before >= 0),
  quantity_after numeric(14, 3) NOT NULL CHECK (quantity_after >= 0),
  unit_cost_before numeric(14, 4),
  unit_cost_after numeric(14, 4) NOT NULL CHECK (unit_cost_after >= 0),
  justification text,
  approval_actor text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_cost_event_one_source CHECK (
    (event_type = 'OPENING' AND stock_movement_id IS NULL AND sale_line_id IS NULL
      AND justification IS NOT NULL AND btrim(justification) <> ''
      AND approval_actor IS NOT NULL AND btrim(approval_actor) <> '')
    OR (event_type = 'PURCHASE' AND stock_movement_id IS NOT NULL AND sale_line_id IS NULL)
    OR (event_type = 'SALE' AND stock_movement_id IS NOT NULL AND sale_line_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX commerce_inventory_cost_purchase_once_idx
  ON public.commerce_inventory_cost_events(stock_movement_id) WHERE event_type = 'PURCHASE';
CREATE UNIQUE INDEX commerce_inventory_cost_sale_once_idx
  ON public.commerce_inventory_cost_events(sale_line_id) WHERE event_type = 'SALE';
CREATE INDEX commerce_inventory_cost_events_location_date_idx
  ON public.commerce_inventory_cost_events(business_location_id, created_at DESC);

COMMENT ON TABLE public.commerce_inventory_cost_states IS
  'Authoritative current CUMP state per Commerce location and item. No inferred historical backfill.';
COMMENT ON TABLE public.commercial_sale_line_costs IS
  'Protected immutable CUMP snapshot for one article sale line.';

CREATE OR REPLACE FUNCTION public._internal_apply_commerce_purchase_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_state public.commerce_inventory_cost_states;
  v_local_quantity numeric(14, 3) := 0;
  v_new_quantity numeric(14, 3);
  v_new_value numeric(16, 2);
  v_new_cump numeric(14, 4);
BEGIN
  IF NEW.movement_type <> 'PURCHASE' OR NEW.status <> 'VALID'
    OR NEW.business_location_id IS NULL OR NEW.unit_price IS NULL
    OR (TG_OP = 'UPDATE' AND OLD.business_location_id IS NOT DISTINCT FROM NEW.business_location_id) THEN
    RETURN NEW;
  END IF;

  SELECT quantity INTO v_local_quantity
  FROM public.business_location_inventory_items
  WHERE business_location_id = NEW.business_location_id
    AND inventory_item_id = NEW.inventory_item_id
  FOR UPDATE;
  v_local_quantity := COALESCE(v_local_quantity, 0);

  SELECT * INTO v_state
  FROM public.commerce_inventory_cost_states
  WHERE business_location_id = NEW.business_location_id
    AND inventory_item_id = NEW.inventory_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_local_quantity <> 0 THEN
      RAISE EXCEPTION 'Cout d ouverture requis avant ce reapprovisionnement (stock existant: %).', v_local_quantity
        USING ERRCODE = '22023';
    END IF;
    v_state.quantity_on_hand := 0;
    v_state.inventory_value := 0;
    v_state.current_unit_cost := 0;
  ELSIF v_state.quantity_on_hand <> v_local_quantity THEN
    RAISE EXCEPTION 'Ecart entre quantite de stock (%) et quantite valorisee (%).', v_local_quantity, v_state.quantity_on_hand
      USING ERRCODE = '22023';
  END IF;

  v_new_quantity := v_state.quantity_on_hand + NEW.quantity;
  v_new_value := round(v_state.inventory_value + round(NEW.quantity * NEW.unit_price, 2), 2);
  v_new_cump := round(v_new_value / v_new_quantity, 4);
  v_new_value := round(v_new_quantity * v_new_cump, 2);

  INSERT INTO public.commerce_inventory_cost_states(
    business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost,
    inventory_value, initialized_from, updated_at
  ) VALUES (
    NEW.business_location_id, NEW.inventory_item_id, v_new_quantity, v_new_cump,
    v_new_value, 'PURCHASE', now()
  )
  ON CONFLICT (business_location_id, inventory_item_id) DO UPDATE
  SET quantity_on_hand = EXCLUDED.quantity_on_hand,
      current_unit_cost = EXCLUDED.current_unit_cost,
      inventory_value = EXCLUDED.inventory_value,
      updated_at = now();

  INSERT INTO public.commerce_inventory_cost_events(
    business_location_id, inventory_item_id, event_type, stock_movement_id,
    quantity, unit_cost, total_cost, quantity_before, quantity_after,
    unit_cost_before, unit_cost_after, created_by
  ) VALUES (
    NEW.business_location_id, NEW.inventory_item_id, 'PURCHASE', NEW.id,
    NEW.quantity, NEW.unit_price, round(NEW.quantity * NEW.unit_price, 2),
    v_state.quantity_on_hand, v_new_quantity, v_state.current_unit_cost, v_new_cump, auth.uid()
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER apply_commerce_purchase_cost
AFTER INSERT OR UPDATE OF business_location_id ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public._internal_apply_commerce_purchase_cost();

CREATE OR REPLACE FUNCTION public._internal_snapshot_commerce_sale_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_movement public.stock_movements;
  v_line public.commercial_sale_lines;
  v_state public.commerce_inventory_cost_states;
  v_new_quantity numeric(14, 3);
  v_new_value numeric(16, 2);
BEGIN
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = NEW.stock_movement_id FOR UPDATE;
  SELECT * INTO v_line FROM public.commercial_sale_lines WHERE id = NEW.sale_line_id FOR UPDATE;

  IF v_line.line_type <> 'ARTICLE' OR v_line.inventory_item_id IS NULL
    OR v_movement.movement_type <> 'SALE' OR v_movement.status <> 'VALID'
    OR v_movement.business_location_id IS NULL
    OR v_movement.inventory_item_id <> v_line.inventory_item_id
    OR v_movement.quantity <> v_line.quantity THEN
    RAISE EXCEPTION 'Lien vente-stock incoherent pour la valorisation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state FROM public.commerce_inventory_cost_states
  WHERE business_location_id = v_movement.business_location_id
    AND inventory_item_id = v_movement.inventory_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUMP indisponible pour cet article et ce magasin.' USING ERRCODE = '22023';
  END IF;
  IF v_state.quantity_on_hand < v_line.quantity THEN
    RAISE EXCEPTION 'Stock valorise insuffisant (% disponible, % vendu).', v_state.quantity_on_hand, v_line.quantity
      USING ERRCODE = '22023';
  END IF;

  v_new_quantity := v_state.quantity_on_hand - v_line.quantity;
  v_new_value := round(v_new_quantity * v_state.current_unit_cost, 2);

  INSERT INTO public.commercial_sale_line_costs(sale_line_id, unit_cost, total_cost, gross_margin)
  VALUES(v_line.id, v_state.current_unit_cost,
    round(v_line.quantity * v_state.current_unit_cost, 2),
    round(v_line.line_total - round(v_line.quantity * v_state.current_unit_cost, 2), 2));

  UPDATE public.commerce_inventory_cost_states
  SET quantity_on_hand = v_new_quantity, inventory_value = v_new_value, updated_at = now()
  WHERE business_location_id = v_movement.business_location_id
    AND inventory_item_id = v_movement.inventory_item_id;

  INSERT INTO public.commerce_inventory_cost_events(
    business_location_id, inventory_item_id, event_type, stock_movement_id, sale_line_id,
    quantity, unit_cost, total_cost, quantity_before, quantity_after,
    unit_cost_before, unit_cost_after, created_by
  ) VALUES (
    v_movement.business_location_id, v_movement.inventory_item_id, 'SALE', v_movement.id, v_line.id,
    v_line.quantity, v_state.current_unit_cost, round(v_line.quantity * v_state.current_unit_cost, 2),
    v_state.quantity_on_hand, v_new_quantity, v_state.current_unit_cost, v_state.current_unit_cost, auth.uid()
  );
  RETURN NEW;
END;
$function$;

CREATE TABLE public.commerce_store_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  wallet_id uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('RENT','ELECTRICITY','WATER','INTERNET','TRANSPORT','MAINTENANCE','REPAIR','SUPPLIES','SALARY_BONUS','TAX_FEE','OTHER')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  reference text,
  description text NOT NULL CHECK (btrim(description) <> ''),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'DRAFT' AND confirmed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'CONFIRMED' AND wallet_id IS NOT NULL AND confirmed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL))
);

CREATE TABLE public.finance_commerce_store_expense_links (
  store_expense_id uuid PRIMARY KEY REFERENCES public.commerce_store_expenses(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_store_expenses_location_date_idx
  ON public.commerce_store_expenses(business_location_id, expense_date DESC);

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
 ('store.financial.read','store','financial_read','Consulter couts, marges et resultat magasin.','CRITICAL'),
 ('store.stock_valuation.read','store','stock_valuation_read','Consulter le CUMP et la valorisation du stock.','CRITICAL'),
 ('store.expenses.read','store','expenses_read','Consulter les depenses magasin.','CRITICAL'),
 ('store.expenses.create','store','expenses_create','Preparer une depense magasin.','CRITICAL'),
 ('store.expenses.confirm','store','expenses_confirm','Confirmer ou annuler une depense magasin.','CRITICAL')
ON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, action=EXCLUDED.action,
 description=EXCLUDED.description, sensitivity=EXCLUDED.sensitivity, updated_at=now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
 ('super_admin','store.financial.read'),('super_admin','store.stock_valuation.read'),('super_admin','store.expenses.read'),('super_admin','store.expenses.create'),('super_admin','store.expenses.confirm'),
 ('admin','store.financial.read'),('admin','store.stock_valuation.read'),('admin','store.expenses.read'),('admin','store.expenses.create'),('admin','store.expenses.confirm'),
 ('gestionnaire','store.financial.read'),('gestionnaire','store.stock_valuation.read'),('gestionnaire','store.expenses.read'),('gestionnaire','store.expenses.create'),('gestionnaire','store.expenses.confirm'),
 ('comptable','store.financial.read'),('comptable','store.stock_valuation.read'),('comptable','store.expenses.read'),('comptable','store.expenses.create'),('comptable','store.expenses.confirm')
) grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code=grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.initialize_commerce_inventory_opening_cost(
  p_location_id uuid, p_inventory_item_id uuid, p_opening_quantity numeric,
  p_unit_cost numeric, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_quantity numeric(14,3);
  v_opening_quantity numeric(14,3):=round(p_opening_quantity,3);
  v_cost numeric(14,4):=round(p_unit_cost,4);
  v_reason text:=NULLIF(btrim(p_reason),'');
BEGIN
  PERFORM public.permission_require('store.stock_valuation.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
  IF v_opening_quantity IS NULL OR v_opening_quantity < 0 OR v_cost IS NULL OR v_cost < 0 OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Quantite, cout et justification d ouverture obligatoires.' USING ERRCODE='22023';
  END IF;
  SELECT quantity INTO v_quantity FROM public.business_location_inventory_items
   WHERE business_location_id=p_location_id AND inventory_item_id=p_inventory_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article non affecte a ce magasin.' USING ERRCODE='P0002'; END IF;
  IF v_opening_quantity <> v_quantity THEN
    RAISE EXCEPTION 'Quantite d ouverture (%) differente du stock reel (%).',v_opening_quantity,v_quantity USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commerce_inventory_cost_states WHERE business_location_id=p_location_id AND inventory_item_id=p_inventory_item_id) THEN
    RAISE EXCEPTION 'La valorisation de cet article est deja initialisee.' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.commerce_inventory_cost_states VALUES(p_location_id,p_inventory_item_id,v_quantity,v_cost,round(v_quantity*v_cost,2),'OPENING',now(),now());
  INSERT INTO public.commerce_inventory_cost_events(
    business_location_id,inventory_item_id,event_type,quantity,unit_cost,total_cost,
    quantity_before,quantity_after,unit_cost_before,unit_cost_after,
    justification,approval_actor,created_by
  ) VALUES(
    p_location_id,p_inventory_item_id,'OPENING',v_quantity,v_cost,round(v_quantity*v_cost,2),
    v_quantity,v_quantity,NULL,v_cost,v_reason,auth.uid()::text,auth.uid()
  );
  PERFORM public.business_finance_audit_event('COMMERCE_COST_OPENING',p_inventory_item_id,NULL,'CREATE',NULL,jsonb_build_object('location_id',p_location_id,'quantity',v_quantity,'unit_cost',v_cost,'reason',v_reason));
  RETURN jsonb_build_object('quantity',v_quantity,'unitCost',v_cost,'inventoryValue',round(v_quantity*v_cost,2));
END;$function$;

-- Approved STORE-02 opening valuation. This records valuation only: it does
-- not create a stock movement, finance operation, expense or wallet entry.
DO $approved_opening$
DECLARE
  v_location_id constant uuid := 'ea6525b1-1a39-407d-b5c8-0c9c1d75fce9';
  v_item_id constant uuid := '9674bf77-f1e4-4355-a684-b7623e1a4dd2';
  v_purchase_id constant uuid := '082f70b3-370c-4d2f-ad6c-bc746385d6bf';
  v_quantity constant numeric(14,3) := 4;
  v_unit_cost constant numeric(14,4) := 350;
  v_justification constant text := 'Reprise de valorisation STORE-02 approuvee manuellement. Stock magasin constate : 4 unites. Cout unitaire d ouverture approuve : 350 FCFA. Reference disponible : PURCHASE VALID 082f70b3-370c-4d2f-ad6c-bc746385d6bf, 5 unites a 350 FCFA le 11/08/2026. La sortie historique d une unite n est pas tracable dans les donnees disponibles ; cette initialisation constitue une decision d ouverture et non une reconstitution historique certifiee.';
  v_approval_actor constant text := 'Gestionnaire - approbation manuelle STORE-02D';
  v_actual_quantity numeric(14,3);
BEGIN
  SELECT quantity INTO v_actual_quantity
  FROM public.business_location_inventory_items
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_actual_quantity <> v_quantity THEN
    RAISE EXCEPTION 'Ouverture STORE-02 refusee: stock attendu %, stock reel %.',v_quantity,v_actual_quantity
      USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE id=v_purchase_id AND business_location_id=v_location_id
      AND inventory_item_id=v_item_id AND movement_type='PURCHASE'
      AND status='VALID' AND quantity=5 AND unit_price=350
      AND movement_date=DATE '2026-08-11'
  ) THEN
    RAISE EXCEPTION 'Reference PURCHASE VALID approuvee introuvable ou modifiee.' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.commerce_inventory_cost_states(
    business_location_id,inventory_item_id,quantity_on_hand,current_unit_cost,
    inventory_value,initialized_from
  ) VALUES(v_location_id,v_item_id,v_quantity,v_unit_cost,1400,'OPENING');

  INSERT INTO public.commerce_inventory_cost_events(
    business_location_id,inventory_item_id,event_type,quantity,unit_cost,total_cost,
    quantity_before,quantity_after,unit_cost_before,unit_cost_after,
    justification,approval_actor
  ) VALUES(
    v_location_id,v_item_id,'OPENING',v_quantity,v_unit_cost,1400,
    v_quantity,v_quantity,NULL,v_unit_cost,v_justification,v_approval_actor
  );

  PERFORM public.business_finance_audit_event(
    'COMMERCE_COST_OPENING',v_item_id,NULL,'CREATE',NULL,
    jsonb_build_object(
      'location_id',v_location_id,'inventory_item_id',v_item_id,
      'quantity',v_quantity,'unit_cost',v_unit_cost,'inventory_value',1400,
      'justification',v_justification,'approval_actor',v_approval_actor,
      'migration','20260813120000_add_store_costing_and_profitability.sql'
    )
  );
END;
$approved_opening$;

-- The blocking sale trigger is activated only if every positive Commerce
-- stock has been explicitly valued in this same transaction. If one opening
-- cost is missing, the migration rolls back completely and the production POS
-- keeps its pre-STORE-02 behavior without any interruption window.
DO $activation_guard$
DECLARE
  v_missing record;
BEGIN
  SELECT location_item.business_location_id, location_item.inventory_item_id, location_item.quantity
  INTO v_missing
  FROM public.business_location_inventory_items AS location_item
  LEFT JOIN public.commerce_inventory_cost_states AS cost_state
    USING (business_location_id, inventory_item_id)
  WHERE location_item.quantity > 0
    AND cost_state.inventory_item_id IS NULL
  ORDER BY location_item.business_location_id, location_item.inventory_item_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Activation CUMP refusee: stock positif sans cout d ouverture (magasin %, article %, quantite %).',
      v_missing.business_location_id, v_missing.inventory_item_id, v_missing.quantity
      USING ERRCODE='22023';
  END IF;
END;
$activation_guard$;

CREATE TRIGGER snapshot_commerce_sale_cost
AFTER INSERT ON public.commercial_sale_stock_movement_links
FOR EACH ROW EXECUTE FUNCTION public._internal_snapshot_commerce_sale_cost();

CREATE OR REPLACE FUNCTION public.create_commerce_store_expense(p_expense jsonb)
RETURNS public.commerce_store_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_expense public.commerce_store_expenses; v_location uuid:=NULLIF(p_expense->>'business_location_id','')::uuid;
BEGIN
 PERFORM public.permission_require('store.expenses.create');
 IF NOT public.commerce_location_access_allowed(v_location) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.commerce_store_expenses(business_location_id,category,amount,expense_date,reference,description,created_by)
 VALUES(v_location,upper(p_expense->>'category'),(p_expense->>'amount')::numeric,COALESCE(NULLIF(p_expense->>'expense_date','')::date,current_date),NULLIF(btrim(p_expense->>'reference'),''),NULLIF(btrim(p_expense->>'description'),''),auth.uid()) RETURNING * INTO v_expense;
 PERFORM public.business_finance_audit_event('COMMERCE_STORE_EXPENSE',v_expense.id,NULL,'CREATE',NULL,to_jsonb(v_expense)); RETURN v_expense;
END;$function$;

CREATE OR REPLACE FUNCTION public.confirm_commerce_store_expense(p_expense_id uuid,p_wallet_id uuid)
RETURNS public.commerce_store_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_before public.commerce_store_expenses; v_expense public.commerce_store_expenses; v_operation public.finance_operations;
BEGIN
 PERFORM public.permission_require('store.expenses.confirm'); SELECT * INTO v_before FROM public.commerce_store_expenses WHERE id=p_expense_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Depense introuvable.' USING ERRCODE='P0002'; END IF;
 IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
 IF v_before.status='CONFIRMED' THEN RETURN v_before; END IF; IF v_before.status<>'DRAFT' THEN RAISE EXCEPTION 'Seule une depense brouillon peut etre confirmee.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_location_wallets WHERE business_location_id=v_before.business_location_id AND wallet_id=p_wallet_id AND is_active AND purpose IN('CASH_DRAWER','OPERATING')) THEN RAISE EXCEPTION 'Wallet non autorise pour ce magasin.' USING ERRCODE='23503'; END IF;
 UPDATE public.commerce_store_expenses SET wallet_id=p_wallet_id,status='CONFIRMED',confirmed_by=auth.uid(),confirmed_at=now(),updated_at=now() WHERE id=p_expense_id RETURNING * INTO v_expense;
 v_operation:=public.business_upsert_finance_operation(NULL,p_wallet_id,'EXPENSE',v_expense.amount,v_expense.expense_date,'DEPENSE MAGASIN - '||v_expense.category,v_expense.description,'COMMERCE_STORE_EXPENSE','COMMERCE_STORE_EXPENSE',v_expense.id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,v_expense.reference);
 INSERT INTO public.finance_commerce_store_expense_links VALUES(v_expense.id,v_operation.id,now());
 PERFORM public.business_finance_audit_event('COMMERCE_STORE_EXPENSE',v_expense.id,v_operation.id,'UPDATE',to_jsonb(v_before),to_jsonb(v_expense)); RETURN v_expense;
END;$function$;

CREATE OR REPLACE FUNCTION public.cancel_commerce_store_expense(p_expense_id uuid,p_reason text)
RETURNS public.commerce_store_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_before public.commerce_store_expenses; v_expense public.commerce_store_expenses; v_operation_id uuid; v_reason text:=NULLIF(btrim(p_reason),'');
BEGIN
 PERFORM public.permission_require('store.expenses.confirm'); SELECT * INTO v_before FROM public.commerce_store_expenses WHERE id=p_expense_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Depense introuvable.' USING ERRCODE='P0002'; END IF;
 IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
 IF v_before.status='CANCELLED' THEN RETURN v_before; END IF; IF v_reason IS NULL THEN RAISE EXCEPTION 'Motif d annulation obligatoire.' USING ERRCODE='22023'; END IF;
 SELECT operation_id INTO v_operation_id FROM public.finance_commerce_store_expense_links WHERE store_expense_id=p_expense_id;
 IF v_before.status='CONFIRMED' THEN PERFORM public.business_cancel_finance_operation(v_operation_id); END IF;
 UPDATE public.commerce_store_expenses SET status='CANCELLED',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=v_reason,updated_at=now() WHERE id=p_expense_id RETURNING * INTO v_expense;
 PERFORM public.business_finance_audit_event('COMMERCE_STORE_EXPENSE',v_expense.id,v_operation_id,'CANCEL',to_jsonb(v_before),to_jsonb(v_expense)); RETURN v_expense;
END;$function$;

CREATE OR REPLACE FUNCTION public.get_commerce_store_stock_valuation(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
 PERFORM public.permission_require('store.stock_valuation.read'); IF NOT public.commerce_location_access_allowed(p_location_id) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('isComplete',count(*)=count(cost_state.inventory_item_id),'itemCount',count(*),'valuedItemCount',count(cost_state.inventory_item_id),'costValue',CASE WHEN count(*)=count(cost_state.inventory_item_id) THEN COALESCE(sum(cost_state.inventory_value),0) ELSE NULL END,'potentialSaleValue',COALESCE(sum(local_item.quantity*local_item.sale_price),0),'potentialMargin',CASE WHEN count(*)=count(cost_state.inventory_item_id) THEN COALESCE(sum(local_item.quantity*local_item.sale_price),0)-COALESCE(sum(cost_state.inventory_value),0) ELSE NULL END)
 INTO v_result FROM public.business_location_inventory_items local_item LEFT JOIN public.commerce_inventory_cost_states cost_state USING(business_location_id,inventory_item_id) WHERE local_item.business_location_id=p_location_id;
 RETURN v_result;
END;$function$;

CREATE OR REPLACE FUNCTION public.get_commerce_store_profitability(p_location_id uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
 PERFORM public.permission_require('store.financial.read'); IF NOT public.commerce_location_access_allowed(p_location_id) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'Periode invalide.' USING ERRCODE='22023'; END IF;
 WITH sales AS (SELECT COALESCE(sum(l.line_total) FILTER(WHERE l.line_type='ARTICLE'),0) article_revenue,COALESCE(sum(l.line_total) FILTER(WHERE l.line_type='SERVICE'),0) service_revenue,COALESCE(sum(l.line_total),0) total_revenue,COALESCE(sum(line_cost.total_cost) FILTER(WHERE l.line_type='ARTICLE'),0) cogs,count(*) FILTER(WHERE l.line_type='ARTICLE' AND line_cost.sale_line_id IS NULL) uncosted FROM public.commercial_sales s JOIN public.commercial_sale_lines l ON l.sale_id=s.id LEFT JOIN public.commercial_sale_line_costs line_cost ON line_cost.sale_line_id=l.id WHERE s.business_location_id=p_location_id AND s.status='CONFIRMED' AND s.sale_date BETWEEN p_from AND p_to), expenses AS (SELECT COALESCE(sum(e.amount),0) operating_expenses FROM public.commerce_store_expenses e JOIN public.finance_commerce_store_expense_links link ON link.store_expense_id=e.id JOIN public.finance_operations op ON op.id=link.operation_id WHERE e.business_location_id=p_location_id AND e.status='CONFIRMED' AND COALESCE(op.status,'VALIDE')<>'CANCELLED' AND e.expense_date BETWEEN p_from AND p_to)
 SELECT jsonb_build_object('from',p_from,'to',p_to,'isComplete',sales.uncosted=0,'articleRevenue',sales.article_revenue,'serviceRevenue',sales.service_revenue,'totalRevenue',sales.total_revenue,'costOfGoodsSold',CASE WHEN sales.uncosted=0 THEN sales.cogs ELSE NULL END,'grossMargin',CASE WHEN sales.uncosted=0 THEN sales.total_revenue-sales.cogs ELSE NULL END,'operatingExpenses',expenses.operating_expenses,'netResult',CASE WHEN sales.uncosted=0 THEN sales.total_revenue-sales.cogs-expenses.operating_expenses ELSE NULL END) INTO v_result FROM sales CROSS JOIN expenses; RETURN v_result;
END;$function$;

ALTER TABLE public.commerce_inventory_cost_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_inventory_cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_sale_line_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_store_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_commerce_store_expense_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_store_expenses_authorized_read ON public.commerce_store_expenses FOR SELECT TO authenticated USING(public.user_has_permission('store.expenses.read') AND public.commerce_location_access_allowed(business_location_id));

REVOKE ALL ON TABLE public.commerce_inventory_cost_states,public.commerce_inventory_cost_events,public.commercial_sale_line_costs,public.finance_commerce_store_expense_links FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.commerce_store_expenses FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._internal_apply_commerce_purchase_cost(),public._internal_snapshot_commerce_sale_cost() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.initialize_commerce_inventory_opening_cost(uuid,uuid,numeric,numeric,text),public.create_commerce_store_expense(jsonb),public.confirm_commerce_store_expense(uuid,uuid),public.cancel_commerce_store_expense(uuid,text),public.get_commerce_store_stock_valuation(uuid),public.get_commerce_store_profitability(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.initialize_commerce_inventory_opening_cost(uuid,uuid,numeric,numeric,text),public.create_commerce_store_expense(jsonb),public.confirm_commerce_store_expense(uuid,uuid),public.cancel_commerce_store_expense(uuid,text),public.get_commerce_store_stock_valuation(uuid),public.get_commerce_store_profitability(uuid,date,date) TO authenticated;
