-- Section 4 : creation automatique, idempotente, sans recherche par nom.
-- Les triggers appellent ces fonctions internes a chaque INSERT d'actif ;
-- les contraintes uniques partielles ajoutees en 20260822200000 garantissent
-- qu'un rejeu ou une double insertion ne cree jamais de doublon -- la
-- garantie vient de la base, pas du code appelant.

CREATE OR REPLACE FUNCTION public._internal_ensure_module_general_wallet(p_module text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_wallet_id uuid;
  v_label text := CASE p_module
    WHEN 'MOTOS' THEN 'MOTOS – Général'
    WHEN 'VEHICULES' THEN 'VÉHICULES – Général'
    WHEN 'AGRICULTURE' THEN 'AGRICULTURE – Général'
    WHEN 'COMMERCE' THEN 'COMMERCE – Général'
    WHEN 'TRANSPORT' THEN 'TRANSPORT – Général'
    ELSE p_module || ' – Général'
  END;
BEGIN
  SELECT id INTO v_wallet_id FROM public.wallets WHERE module = p_module AND is_general;
  IF FOUND THEN
    RETURN v_wallet_id;
  END IF;

  INSERT INTO public.wallets (name, type, module, asset_kind, is_general, balance, initial_balance)
  VALUES (v_label, 'ASSET', p_module, 'GENERAL', true, 0, 0)
  ON CONFLICT (module) WHERE is_general DO NOTHING
  RETURNING id INTO v_wallet_id;

  IF v_wallet_id IS NULL THEN
    -- Course concurrente : une autre transaction vient de le créer, on le relit.
    SELECT id INTO v_wallet_id FROM public.wallets WHERE module = p_module AND is_general;
  END IF;

  RETURN v_wallet_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._internal_ensure_asset_wallet(
  p_module text,
  p_asset_kind text,
  p_name text,
  p_motorcycle_id uuid DEFAULT NULL,
  p_vehicle_id uuid DEFAULT NULL,
  p_farm_id uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_wallet_id uuid;
BEGIN
  PERFORM public._internal_ensure_module_general_wallet(p_module);

  IF p_motorcycle_id IS NOT NULL THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE motorcycle_id = p_motorcycle_id;
  ELSIF p_vehicle_id IS NOT NULL THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE vehicle_id = p_vehicle_id;
  ELSIF p_farm_id IS NOT NULL THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE farm_id = p_farm_id;
  END IF;

  IF FOUND AND v_wallet_id IS NOT NULL THEN
    RETURN v_wallet_id;
  END IF;

  INSERT INTO public.wallets (name, type, module, asset_kind, motorcycle_id, vehicle_id, farm_id, balance, initial_balance)
  VALUES (p_name, 'ASSET', p_module, p_asset_kind, p_motorcycle_id, p_vehicle_id, p_farm_id, 0, 0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_wallet_id;

  IF v_wallet_id IS NULL THEN
    SELECT id INTO v_wallet_id FROM public.wallets
    WHERE motorcycle_id IS NOT DISTINCT FROM p_motorcycle_id
      AND vehicle_id IS NOT DISTINCT FROM p_vehicle_id
      AND farm_id IS NOT DISTINCT FROM p_farm_id
      AND (p_motorcycle_id IS NOT NULL OR p_vehicle_id IS NOT NULL OR p_farm_id IS NOT NULL);
  END IF;

  RETURN v_wallet_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_ensure_module_general_wallet(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_ensure_module_general_wallet(text) FROM anon;
REVOKE ALL ON FUNCTION public._internal_ensure_asset_wallet(text, text, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_ensure_asset_wallet(text, text, text, uuid, uuid, uuid) FROM anon;

-- Triggers : un actif cree => son sous-wallet existe, sans dependre du
-- frontend pour appeler la bonne RPC.
CREATE OR REPLACE FUNCTION public.tg_motorcycle_ensure_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._internal_ensure_asset_wallet(
    'MOTOS', 'MOTORCYCLE', COALESCE(NEW.immatriculation, 'Moto ' || NEW.id::text),
    p_motorcycle_id => NEW.id
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_vehicle_ensure_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._internal_ensure_asset_wallet(
    'VEHICULES', 'VEHICLE', COALESCE(NEW.registration, 'Véhicule ' || NEW.id::text),
    p_vehicle_id => NEW.id
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_farm_ensure_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._internal_ensure_asset_wallet(
    'AGRICULTURE', 'FARM', COALESCE(NEW.code, NEW.nom, 'Exploitation ' || NEW.id::text),
    p_farm_id => NEW.id
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_motorcycle_ensure_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_motorcycle_ensure_wallet() FROM anon;
REVOKE ALL ON FUNCTION public.tg_vehicle_ensure_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_vehicle_ensure_wallet() FROM anon;
REVOKE ALL ON FUNCTION public.tg_farm_ensure_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_farm_ensure_wallet() FROM anon;

CREATE TRIGGER trg_motorcycles_ensure_wallet
  AFTER INSERT ON public.motorcycles
  FOR EACH ROW EXECUTE FUNCTION public.tg_motorcycle_ensure_wallet();

CREATE TRIGGER trg_vehicles_ensure_wallet
  AFTER INSERT ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.tg_vehicle_ensure_wallet();

CREATE TRIGGER trg_farms_ensure_wallet
  AFTER INSERT ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.tg_farm_ensure_wallet();
