-- GFC V1 Phase 5B -- fixes a real logic bug caught by manual trace of the
-- sequential-refund scenario (mission test E) before ever running the E2E
-- test: confirm_commerce_sale_refund re-added v_before.amount to the
-- freshly computed refundable credit before comparing, intending to
-- neutralize this row's own (not-yet-confirmed) non-contribution to the
-- SUM. That reasoning only holds for re-confirming the SAME row (already
-- handled by the earlier idempotent early-return on status='CONFIRMED').
-- For a genuinely separate second PLANNED row for the same sale, the
-- adjustment over-compensates and would let two rows whose combined
-- amount exceeds the real credit both pass their individual checks.
-- _internal_commerce_sale_refundable_credit already correctly excludes
-- this row (still PLANNED, not counted in confirmed_refunds) -- comparing
-- against it directly, unadjusted, is the correct check.

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

  v_refundable := public._internal_commerce_sale_refundable_credit(v_before.sale_id);
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
