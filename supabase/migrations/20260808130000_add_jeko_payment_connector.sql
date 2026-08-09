-- Jèko connector infrastructure.
-- This migration does not alter ERP financial rules: confirmed Course payments
-- still use the existing Course payment engine and finance link mechanism.

CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  transaction_id text NOT NULL,
  event_type text NOT NULL DEFAULT 'transaction.completed',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  reference text,
  provider_request_id text,
  provider_amount numeric(18, 4),
  currency text,
  invoice_id uuid REFERENCES public.transport_invoices(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.transport_invoice_payments(id) ON DELETE RESTRICT,
  finance_operation_id uuid REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  last_error_message text,
  processing_note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_provider_transaction_unique UNIQUE (provider, transaction_id),
  CONSTRAINT payment_events_provider_check CHECK (provider = 'JEKO'),
  CONSTRAINT payment_events_status_check CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
  CONSTRAINT payment_events_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

-- Jèko does not include an ERP wallet identifier in a webhook. These mappings
-- bind a Jèko store to a wallet before any remote payment is initiated.
CREATE TABLE IF NOT EXISTS public.payment_provider_wallet_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'JEKO',
  provider_store_id text NOT NULL,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_provider_wallet_mappings_provider_check CHECK (provider = 'JEKO'),
  CONSTRAINT payment_provider_wallet_mappings_provider_store_unique UNIQUE (provider, provider_store_id)
);

-- A registered remote request is the authoritative binding between a Jèko
-- payment request, the ERP invoice and its destination wallet. Provider amount
-- and ERP amount are kept separate because Jèko documents amountCents for API
-- initiation while ERP financial values are expressed in FCFA.
CREATE TABLE IF NOT EXISTS public.payment_provider_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'JEKO',
  provider_request_id text NOT NULL,
  provider_reference text NOT NULL,
  provider_store_id text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.transport_invoices(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  expected_provider_amount numeric(18, 4) NOT NULL CHECK (expected_provider_amount > 0),
  erp_amount numeric(14, 2) NOT NULL CHECK (erp_amount > 0),
  currency text NOT NULL DEFAULT 'XOF' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'PENDING',
  payment_id uuid UNIQUE REFERENCES public.transport_invoice_payments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT payment_provider_payment_requests_provider_check CHECK (provider = 'JEKO'),
  CONSTRAINT payment_provider_payment_requests_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  CONSTRAINT payment_provider_payment_requests_provider_request_unique UNIQUE (provider, provider_request_id)
);

