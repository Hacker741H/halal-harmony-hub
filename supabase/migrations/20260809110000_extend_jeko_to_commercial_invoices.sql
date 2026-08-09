-- Extends the existing Jèko connector to commercial invoices, including
-- agriculture sales represented by commercial sale lines. It does not alter
-- wallet calculations: existing invoice payment engines remain authoritative.

ALTER TABLE public.payment_provider_payment_requests
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'TRANSPORT',
  ADD COLUMN IF NOT EXISTS commercial_invoice_id uuid REFERENCES public.commercial_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commercial_payment_id uuid UNIQUE REFERENCES public.commercial_invoice_payments(id) ON DELETE RESTRICT;

ALTER TABLE public.payment_provider_payment_requests
  ALTER COLUMN invoice_id DROP NOT NULL;

UPDATE public.payment_provider_payment_requests
SET source_type = 'TRANSPORT'
WHERE source_type IS NULL OR source_type NOT IN ('TRANSPORT', 'COMMERCIAL');

ALTER TABLE public.payment_provider_payment_requests
  DROP CONSTRAINT IF EXISTS payment_provider_payment_requests_source_type_check,
  ADD CONSTRAINT payment_provider_payment_requests_source_type_check
    CHECK (source_type IN ('TRANSPORT', 'COMMERCIAL')),
  DROP CONSTRAINT IF EXISTS payment_provider_payment_requests_exactly_one_invoice_check,
  ADD CONSTRAINT payment_provider_payment_requests_exactly_one_invoice_check
    CHECK (
      (source_type = 'TRANSPORT' AND invoice_id IS NOT NULL AND commercial_invoice_id IS NULL)
      OR (source_type = 'COMMERCIAL' AND invoice_id IS NULL AND commercial_invoice_id IS NOT NULL)
    );

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS commercial_invoice_id uuid REFERENCES public.commercial_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS commercial_payment_id uuid REFERENCES public.commercial_invoice_payments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS payment_provider_payment_requests_commercial_invoice_idx
  ON public.payment_provider_payment_requests(commercial_invoice_id, status)
  WHERE commercial_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_payment_requests_commercial_pending_unique
  ON public.payment_provider_payment_requests(provider, commercial_invoice_id)
  WHERE source_type = 'COMMERCIAL' AND status = 'PENDING';

