-- CM-03: restricted administrative setup for a Commerce location.
CREATE OR REPLACE FUNCTION public.get_commerce_setup_options()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'wallets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM public.wallets), '[]'::jsonb),
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(full_name, username, 'Utilisateur')) ORDER BY coalesce(full_name, username)) FROM public.profiles), '[]'::jsonb)
  ) WHERE public.user_has_all_permissions(ARRAY['locations.manage', 'locations.assign', 'locations.wallets.manage']);
$function$;

CREATE OR REPLACE FUNCTION public.setup_commerce_location(p_setup jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $function$
DECLARE v_unit_id uuid; v_location public.business_locations; v_wallet_id uuid := NULLIF(p_setup ->> 'wallet_id', '')::uuid; v_user_id uuid := NULLIF(p_setup ->> 'user_id', '')::uuid;
BEGIN
  PERFORM public.permission_require('locations.manage');
  PERFORM public.permission_require('locations.wallets.manage');
  SELECT id INTO v_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_unit_id IS NULL OR v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN RAISE EXCEPTION 'Activité Commerce ou wallet introuvable.' USING ERRCODE = '23503'; END IF;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_unit_id, upper(NULLIF(btrim(p_setup ->> 'code'), '')), NULLIF(btrim(p_setup ->> 'name'), ''), 'STORE', 'ACTIVE', auth.uid(), auth.uid()) RETURNING * INTO v_location;
  IF v_location.code IS NULL OR v_location.name IS NULL THEN RAISE EXCEPTION 'Nom et code du magasin obligatoires.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location.id, v_wallet_id, 'CASH_DRAWER', true, true, auth.uid());
  IF v_user_id IS NOT NULL THEN
    PERFORM public.permission_require('locations.assign');
    INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, assigned_by)
    VALUES (v_location.id, v_user_id, 'CASHIER', auth.uid());
  END IF;
  PERFORM public.business_finance_audit_event('BUSINESS_LOCATION', v_location.id, NULL, 'CREATE', NULL, to_jsonb(v_location));
  RETURN jsonb_build_object('locationId', v_location.id, 'name', v_location.name);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_commerce_setup_options(), public.setup_commerce_location(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_setup_options(), public.setup_commerce_location(jsonb) TO authenticated;
