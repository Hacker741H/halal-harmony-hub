-- Phase E: the payment ceiling in commercial invoice payment create/confirm was
-- capped against invoice.total_amount (gross), never subtracting confirmed
-- returns (commerce_sale_return_lines) -- unlike get_commercial_sale_financial_summary,
-- which already computes amount_due = GREATEST(0, total_invoiced - total_returned - total_received)
-- and is what the frontend displays/prefills. This closes that gap so the server
-- enforces exactly the same net-outstanding ceiling the UI shows, including under
-- concurrent requests (reuses the existing FOR UPDATE locks on commercial_invoices/
-- commercial_invoice_payments -- no new locking needed, no table rewritten, no
-- historical payment or finance_operations row touched).

CREATE OR REPLACE FUNCTION public._internal_commercial_invoice_net_ceiling(p_sale_id uuid, p_invoice_total numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_invoice_total - COALESCE((
    SELECT sum(rl.quantity_returned * rl.historical_unit_sale_price)
    FROM public.commerce_sale_return_lines rl
    JOIN public.commerce_sale_returns r ON r.id = rl.return_id
    WHERE r.sale_id = p_sale_id
  ), 0);
$function$;

REVOKE ALL ON FUNCTION public._internal_commercial_invoice_net_ceiling(uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._internal_create_commercial_invoice_payment(p_invoice_id uuid, p_payment jsonb, p_actor_id uuid DEFAULT auth.uid())
 RETURNS commercial_invoice_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_wallet_id uuid := NULLIF(p_payment->>'wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_payment->>'amount', '')::numeric;
  v_status text := upper(COALESCE(NULLIF(btrim(p_payment->>'status'), ''), 'PLANNED'));
  v_kind text := upper(COALESCE(NULLIF(btrim(p_payment->>'payment_kind'), ''), 'PAYMENT'));
  v_reserved numeric(14, 2);
BEGIN
  IF p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payment) AS key_name
    WHERE key_name NOT IN ('wallet_id', 'amount', 'payment_date', 'status', 'payment_kind', 'reference', 'notes')
  ) THEN
    RAISE EXCEPTION 'Les données de paiement sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise avant de recevoir un paiement.' USING ERRCODE = '22023';
  END IF;
  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE = '23503';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('PLANNED', 'RECEIVED') OR v_kind NOT IN ('DEPOSIT', 'PAYMENT', 'SETTLEMENT', 'REFUND') THEN
    RAISE EXCEPTION 'Le statut ou le type de paiement est invalide.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_reserved
  FROM public.commercial_invoice_payments
  WHERE invoice_id = p_invoice_id AND status IN ('PLANNED', 'RECEIVED', 'CONFIRMED');
  IF v_reserved + v_amount > public._internal_commercial_invoice_net_ceiling(v_invoice.sale_id, v_invoice.total_amount) THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commercial_invoice_payments(
    invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind,
    reference, notes, created_by, updated_by
  ) VALUES (
    v_invoice.id, v_invoice.sale_id, v_wallet_id, v_amount,
    COALESCE(NULLIF(p_payment->>'payment_date', '')::date, current_date), v_status, v_kind,
    NULLIF(btrim(p_payment->>'reference'), ''), NULLIF(btrim(p_payment->>'notes'), ''), p_actor_id, p_actor_id
  ) RETURNING * INTO v_payment;
  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, NULL, 'CREATE', NULL, to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public._internal_confirm_commercial_invoice_payment(p_payment_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS commercial_invoice_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.commercial_invoice_payments;
  v_payment public.commercial_invoice_payments;
  v_invoice public.commercial_invoices;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_confirmed numeric(14, 2);
BEGIN
  SELECT * INTO v_before FROM public.commercial_invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status NOT IN ('PLANNED', 'RECEIVED') THEN
    RAISE EXCEPTION 'Seul un paiement prévu ou reçu peut être confirmé.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_commercial_invoice_payment_links
    WHERE payment_id = v_before.id AND link_type = 'PAYMENT'
  ) THEN
    RAISE EXCEPTION 'Une écriture financière existe déjà pour ce paiement.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = v_before.invoice_id FOR UPDATE;
  IF v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise pour confirmer un paiement.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_invoice.client_id;
  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.commercial_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';
  IF v_confirmed + v_before.amount > public._internal_commercial_invoice_net_ceiling(v_invoice.sale_id, v_invoice.total_amount) THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  v_operation := public.business_upsert_finance_operation(
    NULL, v_before.wallet_id, 'DEPOSIT', v_before.amount, v_before.payment_date,
    'REGLEMENT CLIENT', 'Encaissement facture ' || v_invoice.invoice_number,
    'COMMERCIAL_PAYMENT', 'COMMERCIAL_INVOICE_PAYMENT', v_before.id,
    p_farm_id := v_sale.farm_id,
    p_client := v_client.display_name,
    p_reference := COALESCE(v_before.reference, v_before.id::text)
  );
  INSERT INTO public.finance_commercial_invoice_payment_links(payment_id, operation_id, link_type)
  VALUES (v_before.id, v_operation.id, 'PAYMENT');

  UPDATE public.commercial_invoice_payments
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = p_actor_id, updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_payment;

  v_confirmed := v_confirmed + v_payment.amount;
  UPDATE public.commercial_invoices
  SET status = CASE WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = p_actor_id, updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, v_operation.id, 'CONFIRM', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;
