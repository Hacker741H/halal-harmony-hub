-- Finance V2 — hiérarchie Wallet (Phase E, additive uniquement).
-- Aucune colonne existante modifiée, aucune ligne finance_operations touchée.
-- Le "wallet parent" (MOTOS, VEHICULES, ...) reste virtuel : c'est une valeur
-- de `module` partagée par plusieurs sous-wallets, jamais un solde stocké à
-- part -- le solde consolidé se calcule par SUM(balance) WHERE module = X.
-- Voir docs/finance-v2-wallet-hierarchy-design.md pour le détail des choix.

ALTER TABLE public.wallets
  ADD COLUMN module text NULL,
  ADD COLUMN asset_kind text NULL,
  ADD COLUMN motorcycle_id uuid NULL REFERENCES public.motorcycles(id),
  ADD COLUMN vehicle_id uuid NULL REFERENCES public.vehicles(id),
  ADD COLUMN farm_id uuid NULL REFERENCES public.farms(id),
  ADD COLUMN is_general boolean NOT NULL DEFAULT false,
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz NULL;

ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_module_check
    CHECK (module IS NULL OR module IN ('MOTOS', 'VEHICULES', 'AGRICULTURE', 'COMMERCE', 'TRANSPORT')),
  ADD CONSTRAINT wallets_asset_kind_check
    CHECK (asset_kind IS NULL OR asset_kind IN ('MOTORCYCLE', 'VEHICLE', 'FARM', 'BUSINESS_LOCATION', 'GENERAL')),
  -- Un sous-wallet lié à un actif doit porter un module ; un wallet hors
  -- hiérarchie (Marasse, Epargne, Jèko) garde les deux à NULL.
  ADD CONSTRAINT wallets_asset_kind_requires_module
    CHECK (asset_kind IS NULL OR module IS NOT NULL),
  -- Un seul type de lien d'actif à la fois par wallet.
  ADD CONSTRAINT wallets_single_asset_link CHECK (
    (CASE WHEN motorcycle_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN vehicle_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN farm_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );

-- Idempotence (section 4 de la mission) : au plus un sous-wallet par actif,
-- au plus un "Général" par module -- garanti par contrainte, pas par code
-- applicatif qui pourrait être contourné ou rejoué.
CREATE UNIQUE INDEX wallets_one_general_per_module_idx
  ON public.wallets (module) WHERE is_general;
CREATE UNIQUE INDEX wallets_one_per_motorcycle_idx
  ON public.wallets (motorcycle_id) WHERE motorcycle_id IS NOT NULL;
CREATE UNIQUE INDEX wallets_one_per_vehicle_idx
  ON public.wallets (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX wallets_one_per_farm_idx
  ON public.wallets (farm_id) WHERE farm_id IS NOT NULL;

CREATE INDEX wallets_module_idx ON public.wallets (module) WHERE module IS NOT NULL;
CREATE INDEX wallets_archived_idx ON public.wallets (is_archived);

COMMENT ON COLUMN public.wallets.module IS
  'Regroupement analytique (MOTOS/VEHICULES/AGRICULTURE/COMMERCE/TRANSPORT). NULL = wallet de trésorerie ou de règlement hors hiérarchie (Marasse, Epargne, Jèko).';
COMMENT ON COLUMN public.wallets.is_general IS
  'Sous-wallet "Général / Non affecté" du module -- créé automatiquement, non supprimable normalement (section 6).';
