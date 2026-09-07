-- BUG PRODUCTION -- isActive undefined à la création/modification d'un
-- poste de caisse.
--
-- Diagnostic confirmé par requête réelle en production (transaction
-- garantie-annulée, impersonation du compte réel Mariam Keita, admin) :
--   get_commerce_cash_registers (jsonb_build_object explicite) renvoie déjà
--   correctement isActive -- {"id":..,"name":"CAISSE MARIAM","isActive":true}.
-- Mais create_commerce_cash_register / update_commerce_cash_register
-- déclaraient RETURNS public.commerce_cash_registers (le type composite
-- brut de la table) et faisaient RETURN v_register directement -- au lieu
-- de suivre le même motif jsonb_build_object que TOUTES les autres RPC de
-- ce chantier. PostgREST sérialise un type composite avec les noms de
-- colonnes réels : is_active (snake_case), jamais isActive. Le schéma Zod
-- frontend (commerceCashRegisterSchema, src/lib/commerce-pos.functions.ts)
-- exige isActive en camelCase, obligatoire -- absent du payload réel dans
-- exactement ces deux réponses, d'où
--   ZodError invalid_type, expected boolean, received undefined,
--   path: ["isActive"], message: "Required"
-- à chaque clic sur "Ajouter" ou sur le bouton actif/inactif d'un poste.
-- L'écriture en base réussissait déjà (confirmé : les deux postes créés
-- pendant le test existent bien, is_active=true) -- seule la réponse au
-- client échouait à se parser, d'où l'écran qui semblait "ne pas
-- apparaître correctement" malgré une création réelle en base.
--
-- Recherche du même défaut sur les 9 autres RPC de ce chantier (grep
-- systématique de chaque RETURNS/jsonb_build_object des 3 migrations
-- précédentes) : aucune autre fonction n'est concernée. Seules
-- create_commerce_cash_register et update_commerce_cash_register
-- renvoyaient un type composite brut à un schéma Zod multi-champs;
-- assign_business_location_user renvoie aussi un composite brut mais son
-- schéma Zod ne lit que `id` (identique en snake_case et camelCase), donc
-- sans risque.
--
-- Correctif : un seul contrat de données, pas une deuxième API --
-- jsonb_build_object explicite, exactement le motif déjà utilisé par
-- get_commerce_cash_registers. Le type de retour change (composite ->
-- jsonb), ce que CREATE OR REPLACE FUNCTION n'autorise pas ; DROP puis
-- CREATE dans la même migration -- une fonction n'est pas une table,
-- aucune perte de données. Reproduction intégrale du corps de chaque
-- fonction (20260907100000) ; seuls RETURNS et le RETURN final changent.

DROP FUNCTION IF EXISTS public.create_commerce_cash_register(jsonb);

CREATE FUNCTION public.create_commerce_cash_register(p_register jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_register ->> 'business_location_id', '')::uuid;
  v_name text := NULLIF(btrim(p_register ->> 'name'), '');
  v_register public.commerce_cash_registers;
BEGIN
  PERFORM public.permission_require('locations.manage');

  IF v_location_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'Magasin ou nom de poste invalide.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_locations WHERE id = v_location_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Point de vente introuvable ou archivé.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.commerce_cash_registers(business_location_id, name, created_by, updated_by)
  VALUES (v_location_id, v_name, auth.uid(), auth.uid())
  RETURNING * INTO v_register;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_CASH_REGISTER', v_register.id, NULL, 'CREATE', NULL, to_jsonb(v_register)
  );

  -- Correctif : jsonb_build_object (camelCase), pas le composite brut.
  RETURN jsonb_build_object('id', v_register.id, 'name', v_register.name, 'isActive', v_register.is_active);
END;
$function$;

DROP FUNCTION IF EXISTS public.update_commerce_cash_register(jsonb);

CREATE FUNCTION public.update_commerce_cash_register(p_register jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_register_id uuid := NULLIF(p_register ->> 'register_id', '')::uuid;
  v_name text := NULLIF(btrim(p_register ->> 'name'), '');
  -- is_active est un champ explicitement fourni (jamais deviné) : absent du
  -- payload = inchangé, présent = nouvelle valeur, y compris false.
  v_has_is_active boolean := p_register ? 'is_active';
  v_is_active boolean := (p_register ->> 'is_active')::boolean;
  v_before public.commerce_cash_registers;
  v_register public.commerce_cash_registers;
BEGIN
  PERFORM public.permission_require('locations.manage');

  IF v_register_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'Poste de caisse ou nom invalide.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before
  FROM public.commerce_cash_registers
  WHERE id = v_register_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poste de caisse introuvable.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.commerce_cash_registers
  SET name = v_name,
      is_active = CASE WHEN v_has_is_active THEN v_is_active ELSE is_active END,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_register_id
  RETURNING * INTO v_register;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_CASH_REGISTER', v_register.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_register)
  );

  -- Correctif : jsonb_build_object (camelCase), pas le composite brut.
  RETURN jsonb_build_object('id', v_register.id, 'name', v_register.name, 'isActive', v_register.is_active);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_commerce_cash_register(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_commerce_cash_register(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commerce_cash_register(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_commerce_cash_register(jsonb) TO authenticated;
