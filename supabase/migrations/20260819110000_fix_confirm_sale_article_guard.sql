-- GFC V1 Phase 5.5A -- fixes a real bug caught by the Phase 2 non-régression
-- test: commercial_sale_lines.line_type defaults to 'ARTICLE' even when
-- inventory_item_id is NULL -- a pre-existing, legitimate pattern (a
-- free-text merchandise line with a price but no tracked SKU, exactly what
-- Phase 2's own credit-settlement test uses). confirm_commercial_sale's new
-- location-required guard checked line_type='ARTICLE' alone, wrongly
-- demanding a location for a line that would never actually touch stock --
-- _internal_apply_commercial_sale_line_stock_exit already correctly
-- no-ops on line_type='ARTICLE' AND inventory_item_id IS NULL; the guard
-- now matches that exact condition instead of a looser one.

CREATE OR REPLACE FUNCTION public.confirm_commercial_sale(p_sale_id uuid)
RETURNS commercial_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.commercial_sales;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_client_label text := 'Client comptoir';
  v_line record;
BEGIN
  PERFORM public.permission_require('sales.update');
  SELECT * INTO v_before FROM public.commercial_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une vente brouillon peut être confirmée.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commercial_sale_lines WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.commercial_sale_lines WHERE sale_id = p_sale_id AND line_type = 'ARTICLE' AND inventory_item_id IS NOT NULL) THEN
    IF v_before.business_location_id IS NULL THEN
      RAISE EXCEPTION 'Un magasin est requis pour confirmer une vente contenant des articles de stock.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
      RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_before.client_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.transport_clients WHERE id = v_before.client_id;
    IF FOUND THEN v_client_label := v_client.display_name; END IF;
  END IF;

  UPDATE public.commercial_sales
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  FOR v_line IN SELECT id FROM public.commercial_sale_lines WHERE sale_id = p_sale_id AND line_type = 'ARTICLE' AND inventory_item_id IS NOT NULL
  LOOP
    PERFORM public._internal_apply_commercial_sale_line_stock_exit(
      v_line.id, v_sale.business_location_id, NULL, v_sale.sale_number,
      'Vente ' || v_sale.sale_number, v_client_label
    );
  END LOOP;

  PERFORM public.business_finance_audit_event('COMMERCIAL_SALE', v_sale.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_sale));
  RETURN v_sale;
END;
$function$;
