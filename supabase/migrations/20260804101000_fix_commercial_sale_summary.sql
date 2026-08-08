-- CC-01 corrective migration: qualify invoice columns in the commercial
-- financial summary.  This avoids PL/pgSQL resolving output names as local
-- variables.  No table, permission, RLS policy, wallet rule or finance flow
-- is modified.

CREATE OR REPLACE FUNCTION public.get_commercial_sale_financial_summary(p_sale_id uuid)
RETURNS TABLE(
  subtotal_amount numeric,
  tax_amount numeric,
  total_invoiced numeric,
  total_received numeric,
  amount_due numeric,
  invoice_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('sales.finance.read');
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sales AS sale_row WHERE sale_row.id = p_sale_id) THEN
    RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT sum(invoice_row.subtotal_amount)
      FROM public.commercial_invoices AS invoice_row
      WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'
    ), 0),
    COALESCE((
      SELECT sum(invoice_row.tax_amount)
      FROM public.commercial_invoices AS invoice_row
      WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'
    ), 0),
    COALESCE((
      SELECT sum(invoice_row.total_amount)
      FROM public.commercial_invoices AS invoice_row
      WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'
    ), 0),
    COALESCE((
      SELECT sum(payment_row.amount)
      FROM public.commercial_invoice_payments AS payment_row
      JOIN public.commercial_invoices AS invoice_row ON invoice_row.id = payment_row.invoice_id
      WHERE payment_row.sale_id = p_sale_id
        AND invoice_row.status <> 'CANCELLED'
        AND payment_row.status = 'CONFIRMED'
    ), 0),
    COALESCE((
      SELECT sum(invoice_row.total_amount)
      FROM public.commercial_invoices AS invoice_row
      WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'
    ), 0) - COALESCE((
      SELECT sum(payment_row.amount)
      FROM public.commercial_invoice_payments AS payment_row
      JOIN public.commercial_invoices AS invoice_row ON invoice_row.id = payment_row.invoice_id
      WHERE payment_row.sale_id = p_sale_id
        AND invoice_row.status <> 'CANCELLED'
        AND payment_row.status = 'CONFIRMED'
    ), 0),
    (
      SELECT invoice_row.status
      FROM public.commercial_invoices AS invoice_row
      WHERE invoice_row.sale_id = p_sale_id AND invoice_row.status <> 'CANCELLED'
      ORDER BY invoice_row.created_at DESC
      LIMIT 1
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commercial_sale_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_sale_financial_summary(uuid) TO authenticated;
