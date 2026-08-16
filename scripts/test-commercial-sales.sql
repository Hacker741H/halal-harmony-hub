-- CC-01 commercial-sale tests.
-- Run after 20260804100000_add_commercial_sales_foundation.sql.
-- This file always rolls back and therefore keeps no Client, sale, payment or
-- wallet operation in the linked database.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_before_balance numeric(14, 2);
  v_after_balance numeric(14, 2);
  v_client public.transport_clients;
  v_sale public.commercial_sales;
  v_invoice public.commercial_invoices;
  v_first_payment public.commercial_invoice_payments;
  v_final_payment public.commercial_invoice_payments;
  v_summary record;
  v_overpayment_refused boolean := false;
  v_invoice_cancellation_refused boolean := false;
  v_sale_cancellation_refused boolean := false;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
BEGIN
  IF to_regclass('public.commercial_sales') IS NULL
    OR to_regclass('public.commercial_sale_lines') IS NULL
    OR to_regclass('public.commercial_invoices') IS NULL
    OR to_regclass('public.commercial_invoice_payments') IS NULL
    OR to_regclass('public.finance_commercial_invoice_payment_links') IS NULL THEN
    RAISE EXCEPTION 'CC-01 commercial tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN (
      'public.commercial_sales'::regclass,
      'public.commercial_sale_lines'::regclass,
      'public.commercial_invoices'::regclass,
      'public.commercial_invoice_payments'::regclass
    )
      AND NOT relrowsecurity
  ) THEN
    RAISE EXCEPTION 'All CC-01 operational tables must have RLS enabled';
  END IF;

  IF has_table_privilege('authenticated', 'public.commercial_sales', 'DELETE')
    OR has_table_privilege('authenticated', 'public.commercial_invoices', 'DELETE')
    OR has_table_privilege('authenticated', 'public.commercial_invoice_payments', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated must not receive direct DELETE on commercial data';
  END IF;

  IF has_function_privilege('anon', 'public.create_commercial_sale(jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.confirm_commercial_invoice_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute commercial mutation RPCs';
  END IF;

  SELECT user_role.user_id INTO v_actor_id
  FROM public.user_roles AS user_role
  JOIN public.roles AS role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;
  SELECT id, balance INTO v_wallet_id, v_before_balance
  FROM public.wallets
  ORDER BY is_default DESC NULLS LAST, created_at
  LIMIT 1;

  IF v_actor_id IS NULL OR v_wallet_id IS NULL THEN
    RAISE NOTICE 'Lifecycle test skipped: an active super_admin and a wallet are required.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  v_client := public.create_client(
    jsonb_build_object(
      'kind', 'ORGANIZATION',
      'display_name', 'Client commercial test ' || v_suffix,
      'country_code', 'CI',
      'telephone', '+225 07 ' || substr(v_suffix, 1, 6),
      'email', 'commercial-' || lower(v_suffix) || '@example.test',
      'registration_identifier_type', null,
      'registration_identifier_value', null
    )
  );

  v_sale := public.create_commercial_sale(
    jsonb_build_object(
      'client_id', v_client.id,
      'sale_date', current_date,
      'reference', 'CC-01-' || v_suffix,
      'lines', jsonb_build_array(
        jsonb_build_object(
          'description', 'Vente agricole de test',
          'quantity', 10,
          'unit', 'kg',
          'unit_price', 10000
        )
      )
    )
  );
  IF v_sale.status <> 'DRAFT'
    OR (SELECT count(*) FROM public.commercial_sale_lines WHERE sale_id = v_sale.id) <> 1 THEN
    RAISE EXCEPTION 'Commercial sale creation must create one draft with its lines';
  END IF;

  v_sale := public.confirm_commercial_sale(v_sale.id);
  IF v_sale.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'A commercial sale must be confirmed before invoicing';
  END IF;

  v_invoice := public.create_commercial_invoice(v_sale.id, jsonb_build_object('due_date', current_date + 7));
  v_invoice := public.issue_commercial_invoice(v_invoice.id);
  IF v_invoice.status <> 'ISSUED' OR v_invoice.total_amount <> 100000 THEN
    RAISE EXCEPTION 'Invoice must be issued from the calculated sale total';
  END IF;

  v_first_payment := public.create_commercial_invoice_payment(
    v_invoice.id,
    jsonb_build_object(
      'wallet_id', v_wallet_id,
      'amount', 40000,
      'payment_date', current_date,
      'payment_kind', 'DEPOSIT',
      'status', 'RECEIVED'
    )
  );
  v_first_payment := public.confirm_commercial_invoice_payment(v_first_payment.id);
  IF v_first_payment.status <> 'CONFIRMED'
    OR NOT EXISTS (
      SELECT 1
      FROM public.finance_commercial_invoice_payment_links
      WHERE payment_id = v_first_payment.id AND link_type = 'PAYMENT'
    ) THEN
    RAISE EXCEPTION 'A confirmed commercial payment must create one explicit financial link';
  END IF;
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id = v_wallet_id;
  IF v_after_balance <> v_before_balance + 40000 THEN
    RAISE EXCEPTION 'A confirmed commercial payment must credit its wallet exactly';
  END IF;

  PERFORM public.confirm_commercial_invoice_payment(v_first_payment.id);
  IF (SELECT count(*) FROM public.finance_commercial_invoice_payment_links WHERE payment_id = v_first_payment.id AND link_type = 'PAYMENT') <> 1 THEN
    RAISE EXCEPTION 'A second payment confirmation must not create a second receipt';
  END IF;

  BEGIN
    PERFORM public.create_commercial_invoice_payment(
      v_invoice.id,
      jsonb_build_object('wallet_id', v_wallet_id, 'amount', 70000, 'payment_date', current_date)
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_overpayment_refused := true;
  END;
  IF NOT v_overpayment_refused THEN
    RAISE EXCEPTION 'The commercial payment flow must reject an overpayment';
  END IF;

  BEGIN
    PERFORM public.cancel_commercial_invoice(v_invoice.id, 'Tentative de test après encaissement');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_invoice_cancellation_refused := true;
  END;
  IF NOT v_invoice_cancellation_refused THEN
    RAISE EXCEPTION 'An invoice with a confirmed payment must not be cancelled directly';
  END IF;

  BEGIN
    PERFORM public.cancel_commercial_sale(v_sale.id, 'Tentative de test avec facture active');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_sale_cancellation_refused := true;
  END;
  IF NOT v_sale_cancellation_refused THEN
    RAISE EXCEPTION 'A sale with an active invoice must not be cancelled directly';
  END IF;

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.total_invoiced <> 100000 OR v_summary.total_received <> 40000 OR v_summary.amount_due <> 60000 THEN
    RAISE EXCEPTION 'Commercial financial summary is not reconciled after a partial payment';
  END IF;

  v_first_payment := public.cancel_commercial_invoice_payment(v_first_payment.id, 'Test de contre-écriture');
  IF v_first_payment.status <> 'CANCELLED'
    OR NOT EXISTS (
      SELECT 1
      FROM public.finance_commercial_invoice_payment_links
      WHERE payment_id = v_first_payment.id AND link_type = 'REVERSAL'
    ) THEN
    RAISE EXCEPTION 'Cancelling a confirmed payment must retain it and create a reversal';
  END IF;
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id = v_wallet_id;
  IF v_after_balance <> v_before_balance THEN
    RAISE EXCEPTION 'The reversal must restore the wallet to its prior balance';
  END IF;

  v_final_payment := public.create_commercial_invoice_payment(
    v_invoice.id,
    jsonb_build_object('wallet_id', v_wallet_id, 'amount', 100000, 'payment_date', current_date, 'payment_kind', 'SETTLEMENT')
  );
  v_final_payment := public.confirm_commercial_invoice_payment(v_final_payment.id);
  IF (SELECT status FROM public.commercial_invoices WHERE id = v_invoice.id) <> 'PAID' THEN
    RAISE EXCEPTION 'A fully confirmed settlement must mark the invoice PAID';
  END IF;
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id = v_wallet_id;
  IF v_after_balance <> v_before_balance + 100000 THEN
    RAISE EXCEPTION 'The final settlement must credit the wallet exactly once';
  END IF;

  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.amount_due <> 0 OR v_summary.total_received <> 100000 OR v_summary.invoice_status <> 'PAID' THEN
    RAISE EXCEPTION 'Commercial financial summary must reconcile a settled invoice';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_finance_audit
    WHERE source_type = 'COMMERCIAL_PAYMENT' AND source_id = v_final_payment.id AND action = 'CONFIRM'
  ) THEN
    RAISE EXCEPTION 'Commercial payment confirmation must be audited';
  END IF;

  RAISE NOTICE 'CC-01 commercial sales tests passed.';
END;
$test$;

ROLLBACK;
