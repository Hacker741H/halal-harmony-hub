-- Contrôles non destructifs à exécuter avec une connexion d'administration.
-- Ce script ne crée ni ne modifie aucune ligne.

-- 1. Réconciliation des archives : tous les écarts doivent être nuls.
SELECT
  source_table,
  source_rows,
  migrated_rows,
  source_amount,
  migrated_amount,
  source_rows - migrated_rows AS row_difference,
  source_amount - migrated_amount AS amount_difference
FROM public.finance_legacy_migration_reconciliation
ORDER BY source_table;

-- 2. Aucun type historique ne doit subsister dans le journal actif.
SELECT type, count(*) AS rows, COALESCE(sum(amount), 0) AS amount
FROM public.finance_operations
GROUP BY type
ORDER BY type;

-- 3. Aucun doublon de backfill ne doit être possible.
SELECT 'revenues' AS source_table, revenue_id AS legacy_id, count(*) AS links
FROM public.finance_revenue_links
GROUP BY revenue_id
HAVING count(*) > 1
UNION ALL
SELECT 'expenses', expense_id, count(*)
FROM public.finance_expense_links
GROUP BY expense_id
HAVING count(*) > 1
UNION ALL
SELECT 'payments', payment_id, count(*)
FROM public.finance_payment_links
GROUP BY payment_id
HAVING count(*) > 1;

-- 4. Tous les wallets doivent avoir un écart nul.
SELECT
  wallet_id,
  wallet_name,
  stored_balance,
  calculated_balance,
  stored_balance - calculated_balance AS difference
FROM public.finance_wallet_reconciliation
ORDER BY wallet_name;

-- 5. Les archives sont consultables mais sans politique d'écriture.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('revenues', 'expenses', 'payments')
ORDER BY tablename, policyname;
