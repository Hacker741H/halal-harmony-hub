-- GFC V1 Phase 2 -- Clients/Creances. Fixes the "Confirmer dans le wallet"
-- button that a gestionnaire already sees (client-side canPayment checks
-- only sales.payments + sales.finance.read) but that always 403s server
-- side.
--
-- Root cause: confirm/cancel_commercial_invoice_payment each already
-- require their own correct scoped permission (sales.payments /
-- sales.payments+sales.cancel-adjacent), then ALSO separately required
-- finance.create / finance.cancel -- a second, unrelated, broad gate
-- (admin/comptable/super_admin only via finance_require_write_role) -- and
-- finally called finance_create_operation(), which re-checks that same
-- broad gate a third time internally regardless of what the caller already
-- verified. gestionnaire has sales.payments but never finance.create/
-- finance.cancel, hence the 403.
--
-- Fix: route the finance write through business_upsert_finance_operation
-- instead -- already the pattern used by confirm_commerce_store_expense
-- and stock/vehicle/motorcycle purchases, and already proven to trust the
-- calling RPC's own scoped permission_require() rather than imposing a
-- second broad role gate (its own internal check,
-- business_finance_require_write_role(), only verifies auth.uid() IS NOT
-- NULL). No permission is widened: finance.create/finance.cancel are not
-- granted to anyone new here, they are simply no longer required for an
-- action already fully authorized by sales.payments. This also answers the
-- "chemin canonique" question: business_upsert_finance_operation becomes
-- the one reusable write path (already the dominant pattern -- 2 real
-- callers before this migration, now 4).

CREATE OR REPLACE FUNCTION public._internal_confirm_commercial_invoice_payment(
  p_payment_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
  IF v_confirmed + v_before.amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  v_operation := public.business_upsert_finance_operation(
    NULL, v_before.wallet_id, 'REVENUE', v_before.amount, v_before.payment_date,
    'VENTE COMMERCIALE', 'Encaissement facture ' || v_invoice.invoice_number,
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

CREATE OR REPLACE FUNCTION public.confirm_commercial_invoice_payment(p_payment_id uuid)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('sales.payments');
  RETURN public._internal_confirm_commercial_invoice_payment(p_payment_id, auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_commercial_invoice_payment(p_payment_id uuid, p_reason text)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_invoice_payments;
  v_payment public.commercial_invoice_payments;
  v_invoice public.commercial_invoices;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_confirmed numeric(14, 2);
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM public.permission_require('sales.payments');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Un motif d''annulation est obligatoire.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_before FROM public.commercial_invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = v_before.invoice_id FOR UPDATE;
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_invoice.client_id;

  IF v_before.status = 'CONFIRMED' THEN
    IF EXISTS (
      SELECT 1 FROM public.finance_commercial_invoice_payment_links
      WHERE payment_id = v_before.id AND link_type = 'REVERSAL'
    ) THEN
      RAISE EXCEPTION 'La contre-écriture existe déjà pour ce paiement.' USING ERRCODE = '23505';
    END IF;
    v_operation := public.business_upsert_finance_operation(
      NULL, v_before.wallet_id, 'EXPENSE', v_before.amount, current_date,
      'ANNULATION VENTE COMMERCIALE', 'Contre-écriture encaissement facture ' || v_invoice.invoice_number,
      'COMMERCIAL_PAYMENT_REVERSAL', 'COMMERCIAL_INVOICE_PAYMENT', v_before.id,
      p_farm_id := v_sale.farm_id,
      p_client := v_client.display_name,
      p_reference := 'REV-' || v_before.id::text
    );
    INSERT INTO public.finance_commercial_invoice_payment_links(payment_id, operation_id, link_type)
    VALUES (v_before.id, v_operation.id, 'REVERSAL');
  END IF;

  UPDATE public.commercial_invoice_payments
  SET status = 'CANCELLED', cancelled_at = now(), notes = concat_ws(E'\n', notes, 'Annulation : ' || v_reason),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.commercial_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';
  UPDATE public.commercial_invoices
  SET status = CASE WHEN v_confirmed = 0 THEN 'ISSUED' WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = auth.uid(), updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, v_operation.id, 'CANCEL', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;
