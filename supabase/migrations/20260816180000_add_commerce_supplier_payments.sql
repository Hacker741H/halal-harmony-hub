-- GFC V1 Phase 3 -- Fournisseurs/Achats. Supplier payments -- the only
-- point in the whole fournisseur domain that touches Finance/wallet.
-- Mirrors commercial_invoice_payments' proven lifecycle exactly (PLANNED/
-- RECEIVED -> CONFIRMED, or CANCELLED with a reversal), and reuses the
-- exact canonical write path decided in Phase 2:
-- business_upsert_finance_operation, authorized by the calling RPC's own
-- scoped permission (purchases.payments) alone -- no redundant broad gate.
--
-- Finance semantics, per the mandatory Phase 3A audit: type='EXPENSE' for
-- the wallet-decrease direction (the only structurally fitting type --
-- TRANSFER would require an internal destination_wallet_id, which does not
-- apply to an external supplier). Linked via the NEW
-- finance_supplier_payment_links table, never finance_commerce_store_
-- expense_links -- get_commerce_store_profitability's operatingExpenses
-- only ever joins through that specific table, so a supplier payment is
-- structurally excluded from "resultat magasin", exactly like a stock
-- purchase already is today. No new finance_operations.type needed.
--
-- Debt is never stored mutable: get_commerce_purchase_financial_summary
-- always derives it as total_amount - sum(CONFIRMED payments), the same
-- principle already proven by get_commercial_sale_financial_summary.

CREATE TABLE public.commerce_supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.commerce_purchases(id),
  supplier_id uuid NOT NULL REFERENCES public.commerce_suppliers(id),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'RECEIVED', 'CONFIRMED', 'CANCELLED')),
  reference text,
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commerce_supplier_payments_purchase_idx ON public.commerce_supplier_payments(purchase_id);
CREATE INDEX commerce_supplier_payments_supplier_idx ON public.commerce_supplier_payments(supplier_id);

