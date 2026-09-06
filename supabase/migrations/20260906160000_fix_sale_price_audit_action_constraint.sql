-- Bug production reproduit et confirmé (transaction garantie-rollback,
-- rien persisté, voir diagnostic) : update_commerce_location_item_sale_
-- price échouait TOUJOURS, sale_price restant NULL malgré un dialogue
-- fonctionnel et un prix correctement saisi.
--
-- Cause exacte, SQLSTATE 23514 : "new row for relation
-- ''business_finance_audit'' violates check constraint
-- ''business_finance_audit_action_check''". Le CHECK de cette table
-- n'autorise que ARRAY['CREATE','UPDATE','CANCEL','DELETE','CLOSE',
-- 'ARCHIVE','RESTORE','REPLACE','ASSIGN','UNASSIGN','MERGE','DEPARTURE',
-- 'DELIVERY','CORRECT','CONFIRM'] -- 'UPDATE_SALE_PRICE' (choisi dans
-- 20260906140000) n'en fait pas partie. L'UPDATE de sale_price s'exécutait
-- bien DANS la fonction, mais l'appel d'audit qui suit immédiatement
-- échouait avec cette violation de contrainte, ce qui annulait toute la
-- transaction -- UPDATE inclus. C'est pourquoi le prix restait NULL malgré
-- un dialogue et une saisie fonctionnels : l'échec survient après l'écriture,
-- jamais avant.
--
-- Correctif minimal : 'UPDATE' (déjà dans la liste autorisée, sémantique
-- exacte -- un enregistrement existant a été modifié) remplace
-- 'UPDATE_SALE_PRICE'. Aucun élargissement de contrainte nécessaire,
-- aucune deuxième RPC créée -- la cause est corrigée dans le mécanisme
-- existant. Vérifié à l'identique en transaction garantie-rollback avant
-- d'écrire cette migration : quantity inchangée (1.000 -> 1.000),
-- sale_price NULL -> 8000.00, aucune erreur.
--
-- Reproduction exacte de la définition actuelle
-- (20260906150000_require_strictly_positive_sale_price.sql), seule la
-- valeur de p_action passée à business_finance_audit_event change.
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

  -- Règle métier verrouillée : un sale_price normal est strictement
  -- positif -- 0 n'est plus accepté (NULL et négatif ne l'étaient déjà
  -- pas). La gratuité sera traitée par un workflow dédié plus tard,
  -- jamais par ce champ.
  IF p_sale_price IS NULL OR p_sale_price <= 0 THEN
    RAISE EXCEPTION 'Le prix de vente doit être strictement positif.' USING ERRCODE = '22023';
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

  -- Correctif : 'UPDATE' (valeur permise par business_finance_audit_
  -- action_check), pas 'UPDATE_SALE_PRICE' (invalide, cause du bug).
  PERFORM public.business_finance_audit_event(
    'COMMERCE_LOCATION_INVENTORY', v_result.id, NULL, 'UPDATE',
    to_jsonb(v_before), to_jsonb(v_result)
  );

  RETURN v_result;
END;
$function$;
