-- Jèko connector tests. Run only after 20260808130000_add_jeko_payment_connector.sql.
-- All test data, finance operations and wallet changes are rolled back.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_wallet_id uuid;
  v_client public.transport_clients;
  v_mission public.transport_missions;
  v_invoice public.transport_invoices;
  v_request public.payment_provider_payment_requests;
  v_event public.payment_events;
  v_duplicate_event public.payment_events;
  v_transfer_event public.payment_events;
  v_unknown_event public.payment_events;
  v_missing_reference_event public.payment_events;
  v_amount_mismatch_event public.payment_events;
  v_currency_mismatch_event public.payment_events;
  v_retry_event public.payment_events;
  v_sale public.commercial_sales;
  v_commercial_invoice public.commercial_invoices;
  v_commercial_request public.payment_provider_payment_requests;
  v_commercial_event public.payment_events;
  v_before_balance numeric;
  v_after_balance numeric;
  v_finance_links_before integer;
  v_finance_links_after integer;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_invoice_amount numeric := 50000;
  v_jeko_provider_amount numeric := 5000000;
BEGIN
  IF to_regclass('public.payment_events') IS NULL
    OR to_regclass('public.payment_provider_wallet_mappings') IS NULL
    OR to_regclass('public.payment_provider_payment_requests') IS NULL THEN
    RAISE EXCEPTION 'Jèko connector tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.payment_events'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'payment_events must have RLS enabled';
  END IF;
  IF has_table_privilege('anon', 'public.payment_events', 'SELECT')
    OR has_table_privilege('authenticated', 'public.payment_events', 'INSERT')
    OR has_function_privilege('anon', 'public.process_jeko_payment_event(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.process_jeko_payment_event(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Jèko events and bridge RPC must not be directly accessible to anon/authenticated';
  END IF;

  SELECT user_role.user_id INTO v_actor_id
  FROM public.user_roles user_role
  JOIN public.roles role_catalogue ON role_catalogue.code = user_role.role
  WHERE user_role.role = 'super_admin' AND role_catalogue.is_active
  ORDER BY user_role.created_at
  LIMIT 1;
  SELECT id, balance INTO v_wallet_id, v_before_balance
  FROM public.wallets
  ORDER BY is_default DESC NULLS LAST, created_at
  LIMIT 1;
  IF v_actor_id IS NULL OR v_wallet_id IS NULL THEN
    RAISE NOTICE 'Jèko finance lifecycle test skipped: an active super_admin and a wallet are required.';
    RETURN;
  END IF;

  -- Existing authenticated Course RPCs build an issued invoice. The bridge
  -- itself is then called with the service-role JWT claim, as the Edge Function does.
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  v_client := public.create_client(jsonb_build_object(
    'kind', 'ORGANIZATION',
    'display_name', 'Client Jèko test ' || v_suffix,
    'country_code', 'CI',
    'telephone', '+225 07 ' || substr(v_suffix, 1, 6),
    'email', 'jeko-' || lower(v_suffix) || '@example.test'
  ));
  -- create_transport_mission stopped reading quoted_amount when
  -- 20260813143000_add_real_course_pricing_and_simplify_workflow.sql moved
  -- pricing to pricing_mode/actual_transport_amount; create_transport_invoice
  -- now requires actual_transport_amount to be set before it will invoice.
  v_mission := public.create_transport_mission(jsonb_build_object(
    'client_id', v_client.id,
    'pricing_mode', 'FLAT',
    'actual_transport_amount', v_invoice_amount
  ));
  v_invoice := public.create_transport_invoice(v_mission.id, jsonb_build_object(
    'subtotal_amount', v_invoice_amount,
    'tax_rate', 0,
    'due_date', current_date
  ));
  v_invoice := public.issue_transport_invoice(v_invoice.id);

  INSERT INTO public.payment_provider_wallet_mappings(provider, provider_store_id, wallet_id)
  VALUES ('JEKO', 'store-test-' || v_suffix, v_wallet_id);

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_request := public.register_jeko_payment_request(jsonb_build_object(
    'provider_request_id', 'pr-test-' || v_suffix,
    'provider_reference', v_invoice.invoice_number,
    'provider_store_id', 'store-test-' || v_suffix,
    'invoice_id', v_invoice.id,
    'wallet_id', v_wallet_id,
    'expected_provider_amount', v_jeko_provider_amount,
    'erp_amount', v_invoice_amount,
    'currency', 'XOF'
  ));
  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Registered Jèko request must start pending';
  END IF;

  SELECT count(*) INTO v_finance_links_before FROM public.finance_transport_payment_links;
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-test-' || v_suffix, jsonb_build_object(
    'id', 'txn-test-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', v_jeko_provider_amount, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('id', v_request.provider_request_id, 'reference', v_invoice.invoice_number)
  )) RETURNING * INTO v_event;

  v_event := public.process_jeko_payment_event(v_event.id);
  IF v_event.status <> 'PROCESSED' OR v_event.payment_id IS NULL OR v_event.finance_operation_id IS NULL THEN
    RAISE EXCEPTION 'Successful Jèko payment must create one confirmed ERP payment and linked finance operation';
  END IF;
  IF (SELECT status FROM public.transport_invoice_payments WHERE id = v_event.payment_id) <> 'CONFIRMED'
    OR (SELECT status FROM public.transport_invoices WHERE id = v_invoice.id) <> 'PAID' THEN
    RAISE EXCEPTION 'Jèko bridge must reuse the Course payment confirmation lifecycle';
  END IF;
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id = v_wallet_id;
  IF v_after_balance <> v_before_balance + v_invoice_amount THEN
    RAISE EXCEPTION 'Successful Jèko payment must credit the mapped wallet exactly once';
  END IF;
  SELECT count(*) INTO v_finance_links_after FROM public.finance_transport_payment_links;
  IF v_finance_links_after <> v_finance_links_before + 1 THEN
    RAISE EXCEPTION 'Exactly one finance link must be created for a successful Jèko payment';
  END IF;

  -- A replay returns the stored event and must not create a second credit.
  v_duplicate_event := public.process_jeko_payment_event(v_event.id);
  SELECT balance INTO v_after_balance FROM public.wallets WHERE id = v_wallet_id;
  IF v_duplicate_event.status <> 'PROCESSED'
    OR v_after_balance <> v_before_balance + v_invoice_amount
    OR (SELECT count(*) FROM public.finance_transport_payment_links) <> v_finance_links_after THEN
    RAISE EXCEPTION 'Replay of an already processed Jèko transaction must be idempotent';
  END IF;
  BEGIN
    INSERT INTO public.payment_events(provider, transaction_id, payload)
    VALUES ('JEKO', v_event.transaction_id, '{}'::jsonb);
    RAISE EXCEPTION 'Duplicate Jèko transaction ID must be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Successful transfers are retained for audit but never enter invoice cash collection.
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-transfer-' || v_suffix, jsonb_build_object(
    'id', 'txn-transfer-' || v_suffix,
    'status', 'success',
    'transactionType', 'transfer',
    'amount', jsonb_build_object('amount', 1000, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('reference', 'TRANSFER-' || v_suffix)
  )) RETURNING * INTO v_transfer_event;
  v_transfer_event := public.process_jeko_payment_event(v_transfer_event.id);
  IF v_transfer_event.status <> 'PROCESSED' OR v_transfer_event.processing_note <> 'TRANSFER_IGNORED_BY_INVOICE_FLOW'
    OR v_transfer_event.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Transfer webhook must not enter the invoice collection flow';
  END IF;

  -- Permanent integrity failures remain FAILED, preserving a retryable audit record.
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-unknown-' || v_suffix, jsonb_build_object(
    'id', 'txn-unknown-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', 1000, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('id', 'pr-unknown-' || v_suffix, 'reference', 'FAC-UNKNOWN-' || v_suffix)
  )) RETURNING * INTO v_unknown_event;
  v_unknown_event := public.process_jeko_payment_event(v_unknown_event.id);
  IF v_unknown_event.status <> 'FAILED' OR v_unknown_event.last_error_code <> 'PJEK5' THEN
    RAISE EXCEPTION 'Unknown payment request must fail without a finance operation';
  END IF;

  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-missing-ref-' || v_suffix, jsonb_build_object(
    'id', 'txn-missing-ref-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', 1000, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('id', 'pr-missing-' || v_suffix)
  )) RETURNING * INTO v_missing_reference_event;
  v_missing_reference_event := public.process_jeko_payment_event(v_missing_reference_event.id);
  IF v_missing_reference_event.status <> 'FAILED' OR v_missing_reference_event.last_error_code <> 'PJEK2' THEN
    RAISE EXCEPTION 'Missing invoice reference must fail safely';
  END IF;

  -- Create a second issued invoice for amount/currency mismatch and retry checks.
  v_mission := public.create_transport_mission(jsonb_build_object('client_id', v_client.id, 'pricing_mode', 'FLAT', 'actual_transport_amount', 10000));
  v_invoice := public.create_transport_invoice(v_mission.id, jsonb_build_object('subtotal_amount', 10000, 'tax_rate', 0));
  v_invoice := public.issue_transport_invoice(v_invoice.id);
  v_request := public.register_jeko_payment_request(jsonb_build_object(
    'provider_request_id', 'pr-mismatch-' || v_suffix,
    'provider_reference', v_invoice.invoice_number,
    'provider_store_id', 'store-test-' || v_suffix,
    'invoice_id', v_invoice.id,
    'wallet_id', v_wallet_id,
    'expected_provider_amount', 1000000,
    'erp_amount', 10000,
    'currency', 'XOF'
  ));
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-amount-' || v_suffix, jsonb_build_object(
    'id', 'txn-amount-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', 999999, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('id', v_request.provider_request_id, 'reference', v_invoice.invoice_number)
  )) RETURNING * INTO v_amount_mismatch_event;
  v_amount_mismatch_event := public.process_jeko_payment_event(v_amount_mismatch_event.id);
  IF v_amount_mismatch_event.status <> 'FAILED' OR v_amount_mismatch_event.last_error_code <> 'PJEK8' THEN
    RAISE EXCEPTION 'Provider amount mismatch must not credit a wallet';
  END IF;
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-currency-' || v_suffix, jsonb_build_object(
    'id', 'txn-currency-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', 1000000, 'currency', 'EUR'),
    'transactionDetails', jsonb_build_object('id', v_request.provider_request_id, 'reference', v_invoice.invoice_number)
  )) RETURNING * INTO v_currency_mismatch_event;
  v_currency_mismatch_event := public.process_jeko_payment_event(v_currency_mismatch_event.id);
  IF v_currency_mismatch_event.status <> 'FAILED' OR v_currency_mismatch_event.last_error_code <> 'PJEK9' THEN
    RAISE EXCEPTION 'Provider currency mismatch must not credit a wallet';
  END IF;

  -- A failed event remains available to a later signed retry. The first pass
  -- deliberately sees a draft invoice; after reissue the same event succeeds.
  UPDATE public.transport_invoices SET status = 'DRAFT' WHERE id = v_invoice.id;
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-retry-' || v_suffix, jsonb_build_object(
    'id', 'txn-retry-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', 1000000, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('id', v_request.provider_request_id, 'reference', v_invoice.invoice_number)
  )) RETURNING * INTO v_retry_event;
  v_retry_event := public.process_jeko_payment_event(v_retry_event.id);
  IF v_retry_event.status <> 'FAILED' OR v_retry_event.last_error_code <> 'PJE11' THEN
    RAISE EXCEPTION 'Business failure after receipt must leave the event retryable';
  END IF;
  v_invoice := public.issue_transport_invoice(v_invoice.id);
  v_retry_event := public.process_jeko_payment_event(v_retry_event.id);
  IF v_retry_event.status <> 'PROCESSED' THEN
    RAISE EXCEPTION 'A later retry must process a previously received event once the business condition is restored';
  END IF;

  -- Commercial sales, including agriculture lines, reuse the same Jèko event
  -- table and the existing commercial payment confirmation engine.
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client.id,
    'sale_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Vente Jèko test ' || v_suffix,
      'quantity', 1,
      'unit', 'unité',
      'unit_price', 12000,
      'inventory_item_id', NULL,
      'harvest_id', NULL,
      'farm_id', NULL
    ))
  ));
  v_sale := public.confirm_commercial_sale(v_sale.id);
  v_commercial_invoice := public.create_commercial_invoice(v_sale.id, jsonb_build_object('tax_rate', 0));
  v_commercial_invoice := public.issue_commercial_invoice(v_commercial_invoice.id);

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_commercial_request := public.register_jeko_payment_request(jsonb_build_object(
    'invoice_kind', 'COMMERCIAL',
    'commercial_invoice_id', v_commercial_invoice.id,
    'provider_request_id', 'pr-commercial-' || v_suffix,
    'provider_reference', 'COMMERCIAL:' || v_commercial_invoice.invoice_number,
    'provider_store_id', 'store-test-' || v_suffix,
    'wallet_id', v_wallet_id,
    'expected_provider_amount', 1200000,
    'erp_amount', 12000,
    'currency', 'XOF'
  ));
  SELECT balance INTO v_before_balance FROM public.wallets WHERE id = v_wallet_id;
  INSERT INTO public.payment_events(provider, transaction_id, payload)
  VALUES ('JEKO', 'txn-commercial-' || v_suffix, jsonb_build_object(
    'id', 'txn-commercial-' || v_suffix,
    'status', 'success',
    'transactionType', 'payment',
    'amount', jsonb_build_object('amount', 1200000, 'currency', 'XOF'),
    'transactionDetails', jsonb_build_object('id', v_commercial_request.provider_request_id, 'reference', 'COMMERCIAL:' || v_commercial_invoice.invoice_number)
  )) RETURNING * INTO v_commercial_event;
  v_commercial_event := public.process_jeko_payment_event(v_commercial_event.id);
  IF v_commercial_event.status <> 'PROCESSED'
    OR v_commercial_event.commercial_payment_id IS NULL
    OR v_commercial_event.finance_operation_id IS NULL
    OR (SELECT status FROM public.commercial_invoices WHERE id = v_commercial_invoice.id) <> 'PAID'
    OR (SELECT balance FROM public.wallets WHERE id = v_wallet_id) <> v_before_balance + 12000
    OR (SELECT count(*) FROM public.finance_commercial_invoice_payment_links WHERE payment_id = v_commercial_event.commercial_payment_id AND link_type = 'PAYMENT') <> 1 THEN
    RAISE EXCEPTION 'Commercial Jèko payment must create exactly one commercial payment, finance operation and wallet credit';
  END IF;
END;
$test$;

ROLLBACK;
