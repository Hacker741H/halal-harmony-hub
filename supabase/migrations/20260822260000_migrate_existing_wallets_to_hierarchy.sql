-- Phase H : rattachement des 10 wallets existants a la hierarchie. Mapping
-- confirme par les donnees reelles (Phase A), pas par convention de nom :
--
--   HALAL AGR001 -> AGRICULTURE / FARM  (farms.code = 'AGR001', match exact)
--   HALAL AGR002 -> AGRICULTURE / FARM  (farms.code = 'AGR002', match exact)
--   HALAL MOTO 001/002/003 -> MOTOS, sans lien moto : aucune moto n'existe
--     encore en base aujourd'hui, donc aucun lien FK n'est invente ici.
--   HALAL_VHC_01 -> VEHICULES, sans lien vehicule : 2 vehicules existent
--     mais aucune correspondance fiable au nom du wallet -- pas de lien
--     devine, un admin pourra reaffecter via reassign_wallet_asset() si la
--     correspondance reelle est confirmee.
--   Magasin lélédou -> COMMERCE / BUSINESS_LOCATION (deja lie par FK via
--     business_location_wallets, on ajoute juste le tag module/asset_kind).
--   Marasse, Epargne, Jèko - HALAL & CO : aucun changement, restent hors
--     hierarchie (tresorerie / reglement fournisseur de paiement).
--
-- Aucun montant modifie : uniquement module/asset_kind/*_id sur des lignes
-- wallets existantes. finance_operations n'est pas touchee.

UPDATE public.wallets w
SET module = 'AGRICULTURE', asset_kind = 'FARM', farm_id = f.id
FROM public.farms f
WHERE w.name = 'HALAL AGR001' AND f.code = 'AGR001';

UPDATE public.wallets w
SET module = 'AGRICULTURE', asset_kind = 'FARM', farm_id = f.id
FROM public.farms f
WHERE w.name = 'HALAL AGR002' AND f.code = 'AGR002';

UPDATE public.wallets
SET module = 'MOTOS'
WHERE name IN ('HALAL MOTO 001', 'HALAL MOTO 002', 'HALAL MOTO 003');

UPDATE public.wallets
SET module = 'VEHICULES'
WHERE name = 'HALAL_VHC_01';

UPDATE public.wallets
SET module = 'COMMERCE', asset_kind = 'BUSINESS_LOCATION'
WHERE name = 'Magasin lélédou';

-- Le sous-wallet "Général" de MOTOS/VEHICULES doit exister pour toute
-- future depense non affectee a un actif precis (section 6), independamment
-- des 3 wallets MOTO deja nommes ci-dessus qui gardent leur propre identite.
SELECT public._internal_ensure_module_general_wallet('MOTOS');
SELECT public._internal_ensure_module_general_wallet('VEHICULES');
SELECT public._internal_ensure_module_general_wallet('AGRICULTURE');
SELECT public._internal_ensure_module_general_wallet('COMMERCE');
