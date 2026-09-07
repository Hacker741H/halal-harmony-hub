-- CHANTIER CAISSE (1/4) : entité "poste de caisse" (commerce_cash_registers)
-- et affectation d'un collaborateur à un poste précis.
--
-- Constat du diagnostic (lecture directe du schéma + deux agents
-- d'exploration indépendants, résultats convergents) : aucune notion de
-- "caisse" nommée n'existe nulle part -- business_location_assignments
-- affecte un collaborateur à un MAGASIN, jamais à un poste précis en son
-- sein. Le seul identifiant qui s'en approche (terminal_id) est un UUID
-- généré côté navigateur, ambiant, jamais choisi par l'utilisateur (voir
-- 20260814100000, commentaire "no server-side terminal registry exists yet
-- (that is POS-03 scope)"). C'est la cause racine de la sélection
-- silencieuse d'"une" caisse.
--
-- Conception additive, réutilisant le modèle d'affectation existant plutôt
-- que d'en créer un second (consigne explicite du chantier) :
--   - Nouvelle table commerce_cash_registers, un poste nommé par magasin.
--   - Nouvelle colonne NULLABLE business_location_assignments.cash_register_id.
--     NULL = affectation "tout le magasin" (comportement strictement
--     identique à aujourd'hui pour chaque ligne déjà existante -- aucune
--     migration de données requise). Une valeur = affectation à un poste
--     précis uniquement.
-- Zéro impact sur les ventes, wallets ou écritures Finance déjà en base.

CREATE TABLE IF NOT EXISTS public.commerce_cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(name)) BETWEEN 1 AND 80)
);

-- Un nom de poste actif est unique par magasin (insensible à la casse) ;
-- un poste désactivé libère son nom pour une réutilisation future, comme
-- business_location_wallets_one_active_primary_idx le fait déjà pour les
-- wallets primaires (même motif WHERE is_active dans ce schéma).
CREATE UNIQUE INDEX IF NOT EXISTS commerce_cash_registers_active_name_idx
  ON public.commerce_cash_registers(business_location_id, lower(btrim(name)))
  WHERE is_active;
CREATE INDEX IF NOT EXISTS commerce_cash_registers_location_idx
  ON public.commerce_cash_registers(business_location_id, is_active, name);

ALTER TABLE public.business_location_assignments
  ADD COLUMN IF NOT EXISTS cash_register_id uuid REFERENCES public.commerce_cash_registers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS business_location_assignments_register_idx
  ON public.business_location_assignments(cash_register_id) WHERE cash_register_id IS NOT NULL;

ALTER TABLE public.commerce_cash_registers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_cash_registers_read ON public.commerce_cash_registers;
CREATE POLICY commerce_cash_registers_read ON public.commerce_cash_registers
  FOR SELECT TO authenticated
  USING (public.commerce_location_access_allowed(business_location_id));

