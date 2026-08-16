-- GFC V1 Phase 2 -- Clients/Creances. Distinct commercial financial-metrics
-- primitive per explicit business decision: does NOT touch
-- get_client_financial_metrics (Transport contract, left exactly as-is).
-- Computed live from commercial_sales/commercial_invoices/
-- commercial_invoice_payments -- the same source tables and the same
-- invoiced/received/due formula already proven by
-- get_commercial_sale_financial_summary, aggregated per client instead of
-- per sale. Always returns genuinely computed values, including a real
-- zero when a client genuinely has no commercial activity -- never a fake
-- default. Gated by sales.finance.read (already granted to
-- admin/comptable/gestionnaire), the same permission that already protects
-- every other read of this data -- no new permission code.

CREATE OR REPLACE FUNCTION public.get_commercial_client_financial_metrics(p_client_id uuid)
RETURNS TABLE (
  metrics_available boolean,
  sale_count integer,
  total_invoiced numeric(14, 2),
  total_received numeric(14, 2),
  amount_due numeric(14, 2),
  last_sale_at timestamptz,
  last_payment_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('sales.finance.read');
  IF NOT EXISTS (SELECT 1 FROM public.transport_clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    true,
    (SELECT count(*)::integer FROM public.commercial_sales s WHERE s.client_id = p_client_id AND s.status <> 'CANCELLED'),
    COALESCE((SELECT sum(i.total_amount) FROM public.commercial_invoices i WHERE i.client_id = p_client_id AND i.status <> 'CANCELLED'), 0)::numeric(14, 2),
    COALESCE((
      SELECT sum(p.amount) FROM public.commercial_invoice_payments p
      JOIN public.commercial_invoices i ON i.id = p.invoice_id
      WHERE i.client_id = p_client_id AND p.status = 'CONFIRMED' AND i.status <> 'CANCELLED'
    ), 0)::numeric(14, 2),
    GREATEST(0, COALESCE((SELECT sum(i.total_amount) FROM public.commercial_invoices i WHERE i.client_id = p_client_id AND i.status <> 'CANCELLED'), 0) - COALESCE((
      SELECT sum(p.amount) FROM public.commercial_invoice_payments p
      JOIN public.commercial_invoices i ON i.id = p.invoice_id
      WHERE i.client_id = p_client_id AND p.status = 'CONFIRMED' AND i.status <> 'CANCELLED'
    ), 0))::numeric(14, 2),
    (SELECT max(s.created_at) FROM public.commercial_sales s WHERE s.client_id = p_client_id AND s.status <> 'CANCELLED'),
    (SELECT max(p.confirmed_at) FROM public.commercial_invoice_payments p
      JOIN public.commercial_invoices i ON i.id = p.invoice_id
      WHERE i.client_id = p_client_id AND p.status = 'CONFIRMED' AND i.status <> 'CANCELLED');
END;
$function$;

-- Bulk variant for list screens (client-table.tsx): one call per page of
-- clients instead of one RPC round-trip per row.
CREATE OR REPLACE FUNCTION public.get_commercial_client_financial_metrics_bulk(p_client_ids uuid[])
RETURNS TABLE (
  client_id uuid,
  sale_count integer,
  total_invoiced numeric(14, 2),
  total_received numeric(14, 2),
  amount_due numeric(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
    GREATEST(0, COALESCE(invoice_agg.total_invoiced, 0) - COALESCE(payment_agg.total_received, 0))::numeric(14, 2)
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
  ) AS payment_agg ON payment_agg.client_id = wanted.client_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commercial_client_financial_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_client_financial_metrics(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_commercial_client_financial_metrics_bulk(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_client_financial_metrics_bulk(uuid[]) TO authenticated;
