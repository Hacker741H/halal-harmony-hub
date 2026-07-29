-- Lot 4: normalize the existing journal and backfill the immutable legacy
-- snapshot. The procedure is transactional and the explicit link tables make
-- it safe to invoke again after an interruption.

DO $canonical_types$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.finance_operations
    WHERE type NOT IN ('RECETTE', 'DEPENSE', 'VERSEMENT', 'TRANSFERT', 'REVENUE', 'EXPENSE', 'DEPOSIT', 'TRANSFER')
  ) THEN
    RAISE EXCEPTION 'Le journal contient un type financier non mappable. Corrigez-le avant le backfill.';
  END IF;

  UPDATE public.finance_operations
  SET type = CASE type
    WHEN 'RECETTE' THEN 'REVENUE'
    WHEN 'DEPENSE' THEN 'EXPENSE'
    WHEN 'VERSEMENT' THEN 'DEPOSIT'
    WHEN 'TRANSFERT' THEN 'TRANSFER'
    ELSE type
  END
  WHERE type IN ('RECETTE', 'DEPENSE', 'VERSEMENT', 'TRANSFERT');
END
$canonical_types$;

ALTER TABLE public.finance_operations
  DROP CONSTRAINT IF EXISTS finance_operations_type_check;
ALTER TABLE public.finance_operations
  ADD CONSTRAINT finance_operations_type_check
  CHECK (type IN ('REVENUE', 'EXPENSE', 'DEPOSIT', 'TRANSFER')) NOT VALID;

ALTER TABLE public.finance_operations
  DROP CONSTRAINT IF EXISTS finance_operations_amount_positive_check;
ALTER TABLE public.finance_operations
  ADD CONSTRAINT finance_operations_amount_positive_check
  CHECK (amount > 0) NOT VALID;

ALTER TABLE public.finance_operations
  DROP CONSTRAINT IF EXISTS finance_operations_transfer_wallets_check;
