-- P0 : corrige l'incohérence CUMP découverte pendant les tests de l'override
-- de prix -- sans rapport avec le prix lui-même, une vente ORDINAIRE (prix
-- catalogue exact, aucune permission spéciale) échoue actuellement avec
-- SQLSTATE 23514 sur commerce_inventory_cost_events.commerce_cost_event_one_source.
--
-- Cause exacte, confirmée par lecture directe de l'état en production
-- (pg_get_constraintdef / pg_get_functiondef, pas seulement les fichiers
-- de migration) :
--
-- 1) 20260813120000_add_store_costing_and_profitability.sql a défini la
--    contrainte ORIGINALE : pour event_type='SALE', stock_movement_id ET
--    sale_line_id devaient TOUS DEUX être NOT NULL. Le trigger
--    snapshot_commerce_sale_cost (AFTER INSERT ON
--    commercial_sale_stock_movement_links, exécute
--    _internal_snapshot_commerce_sale_cost) insère en conséquence
--    stock_movement_id = v_movement.id (NOT NULL) pour chaque vente.
--
-- 2) 20260901100000_add_commerce_inventory_writeoff.sql a élargi la
--    contrainte pour accueillir les nouveaux types WRITE_OFF (et
--    ADJUSTMENT_DEFICIT/TRANSFER_OUT déjà existants) -- mais a, dans le
--    même geste, INVERSÉ la règle pour SALE : elle exige désormais
--    stock_movement_id IS NULL (sale_line_id restant NOT NULL, seule
--    référence désormais attendue pour identifier un événement de vente).
--    _internal_snapshot_commerce_sale_cost n'a PAS été mise à jour pour
--    suivre ce changement -- aucune migration ne l'a retouchée depuis le
--    13 août (vérifié : grep de toutes les migrations).
--
-- Résultat : depuis le 1er septembre, TOUTE vente avec ligne ARTICLE (donc
-- avec un mouvement de stock), caisse ou vente commerciale manuelle,
-- échoue à l'étape de valorisation -- reproduit avec une vente
-- parfaitement ordinaire, au prix catalogue exact, admin, sans lien avec
-- l'override de prix (voir le message précédent pour la preuve complète :
-- SQLSTATE 23514, ligne qui aurait été insérée avec
-- stock_movement_id=<NOT NULL> alors que la contrainte l'exige NULL).
--
-- Correctif strictement ciblé : _internal_snapshot_commerce_sale_cost
-- insère désormais stock_movement_id = NULL pour son événement SALE (au
-- lieu de v_movement.id), exactement ce que la contrainte déjà en
-- vigueur depuis le 1er septembre attend -- sale_line_id (déjà NOT NULL)
-- reste l'unique référence pour identifier cet événement, cohérent avec
-- l'index unique déjà existant commerce_inventory_cost_sale_once_idx
-- (lui-même déjà basé sur sale_line_id, jamais stock_movement_id, pour
-- event_type='SALE' -- non affecté par ce correctif).
--
-- v_movement (la ligne de stock_movements elle-même) reste lu et utilisé
-- tel quel pour toutes ses AUTRES colonnes (business_location_id,
-- inventory_item_id, quantity, business_location_id de validation) --
-- seule la valeur écrite dans la colonne stock_movement_id de
-- commerce_inventory_cost_events change. Aucune formule de CUMP, aucune
-- quantité, aucun montant, aucune règle Finance, aucun wallet, aucune
-- permission, rien côté override de prix ou caisse hors ligne n'est
-- modifié -- CREATE OR REPLACE avec la même signature (aucun grant à
-- refaire), aucune suppression de donnée.
CREATE OR REPLACE FUNCTION public._internal_snapshot_commerce_sale_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_movement public.stock_movements;
  v_line public.commercial_sale_lines;
  v_state public.commerce_inventory_cost_states;
  v_new_quantity numeric(14, 3);
  v_new_value numeric(16, 2);
BEGIN
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = NEW.stock_movement_id FOR UPDATE;
  SELECT * INTO v_line FROM public.commercial_sale_lines WHERE id = NEW.sale_line_id FOR UPDATE;

  IF v_line.line_type <> 'ARTICLE' OR v_line.inventory_item_id IS NULL
    OR v_movement.movement_type <> 'SALE' OR v_movement.status <> 'VALID'
    OR v_movement.business_location_id IS NULL
    OR v_movement.inventory_item_id <> v_line.inventory_item_id
    OR v_movement.quantity <> v_line.quantity THEN
    RAISE EXCEPTION 'Lien vente-stock incoherent pour la valorisation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state FROM public.commerce_inventory_cost_states
  WHERE business_location_id = v_movement.business_location_id
    AND inventory_item_id = v_movement.inventory_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUMP indisponible pour cet article et ce magasin.' USING ERRCODE = '22023';
  END IF;
  IF v_state.quantity_on_hand < v_line.quantity THEN
    RAISE EXCEPTION 'Stock valorise insuffisant (% disponible, % vendu).', v_state.quantity_on_hand, v_line.quantity
      USING ERRCODE = '22023';
  END IF;

  v_new_quantity := v_state.quantity_on_hand - v_line.quantity;
  v_new_value := round(v_new_quantity * v_state.current_unit_cost, 2);

  INSERT INTO public.commercial_sale_line_costs(sale_line_id, unit_cost, total_cost, gross_margin)
  VALUES(v_line.id, v_state.current_unit_cost,
    round(v_line.quantity * v_state.current_unit_cost, 2),
    round(v_line.line_total - round(v_line.quantity * v_state.current_unit_cost, 2), 2));

  UPDATE public.commerce_inventory_cost_states
  SET quantity_on_hand = v_new_quantity, inventory_value = v_new_value, updated_at = now()
  WHERE business_location_id = v_movement.business_location_id
    AND inventory_item_id = v_movement.inventory_item_id;

  -- CORRECTIF (voir en-tête) : stock_movement_id = NULL, pas v_movement.id
  -- -- la contrainte commerce_cost_event_one_source (depuis
  -- 20260901100000) exige stock_movement_id IS NULL pour event_type=
  -- 'SALE' ; sale_line_id (v_line.id, déjà NOT NULL) reste l'unique
  -- référence de cet événement, exactement comme l'attend déjà l'index
  -- unique commerce_inventory_cost_sale_once_idx.
  INSERT INTO public.commerce_inventory_cost_events(
    business_location_id, inventory_item_id, event_type, stock_movement_id, sale_line_id,
    quantity, unit_cost, total_cost, quantity_before, quantity_after,
    unit_cost_before, unit_cost_after, created_by
  ) VALUES (
    v_movement.business_location_id, v_movement.inventory_item_id, 'SALE', NULL, v_line.id,
    v_line.quantity, v_state.current_unit_cost, round(v_line.quantity * v_state.current_unit_cost, 2),
    v_state.quantity_on_hand, v_new_quantity, v_state.current_unit_cost, v_state.current_unit_cost, auth.uid()
  );
  RETURN NEW;
END;
$function$;