-- Tiers d'accès partagé par la RPC de disponibilité et par l'ouverture de
-- session : un facteur commun pour ne jamais laisser les deux logiques
-- diverger. STABLE (jamais appelée en dehors d'une lecture cohérente d'une
-- même transaction, jamais utilisée pour écrire).
CREATE OR REPLACE FUNCTION public._internal_commerce_pos_register_access(
  p_location_id uuid,
  p_register_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_assigned_register_id uuid;
  v_has_whole_location_assignment boolean;
BEGIN
  IF public.user_has_permission('locations.manage') THEN
    RETURN true;
  END IF;

  SELECT assignment_row.cash_register_id
  INTO v_assigned_register_id
  FROM public.business_location_assignments AS assignment_row
  WHERE assignment_row.business_location_id = p_location_id
    AND assignment_row.user_id = auth.uid()
    AND assignment_row.end_date IS NULL
  ORDER BY assignment_row.cash_register_id IS NULL, assignment_row.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Affectation "tout le magasin" (cash_register_id NULL) : accès à tout
  -- poste actif de ce magasin, y compris quand p_register_id est NULL
  -- (magasin sans poste nommé configuré -- comportement historique).
  v_has_whole_location_assignment := v_assigned_register_id IS NULL;
  IF v_has_whole_location_assignment THEN
    RETURN true;
  END IF;

  RETURN v_assigned_register_id = p_register_id;
END;
$function$;

-- Liste les postes que l'utilisateur courant peut choisir pour ce magasin.
-- [] = magasin pas encore migré vers des postes nommés -- le client garde
-- alors le comportement ambiant historique (un seul poste implicite, celui
-- du navigateur), sans aucune action requise de la part d'un administrateur.
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', register_row.id, 'name', register_row.name) ORDER BY register_row.name), '[]'::jsonb)
  INTO v_result
  FROM public.commerce_cash_registers AS register_row
  WHERE register_row.business_location_id = p_location_id
    AND register_row.is_active
    AND (
      v_can_manage
      OR NOT v_has_register_row  -- locations.manage seul mais sans affectation propre : ne devrait pas arriver (déjà refusé plus haut), gardé défensif
      OR v_assigned_register_id IS NULL
      OR register_row.id = v_assigned_register_id
    );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_commerce_cash_register(p_register jsonb)
RETURNS public.commerce_cash_registers
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

  RETURN v_register;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_commerce_cash_register(p_register jsonb)
RETURNS public.commerce_cash_registers
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

  RETURN v_register;
END;
$function$;

-- Extension de CM-06 (20260810120000) : une affectation peut désormais
-- viser un poste précis. cash_register_id absent ou vide du payload =
-- affectation "tout le magasin" (comportement exact d'avant cette
-- migration). Reproduction intégrale de la définition actuellement
-- déployée (20260810110000) -- seules les lignes marquées "Ajout" changent.
CREATE OR REPLACE FUNCTION public.assign_business_location_user(p_assignment jsonb)
RETURNS public.business_location_assignments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_assignment public.business_location_assignments;
  v_location_id uuid := NULLIF(p_assignment ->> 'business_location_id', '')::uuid;
  v_user_id uuid := NULLIF(p_assignment ->> 'user_id', '')::uuid;
  v_role text := upper(coalesce(NULLIF(btrim(p_assignment ->> 'assignment_role'), ''), 'CASHIER'));
  v_start_date date := coalesce(NULLIF(p_assignment ->> 'start_date', '')::date, current_date);
  v_notes text := NULLIF(btrim(p_assignment ->> 'notes'), '');
  -- Ajout : poste de caisse optionnel.
  v_register_id uuid := NULLIF(p_assignment ->> 'cash_register_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('locations.assign');
  IF v_location_id IS NULL OR v_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.business_locations WHERE id = v_location_id AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'Utilisateur ou point d’exploitation introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_role NOT IN ('CASHIER', 'STORE_MANAGER', 'STOCK_KEEPER', 'SALES_AGENT', 'OTHER') THEN
    RAISE EXCEPTION 'Rôle d’affectation invalide.' USING ERRCODE = '22023';
  END IF;
  -- Ajout : un poste, s'il est fourni, doit être un poste actif de ce même magasin.
  IF v_register_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.commerce_cash_registers
    WHERE id = v_register_id AND business_location_id = v_location_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Poste de caisse introuvable pour ce magasin.' USING ERRCODE = '23503';
  END IF;
  UPDATE public.business_location_assignments
  SET end_date = GREATEST(v_start_date, start_date), ended_by = auth.uid(), updated_at = now()
  WHERE business_location_id = v_location_id AND user_id = v_user_id AND end_date IS NULL;
  -- Ajout : cash_register_id porté jusque dans la nouvelle ligne.
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, start_date, notes, assigned_by, cash_register_id)
  VALUES (v_location_id, v_user_id, v_role, v_start_date, v_notes, auth.uid(), v_register_id) RETURNING * INTO v_assignment;
  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION_ASSIGNMENT', v_assignment.id, NULL, 'ASSIGN', NULL, to_jsonb(v_assignment));
  RETURN v_assignment;
END;
$function$;

-- Extension d'affichage seule (CM-06, 20260810120000) : nom du poste
-- affecté, pour que l'écran de gestion des affectations montre "Caissier X
-- -- Poste 2" plutôt qu'un UUID technique. Reproduction intégrale, ajout
-- des seuls champs cashRegisterId/cashRegisterName.
CREATE OR REPLACE FUNCTION public.get_commerce_location_assignments(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_assignments jsonb;
BEGIN
  PERFORM public.permission_require('locations.assign');

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_locations AS location_row
    JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
    WHERE location_row.id = p_location_id
      AND location_row.status = 'ACTIVE'
      AND unit_row.code = 'COMMERCE'
  ) THEN
    RAISE EXCEPTION 'Point de vente Commerce introuvable ou archivé.' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', assignment_row.id,
        'userId', assignment_row.user_id,
        'userName', coalesce(nullif(profile_row.full_name, ''), nullif(profile_row.username, ''), 'Utilisateur'),
        'username', profile_row.username,
        'assignmentRole', assignment_row.assignment_role,
        'startDate', assignment_row.start_date,
        'notes', assignment_row.notes,
        'cashRegisterId', assignment_row.cash_register_id,
        'cashRegisterName', register_row.name
      )
      ORDER BY coalesce(nullif(profile_row.full_name, ''), nullif(profile_row.username, ''), 'Utilisateur'), assignment_row.created_at
    ),
    '[]'::jsonb
  )
  INTO v_assignments
  FROM public.business_location_assignments AS assignment_row
  LEFT JOIN public.profiles AS profile_row ON profile_row.id = assignment_row.user_id
  LEFT JOIN public.commerce_cash_registers AS register_row ON register_row.id = assignment_row.cash_register_id
  WHERE assignment_row.business_location_id = p_location_id
    AND assignment_row.end_date IS NULL;

  RETURN v_assignments;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_commerce_pos_register_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_commerce_pos_available_registers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_commerce_cash_register(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_commerce_cash_register(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_available_registers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_commerce_cash_register(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_commerce_cash_register(jsonb) TO authenticated;
-- assign_business_location_user et get_commerce_location_assignments : GRANT
-- déjà accordé par leurs migrations d'origine (CREATE OR REPLACE préserve
-- les privilèges), aucun re-GRANT nécessaire ici.
