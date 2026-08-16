-- GFC V1 Phase 5B -- Remboursements. A separate table from
-- commercial_invoice_payments on purpose: payment_kind='REFUND' already
-- exists on that table (pre-provisioned, unused) and looked reusable at
-- first, but every existing consumer that sums "CONFIRMED payments" for
-- that table (get_commercial_sale_financial_summary's total_received,
-- cancel_commercial_invoice_payment's invoice-status recompute) does so
-- without excluding payment_kind -- reusing it would silently make a
-- refund count as MORE money received instead of less, in code this
-- mission does not touch. A dedicated table costs a little duplication but
-- avoids contaminating an existing, working aggregate convention across
-- functions outside this migration's scope -- the same reasoning that
-- already kept commerce_supplier_payments separate from
-- commercial_invoice_payments in Phase 3.
--
-- The refundable ceiling is always derived (never a stored mutable
-- balance), mirroring commerce_purchases' amount_due:
--   refundable = max(0, confirmed_payments - max(0, invoiced - returned_value)) - confirmed_refunds
-- Verified against every worked example in the mission text (A/C/D/E).

CREATE TABLE public.commerce_sale_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number text NOT NULL UNIQUE,
  sale_id uuid NOT NULL REFERENCES public.commercial_sales(id),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  refund_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'CONFIRMED', 'CANCELLED')),
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_sale_refunds_sale_idx ON public.commerce_sale_refunds(sale_id);

CREATE TABLE public.finance_commercial_refund_links (
  refund_id uuid NOT NULL REFERENCES public.commerce_sale_refunds(id),
  operation_id uuid NOT NULL REFERENCES public.finance_operations(id),
  link_type text NOT NULL DEFAULT 'REFUND' CHECK (link_type IN ('REFUND', 'REVERSAL')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_commercial_refund_links_refund_idx ON public.finance_commercial_refund_links(refund_id);

CREATE OR REPLACE FUNCTION public._internal_next_commerce_sale_refund_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT 'REMB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    COALESCE((
      SELECT max(NULLIF(split_part(refund_number, '-', 3), '')::int)
      FROM public.commerce_sale_refunds
      WHERE refund_number LIKE 'REMB-' || to_char(now(), 'YYYYMMDD') || '-%'
    ), 0) + 1
  )::text, 4, '0');
$function$;

