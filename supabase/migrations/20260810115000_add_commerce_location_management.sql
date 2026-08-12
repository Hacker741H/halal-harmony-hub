-- CM-05: manage Commerce locations after their first setup without altering
-- historic sales, stock movements or finance operations.
CREATE OR REPLACE FUNCTION public.update_commerce_location(p_location jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_location_id uuid := NULLIF(p_location ->> 'location_id', '')::uuid;
  v_wallet_id uuid := NULLIF(p_location ->> 'wallet_id', '')::uuid;
  v_name text := NULLIF(btrim(p_location ->> 'name'), '');
  v_code text := upper(NULLIF(btrim(p_location ->> 'code'), ''));
  v_before public.business_locations;
  v_location public.business_locations;
  v_wallet_mapping public.business_location_wallets;
BEGIN
  PERFORM public.permission_require('locations.manage');

  IF v_location_id IS NULL OR v_name IS NULL OR v_code IS NULL
    OR v_code !~ '^[A-Z][A-Z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'Nom, code ou point de vente invalide.' USING ERRCODE = '22023';
  END IF;

  SELECT location_row.* INTO v_before
  FROM public.business_locations AS location_row
  JOIN public.business_units AS unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = v_location_id
    AND location_row.status = 'ACTIVE'
    AND unit_row.code = 'COMMERCE'
  FOR UPDATE OF location_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point de vente Commerce introuvable ou archivé.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.business_locations
  SET name = v_name,
      code = v_code,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_location_id
  RETURNING * INTO v_location;

  IF v_wallet_id IS NOT NULL THEN
    PERFORM public.permission_require('locations.wallets.manage');

    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
      RAISE EXCEPTION 'Wallet de caisse introuvable.' USING ERRCODE = '23503';
    END IF;

    -- A wallet changed at a point of sale is never removed from history. Only
    -- its active CASH_DRAWER mapping is closed before the new one becomes primary.
    UPDATE public.business_location_wallets
    SET is_active = false,
        is_primary = false,
        revoked_at = now(),
        updated_at = now()
    WHERE business_location_id = v_location_id
      AND purpose = 'CASH_DRAWER'
      AND is_active
      AND wallet_id <> v_wallet_id;

    UPDATE public.business_location_wallets
    SET is_primary = false,
        updated_at = now()
    WHERE business_location_id = v_location_id
      AND purpose = 'CASH_DRAWER'
      AND is_active
      AND is_primary;

    INSERT INTO public.business_location_wallets(
      business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by, revoked_at
    ) VALUES (
      v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, auth.uid(), NULL
    )
    ON CONFLICT (business_location_id, wallet_id, purpose) DO UPDATE
    SET is_primary = true,
        is_active = true,
        assigned_by = auth.uid(),
        assigned_at = now(),
        revoked_at = NULL,
        updated_at = now()
    RETURNING * INTO v_wallet_mapping;
  END IF;

  PERFORM public.business_finance_audit_event(
    'BUSINESS_LOCATION',
    v_location.id,
    NULL,
    'UPDATE',
    to_jsonb(v_before),
    jsonb_build_object(
      'location', to_jsonb(v_location),
      'cash_drawer_wallet_id', v_wallet_mapping.wallet_id
    )
  );

  RETURN jsonb_build_object(
    'locationId', v_location.id,
    'name', v_location.name,
    'code', v_location.code,
    'walletId', v_wallet_mapping.wallet_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_commerce_location(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_commerce_location(jsonb) TO authenticated;
