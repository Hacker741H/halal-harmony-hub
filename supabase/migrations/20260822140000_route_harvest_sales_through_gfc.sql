-- Route harvest sales through the GFC (commercial_sales) engine instead of
-- the legacy direct-Finance sell_harvest path.
--
-- sell_harvest -> _internal_update_harvest_with_finance writes
-- finance_operations directly (REVENUE + immediate wallet credit) with no
-- invoice/créance concept and no link to commercial_sales. It is now
-- classified LEGACY: kept for historical compatibility, no longer reachable
-- from the modern UI. New harvest sales go through create_commercial_sale
-- with a commercial_sale_lines.harvest_id line instead, reusing the GFC's
-- existing DRAFT -> CONFIRMED -> invoice -> payment pipeline unchanged.
--
-- This migration adds the guards needed for that coexistence:
--   1. A harvest_id sale line requires the harvest to be DELIVERED/CLOSED,
--      is capped at the harvest's delivered weight minus what is already
--      sold by other CONFIRMED sales, and is refused if a legacy
--      finance_harvest_links row already exists for that harvest.
--   2. The same quantity/legacy check is re-run (with a row lock on the
--      harvest) when the sale is actually CONFIRMED, closing the race where
--      two DRAFT sales are created concurrently before either is confirmed.
--   3. _internal_update_harvest_with_finance (sell_harvest's target) refuses
--      to write a direct Finance operation if any non-cancelled
--      commercial_sale_lines already reference the harvest.
-- Together these make the two sale paths mutually exclusive per harvest, in
-- both directions, enforced server-side.

CREATE OR REPLACE FUNCTION public._internal_upsert_commercial_sale_lines(p_sale_id uuid, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_line jsonb;
  v_count integer := 0;
  v_description text;
  v_quantity numeric(14, 3);
  v_unit text;
  v_unit_price numeric(14, 2);
  v_inventory_item_id uuid;
  v_harvest_id uuid;
  v_farm_id uuid;
  v_harvest public.harvests;
  v_already_sold numeric(14, 3);
  v_remaining numeric(14, 3);
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.commercial_sale_lines WHERE sale_id = p_sale_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_line) AS key_name
      WHERE key_name NOT IN ('description', 'quantity', 'unit', 'unit_price', 'inventory_item_id', 'harvest_id', 'farm_id')
    ) THEN
      RAISE EXCEPTION 'Une ligne de vente contient une propriété non autorisée.' USING ERRCODE = '22023';
    END IF;

    v_description := NULLIF(btrim(v_line ->> 'description'), '');
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_unit := COALESCE(NULLIF(btrim(v_line ->> 'unit'), ''), 'UNITE');
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
    v_inventory_item_id := NULLIF(v_line ->> 'inventory_item_id', '')::uuid;
    v_harvest_id := NULLIF(v_line ->> 'harvest_id', '')::uuid;
    v_farm_id := NULLIF(v_line ->> 'farm_id', '')::uuid;

    IF v_description IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Chaque ligne doit posséder un libellé, une quantité positive et un prix unitaire valide.' USING ERRCODE = '22023';
    END IF;
    IF v_inventory_item_id IS NOT NULL AND v_harvest_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une ligne ne peut pas référencer simultanément un article et une récolte.' USING ERRCODE = '22023';
    END IF;
    IF v_inventory_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE id = v_inventory_item_id) THEN
      RAISE EXCEPTION 'Article de stock introuvable.' USING ERRCODE = '23503';
    END IF;

    IF v_harvest_id IS NOT NULL THEN
      SELECT * INTO v_harvest FROM public.harvests WHERE id = v_harvest_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = '23503';
      END IF;
      IF v_harvest.status NOT IN ('DELIVERED', 'CLOSED') THEN
        RAISE EXCEPTION 'Cette récolte doit être livrée ou clôturée avant de pouvoir être vendue (statut actuel : %).', v_harvest.status USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.finance_harvest_links WHERE harvest_id = v_harvest_id) THEN
        RAISE EXCEPTION 'Cette récolte a déjà été vendue via l''ancien circuit direct -- vente GFC impossible pour cette récolte.' USING ERRCODE = '22023';
      END IF;

      SELECT COALESCE(sum(csl.quantity), 0) INTO v_already_sold
      FROM public.commercial_sale_lines csl
      JOIN public.commercial_sales cs ON cs.id = csl.sale_id
      WHERE csl.harvest_id = v_harvest_id AND cs.status = 'CONFIRMED';

      v_remaining := COALESCE(v_harvest.poids_livre_kg, 0) - v_already_sold;
      IF v_quantity > v_remaining THEN
        RAISE EXCEPTION 'Quantité vendue (% kg) supérieure à la quantité restante vendable de cette récolte (% kg restant sur % kg livré, % kg déjà vendu).',
          v_quantity, v_remaining, v_harvest.poids_livre_kg, v_already_sold USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_farm_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
      RAISE EXCEPTION 'Exploitation introuvable.' USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.commercial_sale_lines(
      sale_id, description, quantity, unit, unit_price, line_total,
      inventory_item_id, harvest_id, farm_id
    ) VALUES (
      p_sale_id, v_description, v_quantity, v_unit, v_unit_price,
      round(v_quantity * v_unit_price, 2), v_inventory_item_id, v_harvest_id, v_farm_id
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Une vente doit contenir au moins une ligne.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

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
  v_harvest_line record;
  v_harvest public.harvests;
  v_already_sold numeric(14, 3);
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

  -- Re-validate harvest-linked lines at the moment of real commitment, with a
  -- row lock on the harvest: closes the race where two DRAFT sales for the
  -- same harvest are both created before either is confirmed (each would
  -- pass the draft-time check in _internal_upsert_commercial_sale_lines
  -- since neither counted as CONFIRMED yet).
  FOR v_harvest_line IN
    SELECT csl.harvest_id, csl.quantity
    FROM public.commercial_sale_lines csl
    WHERE csl.sale_id = p_sale_id AND csl.harvest_id IS NOT NULL
  LOOP
    SELECT * INTO v_harvest FROM public.harvests WHERE id = v_harvest_line.harvest_id FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.finance_harvest_links WHERE harvest_id = v_harvest_line.harvest_id) THEN
      RAISE EXCEPTION 'Cette récolte a déjà été vendue via l''ancien circuit direct -- confirmation impossible pour cette vente.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(sum(csl2.quantity), 0) INTO v_already_sold
    FROM public.commercial_sale_lines csl2
    JOIN public.commercial_sales cs2 ON cs2.id = csl2.sale_id
    WHERE csl2.harvest_id = v_harvest_line.harvest_id AND cs2.status = 'CONFIRMED';

    IF v_harvest_line.quantity > (COALESCE(v_harvest.poids_livre_kg, 0) - v_already_sold) THEN
      RAISE EXCEPTION 'Quantité vendue (% kg) supérieure à la quantité restante vendable de cette récolte (% kg restant).',
        v_harvest_line.quantity, COALESCE(v_harvest.poids_livre_kg, 0) - v_already_sold USING ERRCODE = '22023';
    END IF;
  END LOOP;

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

