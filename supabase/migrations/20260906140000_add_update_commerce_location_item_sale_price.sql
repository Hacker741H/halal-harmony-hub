-- Suite du correctif "article transféré indisponible" : /commerce affiche
-- désormais "Prix de vente à définir" quand business_location_inventory_
-- items.sale_price est NULL, mais l'utilisateur n'avait aucun moyen d'en
-- définir un depuis cet écran. Recherche préalable d'une RPC existante :
-- configure_commerce_location_item (20260811113000) est la seule fonction
-- qui écrit sale_price, mais elle exige et écrase INCONDITIONNELLEMENT
-- quantity (v_quantity IS NULL rejette l'appel, SET quantity =
-- EXCLUDED.quantity systématique) -- la réutiliser pour un simple
-- changement de prix obligerait à relire puis renvoyer la quantité
-- courante, avec un vrai risque de correction accidentelle (une vente
-- concurrente entre la lecture et l'écriture serait silencieusement
-- écrasée). Elle applique aussi le plafond d'allocation globale
-- (v_allocated_elsewhere), une contrainte hors sujet pour un prix seul.
-- Nouvelle fonction minimale et sûre à la place -- ne touche jamais à
-- quantity, reorder_level, au CUMP (commerce_inventory_cost_states), aux
-- mouvements de stock ou à Finance.
--
-- Le trigger existant trg_track_business_location_inventory_item_price
-- (20260814140000) capture automatiquement ce changement dans l'historique
-- de prix catalogue (AFTER UPDATE OF sale_price) -- aucune action
-- supplémentaire requise ici pour que le prix plancher POS reste correct.
CREATE OR REPLACE FUNCTION public.update_commerce_location_item_sale_price(
  p_business_location_id uuid,
  p_inventory_item_id uuid,
  p_sale_price numeric
)
RETURNS public.business_location_inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.business_location_inventory_items;
  v_result public.business_location_inventory_items;
BEGIN
  -- Même permission que configure_commerce_location_item ("Mettre en
  -- rayon") -- l'action la plus proche déjà existante pour ce magasin,
  -- aucune permission nouvelle créée.
  PERFORM public.permission_require('commerce.stock.receive');

  IF p_sale_price IS NULL OR p_sale_price < 0 THEN
    RAISE EXCEPTION 'Le prix de vente doit être un nombre positif ou nul.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.commerce_location_access_allowed(p_business_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce magasin.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before
  FROM public.business_location_inventory_items
  WHERE business_location_id = p_business_location_id
    AND inventory_item_id = p_inventory_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cet article n''est pas encore présent dans ce magasin.' USING ERRCODE = '23503';
  END IF;

  -- Seule sale_price change -- quantity, reorder_level et toute autre
  -- colonne restent strictement celles déjà en base.
  UPDATE public.business_location_inventory_items
  SET sale_price = p_sale_price, updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_result;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_LOCATION_INVENTORY', v_result.id, NULL, 'UPDATE_SALE_PRICE',
    to_jsonb(v_before), to_jsonb(v_result)
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_commerce_location_item_sale_price(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_commerce_location_item_sale_price(uuid, uuid, numeric) TO authenticated;