CREATE OR REPLACE FUNCTION public._internal_commerce_sale_refundable_credit(p_sale_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT GREATEST(0,
    COALESCE((SELECT sum(amount) FROM public.commercial_invoice_payments WHERE sale_id = p_sale_id AND status = 'CONFIRMED'), 0)
    - GREATEST(0,
        COALESCE((SELECT sum(total_amount) FROM public.commercial_invoices WHERE sale_id = p_sale_id AND status <> 'CANCELLED'), 0)
        - COALESCE((
            SELECT sum(rl.quantity_returned * rl.historical_unit_sale_price)
            FROM public.commerce_sale_return_lines rl JOIN public.commerce_sale_returns r ON r.id = rl.return_id
            WHERE r.sale_id = p_sale_id
          ), 0)
      )
  ) - COALESCE((SELECT sum(amount) FROM public.commerce_sale_refunds WHERE sale_id = p_sale_id AND status = 'CONFIRMED'), 0);
$function$;

CREATE OR REPLACE FUNCTION public.create_commerce_sale_refund(p_sale_id uuid, p_refund jsonb)
RETURNS public.commerce_sale_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_sale public.commercial_sales;
  v_wallet_id uuid := NULLIF(p_refund ->> 'wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_refund ->> 'amount', '')::numeric;
  v_refund_date date := COALESCE(NULLIF(p_refund ->> 'refund_date', '')::date, current_date);
  v_reference text := NULLIF(btrim(p_refund ->> 'reference'), '');
  v_notes text := NULLIF(btrim(p_refund ->> 'notes'), '');
  v_refundable numeric(14, 2);
  v_refund public.commerce_sale_refunds;
BEGIN
  PERFORM public.permission_require('sales.refunds.manage');
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.commerce_location_access_allowed(v_sale.business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant remboursé doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  v_refundable := public._internal_commerce_sale_refundable_credit(p_sale_id);
  IF v_amount > v_refundable THEN
    RAISE EXCEPTION 'Montant supérieur au crédit remboursable (% disponible).', v_refundable USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commerce_sale_refunds(refund_number, sale_id, wallet_id, amount, refund_date, reference, notes, created_by, updated_by)
  VALUES (public._internal_next_commerce_sale_refund_number(), p_sale_id, v_wallet_id, v_amount, v_refund_date, v_reference, v_notes, auth.uid(), auth.uid())
  RETURNING * INTO v_refund;

  PERFORM public.business_finance_audit_event('COMMERCE_SALE_REFUND', v_refund.id, NULL, 'CREATE', NULL, to_jsonb(v_refund));
  RETURN v_refund;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_commerce_sale_refund(p_refund_id uuid)
RETURNS public.commerce_sale_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_sale_refunds;
  v_refund public.commerce_sale_refunds;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_refundable numeric(14, 2);
BEGIN
  PERFORM public.permission_require('sales.refunds.manage');
  SELECT * INTO v_before FROM public.commerce_sale_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remboursement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Seul un remboursement prévu peut être confirmé.' USING ERRCODE = '22023';
  END IF;

  -- Re-checked at confirm time: the refundable ceiling can only have
  -- shrunk since creation (another refund confirmed meanwhile).
  v_refundable := public._internal_commerce_sale_refundable_credit(v_before.sale_id) + v_before.amount;
  IF v_before.amount > v_refundable THEN
    RAISE EXCEPTION 'Ce remboursement dépasse désormais le crédit remboursable (% disponible).', v_refundable USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_sale.client_id;

  v_operation := public.business_upsert_finance_operation(
    NULL, v_before.wallet_id, 'EXPENSE', v_before.amount, v_before.refund_date,
    'REMBOURSEMENT CLIENT', 'Remboursement vente ' || v_sale.sale_number,
    'COMMERCIAL_REFUND', 'COMMERCE_SALE_REFUND', v_before.id,
    p_farm_id := v_sale.farm_id,
    p_client := v_client.display_name,
    p_reference := COALESCE(v_before.reference, v_before.refund_number)
  );
  INSERT INTO public.finance_commercial_refund_links(refund_id, operation_id, link_type)
  VALUES (v_before.id, v_operation.id, 'REFUND');

  UPDATE public.commerce_sale_refunds
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO v_refund;

  PERFORM public.business_finance_audit_event('COMMERCE_SALE_REFUND', v_refund.id, v_operation.id, 'CONFIRM', to_jsonb(v_before), to_jsonb(v_refund));
  RETURN v_refund;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_commerce_sale_refund(p_refund_id uuid, p_reason text)
RETURNS public.commerce_sale_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_sale_refunds;
  v_refund public.commerce_sale_refunds;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('sales.refunds.manage');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commerce_sale_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remboursement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;

  IF v_before.status = 'CONFIRMED' THEN
    IF EXISTS (SELECT 1 FROM public.finance_commercial_refund_links WHERE refund_id = v_before.id AND link_type = 'REVERSAL') THEN
      RAISE EXCEPTION 'La contre-écriture existe déjà pour ce remboursement.' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
    SELECT * INTO v_client FROM public.transport_clients WHERE id = v_sale.client_id;

    v_operation := public.business_upsert_finance_operation(
      NULL, v_before.wallet_id, 'DEPOSIT', v_before.amount, current_date,
      'ANNULATION REMBOURSEMENT CLIENT', 'Contre-écriture remboursement ' || v_before.refund_number,
      'COMMERCIAL_REFUND_REVERSAL', 'COMMERCE_SALE_REFUND', v_before.id,
      p_farm_id := v_sale.farm_id,
      p_client := v_client.display_name,
      p_reference := 'REV-' || v_before.id::text
    );
    INSERT INTO public.finance_commercial_refund_links(refund_id, operation_id, link_type)
    VALUES (v_before.id, v_operation.id, 'REVERSAL');
  END IF;

  UPDATE public.commerce_sale_refunds
  SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = v_reason, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO v_refund;

  PERFORM public.business_finance_audit_event('COMMERCE_SALE_REFUND', v_refund.id, v_operation.id, 'CANCEL', to_jsonb(v_before), to_jsonb(v_refund));
  RETURN v_refund;
END;
$function$;

ALTER TABLE public.commerce_sale_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_commercial_refund_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_sale_refunds_authorized_read ON public.commerce_sale_refunds
  FOR SELECT TO authenticated USING (
    public.user_has_permission('sales.refunds.read')
    AND EXISTS (SELECT 1 FROM public.commercial_sales s WHERE s.id = commerce_sale_refunds.sale_id AND public.commerce_location_access_allowed(s.business_location_id))
  );
CREATE POLICY finance_commercial_refund_links_authorized_read ON public.finance_commercial_refund_links
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.commerce_sale_refunds r
    JOIN public.commercial_sales s ON s.id = r.sale_id
    WHERE r.id = finance_commercial_refund_links.refund_id
      AND public.user_has_permission('sales.refunds.read') AND public.commerce_location_access_allowed(s.business_location_id)
  ));

REVOKE ALL ON TABLE public.commerce_sale_refunds, public.finance_commercial_refund_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commerce_sale_refunds, public.finance_commercial_refund_links TO authenticated;
REVOKE ALL ON FUNCTION public._internal_next_commerce_sale_refund_number(), public._internal_commerce_sale_refundable_credit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_commerce_sale_refund(uuid, jsonb), public.confirm_commerce_sale_refund(uuid), public.cancel_commerce_sale_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_sale_refund(uuid, jsonb), public.confirm_commerce_sale_refund(uuid), public.cancel_commerce_sale_refund(uuid, text) TO authenticated;

INSERT INTO public.permissions(code, module, action, description, sensitivity) VALUES
  ('sales.refunds.read', 'sales', 'read', 'Consulter les remboursements clients.', 'SENSITIVE'),
  ('sales.refunds.manage', 'sales', 'manage', 'Enregistrer, confirmer ou annuler un remboursement client (débite un wallet).', 'CRITICAL');

INSERT INTO public.role_permissions(role, permission_code) VALUES
  ('admin', 'sales.refunds.read'), ('admin', 'sales.refunds.manage'),
  ('super_admin', 'sales.refunds.read'), ('super_admin', 'sales.refunds.manage'),
  ('gestionnaire', 'sales.refunds.read'), ('gestionnaire', 'sales.refunds.manage'),
  ('comptable', 'sales.refunds.read');