CREATE INDEX IF NOT EXISTS payment_events_status_received_idx
  ON public.payment_events(status, received_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_reference_idx
  ON public.payment_events(provider, reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_provider_payment_requests_invoice_idx
  ON public.payment_provider_payment_requests(invoice_id, status);

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_wallet_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_payment_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_events, public.payment_provider_wallet_mappings,
  public.payment_provider_payment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_events,
  public.payment_provider_wallet_mappings, public.payment_provider_payment_requests TO service_role;

-- The two internal helpers contain the existing Course payment lifecycle. The
-- public RPCs below remain permission-gated and keep their original signatures.
CREATE OR REPLACE FUNCTION public._internal_create_transport_invoice_payment(
  p_invoice_id uuid,
  p_payment jsonb,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_create_transport_invoice_payment$
DECLARE
  v_invoice public.transport_invoices;
  v_payment public.transport_invoice_payments;
BEGIN
  SELECT * INTO v_invoice
  FROM public.transport_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND OR v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture doit être émise avant de recevoir un paiement.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_payment ->> 'wallet_id', '') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = (p_payment ->> 'wallet_id')::uuid) THEN
    RAISE EXCEPTION 'Un wallet valide est obligatoire.' USING ERRCODE = '23503';
  END IF;
  IF NULLIF(p_payment ->> 'amount', '') IS NULL OR (p_payment ->> 'amount')::numeric <= 0 THEN
    RAISE EXCEPTION 'Le montant du paiement est invalide.' USING ERRCODE = '22023';
  END IF;
  IF (p_payment ->> 'amount')::numeric > v_invoice.total_amount - COALESCE((
    SELECT sum(amount) FROM public.transport_invoice_payments
    WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED'
  ), 0) THEN
    RAISE EXCEPTION 'Le surpaiement est bloqué.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.transport_invoice_payments(
    invoice_id, mission_id, wallet_id, amount, payment_date, status, payment_kind,
    reference, notes, created_by, updated_by
  ) VALUES (
    v_invoice.id,
    v_invoice.mission_id,
    (p_payment ->> 'wallet_id')::uuid,
    (p_payment ->> 'amount')::numeric,
    COALESCE(NULLIF(p_payment ->> 'payment_date', '')::date, current_date),
    COALESCE(NULLIF(upper(p_payment ->> 'status'), ''), 'PLANNED'),
    COALESCE(NULLIF(upper(p_payment ->> 'payment_kind'), ''), 'PAYMENT'),
    NULLIF(btrim(p_payment ->> 'reference'), ''),
    NULLIF(btrim(p_payment ->> 'notes'), ''),
    p_actor_id,
    p_actor_id
  ) RETURNING * INTO v_payment;

  IF v_payment.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Un paiement doit être confirmé par la commande dédiée.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.business_finance_audit_event(
    'COURSE_PAYMENT', v_payment.id, NULL, 'CREATE', NULL,
    to_jsonb(v_payment)
  );
  RETURN v_payment;
END;
$internal_create_transport_invoice_payment$;

