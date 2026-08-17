-- GFC V1 Phase 6 -- KPI consistency audit found that the client-level
-- financial metrics (fiche client "montant du") never learned about sale
-- returns added in Phase 5: it summed commercial_invoices.total_amount minus
-- confirmed payments only, while the sale-level
-- get_commercial_sale_financial_summary (fixed in 20260818120000) already
-- nets out commerce_sale_return_lines. A client with a returned sale would
-- show a higher, wrong "montant du" on their fiche than the sale detail page
-- for that same sale. Both RETURNS TABLE signatures change (add
-- total_returned), so this is DROP+CREATE -- privileges are re-applied
-- explicitly in this same migration (see 20260818150000 for why that matters).

DROP FUNCTION IF EXISTS public.get_commercial_client_financial_metrics(uuid);

CREATE FUNCTION public.get_commercial_client_financial_metrics(p_client_id uuid)
RETURNS TABLE(
  metrics_available boolean,
  sale_count integer,
  total_invoiced numeric,
  total_received numeric,
  total_returned numeric,
  amount_due numeric,
  last_sale_at timestamp with time zone,
  last_payment_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_total_invoiced numeric(14, 2);
  v_total_returned numeric(14, 2);
  v_total_received numeric(14, 2);
BEGIN
  PERFORM public.permission_require('sales.finance.read');
  IF NOT EXISTS (SELECT 1 FROM public.transport_clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(sum(invoice_row.total_amount), 0) INTO v_total_invoiced
  FROM public.commercial_invoices AS invoice_row
  WHERE invoice_row.client_id = p_client_id AND invoice_row.status <> 'CANCELLED';

  SELECT COALESCE(sum(rl.quantity_returned * rl.historical_unit_sale_price), 0) INTO v_total_returned
  FROM public.commerce_sale_return_lines rl
  JOIN public.commerce_sale_returns r ON r.id = rl.return_id
  JOIN public.commercial_sales s ON s.id = r.sale_id
  WHERE s.client_id = p_client_id;

  SELECT COALESCE(sum(payment_row.amount), 0) INTO v_total_received
  FROM public.commercial_invoice_payments AS payment_row
  JOIN public.commercial_invoices AS invoice_row ON invoice_row.id = payment_row.invoice_id
  WHERE invoice_row.client_id = p_client_id AND payment_row.status = 'CONFIRMED' AND invoice_row.status <> 'CANCELLED';

  RETURN QUERY
  SELECT
    true,
    (SELECT count(*)::integer FROM public.commercial_sales s WHERE s.client_id = p_client_id AND s.status <> 'CANCELLED'),
    v_total_invoiced,
    v_total_received,
    v_total_returned,
    GREATEST(0, v_total_invoiced - v_total_returned - v_total_received),
    (SELECT max(s.created_at) FROM public.commercial_sales s WHERE s.client_id = p_client_id AND s.status <> 'CANCELLED'),
    (SELECT max(p.confirmed_at) FROM public.commercial_invoice_payments p
      JOIN public.commercial_invoices i ON i.id = p.invoice_id
      WHERE i.client_id = p_client_id AND p.status = 'CONFIRMED' AND i.status <> 'CANCELLED');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commercial_client_financial_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_client_financial_metrics(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_commercial_client_financial_metrics_bulk(uuid[]);

CREATE FUNCTION public.get_commercial_client_financial_metrics_bulk(p_client_ids uuid[])
RETURNS TABLE(
  client_id uuid,
  sale_count integer,
  total_invoiced numeric,
  total_received numeric,
  total_returned numeric,
  amount_due numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.permission_require('sales.finance.read');
  IF p_client_ids IS NULL OR array_length(p_client_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    wanted.client_id,
    COALESCE(sale_agg.sale_count, 0)::integer,
    COALESCE(invoice_agg.total_invoiced, 0)::numeric(14, 2),
    COALESCE(payment_agg.total_received, 0)::numeric(14, 2),
    COALESCE(return_agg.total_returned, 0)::numeric(14, 2),
    GREATEST(0, COALESCE(invoice_agg.total_invoiced, 0) - COALESCE(return_agg.total_returned, 0) - COALESCE(payment_agg.total_received, 0))::numeric(14, 2)
  FROM unnest(p_client_ids) AS wanted(client_id)
  LEFT JOIN (
    SELECT s.client_id, count(*) AS sale_count
    FROM public.commercial_sales s
    WHERE s.client_id = ANY(p_client_ids) AND s.status <> 'CANCELLED'
    GROUP BY s.client_id
  ) AS sale_agg ON sale_agg.client_id = wanted.client_id
  LEFT JOIN (
    SELECT i.client_id, sum(i.total_amount) AS total_invoiced
    FROM public.commercial_invoices i
    WHERE i.client_id = ANY(p_client_ids) AND i.status <> 'CANCELLED'
    GROUP BY i.client_id
  ) AS invoice_agg ON invoice_agg.client_id = wanted.client_id
  LEFT JOIN (
    SELECT i.client_id, sum(p.amount) AS total_received
    FROM public.commercial_invoice_payments p
    JOIN public.commercial_invoices i ON i.id = p.invoice_id
    WHERE i.client_id = ANY(p_client_ids) AND p.status = 'CONFIRMED' AND i.status <> 'CANCELLED'
    GROUP BY i.client_id
  ) AS payment_agg ON payment_agg.client_id = wanted.client_id
  LEFT JOIN (
    SELECT s.client_id, sum(rl.quantity_returned * rl.historical_unit_sale_price) AS total_returned
    FROM public.commerce_sale_return_lines rl
    JOIN public.commerce_sale_returns r ON r.id = rl.return_id
    JOIN public.commercial_sales s ON s.id = r.sale_id
    WHERE s.client_id = ANY(p_client_ids)
    GROUP BY s.client_id
  ) AS return_agg ON return_agg.client_id = wanted.client_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commercial_client_financial_metrics_bulk(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_client_financial_metrics_bulk(uuid[]) TO authenticated;
