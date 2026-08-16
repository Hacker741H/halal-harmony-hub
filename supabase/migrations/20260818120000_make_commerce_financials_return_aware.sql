-- GFC V1 Phase 5B -- adds the return_date column commerce_sale_returns
-- should have had from the start (every other transactional table in this
-- schema has an explicit _date column distinct from created_at). Table is
-- brand new with zero rows, so this is a pure additive widening, not a
-- backfill. Needed so a return dated after its original sale's reporting
-- period is reflected in the period it actually happened in, never
-- retroactively edits a past, already-closed report (mission section 10 --
-- control reports are photographs).
ALTER TABLE public.commerce_sale_returns ADD COLUMN return_date date NOT NULL DEFAULT current_date;

-- Makes the sale-level financial summary return/refund-aware. Additive
-- columns only (total_returned, refundable_credit); amount_due now nets
-- against returns and is clamped at 0 -- the negative side (client owed
-- money back) is reported separately as refundable_credit, never as a
-- negative amount_due, so every existing caller reading amount_due as
-- "what the client still owes" keeps a correct, non-negative number.
-- Postgres refuses CREATE OR REPLACE when RETURNS TABLE(...) gains new
-- columns ("cannot change return type of existing function") -- must drop
-- first, same statement-count as before, still one migration.
DROP FUNCTION public.get_commercial_sale_financial_summary(uuid);

CREATE FUNCTION public.get_commercial_sale_financial_summary(p_sale_id uuid)
 RETURNS TABLE(subtotal_amount numeric, tax_amount numeric, total_invoiced numeric, total_received numeric, total_returned numeric, refundable_credit numeric, amount_due numeric, invoice_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_total_invoiced numeric(14, 2);
  v_total_returned numeric(14, 2);
  v_total_received numeric(14, 2);
BEGIN
  PERFORM public.permission_require('sales.finance.read');
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sales AS sale_row WHERE sale_row.id = p_sale_id) THEN
    RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(sum(invoice_row.total_amount), 0) INTO v_total_invoiced
  FROM public.commercial_invoices AS invoice_row
  WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED';

  SELECT COALESCE(sum(rl.quantity_returned * rl.historical_unit_sale_price), 0) INTO v_total_returned
  FROM public.commerce_sale_return_lines rl
  JOIN public.commerce_sale_returns r ON r.id = rl.return_id
  WHERE r.sale_id = p_sale_id;

  SELECT COALESCE(sum(payment_row.amount), 0) INTO v_total_received
  FROM public.commercial_invoice_payments AS payment_row
  JOIN public.commercial_invoices AS invoice_row ON invoice_row.id = payment_row.invoice_id
  WHERE payment_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED' AND payment_row.status = 'CONFIRMED';

  RETURN QUERY
  SELECT
    COALESCE((SELECT sum(invoice_row.subtotal_amount) FROM public.commercial_invoices AS invoice_row WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'), 0),
    COALESCE((SELECT sum(invoice_row.tax_amount) FROM public.commercial_invoices AS invoice_row WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'), 0),
    v_total_invoiced,
    v_total_received,
    v_total_returned,
    public._internal_commerce_sale_refundable_credit(p_sale_id),
    GREATEST(0, v_total_invoiced - v_total_returned - v_total_received),
    (
      SELECT invoice_row.status
      FROM public.commercial_invoices AS invoice_row
      WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'
      ORDER BY invoice_row.created_at DESC
      LIMIT 1
    );
END;
$function$;

-- Nets store-level CA/CMV/margin against returns dated within the same
-- queried period (a return dated outside [p_from, p_to] belongs to a
-- different period's report, never retroactively edits this one). Reads
-- only -- no historical commercial_sales/commercial_sale_lines row is ever
-- touched, matching "lecture ventes + retours, jamais un UPDATE
-- destructif."
CREATE OR REPLACE FUNCTION public.get_commerce_store_profitability(p_location_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
 PERFORM public.permission_require('store.financial.read'); IF NOT public.commerce_location_access_allowed(p_location_id) THEN RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'Periode invalide.' USING ERRCODE='22023'; END IF;
 WITH sales AS (
   SELECT COALESCE(sum(l.line_total) FILTER(WHERE l.line_type='ARTICLE'),0) article_revenue,
     COALESCE(sum(l.line_total) FILTER(WHERE l.line_type='SERVICE'),0) service_revenue,
     COALESCE(sum(l.line_total),0) total_revenue,
     COALESCE(sum(line_cost.total_cost) FILTER(WHERE l.line_type='ARTICLE'),0) cogs,
     count(*) FILTER(WHERE l.line_type='ARTICLE' AND line_cost.sale_line_id IS NULL) uncosted
   FROM public.commercial_sales s JOIN public.commercial_sale_lines l ON l.sale_id=s.id
   LEFT JOIN public.commercial_sale_line_costs line_cost ON line_cost.sale_line_id=l.id
   WHERE s.business_location_id=p_location_id AND s.status='CONFIRMED' AND s.sale_date BETWEEN p_from AND p_to
 ), returns AS (
   SELECT COALESCE(sum(rl.quantity_returned * rl.historical_unit_sale_price),0) returned_revenue,
     COALESCE(sum(rl.quantity_returned * rl.historical_unit_cost) FILTER (WHERE rl.historical_unit_cost IS NOT NULL),0) returned_cogs
   FROM public.commerce_sale_returns r JOIN public.commerce_sale_return_lines rl ON rl.return_id=r.id
   WHERE r.business_location_id=p_location_id AND r.return_date BETWEEN p_from AND p_to
 ), expenses AS (
   SELECT COALESCE(sum(e.amount),0) operating_expenses FROM public.commerce_store_expenses e
   JOIN public.finance_commerce_store_expense_links link ON link.store_expense_id=e.id
   JOIN public.finance_operations op ON op.id=link.operation_id
   WHERE e.business_location_id=p_location_id AND e.status='CONFIRMED' AND COALESCE(op.status,'VALIDE')<>'CANCELLED' AND e.expense_date BETWEEN p_from AND p_to
 )
 SELECT jsonb_build_object(
   'from',p_from,'to',p_to,'isComplete',sales.uncosted=0,
   'articleRevenue',sales.article_revenue - returns.returned_revenue,
   'serviceRevenue',sales.service_revenue,
   'totalRevenue',sales.total_revenue - returns.returned_revenue,
   'returnedRevenue',returns.returned_revenue,
   'costOfGoodsSold',CASE WHEN sales.uncosted=0 THEN sales.cogs - returns.returned_cogs ELSE NULL END,
   'grossMargin',CASE WHEN sales.uncosted=0 THEN (sales.total_revenue - returns.returned_revenue) - (sales.cogs - returns.returned_cogs) ELSE NULL END,
   'operatingExpenses',expenses.operating_expenses,
   'netResult',CASE WHEN sales.uncosted=0 THEN (sales.total_revenue - returns.returned_revenue) - (sales.cogs - returns.returned_cogs) - expenses.operating_expenses ELSE NULL END
 ) INTO v_result FROM sales CROSS JOIN returns CROSS JOIN expenses; RETURN v_result;
END;$function$;