CREATE OR REPLACE FUNCTION public._internal_confirm_transport_invoice_payment(
  p_payment_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_confirm_transport_invoice_payment$
DECLARE
  v_before public.transport_invoice_payments;
  v_payment public.transport_invoice_payments;
  v_invoice public.transport_invoices;
  v_mission public.transport_missions;
  v_operation public.finance_operations;
  v_confirmed numeric;
BEGIN
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
    RAISE EXCEPTION 'Un paiement daté dans le futur doit rester prévu ou reçu jusqu’à sa date effective.' USING ERRCODE = '22023';
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
    SELECT 1 FROM public.finance_transport_payment_links
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
  SET status = 'CONFIRMED', confirmed_at = now(), updated_by = p_actor_id, updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_payment;

  v_confirmed := v_confirmed + v_payment.amount;
  UPDATE public.transport_invoices
  SET status = CASE WHEN v_confirmed >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = v_invoice.id;

  PERFORM public.business_finance_audit_event(
    'COURSE_PAYMENT', v_payment.id, v_operation.id, 'UPDATE',
    to_jsonb(v_before), to_jsonb(v_payment)
  );
  RETURN v_payment;
END;
$internal_confirm_transport_invoice_payment$;

CREATE OR REPLACE FUNCTION public.create_transport_invoice_payment(p_invoice_id uuid, p_payment jsonb)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $create_transport_invoice_payment$
BEGIN
  PERFORM public.permission_require('missions.payments');
  RETURN public._internal_create_transport_invoice_payment(p_invoice_id, p_payment, auth.uid());
END;
$create_transport_invoice_payment$;

CREATE OR REPLACE FUNCTION public.confirm_transport_invoice_payment(p_payment_id uuid)
RETURNS public.transport_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $confirm_transport_invoice_payment$
BEGIN
  PERFORM public.permission_require('missions.payments');
  RETURN public._internal_confirm_transport_invoice_payment(p_payment_id, auth.uid());
END;
$confirm_transport_invoice_payment$;

-- Registration happens immediately after a trusted server creates a Jèko
-- payment request. It establishes the only accepted wallet and amount before
-- any provider webhook can lead to an ERP payment.
CREATE OR REPLACE FUNCTION public.register_jeko_payment_request(p_request jsonb)
RETURNS public.payment_provider_payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $register_jeko_payment_request$
DECLARE
  v_request public.payment_provider_payment_requests;
  v_invoice public.transport_invoices;
  v_confirmed numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Accès réservé au serveur d’intégration.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_request ->> 'provider_request_id'), '') IS NULL
    OR NULLIF(btrim(p_request ->> 'provider_reference'), '') IS NULL
    OR NULLIF(btrim(p_request ->> 'provider_store_id'), '') IS NULL
    OR NULLIF(p_request ->> 'invoice_id', '') IS NULL
    OR NULLIF(p_request ->> 'wallet_id', '') IS NULL
    OR NULLIF(p_request ->> 'expected_provider_amount', '') IS NULL
    OR NULLIF(p_request ->> 'erp_amount', '') IS NULL THEN
    RAISE EXCEPTION 'Enregistrement Jèko incomplet.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice
  FROM public.transport_invoices
  WHERE id = (p_request ->> 'invoice_id')::uuid
  FOR UPDATE;
  IF NOT FOUND OR v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'La facture Jèko doit être émise et non soldée.' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.invoice_number <> btrim(p_request ->> 'provider_reference') THEN
    RAISE EXCEPTION 'La référence Jèko doit correspondre exactement au numéro de facture.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_provider_wallet_mappings mapping
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
  IF (p_request ->> 'expected_provider_amount')::numeric <= 0
    OR (p_request ->> 'erp_amount')::numeric <= 0 THEN
    RAISE EXCEPTION 'Les montants Jèko sont invalides.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_confirmed
  FROM public.transport_invoice_payments
  WHERE invoice_id = v_invoice.id AND status = 'CONFIRMED';
  IF (p_request ->> 'erp_amount')::numeric > v_invoice.total_amount - v_confirmed THEN
    RAISE EXCEPTION 'Le montant ERP Jèko dépasse le solde de la facture.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_provider_payment_requests(
    provider, provider_request_id, provider_reference, provider_store_id, invoice_id,
    wallet_id, expected_provider_amount, erp_amount, currency
  ) VALUES (
    'JEKO',
    btrim(p_request ->> 'provider_request_id'),
    btrim(p_request ->> 'provider_reference'),
    btrim(p_request ->> 'provider_store_id'),
    (p_request ->> 'invoice_id')::uuid,
    (p_request ->> 'wallet_id')::uuid,
    (p_request ->> 'expected_provider_amount')::numeric,
    (p_request ->> 'erp_amount')::numeric,
    upper(COALESCE(NULLIF(btrim(p_request ->> 'currency'), ''), 'XOF'))
  ) ON CONFLICT (provider, provider_request_id) DO NOTHING
  RETURNING * INTO v_request;

  IF v_request.id IS NULL THEN
    SELECT * INTO v_request
    FROM public.payment_provider_payment_requests
    WHERE provider = 'JEKO'
      AND provider_request_id = btrim(p_request ->> 'provider_request_id');
    IF v_request.provider_reference <> btrim(p_request ->> 'provider_reference')
      OR v_request.invoice_id <> (p_request ->> 'invoice_id')::uuid
      OR v_request.wallet_id <> (p_request ->> 'wallet_id')::uuid
      OR v_request.expected_provider_amount <> (p_request ->> 'expected_provider_amount')::numeric
      OR v_request.erp_amount <> (p_request ->> 'erp_amount')::numeric
      OR v_request.currency <> upper(COALESCE(NULLIF(btrim(p_request ->> 'currency'), ''), 'XOF')) THEN
      RAISE EXCEPTION 'La demande Jèko existe avec des données différentes.' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN v_request;
END;
$register_jeko_payment_request$;