CREATE OR REPLACE FUNCTION public._internal_update_harvest_with_finance(p_harvest jsonb)
 RETURNS harvests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
  v_operation_id uuid;
  v_operation public.finance_operations;
  v_wallet_id uuid := NULLIF(p_harvest ->> 'sale_wallet_id', '')::uuid;
  v_amount numeric(14, 2);
BEGIN
  PERFORM public.business_finance_require_write_role();
  SELECT * INTO v_before FROM public.harvests
  WHERE id = NULLIF(p_harvest ->> 'id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.harvests
  SET farm_id = NULLIF(p_harvest ->> 'farm_id', '')::uuid,
      date_recolte = NULLIF(p_harvest ->> 'date_recolte', '')::date,
      produit = NULLIF(trim(p_harvest ->> 'produit'), ''),
      quantite_kg = NULLIF(p_harvest ->> 'quantite_kg', '')::numeric,
      prix_kg = NULLIF(p_harvest ->> 'prix_kg', '')::numeric,
      acheteur = NULLIF(trim(p_harvest ->> 'acheteur'), ''),
      observations = NULLIF(trim(p_harvest ->> 'observations'), ''),
      sale_wallet_id = v_wallet_id,
      updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_harvest;

  SELECT operation_id INTO v_operation_id
  FROM public.finance_harvest_links WHERE harvest_id = v_harvest.id;

  IF v_wallet_id IS NOT NULL THEN
    -- Anti-double-CA: refuse the legacy direct-Finance path once this
    -- harvest is already sold (even in DRAFT) through the GFC.
    IF EXISTS (
      SELECT 1
      FROM public.commercial_sale_lines csl
      JOIN public.commercial_sales cs ON cs.id = csl.sale_id
      WHERE csl.harvest_id = v_harvest.id AND cs.status <> 'CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Cette récolte est déjà vendue via une vente commerciale (GFC) -- utilisez cette vente pour tout encaissement, pas la vente directe historique.' USING ERRCODE = '22023';
    END IF;

    v_amount := v_harvest.quantite_kg * v_harvest.prix_kg;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Un encaissement de récolte exige un montant strictement positif.' USING ERRCODE = '22023';
    END IF;
    v_operation := public.business_upsert_finance_operation(
      v_operation_id, v_wallet_id, 'REVENUE', v_amount, v_harvest.date_recolte,
      'VENTE AGRICOLE', 'Encaissement de la récolte ' || v_harvest.produit,
      'HARVEST_SALE', 'HARVEST', v_harvest.id, NULL, v_harvest.farm_id,
      NULL, NULL, NULL, NULL, v_harvest.id, NULL, NULL, NULL, NULL,
      v_harvest.acheteur, NULL
    );
    IF v_operation_id IS NULL THEN
      INSERT INTO public.finance_harvest_links(operation_id, harvest_id)
      VALUES (v_operation.id, v_harvest.id);
    END IF;
  ELSIF v_operation_id IS NOT NULL THEN
    v_operation := public.business_cancel_finance_operation(v_operation_id);
  END IF;

  PERFORM public.business_finance_audit_event(
    'HARVEST', v_harvest.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest)
  );
  RETURN v_harvest;
END;
$function$;
