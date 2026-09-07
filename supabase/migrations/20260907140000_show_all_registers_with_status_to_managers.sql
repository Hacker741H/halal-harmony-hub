-- BUG UX -- écran "poste occupé" n'affichait que Réessayer, jamais
-- "Choisir une autre caisse", pour MAGASIN MARIAM précisément.
--
-- Cause exacte : get_commerce_pos_available_registers filtrait déjà sur
-- register_row.is_active -- CAISSE MARIAM est inactif (désactivé par
-- l'admin elle-même pendant les tests du correctif isActive), donc la
-- liste ne contenait qu'un seul élément (CAISSE 2) pour MAGASIN MARIAM.
-- Le bouton "Choisir un autre poste" (déjà écrit, jamais retiré) est
-- gated sur registers.length > 1 côté UI -- avec une liste à 1 élément,
-- il ne s'affichait donc jamais, quel que soit l'état d'occupation.
--
-- Correctif : la RPC renvoie désormais TOUS les postes que l'appelant est
-- en droit de voir (actifs ET inactifs pour un admin/locations.manage --
-- un simple caissier continue de ne voir que les postes actifs déjà
-- couverts par son affectation, comportement inchangé), avec isActive.
-- L'occupation (qui a quel poste ouvert, depuis quand) est fusionnée côté
-- client avec get_commerce_pos_open_sessions -- déjà écrite, déjà testée,
-- jamais encore branchée à un écran -- pas une nouvelle RPC.
-- Reproduction intégrale (20260907100000), seuls le filtre is_active et
-- le champ isActive du jsonb_build_object changent.
CREATE OR REPLACE FUNCTION public.get_commerce_pos_available_registers(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_can_manage boolean := public.user_has_permission('locations.manage');
  v_assigned_register_id uuid;
  v_has_register_row boolean;
BEGIN
  PERFORM public.permission_require('commerce.pos.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501';
  END IF;

  SELECT assignment_row.cash_register_id, true
  INTO v_assigned_register_id, v_has_register_row
  FROM public.business_location_assignments AS assignment_row
  WHERE assignment_row.business_location_id = p_location_id
    AND assignment_row.user_id = auth.uid()
    AND assignment_row.end_date IS NULL
  ORDER BY assignment_row.cash_register_id IS NULL, assignment_row.created_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', register_row.id, 'name', register_row.name, 'isActive', register_row.is_active) ORDER BY register_row.name), '[]'::jsonb)
  INTO v_result
  FROM public.commerce_cash_registers AS register_row
  WHERE register_row.business_location_id = p_location_id
    -- Ajout : un poste inactif n'est visible que pour un profil pouvant
    -- gérer les postes (admin/gestionnaire) -- un simple caissier continue
    -- de ne voir strictement que des postes actifs, comme avant.
    AND (register_row.is_active OR v_can_manage)
    AND (
      v_can_manage
      OR NOT v_has_register_row  -- locations.manage seul mais sans affectation propre : ne devrait pas arriver (déjà refusé plus haut), gardé défensif
      OR v_assigned_register_id IS NULL
      OR register_row.id = v_assigned_register_id
    );

  RETURN v_result;
END;
$function$;
-- GRANT déjà accordé (CREATE OR REPLACE préserve les privilèges).
