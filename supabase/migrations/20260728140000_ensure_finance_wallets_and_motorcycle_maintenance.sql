-- Lot 1: reconcile application tables that are present in the generated
-- Supabase types and referenced by server functions, but missing from the
-- local migration history. This migration is additive and does not migrate
-- or delete legacy finance, payment, revenue, expense, or stock data.

-- Wallets ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  balance numeric(14, 2) NOT NULL DEFAULT 0,
  color text,
  icon text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS balance numeric(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS wallets_name_idx ON public.wallets(name);
CREATE INDEX IF NOT EXISTS wallets_default_idx ON public.wallets(is_default);

-- Finance journal ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  destination_wallet_id uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  type text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  operation_date date NOT NULL DEFAULT current_date,
  category text,
  description text,
  reference text,
  status text,
  origin text,
  module text,
  module_id text,
  payment_method text,
  payment_reference text,
  supplier text,
  client text,
  employee text,
  project text,
  vehicle_id uuid,
  attachment_url text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.finance_operations
  ADD COLUMN IF NOT EXISTS wallet_id uuid,
  ADD COLUMN IF NOT EXISTS destination_wallet_id uuid,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS operation_date date DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS module_id text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS client text,
  ADD COLUMN IF NOT EXISTS employee text,
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS finance_operations_wallet_date_idx
  ON public.finance_operations(wallet_id, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_destination_wallet_idx
  ON public.finance_operations(destination_wallet_id);
CREATE INDEX IF NOT EXISTS finance_operations_type_date_idx
  ON public.finance_operations(type, operation_date DESC);
CREATE INDEX IF NOT EXISTS finance_operations_vehicle_idx
  ON public.finance_operations(vehicle_id);

-- Legacy generic finance link. It is retained for compatibility only; no new
-- polymorphic relation is introduced by this migration.
CREATE TABLE IF NOT EXISTS public.finance_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_operation_id uuid NOT NULL
    REFERENCES public.finance_operations(id) ON DELETE CASCADE,
  module text NOT NULL,
  module_record_id text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.finance_links
  ADD COLUMN IF NOT EXISTS finance_operation_id uuid,
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS module_record_id text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS finance_links_operation_idx
  ON public.finance_links(finance_operation_id);
CREATE INDEX IF NOT EXISTS finance_links_module_record_idx
  ON public.finance_links(module, module_record_id);

-- Motorcycle maintenance ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.motorcycle_maintenances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorcycle_id uuid NOT NULL REFERENCES public.motorcycles(id) ON DELETE CASCADE,
  type text NOT NULL,
  maintenance_date date NOT NULL DEFAULT current_date,
  kilometrage integer,
  cost numeric(14, 2) DEFAULT 0,
  garage text,
  next_date date,
  next_kilometrage integer,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.motorcycle_maintenances
  ADD COLUMN IF NOT EXISTS motorcycle_id uuid,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS maintenance_date date DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS kilometrage integer,
  ADD COLUMN IF NOT EXISTS cost numeric(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garage text,
  ADD COLUMN IF NOT EXISTS next_date date,
  ADD COLUMN IF NOT EXISTS next_kilometrage integer,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS motorcycle_maintenances_motorcycle_date_idx
  ON public.motorcycle_maintenances(motorcycle_id, maintenance_date DESC);
CREATE INDEX IF NOT EXISTS motorcycle_maintenances_next_date_idx
  ON public.motorcycle_maintenances(next_date);

-- Add missing foreign keys without validating historical rows. Existing data
-- remains untouched; future writes must satisfy these relations.
DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_operations_wallet_id_fkey'
      AND conrelid = 'public.finance_operations'::regclass
  ) THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_wallet_id_fkey
      FOREIGN KEY (wallet_id) REFERENCES public.wallets(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_operations_destination_wallet_id_fkey'
      AND conrelid = 'public.finance_operations'::regclass
  ) THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_destination_wallet_id_fkey
      FOREIGN KEY (destination_wallet_id) REFERENCES public.wallets(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_operations_vehicle_id_fkey'
      AND conrelid = 'public.finance_operations'::regclass
  ) THEN
    ALTER TABLE public.finance_operations
      ADD CONSTRAINT finance_operations_vehicle_id_fkey
      FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_links_finance_operation_id_fkey'
      AND conrelid = 'public.finance_links'::regclass
  ) THEN
    ALTER TABLE public.finance_links
      ADD CONSTRAINT finance_links_finance_operation_id_fkey
      FOREIGN KEY (finance_operation_id) REFERENCES public.finance_operations(id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'motorcycle_maintenances_motorcycle_id_fkey'
      AND conrelid = 'public.motorcycle_maintenances'::regclass
  ) THEN
    ALTER TABLE public.motorcycle_maintenances
      ADD CONSTRAINT motorcycle_maintenances_motorcycle_id_fkey
      FOREIGN KEY (motorcycle_id) REFERENCES public.motorcycles(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END
$constraints$;

-- Recalculate one wallet from the finance journal. The function is created
-- only when absent so an already deployed implementation is not overwritten.
DO $function_guard$
BEGIN
  IF to_regprocedure('public.update_wallet_balance(uuid)') IS NULL THEN
    EXECUTE $function_sql$
      CREATE FUNCTION public.update_wallet_balance(p_wallet_id uuid)
      RETURNS numeric
      LANGUAGE plpgsql
      SET search_path = public
      AS $wallet_balance$
      DECLARE
        calculated_balance numeric(14, 2);
      BEGIN
        SELECT COALESCE(SUM(
          CASE
            WHEN wallet_id = p_wallet_id AND type IN ('RECETTE', 'VERSEMENT')
              THEN amount
            WHEN wallet_id = p_wallet_id AND type IN ('DEPENSE', 'TRANSFERT')
              THEN -amount
            WHEN destination_wallet_id = p_wallet_id AND type = 'TRANSFERT'
              THEN amount
            ELSE 0
          END
        ), 0)
        INTO calculated_balance
        FROM public.finance_operations;

        UPDATE public.wallets
        SET balance = calculated_balance,
            updated_at = now()
        WHERE id = p_wallet_id;

        RETURN calculated_balance;
      END;
      $wallet_balance$;
    $function_sql$;
  END IF;
END
$function_guard$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_operations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.motorcycle_maintenances TO authenticated;
GRANT ALL ON public.wallets, public.finance_operations, public.finance_links,
  public.motorcycle_maintenances TO service_role;
GRANT EXECUTE ON FUNCTION public.update_wallet_balance(uuid) TO authenticated;

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motorcycle_maintenances ENABLE ROW LEVEL SECURITY;

-- Policies are created only when their named counterpart is absent. This
-- preserves any policy that is already deployed on the remote project.
DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallets' AND policyname = 'wallets_read') THEN
    EXECUTE $policy$CREATE POLICY "wallets_read" ON public.wallets FOR SELECT TO authenticated USING (true)$policy$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallets' AND policyname = 'wallets_write') THEN
    EXECUTE $policy$CREATE POLICY "wallets_write" ON public.wallets FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))$policy$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'finance_operations' AND policyname = 'finance_operations_read') THEN
    EXECUTE $policy$CREATE POLICY "finance_operations_read" ON public.finance_operations FOR SELECT TO authenticated USING (true)$policy$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'finance_operations' AND policyname = 'finance_operations_write') THEN
    EXECUTE $policy$CREATE POLICY "finance_operations_write" ON public.finance_operations FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))$policy$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'finance_links' AND policyname = 'finance_links_read') THEN
    EXECUTE $policy$CREATE POLICY "finance_links_read" ON public.finance_links FOR SELECT TO authenticated USING (true)$policy$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'finance_links' AND policyname = 'finance_links_write') THEN
    EXECUTE $policy$CREATE POLICY "finance_links_write" ON public.finance_links FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire','comptable']::public.app_role[]))$policy$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'motorcycle_maintenances' AND policyname = 'motorcycle_maintenances_read') THEN
    EXECUTE $policy$CREATE POLICY "motorcycle_maintenances_read" ON public.motorcycle_maintenances FOR SELECT TO authenticated USING (true)$policy$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'motorcycle_maintenances' AND policyname = 'motorcycle_maintenances_write') THEN
    EXECUTE $policy$CREATE POLICY "motorcycle_maintenances_write" ON public.motorcycle_maintenances FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin','admin','gestionnaire']::public.app_role[]))$policy$;
  END IF;
END
$rls$;

-- Keep updated_at current when the shared trigger function exists.
DO $triggers$
BEGIN
  IF to_regprocedure('public.tg_touch_updated_at()') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.wallets'::regclass AND tgname = 'trg_wallets_updated' AND NOT tgisinternal) THEN
      EXECUTE 'CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.finance_operations'::regclass AND tgname = 'trg_finance_operations_updated' AND NOT tgisinternal) THEN
      EXECUTE 'CREATE TRIGGER trg_finance_operations_updated BEFORE UPDATE ON public.finance_operations FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.motorcycle_maintenances'::regclass AND tgname = 'trg_motorcycle_maintenances_updated' AND NOT tgisinternal) THEN
      EXECUTE 'CREATE TRIGGER trg_motorcycle_maintenances_updated BEFORE UPDATE ON public.motorcycle_maintenances FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at()';
    END IF;
  END IF;
END
$triggers$;