ALTER TABLE public.finance_operations
  ADD CONSTRAINT finance_operations_transfer_wallets_check
  CHECK (
    (type = 'TRANSFER' AND destination_wallet_id IS NOT NULL AND destination_wallet_id <> wallet_id)
    OR (type <> 'TRANSFER' AND destination_wallet_id IS NULL)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.backfill_legacy_finance_operations(
  p_migration_key text DEFAULT 'legacy_finance_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $backfill$
DECLARE
  v_run_id uuid;
  v_wallet_id uuid;
  v_legacy_count bigint;
  v_operation_id uuid;
  v_row record;
  v_entity_type text;
  v_entity_id uuid;
  v_farm_id uuid;
  v_motorcycle_id uuid;
  v_vehicle_id uuid;
  v_driver_id uuid;
  v_employee_id uuid;
  v_contract_id uuid;
  v_payment_type text;
  v_revenues_migrated bigint := 0;
  v_expenses_migrated bigint := 0;
  v_payments_migrated bigint := 0;
BEGIN
  SELECT id INTO v_run_id
  FROM public.finance_migration_runs
  WHERE migration_key = p_migration_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot introuvable pour la migration %.', p_migration_key;
  END IF;

  SELECT count(*) INTO v_legacy_count
  FROM (
    SELECT legacy_id FROM public.finance_legacy_snapshot_revenues WHERE migration_run_id = v_run_id
    UNION ALL
    SELECT legacy_id FROM public.finance_legacy_snapshot_expenses WHERE migration_run_id = v_run_id
    UNION ALL
    SELECT legacy_id FROM public.finance_legacy_snapshot_payments WHERE migration_run_id = v_run_id
  ) legacy_rows;

  SELECT default_wallet_id INTO v_wallet_id
  FROM public.finance_legacy_migration_config
  WHERE singleton = true;

  IF v_legacy_count > 0 AND v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'La migration historique exige un wallet explicitement configuré dans finance_legacy_migration_config.'
      USING ERRCODE = '22023';
  END IF;

  IF v_wallet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet configuré pour la migration n''existe plus.' USING ERRCODE = '23503';
  END IF;

  -- revenues ---------------------------------------------------------------
  FOR v_row IN
    SELECT snapshot.legacy_id, snapshot.row_data
    FROM public.finance_legacy_snapshot_revenues AS snapshot
    LEFT JOIN public.finance_revenue_links AS link ON link.revenue_id = snapshot.legacy_id
    WHERE snapshot.migration_run_id = v_run_id
      AND link.revenue_id IS NULL
    ORDER BY snapshot.legacy_id
  LOOP
    v_entity_type := NULLIF(v_row.row_data ->> 'entity_type', '');
    v_entity_id := NULLIF(v_row.row_data ->> 'entity_id', '')::uuid;
    v_farm_id := NULL;
    v_motorcycle_id := NULL;
    v_vehicle_id := NULL;
    v_driver_id := NULL;
    v_employee_id := NULL;
    v_contract_id := NULL;

    IF v_entity_type = 'exploitation' AND EXISTS (SELECT 1 FROM public.farms WHERE id = v_entity_id) THEN
      v_farm_id := v_entity_id;
    ELSIF v_entity_type = 'moto' AND EXISTS (SELECT 1 FROM public.motorcycles WHERE id = v_entity_id) THEN
      v_motorcycle_id := v_entity_id;
    ELSIF v_entity_type = 'vehicule' AND EXISTS (SELECT 1 FROM public.vehicles WHERE id = v_entity_id) THEN
      v_vehicle_id := v_entity_id;
    ELSIF v_entity_type = 'chauffeur' AND EXISTS (SELECT 1 FROM public.drivers WHERE id = v_entity_id) THEN
      v_driver_id := v_entity_id;
    ELSIF v_entity_type = 'employe' AND EXISTS (SELECT 1 FROM public.employees WHERE id = v_entity_id) THEN
      v_employee_id := v_entity_id;
    ELSIF v_entity_type = 'contrat' AND EXISTS (SELECT 1 FROM public.contracts WHERE id = v_entity_id) THEN
      v_contract_id := v_entity_id;
    ELSIF v_entity_type IS NOT NULL AND v_entity_type <> 'autre' THEN
      INSERT INTO public.finance_legacy_migration_issues (
        migration_run_id, source_table, legacy_id, issue_code, details
      ) VALUES (
        v_run_id, 'revenues', v_row.legacy_id, 'UNRESOLVED_LEGACY_ENTITY',
        jsonb_build_object('entity_type', v_entity_type, 'entity_id', v_entity_id)
      ) ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO public.finance_operations (
      wallet_id, type, amount, operation_date, category, description,
      origin, module, vehicle_id, farm_id, motorcycle_id, driver_id,
      employee_id, contract_id, created_at, updated_at
    ) VALUES (
      v_wallet_id, 'REVENUE', (v_row.row_data ->> 'montant')::numeric,
      (v_row.row_data ->> 'date')::date, NULLIF(v_row.row_data ->> 'source', ''),
      NULLIF(v_row.row_data ->> 'description', ''), 'LEGACY_REVENUE',
      'LEGACY_REVENUE', v_vehicle_id, v_farm_id, v_motorcycle_id, v_driver_id,
      v_employee_id, v_contract_id,
      COALESCE((v_row.row_data ->> 'created_at')::timestamptz, now()),
      COALESCE((v_row.row_data ->> 'updated_at')::timestamptz, now())
    ) RETURNING id INTO v_operation_id;

    INSERT INTO public.finance_revenue_links (
      operation_id, revenue_id, migration_run_id, legacy_entity_type, legacy_entity_id
    ) VALUES (
      v_operation_id, v_row.legacy_id, v_run_id, v_entity_type, v_entity_id
    );

    v_revenues_migrated := v_revenues_migrated + 1;
  END LOOP;

  -- expenses ---------------------------------------------------------------
  FOR v_row IN
    SELECT snapshot.legacy_id, snapshot.row_data
    FROM public.finance_legacy_snapshot_expenses AS snapshot
    LEFT JOIN public.finance_expense_links AS link ON link.expense_id = snapshot.legacy_id
    WHERE snapshot.migration_run_id = v_run_id
      AND link.expense_id IS NULL
    ORDER BY snapshot.legacy_id
  LOOP
    v_farm_id := NULLIF(v_row.row_data ->> 'farm_id', '')::uuid;

    INSERT INTO public.finance_operations (
      wallet_id, type, amount, operation_date, category, description,
      supplier, origin, module, farm_id, created_at, updated_at
    ) VALUES (
      v_wallet_id, 'EXPENSE', (v_row.row_data ->> 'montant')::numeric,
      (v_row.row_data ->> 'date')::date, NULLIF(v_row.row_data ->> 'categorie', ''),
      NULLIF(v_row.row_data ->> 'description', ''), NULLIF(v_row.row_data ->> 'fournisseur', ''),
      'LEGACY_EXPENSE', 'LEGACY_EXPENSE', v_farm_id,
      COALESCE((v_row.row_data ->> 'created_at')::timestamptz, now()),
      COALESCE((v_row.row_data ->> 'updated_at')::timestamptz, now())
    ) RETURNING id INTO v_operation_id;

    INSERT INTO public.finance_expense_links (operation_id, expense_id, migration_run_id)
    VALUES (v_operation_id, v_row.legacy_id, v_run_id);

    v_expenses_migrated := v_expenses_migrated + 1;
  END LOOP;

  -- payments ---------------------------------------------------------------
  FOR v_row IN
    SELECT snapshot.legacy_id, snapshot.row_data
    FROM public.finance_legacy_snapshot_payments AS snapshot
    LEFT JOIN public.finance_payment_links AS link ON link.payment_id = snapshot.legacy_id
    WHERE snapshot.migration_run_id = v_run_id
      AND link.payment_id IS NULL
    ORDER BY snapshot.legacy_id
  LOOP
    v_payment_type := lower(trim(COALESCE(v_row.row_data ->> 'type', '')));
    v_contract_id := NULLIF(v_row.row_data ->> 'contract_id', '')::uuid;

    IF v_payment_type NOT IN ('entrant', 'sortant') THEN
      INSERT INTO public.finance_legacy_migration_issues (
        migration_run_id, source_table, legacy_id, issue_code, details
      ) VALUES (
        v_run_id, 'payments', v_row.legacy_id, 'UNMAPPABLE_PAYMENT_TYPE',
        jsonb_build_object('type', v_payment_type)
      ) ON CONFLICT DO NOTHING;
      RAISE EXCEPTION 'Le payment % a un type non mappable : %', v_row.legacy_id, v_payment_type
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.finance_operations (
      wallet_id, type, amount, operation_date, category, description,
      reference, payment_method, origin, module, contract_id, created_at, updated_at
    ) VALUES (
      v_wallet_id,
      CASE WHEN v_payment_type = 'entrant' THEN 'REVENUE' ELSE 'EXPENSE' END,
      (v_row.row_data ->> 'montant')::numeric,
      (v_row.row_data ->> 'date')::date,
      'REGLEMENT CONTRAT', NULLIF(v_row.row_data ->> 'description', ''),
      NULLIF(v_row.row_data ->> 'reference', ''), NULLIF(v_row.row_data ->> 'methode', ''),
      'LEGACY_PAYMENT', 'LEGACY_PAYMENT', v_contract_id,
      COALESCE((v_row.row_data ->> 'created_at')::timestamptz, now()),
      COALESCE((v_row.row_data ->> 'updated_at')::timestamptz, now())
    ) RETURNING id INTO v_operation_id;

    INSERT INTO public.finance_payment_links (
      operation_id, payment_id, migration_run_id, legacy_payment_type
    ) VALUES (
      v_operation_id, v_row.legacy_id, v_run_id, v_payment_type
    );

    v_payments_migrated := v_payments_migrated + 1;
  END LOOP;

  IF v_wallet_id IS NOT NULL THEN
    PERFORM public.update_wallet_balance(v_wallet_id);
  END IF;

  PERFORM public.update_wallet_balance(id) FROM public.wallets;

  UPDATE public.finance_migration_runs
  SET backfilled_at = now(),
      status = 'BACKFILL_COMPLETE',
      metadata = metadata || jsonb_build_object(
        'backfill', jsonb_build_object(
          'revenues', v_revenues_migrated,
          'expenses', v_expenses_migrated,
          'payments', v_payments_migrated
        )
      ),
      updated_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'migration_run_id', v_run_id,
    'revenues_migrated', v_revenues_migrated,
    'expenses_migrated', v_expenses_migrated,
    'payments_migrated', v_payments_migrated
  );
END;
$backfill$;

CREATE OR REPLACE VIEW public.finance_legacy_migration_reconciliation AS
SELECT
  run.id AS migration_run_id,
  run.migration_key,
  'revenues'::text AS source_table,
  (SELECT count(*) FROM public.finance_legacy_snapshot_revenues WHERE migration_run_id = run.id) AS source_rows,
  (SELECT COALESCE(sum((row_data ->> 'montant')::numeric), 0) FROM public.finance_legacy_snapshot_revenues WHERE migration_run_id = run.id) AS source_amount,
  (SELECT count(*) FROM public.finance_revenue_links WHERE migration_run_id = run.id) AS migrated_rows,
  (SELECT COALESCE(sum(operation.amount), 0) FROM public.finance_revenue_links link JOIN public.finance_operations operation ON operation.id = link.operation_id WHERE link.migration_run_id = run.id) AS migrated_amount
FROM public.finance_migration_runs run
UNION ALL
SELECT
  run.id, run.migration_key, 'expenses'::text,
  (SELECT count(*) FROM public.finance_legacy_snapshot_expenses WHERE migration_run_id = run.id),
  (SELECT COALESCE(sum((row_data ->> 'montant')::numeric), 0) FROM public.finance_legacy_snapshot_expenses WHERE migration_run_id = run.id),
  (SELECT count(*) FROM public.finance_expense_links WHERE migration_run_id = run.id),
  (SELECT COALESCE(sum(operation.amount), 0) FROM public.finance_expense_links link JOIN public.finance_operations operation ON operation.id = link.operation_id WHERE link.migration_run_id = run.id)
FROM public.finance_migration_runs run
UNION ALL
SELECT
  run.id, run.migration_key, 'payments'::text,
  (SELECT count(*) FROM public.finance_legacy_snapshot_payments WHERE migration_run_id = run.id),
  (SELECT COALESCE(sum((row_data ->> 'montant')::numeric), 0) FROM public.finance_legacy_snapshot_payments WHERE migration_run_id = run.id),
  (SELECT count(*) FROM public.finance_payment_links WHERE migration_run_id = run.id),
  (SELECT COALESCE(sum(operation.amount), 0) FROM public.finance_payment_links link JOIN public.finance_operations operation ON operation.id = link.operation_id WHERE link.migration_run_id = run.id)
FROM public.finance_migration_runs run;

CREATE OR REPLACE VIEW public.finance_wallet_reconciliation AS
SELECT
  wallet.id AS wallet_id,
  wallet.name AS wallet_name,
  wallet.balance AS stored_balance,
  COALESCE(SUM(CASE
    WHEN operation.wallet_id = wallet.id AND operation.type IN ('REVENUE', 'DEPOSIT') THEN operation.amount
    WHEN operation.wallet_id = wallet.id AND operation.type IN ('EXPENSE', 'TRANSFER') THEN -operation.amount
    WHEN operation.destination_wallet_id = wallet.id AND operation.type = 'TRANSFER' THEN operation.amount
    ELSE 0
  END), 0) AS calculated_balance,
  COALESCE(SUM(CASE WHEN operation.wallet_id = wallet.id AND operation.type IN ('REVENUE', 'DEPOSIT') THEN operation.amount ELSE 0 END), 0) AS incoming_total,
  COALESCE(SUM(CASE WHEN operation.wallet_id = wallet.id AND operation.type = 'EXPENSE' THEN operation.amount ELSE 0 END), 0) AS expense_total,
  COALESCE(SUM(CASE WHEN operation.destination_wallet_id = wallet.id AND operation.type = 'TRANSFER' THEN operation.amount ELSE 0 END), 0) AS transfers_in_total,
  COALESCE(SUM(CASE WHEN operation.wallet_id = wallet.id AND operation.type = 'TRANSFER' THEN operation.amount ELSE 0 END), 0) AS transfers_out_total
FROM public.wallets wallet
LEFT JOIN public.finance_operations operation
  ON operation.wallet_id = wallet.id OR operation.destination_wallet_id = wallet.id
GROUP BY wallet.id, wallet.name, wallet.balance;

GRANT SELECT ON public.finance_legacy_migration_reconciliation, public.finance_wallet_reconciliation TO authenticated;
REVOKE ALL ON FUNCTION public.backfill_legacy_finance_operations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_legacy_finance_operations(text) TO service_role;

SELECT public.backfill_legacy_finance_operations('legacy_finance_v1');
