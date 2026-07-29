-- A wallet's opening balance is a fixed starting point. The current balance
-- is the opening balance plus the effective finance journal, never a value
-- overwritten by the latest operation.
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS initial_balance numeric(14, 2) NOT NULL DEFAULT 0;

-- Existing wallets may already have a materialised balance produced from the
-- journal. We deliberately preserve their current value and use zero as the
-- unknown opening balance instead of guessing and double-counting history.
UPDATE public.wallets
SET initial_balance = 0
WHERE initial_balance IS NULL;

CREATE OR REPLACE FUNCTION public.update_wallet_balance(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $wallet_balance$
DECLARE
  opening_balance numeric(14, 2);
  journal_balance numeric(14, 2);
BEGIN
  SELECT COALESCE(initial_balance, 0)
  INTO opening_balance
  FROM public.wallets
  WHERE id = p_wallet_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN wallet_id = p_wallet_id AND type IN ('REVENUE', 'DEPOSIT', 'RECETTE', 'VERSEMENT') THEN amount
      WHEN wallet_id = p_wallet_id AND type IN ('EXPENSE', 'TRANSFER', 'DEPENSE', 'TRANSFERT') THEN -amount
      WHEN destination_wallet_id = p_wallet_id AND type IN ('TRANSFER', 'TRANSFERT') THEN amount
      ELSE 0
    END
  ), 0)
  INTO journal_balance
  FROM public.finance_operations
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

  UPDATE public.wallets
  SET balance = opening_balance + journal_balance,
      updated_at = now()
  WHERE id = p_wallet_id;
END;
$wallet_balance$;

CREATE OR REPLACE VIEW public.finance_wallet_reconciliation AS
SELECT
  wallet.id AS wallet_id,
  wallet.name AS wallet_name,
  wallet.balance AS stored_balance,
  COALESCE(wallet.initial_balance, 0) + COALESCE(SUM(
    CASE
      WHEN operation.wallet_id = wallet.id AND operation.type IN ('REVENUE', 'DEPOSIT') THEN operation.amount
      WHEN operation.wallet_id = wallet.id AND operation.type IN ('EXPENSE', 'TRANSFER') THEN -operation.amount
      WHEN operation.destination_wallet_id = wallet.id AND operation.type = 'TRANSFER' THEN operation.amount
      ELSE 0
    END
  ), 0) AS calculated_balance,
  COALESCE(SUM(CASE WHEN operation.wallet_id = wallet.id AND operation.type IN ('REVENUE', 'DEPOSIT') THEN operation.amount ELSE 0 END), 0) AS incoming_total,
  COALESCE(SUM(CASE WHEN operation.wallet_id = wallet.id AND operation.type = 'EXPENSE' THEN operation.amount ELSE 0 END), 0) AS expense_total,
  COALESCE(SUM(CASE WHEN operation.destination_wallet_id = wallet.id AND operation.type = 'TRANSFER' THEN operation.amount ELSE 0 END), 0) AS transfers_in_total,
  COALESCE(SUM(CASE WHEN operation.wallet_id = wallet.id AND operation.type = 'TRANSFER' THEN operation.amount ELSE 0 END), 0) AS transfers_out_total
FROM public.wallets AS wallet
LEFT JOIN public.finance_operations AS operation
  ON (operation.wallet_id = wallet.id OR operation.destination_wallet_id = wallet.id)
 AND COALESCE(operation.status, 'VALIDE') <> 'CANCELLED'
GROUP BY wallet.id, wallet.name, wallet.balance, wallet.initial_balance;
