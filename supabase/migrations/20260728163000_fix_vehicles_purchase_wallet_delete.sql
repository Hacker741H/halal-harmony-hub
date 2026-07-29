-- A previously-created constraint with this name can use PostgreSQL's default
-- ON DELETE NO ACTION. Recreate it explicitly so removing a wallet clears the
-- optional purchase-wallet reference from its vehicles.

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_purchase_wallet_id_fkey;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_purchase_wallet_id_fkey
  FOREIGN KEY (purchase_wallet_id)
  REFERENCES public.wallets(id)
  ON DELETE SET NULL;
