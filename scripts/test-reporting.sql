-- LOT 9 — tests transactionnels du centre de rapports.
-- À exécuter sur une base de test ou via `supabase db query --linked --file`.
-- Toute donnée temporaire est annulée à la fin.

BEGIN;

DO $context$
DECLARE
  v_actor_id uuid;
BEGIN
  SELECT user_id
    INTO v_actor_id
  FROM public.user_roles
  WHERE role IN ('super_admin', 'admin', 'comptable')
  ORDER BY created_at
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Un utilisateur super_admin, admin ou comptable est requis pour les tests de reporting.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$context$;

SET LOCAL ROLE authenticated;

DO $finance$
DECLARE
  v_report jsonb;
  v_expected_revenue numeric;
  v_expected_expense numeric;
  v_expected_deposit numeric;
  v_expected_transfer numeric;
BEGIN
  SELECT public.get_management_report('FINANCE', '{}'::jsonb) INTO v_report;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE type = 'REVENUE'), 0),
    COALESCE(sum(amount) FILTER (WHERE type = 'EXPENSE'), 0),
    COALESCE(sum(amount) FILTER (WHERE type = 'DEPOSIT'), 0),
    COALESCE(sum(amount) FILTER (WHERE type = 'TRANSFER'), 0)
  INTO v_expected_revenue, v_expected_expense, v_expected_deposit, v_expected_transfer
  FROM public.finance_operations
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

  IF (v_report #>> '{summary,revenue}')::numeric <> v_expected_revenue
    OR (v_report #>> '{summary,expense}')::numeric <> v_expected_expense
    OR (v_report #>> '{summary,deposit}')::numeric <> v_expected_deposit
    OR (v_report #>> '{summary,transfer}')::numeric <> v_expected_transfer THEN
    RAISE EXCEPTION 'Le résumé financier ne correspond pas à finance_operations.';
  END IF;

  IF (v_report #>> '{summary,netFlow}')::numeric <> v_expected_revenue + v_expected_deposit - v_expected_expense THEN
    RAISE EXCEPTION 'Le flux net ne respecte pas recettes + dépôts - dépenses.';
  END IF;
END;
$finance$;

DO $cancelled$
DECLARE
  v_wallet_id uuid;
  v_before numeric;
  v_after numeric;
BEGIN
  SELECT id INTO v_wallet_id FROM public.wallets ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Un wallet est requis pour le test d''exclusion CANCELLED.';
  END IF;

  SELECT (public.get_management_report('FINANCE', '{}'::jsonb) #>> '{summary,revenue}')::numeric INTO v_before;

  INSERT INTO public.finance_operations (
    wallet_id, type, amount, operation_date, status, category, description, module
  ) VALUES (
    v_wallet_id, 'REVENUE', 987654, current_date, 'CANCELLED', 'TEST_REPORTING', 'Écriture annulée de test', 'TEST'
  );

  SELECT (public.get_management_report('FINANCE', '{}'::jsonb) #>> '{summary,revenue}')::numeric INTO v_after;
  IF v_before <> v_after THEN
    RAISE EXCEPTION 'Une opération CANCELLED a été incluse dans le rapport financier.';
  END IF;
END;
$cancelled$;

DO $wallets$
DECLARE
  v_wallet record;
  v_expected numeric;
  v_reported numeric;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets ORDER BY created_at NULLS LAST LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Un wallet est requis pour le rapprochement.';
  END IF;

  SELECT
    v_wallet.initial_balance
    + COALESCE(sum(amount) FILTER (WHERE wallet_id = v_wallet.id AND type IN ('REVENUE', 'DEPOSIT')), 0)
    + COALESCE(sum(amount) FILTER (WHERE destination_wallet_id = v_wallet.id AND type = 'TRANSFER'), 0)
    - COALESCE(sum(amount) FILTER (WHERE wallet_id = v_wallet.id AND type IN ('EXPENSE', 'TRANSFER')), 0)
  INTO v_expected
  FROM public.finance_operations
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

  SELECT (entry ->> 'calculatedBalance')::numeric
  INTO v_reported
  FROM jsonb_array_elements(public.get_management_treasury_report('{}'::jsonb) -> 'wallets') entry
  WHERE entry ->> 'id' = v_wallet.id::text;

  IF v_reported IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Le solde calculé du wallet ne correspond pas à la formule officielle.';
  END IF;

  -- Une période vide ne doit pas modifier le rapprochement du solde courant.
  SELECT (entry ->> 'calculatedBalance')::numeric
  INTO v_reported
  FROM jsonb_array_elements(public.get_management_treasury_report(
    jsonb_build_object('startDate', '1900-01-01', 'endDate', '1900-01-02')
  ) -> 'wallets') entry
  WHERE entry ->> 'id' = v_wallet.id::text;

  IF v_reported IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Le filtre de période a altéré le rapprochement du solde courant.';
  END IF;
END;
$wallets$;

DO $pagination$
DECLARE
  v_rows integer;
  v_total bigint;
  v_expected bigint;
BEGIN
  SELECT count(*), COALESCE(max(total_count), 0)
  INTO v_rows, v_total
  FROM public.get_management_report_operations('{}'::jsonb, 1, 25);

  SELECT count(*) INTO v_expected
  FROM public.finance_operations
  WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED';

  IF v_rows > 25 OR v_total <> v_expected THEN
    RAISE EXCEPTION 'La pagination ou le total des opérations sources est incohérent.';
  END IF;
END;
$pagination$;

DO $domains$
DECLARE
  v_report_type text;
  v_report jsonb;
BEGIN
  FOREACH v_report_type IN ARRAY ARRAY[
    'OVERVIEW', 'VEHICLES', 'MOTORCYCLES', 'DRIVERS', 'EMPLOYEES',
    'FARMS', 'MAINTENANCE', 'STOCK', 'COMPLIANCE'
  ] LOOP
    SELECT public.get_management_report(v_report_type, '{}'::jsonb) INTO v_report;
    IF v_report IS NULL OR v_report ->> 'reportType' <> v_report_type THEN
      RAISE EXCEPTION 'Le rapport % n''a pas retourné de réponse exploitable.', v_report_type;
    END IF;
  END LOOP;
END;
$domains$;

DO $saved_reports$
DECLARE
  v_saved_id uuid;
BEGIN
  INSERT INTO public.saved_reports (name, report_type, filters, visible_columns, sort)
  VALUES ('Test transactionnel reporting', 'FINANCE', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)
  RETURNING id INTO v_saved_id;

  IF NOT EXISTS (SELECT 1 FROM public.saved_reports WHERE id = v_saved_id) THEN
    RAISE EXCEPTION 'Le rapport personnel enregistré n''est pas visible à son propriétaire.';
  END IF;
END;
$saved_reports$;

ROLLBACK;
