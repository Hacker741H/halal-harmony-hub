-- CHANTIER CAISSE (3/4) : lecture d'appoint pour l'affichage -- résoudre un
-- terminal_id en nom de poste lisible, et donner au gestionnaire la
-- visibilité "qui a quel poste ouvert, depuis quand" que le cycle de vie
-- serveur (2/4) rend enfin possible.
--
-- Choix délibéré : deux petites RPC nouvelles plutôt que de modifier
-- get_commerce_pos_control_reports ou get_commerce_store_cockpit en place.
-- Ces deux fonctions existantes sont volumineuses (plusieurs centaines de
-- lignes) et reproduire l'une d'elles ici comporterait un risque réel
-- d'omettre silencieusement un champ déjà consommé par le frontend --
-- un risque que la consigne du chantier ("ne détruis aucune logique déjà
-- validée") interdit précisément de prendre pour un simple gain cosmétique.
-- La résolution terminal_id -> nom de poste se fait donc côté client, à
-- partir de cette liste, appliquée uniformément partout où un terminal_id
-- est déjà affiché aujourd'hui (clôtures, rapports de contrôle, reçus de
-- synchronisation) -- sans toucher une seule des RPC qui les produisent.

CREATE OR REPLACE FUNCTION public.get_commerce_cash_registers(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('id', register_row.id, 'name', register_row.name, 'isActive', register_row.is_active)
      ORDER BY register_row.is_active DESC, register_row.name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.commerce_cash_registers AS register_row
  WHERE register_row.business_location_id = p_location_id;

  RETURN v_result;
END;
$function$;

-- Visibilité gestionnaire : quels postes sont ouverts en ce moment, par qui,
-- depuis quand -- la question précise que le cycle de vie serveur (2/4)
-- rend enfin répondable (avant lui, "ouvert" n'existait pas côté serveur).
-- Même tier d'accès que le reste du contrôle caisse (commerce.cash.read,
-- cf. v_cash_access dans get_commerce_store_cockpit).
CREATE OR REPLACE FUNCTION public.get_commerce_pos_open_sessions(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.cash.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce point de vente.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cashSessionId', session_row.cash_session_id,
        'cashRegisterId', session_row.cash_register_id,
        'cashRegisterName', register_row.name,
        'terminalId', session_row.terminal_id,
        'cashierId', session_row.cashier_user_id,
        'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
        'openedAtServer', session_row.opened_at_server
      )
      ORDER BY session_row.opened_at_server
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.commerce_pos_cash_sessions AS session_row
  LEFT JOIN public.commerce_cash_registers AS register_row ON register_row.id = session_row.cash_register_id
  LEFT JOIN public.profiles AS profile_row ON profile_row.id = session_row.cashier_user_id
  WHERE session_row.business_location_id = p_location_id
    AND session_row.status = 'OPEN';

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_cash_registers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_commerce_pos_open_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_cash_registers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_open_sessions(uuid) TO authenticated;