CREATE OR REPLACE FUNCTION public._internal_create_commercial_invoice_payment(
  p_invoice_id uuid,
  p_payment jsonb,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_wallet_id uuid := NULLIF(p_payment ->> 'wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_payment ->> 'amount', '')::numeric;
  v_status text := upper(COALESCE(NULLIF(btrim(p_payment ->> 'status'), ''), 'PLANNED'));
  v_kind text := upper(COALESCE(NULLIF(btrim(p_payment ->> 'payment_kind'), ''), 'PAYMENT'));
  v_reserved numeric(14, 2);
BEGIN
  IF p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payment) AS key_name
    WHERE key_name NOT IN ('wallet_id', 'amount', 'payment_date', 'status', 'payment_kind', 'reference', 'notes')
  ) THEN
    RAISE EXCEPTION 'Les données de paiement sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise avant de recevoir un paiement.' USING ERRCODE = '22023';
  END IF;
  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE = '23503';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('PLANNED', 'RECEIVED') OR v_kind NOT IN ('DEPOSIT', 'PAYMENT', 'SETTLEMENT', 'REFUND') THEN
    RAISE EXCEPTION 'Le statut ou le type de paiement est invalide.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_reserved
  FROM public.commercial_invoice_payments
  WHERE invoice_id = p_invoice_id AND status IN ('PLANNED', 'RECEIVED', 'CONFIRMED');
  IF v_reserved + v_amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.commercial_invoice_payments(
    invoice_id, sale_id, wallet_id, amount, payment_date, status, payment_kind,
    reference, notes, created_by, updated_by
  ) VALUES (
    v_invoice.id, v_invoice.sale_id, v_wallet_id, v_amount,
    COALESCE(NULLIF(p_payment ->> 'payment_date', '')::date, current_date), v_status, v_kind,
    NULLIF(btrim(p_payment ->> 'reference'), ''), NULLIF(btrim(p_payment ->> 'notes'), ''), p_actor_id, p_actor_id
  ) RETURNING * INTO v_payment;
  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, NULL, 'CREATE', NULL, to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public._internal_confirm_commercial_invoice_payment(
  p_payment_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commercial_invoice_payments;
  v_payment public.commercial_invoice_payments;
  v_invoice public.commercial_invoices;
  v_sale public.commercial_sales;
  v_client public.transport_clients;
  v_operation public.finance_operations;
  v_confirmed numeric(14, 2);
BEGIN
  SELECT * INTO v_before FROM public.commercial_invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status = 'CONFIRMED' THEN RETURN v_before; END IF;
  IF v_before.status NOT IN ('PLANNED', 'RECEIVED') THEN
    RAISE EXCEPTION 'Seul un paiement prévu ou reçu peut être confirmé.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_commercial_invoice_payment_links
    WHERE payment_id = v_before.id AND link_type = 'PAYMENT'
  ) THEN
    RAISE EXCEPTION 'Une écriture financière existe déjà pour ce paiement.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_invoice FROM public.commercial_invoices WHERE id = v_before.invoice_id FOR UPDATE;
  IF v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise pour confirmer un paiement.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sale FROM public.commercial_sales WHERE id = v_before.sale_id;
  SELECT * INTO v_client FROM public.transport_clients WHERE id = v_invoice.client_id;
  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.commercial_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';
  IF v_confirmed + v_before.amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  v_operation := public.finance_create_operation(
    jsonb_build_object(
      'type', 'REVENUE',
      'amount', v_before.amount,
      'wallet_id', v_before.wallet_id,
      'operation_date', v_before.payment_date,
      'category', 'VENTE COMMERCIALE',
      'description', 'Encaissement facture ' || v_invoice.invoice_number,
      'reference', COALESCE(v_before.reference, v_before.id::text),
      'status', 'VALIDE',
      'origin', 'COMMERCIAL_PAYMENT',
      'module', 'COMMERCIAL_INVOICE_PAYMENT',
      'module_id', v_before.id,
      'farm_id', v_sale.farm_id,
      'client', v_client.display_name
    ),
    'COMMERCIAL_INVOICE_PAYMENT',
    v_before.id
  );
  INSERT INTO public.finance_commercial_invoice_payment_links(payment_id, operation_id, link_type)
  VALUES (v_before.id, v_operation.id, 'PAYMENT');

  UPDATE public.commercial_invoice_payments
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = p_actor_id, updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_payment;

  v_confirmed := v_confirmed + v_payment.amount;
  UPDATE public.commercial_invoices
  SET status = CASE WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event('COMMERCIAL_PAYMENT', v_payment.id, v_operation.id, 'UPDATE', to_jsonb(v_before), to_jsonb(v_payment));
  RETURN v_payment;
END;
$function$;

