-- A confirmed Course cashflow creates an immediate finance operation and
-- recalculates its wallet. Future-dated cashflows must therefore remain
-- planned or engaged until their effective date.
-- This is additive and deliberately leaves historical rows untouched.

CREATE OR REPLACE FUNCTION public.confirm_transport_mission_expense(p_expense_id uuid)
RETURNS public.transport_mission_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_transport_mission_expense$
DECLARE
  v_before public.transport_mission_expenses;
  v_expense public.transport_mission_expenses;
  v_mission public.transport_missions;
  v_operation public.finance_operations;
BEGIN
  PERFORM public.permission_require('missions.expenses.confirm');

  SELECT * INTO v_before
  FROM public.transport_mission_expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dépense introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Une dépense annulée ne peut pas être validée.' USING ERRCODE = '22023';
  END IF;
  IF v_before.status = 'PAID' THEN
    RETURN v_before;
  END IF;
  IF v_before.expense_date > current_date THEN
    RAISE EXCEPTION 'Une dépense datée dans le futur doit rester prévue ou engagée jusqu’à sa date effective.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mission
  FROM public.transport_missions
  WHERE id = v_before.mission_id
  FOR UPDATE;

  IF v_mission.status IN ('CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'La Course n’accepte plus de dépenses.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_transport_mission_expense_links
    WHERE expense_id = v_before.id AND link_type = 'EXPENSE'
  ) THEN
    RAISE EXCEPTION 'Une écriture financière existe déjà pour cette dépense.' USING ERRCODE = '23505';
  END IF;

  v_operation := public._internal_course_upsert_finance(
    v_before.wallet_id,
    'EXPENSE',
    v_before.amount,
    v_before.expense_date,
    'COURSE_' || v_before.category,
    'Dépense Course ' || v_mission.mission_number,
    v_mission,
    v_before.id::text
  );

  INSERT INTO public.finance_transport_mission_expense_links(expense_id, operation_id, link_type)
  VALUES (v_before.id, v_operation.id, 'EXPENSE');

  UPDATE public.transport_mission_expenses
  SET status = 'PAID', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_expense;

  PERFORM public.business_finance_audit_event(
    'COURSE_EXPENSE', v_expense.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_expense)
  );
  RETURN v_expense;
END;
$confirm_transport_mission_expense$;

CREATE OR REPLACE FUNCTION public.confirm_transport_invoice_payment(p_payment_id uuid)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_transport_invoice_payment$
DECLARE
  v_before public.transport_invoice_payments;
  v_payment public.transport_invoice_payments;
  v_invoice public.transport_invoices;
  v_mission public.transport_missions;
  v_operation public.finance_operations;
  v_confirmed numeric;
BEGIN
  PERFORM public.permission_require('missions.payments');

  SELECT * INTO v_before
  FROM public.transport_invoice_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Un paiement annulé ne peut pas être confirmé.' USING ERRCODE = '22023';
  END IF;
  IF v_before.status = 'CONFIRMED' THEN
    RETURN v_before;
  END IF;
  IF v_before.payment_date > current_date THEN
    RAISE EXCEPTION 'Un paiement daté dans le futur doit rester prévu ou reçu jusqu’à sa date effective.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice
  FROM public.transport_invoices
  WHERE id = v_before.invoice_id
  FOR UPDATE;
  SELECT * INTO v_mission
  FROM public.transport_missions
  WHERE id = v_before.mission_id;

  IF v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise pour confirmer un paiement.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.transport_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';

  IF v_confirmed + v_before.amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.finance_transport_payment_links
    WHERE payment_id = v_before.id AND link_type = 'PAYMENT'
  ) THEN
    RAISE EXCEPTION 'Une écriture financière existe déjà pour ce paiement.' USING ERRCODE = '23505';
  END IF;

  v_operation := public._internal_course_upsert_finance(
    v_before.wallet_id,
    'REVENUE',
    v_before.amount,
    v_before.payment_date,
    'COURSE_PAYMENT',
    'Encaissement Course ' || v_mission.mission_number,
    v_mission,
    COALESCE(v_before.reference, v_before.id::text)
  );

  INSERT INTO public.finance_transport_payment_links(payment_id, operation_id, link_type)
  VALUES (v_before.id, v_operation.id, 'PAYMENT');

  UPDATE public.transport_invoice_payments
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_payment;

  v_confirmed := v_confirmed + v_payment.amount;
  UPDATE public.transport_invoices
  SET status = CASE WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event(
    'COURSE_PAYMENT', v_payment.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_payment)
  );
  RETURN v_payment;
END;
$confirm_transport_invoice_payment$;
