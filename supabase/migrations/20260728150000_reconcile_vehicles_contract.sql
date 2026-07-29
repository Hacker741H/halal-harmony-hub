-- Reconciles the historical French vehicle migration with the contract that is
-- already applied in the remote database. No rows are deleted or transformed.

DO $migration$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE EXCEPTION 'The public.vehicles table must exist before this migration.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'immatriculation'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'registration'
  ) THEN
    ALTER TABLE public.vehicles RENAME COLUMN immatriculation TO registration;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'marque'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'brand'
  ) THEN
    ALTER TABLE public.vehicles RENAME COLUMN marque TO brand;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'modele'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'model'
  ) THEN
    ALTER TABLE public.vehicles RENAME COLUMN modele TO model;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'annee'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'year'
  ) THEN
    ALTER TABLE public.vehicles RENAME COLUMN annee TO year;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'statut'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.vehicles RENAME COLUMN statut TO status;
    ALTER TABLE public.vehicles ALTER COLUMN status TYPE text USING status::text;
  END IF;
END
$migration$;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS purchase_wallet_id uuid,
  ADD COLUMN IF NOT EXISTS supplier text;

CREATE INDEX IF NOT EXISTS vehicles_purchase_wallet_idx
  ON public.vehicles(purchase_wallet_id);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vehicles'::regclass
      AND conname = 'vehicles_purchase_wallet_id_fkey'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_purchase_wallet_id_fkey
      FOREIGN KEY (purchase_wallet_id)
      REFERENCES public.wallets(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END
$migration$;
