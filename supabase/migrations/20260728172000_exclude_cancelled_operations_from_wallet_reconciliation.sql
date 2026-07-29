-- Wallet reconciliation must use the same effective journal as
-- update_wallet_balance: cancelled business events are traceable but have no
-- balance impact.

CREATE OR REPLACE VIEW public.finance_wallet_reconciliation AS
SELECT
  wallet.id AS wallet_id,
  wallet.name AS wallet_name,
  wallet.balance AS stored_balance,
  COALESCE(SUM(
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
GROUP BY wallet.id, wallet.name, wallet.balance;
