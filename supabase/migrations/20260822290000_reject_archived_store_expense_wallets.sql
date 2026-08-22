-- Une depense Magasin ne peut etre confirmee que sur un wallet encore actif
-- et autorise pour le magasin. La politique de decouvert existante reste
-- inchangee : aucun controle bloquant du solde n'est ajoute ici.

CREATE OR REPLACE FUNCTION public.confirm_commerce_store_expense(
  p_expense_id uuid,
  p_wallet_id uuid
)
RETURNS public.commerce_store_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_store_expenses;
  v_expense public.commerce_store_expenses;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.permission_require('store.expenses.confirm');

  SELECT * INTO v_before
  FROM public.commerce_store_expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Depense introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;

  IF v_before.status = 'CONFIRMED' THEN
    RETURN v_before;
  END IF;

  IF v_before.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seule une depense brouillon peut etre confirmee.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_location_wallets AS location_wallet
    JOIN public.wallets AS wallet ON wallet.id = location_wallet.wallet_id
    WHERE location_wallet.business_location_id = v_before.business_location_id
      AND location_wallet.wallet_id = p_wallet_id
      AND location_wallet.is_active
      AND location_wallet.purpose IN ('CASH_DRAWER', 'OPERATING')
      AND NOT wallet.is_archived
  ) THEN
    RAISE EXCEPTION 'Ce wallet est archivé ou n''est plus autorisé pour ce magasin.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.commerce_store_expenses
  SET wallet_id = p_wallet_id,
      status = 'CONFIRMED',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      updated_at = now()
  WHERE id = p_expense_id
  RETURNING * INTO v_expense;

  v_operation := public.business_upsert_finance_operation(
    NULL,
    p_wallet_id,
    'EXPENSE',
    v_expense.amount,
    v_expense.expense_date,
    'DEPENSE MAGASIN - ' || v_expense.category,
    v_expense.description,
    'COMMERCE_STORE_EXPENSE',
    'COMMERCE_STORE_EXPENSE',
    v_expense.id,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    v_expense.reference
  );

  INSERT INTO public.finance_commerce_store_expense_links(
    store_expense_id,
    operation_id,
    created_at
  ) VALUES (
    v_expense.id,
    v_operation.id,
    now()
  );

  PERFORM public.business_finance_audit_event(
    'COMMERCE_STORE_EXPENSE',
    v_expense.id,
    v_operation.id,
    'UPDATE',
    to_jsonb(v_before),
    to_jsonb(v_expense)
  );

  RETURN v_expense;
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_commerce_store_expense(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_commerce_store_expense(uuid, uuid) TO authenticated;
