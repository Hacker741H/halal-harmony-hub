-- CM-02 validation. This script intentionally rolls everything back.
BEGIN;

DO $test$
DECLARE
  v_unit public.business_units;
  v_location public.business_locations;
  v_wallet public.wallets;
  v_mapping public.business_location_wallets;
BEGIN
  SELECT * INTO v_unit FROM public.business_units WHERE code = 'COMMERCE';
  IF v_unit.id IS NULL OR v_unit.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'L''activité Commerce doit exister et être active.';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets ORDER BY created_at LIMIT 1;
  IF v_wallet.id IS NULL THEN
    RAISE NOTICE 'Aucun wallet existant : le test de liaison wallet est ignoré.';
  END IF;

  INSERT INTO public.business_locations(
    business_unit_id, code, name, location_type, status
  ) VALUES (
    v_unit.id, 'TEST_COMMERCE_LOCATION', 'Point de vente de test', 'STORE', 'ACTIVE'
  ) RETURNING * INTO v_location;

  IF v_location.business_unit_id <> v_unit.id THEN
    RAISE EXCEPTION 'Le point de vente doit être lié à l''activité Commerce.';
  END IF;

  IF v_wallet.id IS NOT NULL THEN
    INSERT INTO public.business_location_wallets(
      business_location_id, wallet_id, purpose, is_primary, is_active
    ) VALUES (
      v_location.id, v_wallet.id, 'CASH_DRAWER', true, true
    ) RETURNING * INTO v_mapping;

    IF NOT v_mapping.is_primary OR NOT v_mapping.is_active THEN
      RAISE EXCEPTION 'La liaison du wallet de caisse doit rester active et principale.';
    END IF;

    BEGIN
      INSERT INTO public.business_location_wallets(
        business_location_id, wallet_id, purpose, is_primary, is_active
      ) VALUES (
        v_location.id, v_wallet.id, 'COLLECTION', true, true
      );
      RAISE EXCEPTION 'Un second wallet principal actif devait être refusé.';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.finance_operations
    WHERE operation_date = current_date
      AND description = 'Point de vente de test'
  ) THEN
    RAISE EXCEPTION 'CM-02 ne doit créer aucune opération financière.';
  END IF;
END;
$test$;

ROLLBACK;
