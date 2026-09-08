-- STABILISATION TRANSVERSALE (2/3) -- suite immediate de
-- 20260908100000_lock_down_internal_finance_functions.sql.
--
-- Verifie apres coup (has_function_privilege en base reelle) : 17 des 19
-- fonctions revoquees etaient bien fermees a authenticated/anon apres ce
-- premier correctif, mais _internal_commerce_pos_session_commercial_
-- totals et _internal_track_business_location_inventory_item_price
-- restaient executables par les deux. Cause : leur EXECUTE etait accorde
-- a PUBLIC (le comportement par defaut de Postgres a la creation d'une
-- fonction, jamais explicitement revoque pour ces deux-la contrairement
-- aux 17 autres) -- authenticated/anon heritent implicitement de tout
-- droit accorde a PUBLIC, donc revoquer seulement authenticated/anon ne
-- suffit pas tant que PUBLIC lui-meme reste autorise.
REVOKE EXECUTE ON FUNCTION public._internal_commerce_pos_session_commercial_totals(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._internal_track_business_location_inventory_item_price() FROM PUBLIC;
