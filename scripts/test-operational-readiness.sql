-- Fast, transactional checks for the guards introduced during OR-01.
-- Run with an administrative linked connection. It always ends in ROLLBACK.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_wallet_balance numeric;
  v_client public.transport_clients;
  v_course public.transport_missions;
  v_expense public.transport_mission_expenses;
  v_invoice public.transport_invoices;
  v_payment public.transport_invoice_payments;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_rejected boolean := false;
BEGIN
  SELECT user_role.user_id
  INTO v_actor_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;

  SELECT id, balance
  INTO v_wallet_id, v_wallet_balance
  FROM public.wallets
  ORDER BY is_default DESC NULLS LAST, created_at
  LIMIT 1;

  IF v_actor_id IS NULL OR v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'A super_admin and a wallet are required for the OR-01 transactional test.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  v_client := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', 'Client OR-01 ' || v_suffix,
    'country_code', 'SN',
    'telephone', '+221 78 ' || substr(v_suffix, 1, 6),
    'email', 'or01-' || lower(v_suffix) || '@example.test'
  ));
  v_course := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'quoted_amount', 10000
  ));

  v_expense := public.create_transport_mission_expense(v_course.id, jsonb_build_object(
    'wallet_id', v_wallet_id,
    'category', 'FUEL',
    'amount', 1000,
    'expense_date', current_date + 1,
    'status', 'ENGAGED'
  ));

  BEGIN
    PERFORM public.confirm_transport_mission_expense(v_expense.id);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A future-dated Course expense must not be confirmed.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_transport_mission_expense_links
    WHERE expense_id = v_expense.id AND link_type = 'EXPENSE'
  ) THEN
    RAISE EXCEPTION 'A rejected future expense must not create a finance operation.';
  END IF;

  v_invoice := public.create_transport_invoice(v_course.id, jsonb_build_object(
    'subtotal_amount', 10000,
    'tax_rate', 0
  ));
  v_invoice := public.issue_transport_invoice(v_invoice.id);
  v_payment := public.create_transport_invoice_payment(v_invoice.id, jsonb_build_object(
    'wallet_id', v_wallet_id,
    'amount', 10000,
    'payment_date', current_date + 1,
    'payment_kind', 'PAYMENT'
  ));

  v_rejected := false;
  BEGIN
    PERFORM public.confirm_transport_invoice_payment(v_payment.id);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A future-dated Course payment must not be confirmed.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_transport_payment_links
    WHERE payment_id = v_payment.id AND link_type = 'PAYMENT'
  ) THEN
    RAISE EXCEPTION 'A rejected future payment must not create a finance operation.';
  END IF;
  IF (SELECT balance FROM public.wallets WHERE id = v_wallet_id) <> v_wallet_balance THEN
    RAISE EXCEPTION 'Rejecting future-dated cashflows must not affect the wallet.';
  END IF;
END;
$test$;

ROLLBACK;
