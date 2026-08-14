-- Mission caisse-UX -- surface the existing inventory_items.categorie column
-- through the cashier workspace, so the redesigned catalogue can group
-- articles by category. Purely additive: one more key in an existing jsonb
-- payload, no schema change, no behavior change beyond the new field.
CREATE OR REPLACE FUNCTION public.get_commerce_pos_workspace(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.pos.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'location', jsonb_build_object('id', location_row.id, 'name', location_row.name, 'code', location_row.code),
    'wallets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', wallet_row.id, 'name', wallet_row.name, 'purpose', mapping.purpose, 'isPrimary', mapping.is_primary) ORDER BY mapping.is_primary DESC, wallet_row.name)
      FROM public.business_location_wallets mapping JOIN public.wallets wallet_row ON wallet_row.id = mapping.wallet_id
      WHERE mapping.business_location_id = p_location_id AND mapping.is_active), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', item.id, 'name', item.nom, 'sku', item.sku, 'unit', item.unite, 'category', item.categorie, 'quantity', local_item.quantity, 'salePrice', local_item.sale_price, 'reorderLevel', local_item.reorder_level) ORDER BY item.nom)
      FROM public.business_location_inventory_items local_item JOIN public.inventory_items item ON item.id = local_item.inventory_item_id
      WHERE local_item.business_location_id = p_location_id), '[]'::jsonb),
    'today', jsonb_build_object('saleCount', (SELECT count(*) FROM public.commercial_sales sale WHERE sale.business_location_id = p_location_id AND sale.status = 'CONFIRMED' AND sale.sale_date = current_date),
      'received', COALESCE((SELECT sum(payment.amount) FROM public.commercial_invoice_payments payment JOIN public.commercial_sales sale ON sale.id = payment.sale_id WHERE sale.business_location_id = p_location_id AND payment.status = 'CONFIRMED' AND payment.payment_date = current_date), 0))
  ) INTO v_result FROM public.business_locations location_row JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = p_location_id AND location_row.status = 'ACTIVE' AND unit_row.code = 'COMMERCE';
  IF v_result IS NULL THEN RAISE EXCEPTION 'Point de vente Commerce introuvable ou archivé.' USING ERRCODE = 'P0002'; END IF;
  RETURN v_result;
END;
$function$;