CREATE TABLE public.finance_supplier_payment_links (
  payment_id uuid NOT NULL REFERENCES public.commerce_supplier_payments(id),
  operation_id uuid NOT NULL REFERENCES public.finance_operations(id),
  link_type text NOT NULL CHECK (link_type IN ('PAYMENT', 'REVERSAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, link_type)
);

CREATE OR REPLACE FUNCTION public.create_supplier_payment(p_purchase_id uuid, p_payment jsonb)
RETURNS public.commerce_supplier_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_purchase public.commerce_purchases;
  v_payment public.commerce_supplier_payments;
  v_wallet_id uuid := NULLIF(p_payment ->> 'wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_payment ->> 'amount', '')::numeric;
  v_status text := upper(COALESCE(NULLIF(btrim(p_payment ->> 'status'), ''), 'PLANNED'));
  v_reserved numeric(14, 2);
BEGIN
  PERFORM public.permission_require('purchases.payments');
  IF p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payment) AS key_name
    WHERE key_name NOT IN ('wallet_id', 'amount', 'payment_date', 'status', 'reference', 'notes')
  ) THEN
    RAISE EXCEPTION 'Les données de paiement sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_purchase FROM public.commerce_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND OR v_purchase.status <> 'RECEIVED' THEN
    RAISE EXCEPTION 'L''achat doit être réceptionné pour enregistrer un paiement.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_purchase.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE = '23503';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023'; END IF;
  IF v_status NOT IN ('PLANNED', 'RECEIVED') THEN
    RAISE EXCEPTION 'Le statut de paiement est invalide.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_reserved
  FROM public.commerce_supplier_payments
  WHERE purchase_id = p_purchase_id AND status IN ('PLANNED', 'RECEIVED', 'CONFIRMED');
  IF v_reserved + v_amount > v_purchase.total_amount THEN
    RAISE EXCEPTION 'Le paiement dépasserait le montant dû à ce fournisseur.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commerce_supplier_payments(
    purchase_id, supplier_id, wallet_id, amount, payment_date, status, reference, notes, created_by, updated_by
  ) VALUES (
    p_purchase_id, v_purchase.supplier_id, v_wallet_id, v_amount,
    COALESCE(NULLIF(p_payment ->> 'payment_date', '')::date, current_date), v_status,
    NULLIF(btrim(p_payment ->> 'reference'), ''), NULLIF(btrim(p_payment ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_payment;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER_PAYMENT', v_payment.id, NULL, 'CREATE', NULL, to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_supplier_payment(p_payment_id uuid)
RETURNS public.commerce_supplier_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_supplier_payments;
  v_payment public.commerce_supplier_payments;
  v_purchase public.commerce_purchases;
  v_supplier public.commerce_suppliers;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.permission_require('purchases.payments');
  SELECT * INTO v_before FROM public.commerce_supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status NOT IN ('PLANNED', 'RECEIVED') THEN
    RAISE EXCEPTION 'Seul un paiement prévu ou reçu peut être confirmé.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_purchase FROM public.commerce_purchases WHERE id = v_before.purchase_id;
  IF NOT public.commerce_location_access_allowed(v_purchase.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_supplier_payment_links WHERE payment_id = v_before.id AND link_type = 'PAYMENT'
  ) THEN
    RAISE EXCEPTION 'Une écriture financière existe déjà pour ce paiement.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_supplier FROM public.commerce_suppliers WHERE id = v_before.supplier_id;

  v_operation := public.business_upsert_finance_operation(
    NULL, v_before.wallet_id, 'EXPENSE', v_before.amount, v_before.payment_date,
    'PAIEMENT FOURNISSEUR', 'Règlement achat ' || v_purchase.purchase_number,
    'SUPPLIER_PAYMENT', 'COMMERCE_SUPPLIER_PAYMENT', v_before.id,
    p_supplier := v_supplier.display_name,
    p_reference := COALESCE(v_before.reference, v_before.id::text)
  );
  INSERT INTO public.finance_supplier_payment_links(payment_id, operation_id, link_type) VALUES (v_before.id, v_operation.id, 'PAYMENT');

  UPDATE public.commerce_supplier_payments
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_payment;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER_PAYMENT', v_payment.id, v_operation.id, 'CONFIRM', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_supplier_payment(p_payment_id uuid, p_reason text)
RETURNS public.commerce_supplier_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_supplier_payments;
  v_payment public.commerce_supplier_payments;
  v_purchase public.commerce_purchases;
  v_supplier public.commerce_suppliers;
  v_operation public.finance_operations;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('purchases.payments');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commerce_supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  SELECT * INTO v_purchase FROM public.commerce_purchases WHERE id = v_before.purchase_id;
  IF NOT public.commerce_location_access_allowed(v_purchase.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_supplier FROM public.commerce_suppliers WHERE id = v_before.supplier_id;

  IF v_before.status = 'CONFIRMED' THEN
    IF EXISTS (
      SELECT 1 FROM public.finance_supplier_payment_links WHERE payment_id = v_before.id AND link_type = 'REVERSAL'
    ) THEN
      RAISE EXCEPTION 'La contre-écriture existe déjà pour ce paiement.' USING ERRCODE = '23505';
    END IF;
    -- Reversal credits the wallet back (type='DEPOSIT') -- the exact mirror
    -- of Phase 2's own commercial-payment reversal, in reverse direction:
    -- the original EXPENSE debited the wallet, so undoing it is a treasury
    -- inflow, not a new REVENUE event.
    v_operation := public.business_upsert_finance_operation(
      NULL, v_before.wallet_id, 'DEPOSIT', v_before.amount, current_date,
      'ANNULATION PAIEMENT FOURNISSEUR', 'Contre-écriture règlement achat ' || v_purchase.purchase_number,
      'SUPPLIER_PAYMENT_REVERSAL', 'COMMERCE_SUPPLIER_PAYMENT', v_before.id,
      p_supplier := v_supplier.display_name,
      p_reference := 'REV-' || v_before.id::text
    );
    INSERT INTO public.finance_supplier_payment_links(payment_id, operation_id, link_type) VALUES (v_before.id, v_operation.id, 'REVERSAL');
  END IF;

  UPDATE public.commerce_supplier_payments
  SET status = 'CANCELLED', cancelled_at = now(), notes = concat_ws(E'\n', notes, 'Annulation : ' || v_reason),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  PERFORM public.business_finance_audit_event('COMMERCE_SUPPLIER_PAYMENT', v_payment.id, v_operation.id, 'CANCEL', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_commerce_purchase_financial_summary(p_purchase_id uuid)
RETURNS TABLE (
  total_amount numeric(14, 2),
  total_paid numeric(14, 2),
  amount_due numeric(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_purchase public.commerce_purchases;
BEGIN
  PERFORM public.permission_require('purchases.finance.read');
  SELECT * INTO v_purchase FROM public.commerce_purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Achat introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.commerce_location_access_allowed(v_purchase.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v_purchase.total_amount,
    COALESCE((SELECT sum(amount) FROM public.commerce_supplier_payments WHERE purchase_id = p_purchase_id AND status = 'CONFIRMED'), 0)::numeric(14, 2),
    GREATEST(0, v_purchase.total_amount - COALESCE((SELECT sum(amount) FROM public.commerce_supplier_payments WHERE purchase_id = p_purchase_id AND status = 'CONFIRMED'), 0))::numeric(14, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_supplier_financial_metrics(p_supplier_id uuid)
RETURNS TABLE (
  purchase_count integer,
  total_purchased numeric(14, 2),
  total_paid numeric(14, 2),
  amount_due numeric(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('purchases.finance.read');
  IF NOT EXISTS (SELECT 1 FROM public.commerce_suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'Fournisseur introuvable.' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*)::integer FROM public.commerce_purchases p WHERE p.supplier_id = p_supplier_id AND p.status <> 'CANCELLED'),
    COALESCE((SELECT sum(p.total_amount) FROM public.commerce_purchases p WHERE p.supplier_id = p_supplier_id AND p.status <> 'CANCELLED'), 0)::numeric(14, 2),
    COALESCE((
      SELECT sum(sp.amount) FROM public.commerce_supplier_payments sp
      JOIN public.commerce_purchases p ON p.id = sp.purchase_id
      WHERE p.supplier_id = p_supplier_id AND sp.status = 'CONFIRMED' AND p.status <> 'CANCELLED'
    ), 0)::numeric(14, 2),
    GREATEST(0, COALESCE((SELECT sum(p.total_amount) FROM public.commerce_purchases p WHERE p.supplier_id = p_supplier_id AND p.status <> 'CANCELLED'), 0) - COALESCE((
      SELECT sum(sp.amount) FROM public.commerce_supplier_payments sp
      JOIN public.commerce_purchases p ON p.id = sp.purchase_id
      WHERE p.supplier_id = p_supplier_id AND sp.status = 'CONFIRMED' AND p.status <> 'CANCELLED'
    ), 0))::numeric(14, 2);
END;
$function$;

ALTER TABLE public.commerce_supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_supplier_payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_supplier_payments_authorized_read ON public.commerce_supplier_payments
  FOR SELECT TO authenticated USING (public.user_has_permission('purchases.finance.read') AND EXISTS (
    SELECT 1 FROM public.commerce_purchases p WHERE p.id = commerce_supplier_payments.purchase_id AND public.commerce_location_access_allowed(p.business_location_id)
  ));

REVOKE ALL ON TABLE public.commerce_supplier_payments, public.finance_supplier_payment_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_supplier_payments TO authenticated;
REVOKE ALL ON FUNCTION public.create_supplier_payment(uuid, jsonb), public.confirm_supplier_payment(uuid), public.cancel_supplier_payment(uuid, text), public.get_commerce_purchase_financial_summary(uuid), public.get_supplier_financial_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_payment(uuid, jsonb), public.confirm_supplier_payment(uuid), public.cancel_supplier_payment(uuid, text), public.get_commerce_purchase_financial_summary(uuid), public.get_supplier_financial_metrics(uuid) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('purchases.payments', 'purchases', 'payments', 'Enregistrer et confirmer les paiements fournisseurs.', 'CRITICAL'),
  ('purchases.finance.read', 'purchases', 'financial_read', 'Consulter les montants dus, payés et les dettes fournisseurs.', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'purchases.payments'), ('admin', 'purchases.finance.read'),
  ('comptable', 'purchases.payments'), ('comptable', 'purchases.finance.read'),
  ('gestionnaire', 'purchases.payments'), ('gestionnaire', 'purchases.finance.read');
