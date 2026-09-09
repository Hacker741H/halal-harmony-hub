-- SÉPARATION NOM APPLICATION / NOM ENTREPRISE : décision produit validée --
-- "HALAL ERP" reste le nom du logiciel (inchangé, codé en dur partout où
-- il désigne le produit), "HALAL & CO" devient le nom de l'entreprise
-- (l'organisation propriétaire/utilisatrice), porté par
-- public.company_settings.nom -- désormais réellement lu par l'UI (sidebar,
-- page Paramètres) via le hook partagé useCompanySettings, alors qu'il
-- n'était auparavant jamais affiché (voir audit précédent).
--
-- Table singleton (une seule ligne, confirmé par lecture directe avant
-- cette migration : id=b4f46c83-df19-4789-bfd7-c8fc2453df39, nom actuel
-- 'HALAL ERP'). UPDATE, jamais d'INSERT -- pas de nouvelle ligne. La
-- clause WHERE rend l'opération idempotente et sûre à rejouer : ne touche
-- que la ligne si elle porte encore exactement l'ancienne valeur par
-- défaut, pour ne jamais écraser une valeur qu'un administrateur aurait
-- déjà personnalisée entre-temps.
UPDATE public.company_settings
SET nom = 'HALAL & CO',
    updated_at = now()
WHERE nom = 'HALAL ERP';