-- The existing user-facing RPC signatures and permission checks stay unchanged.
CREATE OR REPLACE FUNCTION public.create_commercial_invoice_payment(p_invoice_id uuid, p_payment jsonb)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('sales.payments');
  RETURN public._internal_create_commercial_invoice_payment(p_invoice_id, p_payment, auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_commercial_invoice_payment(p_payment_id uuid)
RETURNS public.commercial_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  PERFORM public.permission_require('sales.payments');
  PERFORM public.permission_require('finance.create');
  RETURN public._internal_confirm_commercial_invoice_payment(p_payment_id, auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_jeko_payment_request(p_request jsonb)
RETURNS public.payment_provider_payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_request public.payment_provider_payment_requests;
  v_transport_invoice public.transport_invoices;
  v_commercial_invoice public.commercial_invoices;
  v_transport_invoice_id uuid := NULLIF(p_request ->> 'invoice_id', '')::uuid;
  v_commercial_invoice_id uuid := NULLIF(p_request ->> 'commercial_invoice_id', '')::uuid;
  v_kind text := upper(COALESCE(NULLIF(btrim(p_request ->> 'invoice_kind'), ''), 'TRANSPORT'));
  v_reference text := NULLIF(btrim(p_request ->> 'provider_reference'), '');
  v_confirmed numeric;
  v_expected_reference text;
  v_total numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Accès réservé au serveur d’intégration.' USING ERRCODE = '42501';
  END IF;
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR NULLIF(btrim(p_request ->> 'provider_request_id'), '') IS NULL
    OR v_reference IS NULL
    OR NULLIF(btrim(p_request ->> 'provider_store_id'), '') IS NULL
    OR NULLIF(p_request ->> 'wallet_id', '') IS NULL
    OR NULLIF(p_request ->> 'expected_provider_amount', '') IS NULL
    OR NULLIF(p_request ->> 'erp_amount', '') IS NULL THEN
    RAISE EXCEPTION 'Enregistrement Jèko incomplet.' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('TRANSPORT', 'COMMERCIAL') THEN
    RAISE EXCEPTION 'Le type de facture Jèko est invalide.' USING ERRCODE = '22023';
  END IF;
  IF (v_kind = 'TRANSPORT' AND (v_transport_invoice_id IS NULL OR v_commercial_invoice_id IS NOT NULL))
    OR (v_kind = 'COMMERCIAL' AND (v_commercial_invoice_id IS NULL OR v_transport_invoice_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'La source de facture Jèko est incohérente.' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'TRANSPORT' THEN
    SELECT * INTO v_transport_invoice FROM public.transport_invoices WHERE id = v_transport_invoice_id FOR UPDATE;
    IF NOT FOUND OR v_transport_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
      RAISE EXCEPTION 'La facture Jèko doit être émise et non soldée.' USING ERRCODE = '22023';
    END IF;
    v_expected_reference := v_transport_invoice.invoice_number;
    v_total := v_transport_invoice.total_amount;
    SELECT COALESCE(sum(amount), 0) INTO v_confirmed
    FROM public.transport_invoice_payments
    WHERE invoice_id = v_transport_invoice.id AND status = 'CONFIRMED';
  ELSE
    SELECT * INTO v_commercial_invoice FROM public.commercial_invoices WHERE id = v_commercial_invoice_id FOR UPDATE;
    IF NOT FOUND OR v_commercial_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
      RAISE EXCEPTION 'La facture Jèko doit être émise et non soldée.' USING ERRCODE = '22023';
    END IF;
    v_expected_reference := 'COMMERCIAL:' || v_commercial_invoice.invoice_number;
    v_total := v_commercial_invoice.total_amount;
    SELECT COALESCE(sum(amount), 0) INTO v_confirmed
    FROM public.commercial_invoice_payments
    WHERE invoice_id = v_commercial_invoice.id AND status = 'CONFIRMED';
  END IF;
  IF v_reference <> v_expected_reference THEN
    RAISE EXCEPTION 'La référence Jèko ne correspond pas à la facture ERP.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_provider_wallet_mappings mapping
    WHERE mapping.provider = 'JEKO'
      AND mapping.provider_store_id = btrim(p_request ->> 'provider_store_id')
      AND mapping.wallet_id = (p_request ->> 'wallet_id')::uuid
      AND mapping.is_active
  ) THEN
    RAISE EXCEPTION 'Le wallet n’est pas autorisé pour ce magasin Jèko.' USING ERRCODE = '42501';
  END IF;
  IF upper(COALESCE(NULLIF(btrim(p_request ->> 'currency'), ''), 'XOF')) <> 'XOF' THEN
    RAISE EXCEPTION 'Seule la devise XOF est autorisée pour les factures ERP actuelles.' USING ERRCODE = '22023';
  END IF;
  IF (p_request ->> 'expected_provider_amount')::numeric <= 0 OR (p_request ->> 'erp_amount')::numeric <= 0 THEN
    RAISE EXCEPTION 'Les montants Jèko sont invalides.' USING ERRCODE = '22023';
  END IF;
  IF (p_request ->> 'erp_amount')::numeric > v_total - v_confirmed THEN
    RAISE EXCEPTION 'Le montant ERP Jèko dépasse le solde de la facture.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_provider_payment_requests(
    provider, provider_request_id, provider_reference, provider_store_id, source_type,
    invoice_id, commercial_invoice_id, wallet_id, expected_provider_amount, erp_amount, currency
  ) VALUES (
    'JEKO', btrim(p_request ->> 'provider_request_id'), v_reference, btrim(p_request ->> 'provider_store_id'), v_kind,
    v_transport_invoice_id, v_commercial_invoice_id, (p_request ->> 'wallet_id')::uuid,
    (p_request ->> 'expected_provider_amount')::numeric, (p_request ->> 'erp_amount')::numeric,
    upper(COALESCE(NULLIF(btrim(p_request ->> 'currency'), ''), 'XOF'))
  ) ON CONFLICT (provider, provider_request_id) DO NOTHING
  RETURNING * INTO v_request;

  IF v_request.id IS NULL THEN
    SELECT * INTO v_request FROM public.payment_provider_payment_requests
    WHERE provider = 'JEKO' AND provider_request_id = btrim(p_request ->> 'provider_request_id');
    IF v_request.provider_reference <> v_reference
      OR v_request.source_type <> v_kind
      OR v_request.invoice_id IS DISTINCT FROM v_transport_invoice_id
      OR v_request.commercial_invoice_id IS DISTINCT FROM v_commercial_invoice_id
      OR v_request.wallet_id <> (p_request ->> 'wallet_id')::uuid
      OR v_request.expected_provider_amount <> (p_request ->> 'expected_provider_amount')::numeric
      OR v_request.erp_amount <> (p_request ->> 'erp_amount')::numeric
      OR v_request.currency <> upper(COALESCE(NULLIF(btrim(p_request ->> 'currency'), ''), 'XOF')) THEN
      RAISE EXCEPTION 'La demande Jèko existe avec des données différentes.' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_jeko_payment_event(p_event_id uuid)
RETURNS public.payment_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_event public.payment_events;
  v_request public.payment_provider_payment_requests;
  v_transport_invoice public.transport_invoices;
  v_transport_payment public.transport_invoice_payments;
  v_commercial_invoice public.commercial_invoices;
  v_commercial_payment public.commercial_invoice_payments;
  v_operation_id uuid;
  v_provider_amount numeric;
  v_currency text;
  v_reference text;
  v_provider_request_id text;
  v_kind text;
  v_status text;
  v_error_code text;
  v_error_message text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Accès réservé au serveur d’intégration.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM public.payment_events WHERE id = p_event_id AND provider = 'JEKO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Événement Jèko introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_event.status = 'PROCESSED' THEN RETURN v_event; END IF;

  UPDATE public.payment_events
  SET status = 'PROCESSING', attempt_count = attempt_count + 1, processing_started_at = now(),
      last_error_code = NULL, last_error_message = NULL, updated_at = now()
  WHERE id = v_event.id RETURNING * INTO v_event;

  BEGIN
    v_status := lower(COALESCE(v_event.payload ->> 'status', ''));
    v_kind := lower(regexp_replace(COALESCE(v_event.payload ->> 'transactionType', ''), '[[:space:]_-]', '', 'g'));
    v_reference := NULLIF(btrim(v_event.payload #>> '{transactionDetails,reference}'), '');
    v_provider_request_id := NULLIF(btrim(v_event.payload #>> '{transactionDetails,id}'), '');
    v_provider_amount := NULLIF(v_event.payload #>> '{amount,amount}', '')::numeric;
    v_currency := upper(NULLIF(btrim(v_event.payload #>> '{amount,currency}'), ''));

    IF v_status <> 'success' THEN
      UPDATE public.payment_events SET status = 'PROCESSED', reference = v_reference, provider_request_id = v_provider_request_id,
        provider_amount = v_provider_amount, currency = v_currency, processing_note = 'IGNORED_NON_SUCCESS', processed_at = now(), updated_at = now()
      WHERE id = v_event.id RETURNING * INTO v_event;
      RETURN v_event;
    END IF;
    IF v_kind = 'transfer' THEN
      UPDATE public.payment_events SET status = 'PROCESSED', reference = v_reference, provider_request_id = v_provider_request_id,
        provider_amount = v_provider_amount, currency = v_currency, processing_note = 'TRANSFER_IGNORED_BY_INVOICE_FLOW', processed_at = now(), updated_at = now()
      WHERE id = v_event.id RETURNING * INTO v_event;
      RETURN v_event;
    END IF;
    IF v_kind NOT IN ('payment', 'paymentrequest') THEN RAISE EXCEPTION 'Type de transaction Jèko non pris en charge.' USING ERRCODE = 'PJEK1'; END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'La référence de facture Jèko est absente.' USING ERRCODE = 'PJEK2'; END IF;
    IF v_provider_request_id IS NULL THEN RAISE EXCEPTION 'L’identifiant de demande Jèko est absent.' USING ERRCODE = 'PJEK3'; END IF;
    IF v_provider_amount IS NULL OR v_provider_amount <= 0 OR v_currency IS NULL THEN RAISE EXCEPTION 'Le montant ou la devise Jèko est invalide.' USING ERRCODE = 'PJEK4'; END IF;

    SELECT * INTO v_request FROM public.payment_provider_payment_requests
    WHERE provider = 'JEKO' AND provider_request_id = v_provider_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La demande de paiement Jèko n’est pas enregistrée.' USING ERRCODE = 'PJEK5'; END IF;
    IF v_request.status = 'COMPLETED'
      OR (v_request.source_type = 'TRANSPORT' AND v_request.payment_id IS NOT NULL)
      OR (v_request.source_type = 'COMMERCIAL' AND v_request.commercial_payment_id IS NOT NULL) THEN
      RAISE EXCEPTION 'La demande de paiement Jèko a déjà été comptabilisée.' USING ERRCODE = 'PJEK6';
    END IF;
    IF v_request.provider_reference <> v_reference THEN RAISE EXCEPTION 'La référence Jèko ne correspond pas à la demande enregistrée.' USING ERRCODE = 'PJEK7'; END IF;
    IF v_request.expected_provider_amount <> v_provider_amount THEN RAISE EXCEPTION 'Le montant Jèko ne correspond pas à la demande enregistrée.' USING ERRCODE = 'PJEK8'; END IF;
    IF v_request.currency <> v_currency THEN RAISE EXCEPTION 'La devise Jèko ne correspond pas à la demande enregistrée.' USING ERRCODE = 'PJEK9'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_request.wallet_id) THEN RAISE EXCEPTION 'Le wallet de destination Jèko est introuvable.' USING ERRCODE = 'PJE12'; END IF;

    IF v_request.source_type = 'TRANSPORT' THEN
      SELECT * INTO v_transport_invoice FROM public.transport_invoices
      WHERE id = v_request.invoice_id AND invoice_number = v_reference FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'La facture ERP est introuvable ou incohérente.' USING ERRCODE = 'PJE10'; END IF;
      IF v_transport_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN RAISE EXCEPTION 'La facture ERP ne peut pas recevoir ce paiement.' USING ERRCODE = 'PJE11'; END IF;
      v_transport_payment := public._internal_create_transport_invoice_payment(
        v_transport_invoice.id,
        jsonb_build_object('wallet_id', v_request.wallet_id, 'amount', v_request.erp_amount, 'payment_date', current_date,
          'status', 'RECEIVED', 'payment_kind', 'PAYMENT', 'reference', 'JEKO:' || v_event.transaction_id,
          'notes', 'Paiement Jèko confirmé. Référence facture : ' || v_reference),
        NULL
      );
      v_transport_payment := public._internal_confirm_transport_invoice_payment(v_transport_payment.id, NULL);
      SELECT operation_id INTO v_operation_id FROM public.finance_transport_payment_links
      WHERE payment_id = v_transport_payment.id AND link_type = 'PAYMENT';
      IF v_operation_id IS NULL THEN RAISE EXCEPTION 'Le moteur financier n’a pas créé le lien de paiement attendu.' USING ERRCODE = 'PJE13'; END IF;
      UPDATE public.payment_provider_payment_requests SET status = 'COMPLETED', payment_id = v_transport_payment.id, completed_at = now(), updated_at = now() WHERE id = v_request.id;
      UPDATE public.payment_events SET status = 'PROCESSED', reference = v_reference, provider_request_id = v_provider_request_id,
        provider_amount = v_provider_amount, currency = v_currency, invoice_id = v_transport_invoice.id, payment_id = v_transport_payment.id,
        finance_operation_id = v_operation_id, processing_note = 'TRANSPORT_PAYMENT_CONFIRMED', processed_at = now(), updated_at = now()
      WHERE id = v_event.id RETURNING * INTO v_event;
    ELSIF v_request.source_type = 'COMMERCIAL' THEN
      SELECT * INTO v_commercial_invoice FROM public.commercial_invoices
      WHERE id = v_request.commercial_invoice_id AND ('COMMERCIAL:' || invoice_number) = v_reference FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'La facture commerciale ERP est introuvable ou incohérente.' USING ERRCODE = 'PJE10'; END IF;
      IF v_commercial_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN RAISE EXCEPTION 'La facture commerciale ERP ne peut pas recevoir ce paiement.' USING ERRCODE = 'PJE11'; END IF;
      v_commercial_payment := public._internal_create_commercial_invoice_payment(
        v_commercial_invoice.id,
        jsonb_build_object('wallet_id', v_request.wallet_id, 'amount', v_request.erp_amount, 'payment_date', current_date,
          'status', 'RECEIVED', 'payment_kind', 'PAYMENT', 'reference', 'JEKO:' || v_event.transaction_id,
          'notes', 'Paiement Jèko confirmé. Référence facture : ' || v_commercial_invoice.invoice_number),
        NULL
      );
      v_commercial_payment := public._internal_confirm_commercial_invoice_payment(v_commercial_payment.id, NULL);
      SELECT operation_id INTO v_operation_id FROM public.finance_commercial_invoice_payment_links
      WHERE payment_id = v_commercial_payment.id AND link_type = 'PAYMENT';
      IF v_operation_id IS NULL THEN RAISE EXCEPTION 'Le moteur financier n’a pas créé le lien de paiement attendu.' USING ERRCODE = 'PJE13'; END IF;
      UPDATE public.payment_provider_payment_requests SET status = 'COMPLETED', commercial_payment_id = v_commercial_payment.id, completed_at = now(), updated_at = now() WHERE id = v_request.id;
      UPDATE public.payment_events SET status = 'PROCESSED', reference = v_reference, provider_request_id = v_provider_request_id,
        provider_amount = v_provider_amount, currency = v_currency, commercial_invoice_id = v_commercial_invoice.id,
        commercial_payment_id = v_commercial_payment.id, finance_operation_id = v_operation_id,
        processing_note = 'COMMERCIAL_PAYMENT_CONFIRMED', processed_at = now(), updated_at = now()
      WHERE id = v_event.id RETURNING * INTO v_event;
    ELSE
      RAISE EXCEPTION 'La source de demande Jèko est inconnue.' USING ERRCODE = 'PJEK14';
    END IF;

    PERFORM public.business_finance_audit_event(
      'PAYMENT_PROVIDER_EVENT', v_event.id, v_operation_id, 'UPDATE', NULL,
      jsonb_build_object('provider', 'JEKO', 'transaction_id', v_event.transaction_id, 'reference', v_reference,
        'provider_amount', v_provider_amount, 'currency', v_currency, 'source_type', v_request.source_type)
    );
    RETURN v_event;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE, v_error_message = MESSAGE_TEXT;
    UPDATE public.payment_events SET status = 'FAILED', last_error_code = v_error_code,
      last_error_message = left(v_error_message, 1000), updated_at = now()
    WHERE id = v_event.id RETURNING * INTO v_event;
    RETURN v_event;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_create_commercial_invoice_payment(uuid, jsonb, uuid),
  public._internal_confirm_commercial_invoice_payment(uuid, uuid),
  public.register_jeko_payment_request(jsonb),
  public.process_jeko_payment_event(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_commercial_invoice_payment(uuid, jsonb),
  public.confirm_commercial_invoice_payment(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_commercial_invoice_payment(uuid, jsonb),
  public.confirm_commercial_invoice_payment(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_jeko_payment_request(jsonb),
  public.process_jeko_payment_event(uuid)
  TO service_role;
