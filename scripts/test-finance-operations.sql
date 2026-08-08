-- Test transactionnel des RPC financières. À exécuter avec `supabase db query
-- --linked --file scripts/test-finance-operations.sql`. Toutes les écritures
-- de test sont annulées à la fin.

BEGIN;

DO $test_finance$
DECLARE
  v_actor_id uuid;
  v_source_wallet_id uuid;
  v_destination_wallet_id uuid;
  v_revenue public.finance_operations;
  v_expense public.finance_operations;
  v_transfer public.finance_operations;
  v_backfill_before jsonb;
  v_backfill_after jsonb;
BEGIN
  SELECT user_id INTO v_actor_id
  FROM public.user_roles
  WHERE role IN ('super_admin', 'admin', 'gestionnaire', 'comptable')
  ORDER BY CASE role
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'gestionnaire' THEN 3
    ELSE 4
  END
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Test impossible : aucun utilisateur avec rôle financier.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  SELECT id INTO v_source_wallet_id FROM public.wallets ORDER BY created_at LIMIT 1;
  SELECT id INTO v_destination_wallet_id
  FROM public.wallets
  WHERE id <> v_source_wallet_id
  ORDER BY created_at
  LIMIT 1;

  IF v_source_wallet_id IS NULL OR v_destination_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Test impossible : deux wallets sont requis.';
  END IF;

  -- Création recette et lien d'origine.
  SELECT * INTO v_revenue FROM public.finance_create_operation(
    jsonb_build_object(
      'wallet_id', v_source_wallet_id,
      'type', 'REVENUE',
      'amount', 1000,
      'operation_date', current_date,
      'category', 'TEST AUTOMATIQUE',
      'description', 'Création contrôlée, rollback attendu.'
    ),
    'OTHER',
    gen_random_uuid()
  );

  -- Création dépense.
  SELECT * INTO v_expense FROM public.finance_create_operation(
    jsonb_build_object(
      'wallet_id', v_source_wallet_id,
      'type', 'EXPENSE',
      'amount', 400,
      'operation_date', current_date,
      'category', 'TEST AUTOMATIQUE'
    )
  );

  -- Transfert : débit source et crédit destination sur une seule opération.
  SELECT * INTO v_transfer FROM public.finance_create_operation(
    jsonb_build_object(
      'wallet_id', v_source_wallet_id,
      'destination_wallet_id', v_destination_wallet_id,
      'type', 'TRANSFER',
      'amount', 250,
      'operation_date', current_date,
      'category', 'TEST AUTOMATIQUE'
    )
  );

  -- Mise à jour du montant puis changement de wallet de la recette existante.
  SELECT * INTO v_revenue FROM public.finance_update_operation(
    v_revenue.id,
    jsonb_build_object('amount', 1500, 'wallet_id', v_destination_wallet_id)
  );

  IF v_revenue.wallet_id <> v_destination_wallet_id OR v_revenue.amount <> 1500 THEN
    RAISE EXCEPTION 'La modification d''opération n''a pas été appliquée.';
  END IF;

  -- Suppression et contrôle du cascade des liens.
  IF NOT public.finance_delete_operation(v_revenue.id) THEN
    RAISE EXCEPTION 'La suppression de la recette de test a échoué.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.finance_operations WHERE id = v_revenue.id)
    OR EXISTS (SELECT 1 FROM public.finance_links WHERE finance_operation_id = v_revenue.id) THEN
    RAISE EXCEPTION 'La suppression atomique de l''opération ou de son lien a échoué.';
  END IF;

  -- Réexécution idempotente du backfill : aucune archive n'est dupliquée.
  SELECT public.backfill_legacy_finance_operations('legacy_finance_v1') INTO v_backfill_before;
  SELECT public.backfill_legacy_finance_operations('legacy_finance_v1') INTO v_backfill_after;
  IF v_backfill_before <> v_backfill_after THEN
    RAISE EXCEPTION 'Le backfill n''est pas idempotent.';
  END IF;

  -- Tous les wallets doivent être cohérents après chaque mutation.
  IF EXISTS (
    SELECT 1
    FROM public.finance_wallet_reconciliation
    WHERE stored_balance <> calculated_balance
  ) THEN
    RAISE EXCEPTION 'Un wallet est incohérent après les scénarios de test.';
  END IF;

  -- Les politiques RLS doivent protéger les écritures et geler les archives.
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ((tablename = 'finance_operations' AND policyname IN ('finance_select', 'finance_insert', 'finance_update', 'finance_delete'))
        OR (tablename = 'wallets' AND policyname IN ('wallet_select', 'wallet_insert', 'wallet_update', 'wallet_delete')))
  ) THEN
    RAISE EXCEPTION 'Une politique RLS permissive historique subsiste.';
  END IF;

  -- Les mutations financi\u00e8res passent exclusivement par les RPC s\u00e9curis\u00e9es :
  -- il ne doit donc exister aucune politique d'\u00e9criture directe pour authenticated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'finance_operations'
      AND policyname = 'finance_operations_read' AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wallets'
      AND policyname = 'wallets_read' AND cmd = 'SELECT'
  ) OR EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('finance_operations', 'wallets')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) OR EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('revenues', 'expenses', 'payments')
      AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Les politiques RLS financières ne correspondent pas au modèle attendu.';
  END IF;

  RAISE NOTICE 'Scénarios financiers réussis ; rollback en cours.';
END
$test_finance$;

ROLLBACK;