-- The webhook bridge can only be invoked with the service-role JWT used by the
-- Edge Function. It takes a previously verified, persisted event ID; it does
-- not accept a wallet, amount or invoice from the caller.
CREATE OR REPLACE FUNCTION public.process_jeko_payment_event(p_event_id uuid)
RETURNS public.payment_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $process_jeko_payment_event$
DECLARE
  v_event public.payment_events;
  v_request public.payment_provider_payment_requests;
  v_invoice public.transport_invoices;
  v_payment public.transport_invoice_payments;
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

  SELECT * INTO v_event
  FROM public.payment_events
  WHERE id = p_event_id AND provider = 'JEKO'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Événement Jèko introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'PROCESSED' THEN
    RETURN v_event;
  END IF;

  UPDATE public.payment_events
  SET status = 'PROCESSING',
      attempt_count = attempt_count + 1,
      processing_started_at = now(),
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = now()
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  BEGIN
    v_status := lower(COALESCE(v_event.payload ->> 'status', ''));
    v_kind := lower(regexp_replace(COALESCE(v_event.payload ->> 'transactionType', ''), '[[:space:]_-]', '', 'g'));
    v_reference := NULLIF(btrim(v_event.payload #>> '{transactionDetails,reference}'), '');
    v_provider_request_id := NULLIF(btrim(v_event.payload #>> '{transactionDetails,id}'), '');
    v_provider_amount := NULLIF(v_event.payload #>> '{amount,amount}', '')::numeric;
    v_currency := upper(NULLIF(btrim(v_event.payload #>> '{amount,currency}'), ''));

    IF v_status <> 'success' THEN
      UPDATE public.payment_events
      SET status = 'PROCESSED',
          reference = v_reference,
          provider_request_id = v_provider_request_id,
          provider_amount = v_provider_amount,
          currency = v_currency,
          processing_note = 'IGNORED_NON_SUCCESS',
          processed_at = now(),
          updated_at = now()
      WHERE id = v_event.id
      RETURNING * INTO v_event;
      RETURN v_event;
    END IF;

    IF v_kind = 'transfer' THEN
      UPDATE public.payment_events
      SET status = 'PROCESSED',
          reference = v_reference,
          provider_request_id = v_provider_request_id,
          provider_amount = v_provider_amount,
          currency = v_currency,
          processing_note = 'TRANSFER_IGNORED_BY_INVOICE_FLOW',
          processed_at = now(),
          updated_at = now()
      WHERE id = v_event.id
      RETURNING * INTO v_event;
      RETURN v_event;
    END IF;
    IF v_kind NOT IN ('payment', 'paymentrequest') THEN
      RAISE EXCEPTION 'Type de transaction Jèko non pris en charge.' USING ERRCODE = 'PJEK1';
    END IF;
    IF v_reference IS NULL THEN
      RAISE EXCEPTION 'La référence de facture Jèko est absente.' USING ERRCODE = 'PJEK2';
    END IF;
    IF v_provider_request_id IS NULL THEN
      RAISE EXCEPTION 'L’identifiant de demande Jèko est absent.' USING ERRCODE = 'PJEK3';
    END IF;
    IF v_provider_amount IS NULL OR v_provider_amount <= 0 OR v_currency IS NULL THEN
      RAISE EXCEPTION 'Le montant ou la devise Jèko est invalide.' USING ERRCODE = 'PJEK4';
    END IF;

    SELECT * INTO v_request
    FROM public.payment_provider_payment_requests
    WHERE provider = 'JEKO'
      AND provider_request_id = v_provider_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La demande de paiement Jèko n’est pas enregistrée.' USING ERRCODE = 'PJEK5';
    END IF;
    IF v_request.status = 'COMPLETED' OR v_request.payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'La demande de paiement Jèko a déjà été comptabilisée.' USING ERRCODE = 'PJEK6';
    END IF;
    IF v_request.provider_reference <> v_reference THEN
      RAISE EXCEPTION 'La référence Jèko ne correspond pas à la demande enregistrée.' USING ERRCODE = 'PJEK7';
    END IF;
    IF v_request.expected_provider_amount <> v_provider_amount THEN
      RAISE EXCEPTION 'Le montant Jèko ne correspond pas à la demande enregistrée.' USING ERRCODE = 'PJEK8';
    END IF;
    IF v_request.currency <> v_currency THEN
      RAISE EXCEPTION 'La devise Jèko ne correspond pas à la demande enregistrée.' USING ERRCODE = 'PJEK9';
    END IF;

    SELECT * INTO v_invoice
    FROM public.transport_invoices
    WHERE id = v_request.invoice_id AND invoice_number = v_reference
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La facture ERP est introuvable ou incohérente.' USING ERRCODE = 'PJE10';
    END IF;
    IF v_invoice.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
      RAISE EXCEPTION 'La facture ERP ne peut pas recevoir ce paiement.' USING ERRCODE = 'PJE11';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_request.wallet_id) THEN
      RAISE EXCEPTION 'Le wallet de destination Jèko est introuvable.' USING ERRCODE = 'PJE12';
    END IF;

    v_payment := public._internal_create_transport_invoice_payment(
      v_invoice.id,
      jsonb_build_object(
        'wallet_id', v_request.wallet_id,
        'amount', v_request.erp_amount,
        'payment_date', current_date,
        'status', 'RECEIVED',
        'payment_kind', 'PAYMENT',
        'reference', 'JEKO:' || v_event.transaction_id,
        'notes', 'Paiement Jèko confirmé. Référence facture : ' || v_reference
      ),
      NULL
    );
    v_payment := public._internal_confirm_transport_invoice_payment(v_payment.id, NULL);

    SELECT operation_id INTO v_operation_id
    FROM public.finance_transport_payment_links
    WHERE payment_id = v_payment.id AND link_type = 'PAYMENT';
    IF v_operation_id IS NULL THEN
      RAISE EXCEPTION 'Le moteur financier n’a pas créé le lien de paiement attendu.' USING ERRCODE = 'PJE13';
    END IF;

    UPDATE public.payment_provider_payment_requests
    SET status = 'COMPLETED', payment_id = v_payment.id, completed_at = now(), updated_at = now()
    WHERE id = v_request.id;

    UPDATE public.payment_events
    SET status = 'PROCESSED',
        reference = v_reference,
        provider_request_id = v_provider_request_id,
        provider_amount = v_provider_amount,
        currency = v_currency,
        invoice_id = v_invoice.id,
        payment_id = v_payment.id,
        finance_operation_id = v_operation_id,
        processing_note = 'PAYMENT_CONFIRMED',
        processed_at = now(),
        updated_at = now()
    WHERE id = v_event.id
    RETURNING * INTO v_event;

    PERFORM public.business_finance_audit_event(
      'PAYMENT_PROVIDER_EVENT',
      v_event.id,
      v_operation_id,
      'UPDATE',
      NULL,
      jsonb_build_object(
        'provider', 'JEKO',
        'transaction_id', v_event.transaction_id,
        'reference', v_reference,
        'provider_amount', v_provider_amount,
        'currency', v_currency,
        'invoice_id', v_invoice.id,
        'payment_id', v_payment.id
      )
    );
    RETURN v_event;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE, v_error_message = MESSAGE_TEXT;
    UPDATE public.payment_events
    SET status = 'FAILED',
        last_error_code = v_error_code,
        last_error_message = left(v_error_message, 1000),
        updated_at = now()
    WHERE id = v_event.id
    RETURNING * INTO v_event;
    RETURN v_event;
  END;
END;
$process_jeko_payment_event$;

REVOKE ALL ON FUNCTION public._internal_create_transport_invoice_payment(uuid, jsonb, uuid),
  public._internal_confirm_transport_invoice_payment(uuid, uuid),
  public.register_jeko_payment_request(jsonb),
  public.process_jeko_payment_event(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_transport_invoice_payment(uuid, jsonb),
  public.confirm_transport_invoice_payment(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transport_invoice_payment(uuid, jsonb),
  public.confirm_transport_invoice_payment(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_jeko_payment_request(jsonb),
  public.process_jeko_payment_event(uuid)
  TO service_role;
