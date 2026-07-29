-- ============================================================================
-- HALAL ERP - Farms v2
-- Ajout d'informations avancées pour les exploitations agricoles
-- ============================================================================

ALTER TABLE public.farms
ADD COLUMN IF NOT EXISTS code text UNIQUE,
ADD COLUMN IF NOT EXISTS village text,
ADD COLUMN IF NOT EXISTS departement text,
ADD COLUMN IF NOT EXISTS proprietaire text,
ADD COLUMN IF NOT EXISTS telephone text,
ADD COLUMN IF NOT EXISTS nature text,
ADD COLUMN IF NOT EXISTS prix_kg numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS date_debut_contrat date,
ADD COLUMN IF NOT EXISTS date_fin_contrat date,
ADD COLUMN IF NOT EXISTS latitude double precision,
ADD COLUMN IF NOT EXISTS longitude double precision,
ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS farms_code_idx
ON public.farms(code);

CREATE INDEX IF NOT EXISTS farms_village_idx
ON public.farms(village);

CREATE INDEX IF NOT EXISTS farms_type_culture_idx
ON public.farms(type_culture);

CREATE INDEX IF NOT EXISTS farms_nature_idx
ON public.farms(nature);

COMMENT ON TABLE public.farms IS
'Exploitations agricoles HALAL ERP';

COMMENT ON COLUMN public.farms.code IS
'Code unique de l''exploitation (HALAL01, HALAL02...)';

COMMENT ON COLUMN public.farms.prix_kg IS
'Prix d''achat du kilogramme';

COMMENT ON COLUMN public.farms.nature IS
'Propriété, Garantie, Bail ou Partenariat';

COMMENT ON COLUMN public.farms.latitude IS
'Latitude GPS';

COMMENT ON COLUMN public.farms.longitude IS
'Longitude GPS';