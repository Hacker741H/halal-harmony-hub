-- Le rapprochement d'un wallet doit toujours couvrir l'historique complet.
-- La période choisie filtre les flux présentés, pas le solde calculé comparé
-- au solde enregistré actuel.

CREATE OR REPLACE FUNCTION public.get_management_treasury_report(
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $get_management_treasury_report$
DECLARE
  v_start_date date := NULLIF(p_filters ->> 'startDate', '')::date;
  v_end_date date := NULLIF(p_filters ->> 'endDate', '')::date;
  v_wallet_id uuid := NULLIF(p_filters ->> 'walletId', '')::uuid;
BEGIN
  IF NOT public.reporting_can_access_report('TREASURY') THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à consulter la trésorerie.' USING ERRCODE = '42501';
  END IF;

  IF v_start_date IS NOT NULL AND v_end_date IS NOT NULL AND v_start_date > v_end_date THEN
    RAISE EXCEPTION 'La date de début doit précéder la date de fin.' USING ERRCODE = '22007';
  END IF;

  RETURN (
    WITH all_operations AS (
      SELECT wallet_id, destination_wallet_id, amount, type, operation_date
      FROM public.finance_operations
      WHERE COALESCE(status, 'VALIDE') <> 'CANCELLED'
    ), period_operations AS (
      SELECT *
      FROM all_operations
      WHERE (v_start_date IS NULL OR operation_date >= v_start_date)
        AND (v_end_date IS NULL OR operation_date <= v_end_date)
        AND (v_wallet_id IS NULL OR wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id)
    )
    SELECT jsonb_build_object(
      'reportType', 'TREASURY',
      'wallets', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', w.id,
          'name', w.name,
          'type', w.type,
          'initialBalance', w.initial_balance,
          'recordedBalance', w.balance,
          'revenue', COALESCE((SELECT sum(amount) FROM period_operations o WHERE o.wallet_id = w.id AND o.type = 'REVENUE'), 0),
          'expense', COALESCE((SELECT sum(amount) FROM period_operations o WHERE o.wallet_id = w.id AND o.type = 'EXPENSE'), 0),
          'deposit', COALESCE((SELECT sum(amount) FROM period_operations o WHERE o.wallet_id = w.id AND o.type = 'DEPOSIT'), 0),
          'transferOut', COALESCE((SELECT sum(amount) FROM period_operations o WHERE o.wallet_id = w.id AND o.type = 'TRANSFER'), 0),
          'transferIn', COALESCE((SELECT sum(amount) FROM period_operations o WHERE o.destination_wallet_id = w.id AND o.type = 'TRANSFER'), 0),
          'calculatedBalance', w.initial_balance
            + COALESCE((SELECT sum(amount) FROM all_operations o WHERE o.wallet_id = w.id AND o.type IN ('REVENUE', 'DEPOSIT')), 0)
            + COALESCE((SELECT sum(amount) FROM all_operations o WHERE o.destination_wallet_id = w.id AND o.type = 'TRANSFER'), 0)
            - COALESCE((SELECT sum(amount) FROM all_operations o WHERE o.wallet_id = w.id AND o.type IN ('EXPENSE', 'TRANSFER')), 0),
          'difference', w.balance - (
            w.initial_balance
            + COALESCE((SELECT sum(amount) FROM all_operations o WHERE o.wallet_id = w.id AND o.type IN ('REVENUE', 'DEPOSIT')), 0)
            + COALESCE((SELECT sum(amount) FROM all_operations o WHERE o.destination_wallet_id = w.id AND o.type = 'TRANSFER'), 0)
            - COALESCE((SELECT sum(amount) FROM all_operations o WHERE o.wallet_id = w.id AND o.type IN ('EXPENSE', 'TRANSFER')), 0)
          )
        ) ORDER BY w.name), '[]'::jsonb)
        FROM public.wallets w
        WHERE v_wallet_id IS NULL OR w.id = v_wallet_id
      )
    )
  );
END;
$get_management_treasury_report$;

REVOKE ALL ON FUNCTION public.get_management_treasury_report(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_management_treasury_report(jsonb) TO authenticated;
