-- Commerce: a read-only management cockpit distinct from the cashier workspace.
-- It aggregates existing sale, payment, stock and wallet data; it creates no
-- accounting movement and does not change any operational rule.

CREATE OR REPLACE FUNCTION public.get_commerce_management_dashboard(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.pos.read');

  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501';
  END IF;

  -- Cashiers retain their dedicated transaction workspace. This reporting view
  -- is intentionally limited to management, stock, or finance responsibilities.
  IF NOT (
    public.user_has_permission('locations.manage')
    OR public.user_has_permission('commerce.stock.receive')
    OR public.user_has_permission('sales.finance.read')
  ) THEN
    RAISE EXCEPTION 'Accès refusé au pilotage du magasin.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'location', jsonb_build_object('id', location_row.id, 'name', location_row.name, 'code', location_row.code),
    'today', jsonb_build_object(
      'salesCount', (
        SELECT count(*)
        FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
          AND sale_row.sale_date = current_date
      ),
      'received', COALESCE((
        SELECT sum(payment_row.amount)
        FROM public.commercial_invoice_payments payment_row
        JOIN public.commercial_sales sale_row ON sale_row.id = payment_row.sale_id
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
          AND payment_row.status = 'CONFIRMED'
          AND payment_row.payment_date = current_date
      ), 0)
    ),
    'week', jsonb_build_object(
      'salesCount', (
        SELECT count(*)
        FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
          AND sale_row.sale_date >= date_trunc('week', current_date)::date
          AND sale_row.sale_date <= current_date
      ),
      'received', COALESCE((
        SELECT sum(payment_row.amount)
        FROM public.commercial_invoice_payments payment_row
        JOIN public.commercial_sales sale_row ON sale_row.id = payment_row.sale_id
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
          AND payment_row.status = 'CONFIRMED'
          AND payment_row.payment_date >= date_trunc('week', current_date)::date
          AND payment_row.payment_date <= current_date
      ), 0)
    ),
    'month', jsonb_build_object(
      'salesCount', (
        SELECT count(*)
        FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
          AND sale_row.sale_date >= date_trunc('month', current_date)::date
          AND sale_row.sale_date <= current_date
      ),
      'received', COALESCE((
        SELECT sum(payment_row.amount)
        FROM public.commercial_invoice_payments payment_row
        JOIN public.commercial_sales sale_row ON sale_row.id = payment_row.sale_id
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
          AND payment_row.status = 'CONFIRMED'
          AND payment_row.payment_date >= date_trunc('month', current_date)::date
          AND payment_row.payment_date <= current_date
      ), 0)
    ),
    'cashDrawer', (
      SELECT jsonb_build_object('id', wallet_row.id, 'name', wallet_row.name, 'balance', wallet_row.balance)
      FROM public.business_location_wallets wallet_mapping
      JOIN public.wallets wallet_row ON wallet_row.id = wallet_mapping.wallet_id
      WHERE wallet_mapping.business_location_id = p_location_id
        AND wallet_mapping.is_active
        AND wallet_mapping.is_primary
        AND wallet_mapping.purpose = 'CASH_DRAWER'
      ORDER BY wallet_mapping.assigned_at DESC
      LIMIT 1
    ),
    'inventory', jsonb_build_object(
      'itemsCount', (
        SELECT count(*)
        FROM public.business_location_inventory_items location_item
        WHERE location_item.business_location_id = p_location_id
      ),
      'lowStockCount', (
        SELECT count(*)
        FROM public.business_location_inventory_items location_item
        WHERE location_item.business_location_id = p_location_id
          AND location_item.reorder_level IS NOT NULL
          AND location_item.quantity > 0
          AND location_item.quantity <= location_item.reorder_level
      ),
      'outOfStockCount', (
        SELECT count(*)
        FROM public.business_location_inventory_items location_item
        WHERE location_item.business_location_id = p_location_id
          AND location_item.quantity <= 0
      )
    ),
    'recentSales', COALESCE((
      SELECT jsonb_agg(to_jsonb(recent_sale) ORDER BY recent_sale.sale_date DESC, recent_sale.created_at DESC)
      FROM (
        SELECT
          sale_row.sale_number AS "saleNumber",
          sale_row.sale_date AS "saleDate",
          sale_row.status,
          sale_row.created_at AS "createdAt",
          COALESCE((
            SELECT sum(payment_row.amount)
            FROM public.commercial_invoice_payments payment_row
            WHERE payment_row.sale_id = sale_row.id
              AND payment_row.status = 'CONFIRMED'
          ), 0) AS amount
        FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED'
        ORDER BY sale_row.sale_date DESC, sale_row.created_at DESC
        LIMIT 8
      ) AS recent_sale
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.business_locations location_row
  JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = p_location_id
    AND location_row.status = 'ACTIVE'
    AND unit_row.code = 'COMMERCE';

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Point de vente Commerce introuvable ou archivé.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_management_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_management_dashboard(uuid) TO authenticated;
