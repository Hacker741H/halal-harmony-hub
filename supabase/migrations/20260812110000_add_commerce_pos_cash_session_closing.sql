-- POS-04C: a cash session close is a physical-count control, not a financial
-- movement. Sales remain the only source of POS receipts, payments, stock
-- movements and finance_operations.

CREATE TABLE IF NOT EXISTS public.commerce_pos_cash_session_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id text NOT NULL UNIQUE,
  closure_event_id text NOT NULL UNIQUE,
  terminal_id text NOT NULL,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  opened_at_device timestamptz NOT NULL,
  closed_at_device timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('SYNCED', 'REVIEW_REQUIRED')),
  payload_hash text NOT NULL,
  declared_ticket_count integer NOT NULL CHECK (declared_ticket_count >= 0),
  declared_article_total numeric(14, 2) NOT NULL CHECK (declared_article_total >= 0),
  declared_service_total numeric(14, 2) NOT NULL CHECK (declared_service_total >= 0),
  declared_cash_total numeric(14, 2) NOT NULL CHECK (declared_cash_total >= 0),
  declared_other_payment_total numeric(14, 2) NOT NULL CHECK (declared_other_payment_total >= 0),
  declared_theoretical_cash numeric(14, 2) NOT NULL CHECK (declared_theoretical_cash >= 0),
  counted_cash numeric(14, 2) NOT NULL CHECK (counted_cash >= 0),
  declared_difference numeric(14, 2) NOT NULL,
  discrepancy_note text,
  server_ticket_count integer NOT NULL CHECK (server_ticket_count >= 0),
  server_article_total numeric(14, 2) NOT NULL CHECK (server_article_total >= 0),
  server_service_total numeric(14, 2) NOT NULL CHECK (server_service_total >= 0),
  server_cash_total numeric(14, 2) NOT NULL CHECK (server_cash_total >= 0),
  server_other_payment_total numeric(14, 2) NOT NULL CHECK (server_other_payment_total >= 0),
  server_difference numeric(14, 2) NOT NULL,
  totals_match boolean NOT NULL,
  payload jsonb NOT NULL,
  received_at_server timestamptz NOT NULL DEFAULT now(),
  CHECK (length(cash_session_id) BETWEEN 8 AND 160),
  CHECK (length(closure_event_id) BETWEEN 8 AND 160),
  CHECK (length(terminal_id) BETWEEN 8 AND 160),
  CHECK (discrepancy_note IS NULL OR length(discrepancy_note) <= 1000)
);

CREATE INDEX IF NOT EXISTS commerce_pos_cash_session_closures_location_closed_idx
  ON public.commerce_pos_cash_session_closures (business_location_id, closed_at_device DESC);
CREATE INDEX IF NOT EXISTS commerce_pos_cash_session_closures_cashier_closed_idx
  ON public.commerce_pos_cash_session_closures (cashier_user_id, closed_at_device DESC);

ALTER TABLE public.commerce_pos_cash_session_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commerce_pos_cash_session_closures FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_commerce_pos_cash_session_close(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_cash_session_id text := NULLIF(btrim(p_event ->> 'cash_session_id'), '');
  v_event_id text := NULLIF(btrim(p_event ->> 'event_id'), '');
  v_terminal_id text := NULLIF(btrim(p_event ->> 'terminal_id'), '');
  v_location_id uuid;
  v_claimed_user_id uuid;
  v_opened_at_device timestamptz;
  v_closed_at_device timestamptz;
  v_payload jsonb := p_event -> 'payload';
  v_payload_hash text;
  v_existing public.commerce_pos_cash_session_closures;
  v_declared_ticket_count integer;
  v_declared_article_total numeric(14, 2);
  v_declared_service_total numeric(14, 2);
  v_declared_cash_total numeric(14, 2);
  v_declared_other_payment_total numeric(14, 2);
  v_declared_theoretical_cash numeric(14, 2);
  v_counted_cash numeric(14, 2);
  v_declared_difference numeric(14, 2);
  v_note text;
  v_server_ticket_count integer := 0;
  v_server_article_total numeric(14, 2) := 0;
  v_server_service_total numeric(14, 2) := 0;
  v_server_cash_total numeric(14, 2) := 0;
  v_server_other_payment_total numeric(14, 2) := 0;
  v_server_difference numeric(14, 2) := 0;
  v_pending_sales integer := 0;
  v_totals_match boolean := false;
  v_status text;
  v_closure public.commerce_pos_cash_session_closures;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour synchroniser une clôture de caisse.' USING ERRCODE = '42501';
  END IF;

  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object'
    OR v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Événement de clôture hors connexion invalide.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_location_id := NULLIF(p_event ->> 'business_location_id', '')::uuid;
    v_claimed_user_id := NULLIF(p_event ->> 'cashier_user_id', '')::uuid;
    v_opened_at_device := NULLIF(v_payload ->> 'opened_at_device', '')::timestamptz;
    v_closed_at_device := NULLIF(v_payload ->> 'closed_at_device', '')::timestamptz;
    v_declared_ticket_count := NULLIF(v_payload ->> 'ticket_count', '')::integer;
    v_declared_article_total := NULLIF(v_payload ->> 'article_total', '')::numeric;
    v_declared_service_total := NULLIF(v_payload ->> 'service_total', '')::numeric;
    v_declared_cash_total := NULLIF(v_payload ->> 'cash_total', '')::numeric;
    v_declared_other_payment_total := NULLIF(v_payload ->> 'other_payment_total', '')::numeric;
    v_declared_theoretical_cash := NULLIF(v_payload ->> 'theoretical_cash', '')::numeric;
    v_counted_cash := NULLIF(v_payload ->> 'counted_cash', '')::numeric;
    v_declared_difference := NULLIF(v_payload ->> 'difference', '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Données de clôture hors connexion invalides.' USING ERRCODE = '22023';
  END;
  v_note := NULLIF(btrim(v_payload ->> 'note'), '');

  IF v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_event_id IS NULL OR v_event_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_claimed_user_id IS NULL
    OR v_opened_at_device IS NULL OR v_closed_at_device IS NULL
    OR v_closed_at_device < v_opened_at_device
    OR v_declared_ticket_count IS NULL OR v_declared_ticket_count < 0
    OR v_declared_article_total IS NULL OR v_declared_article_total < 0
    OR v_declared_service_total IS NULL OR v_declared_service_total < 0
    OR v_declared_cash_total IS NULL OR v_declared_cash_total < 0
    OR v_declared_other_payment_total IS NULL OR v_declared_other_payment_total < 0
    OR v_declared_theoretical_cash IS NULL OR v_declared_theoretical_cash < 0
    OR v_counted_cash IS NULL OR v_counted_cash < 0
    OR v_declared_difference IS NULL
    OR (v_note IS NOT NULL AND length(v_note) > 1000) THEN
    RAISE EXCEPTION 'Données de clôture hors connexion invalides.' USING ERRCODE = '22023';
  END IF;

  IF v_claimed_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Le caissier de la clôture ne correspond pas à la session connectée.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  IF round(v_declared_cash_total, 2) <> round(v_declared_article_total + v_declared_service_total, 2)
    OR round(v_declared_theoretical_cash, 2) <> round(v_declared_cash_total + v_declared_other_payment_total, 2)
    OR round(v_declared_difference, 2) <> round(v_counted_cash - v_declared_theoretical_cash, 2) THEN
    RAISE EXCEPTION 'Les totaux déclarés de clôture sont incohérents.' USING ERRCODE = '22023';
  END IF;

  v_payload_hash := md5(p_event::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':cash-close:' || v_cash_session_id, 0));

  SELECT * INTO v_existing
  FROM public.commerce_pos_cash_session_closures
  WHERE cash_session_id = v_cash_session_id;

  IF FOUND THEN
    IF v_existing.closure_event_id <> v_event_id
      OR v_existing.payload_hash <> v_payload_hash
      OR v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Cette session de caisse possède déjà une clôture différente.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'closureId', v_existing.id,
      'status', v_existing.status,
      'errorCode', CASE WHEN v_existing.status = 'REVIEW_REQUIRED' THEN 'TOTALS_MISMATCH' ELSE NULL END,
      'errorMessage', CASE WHEN v_existing.status = 'REVIEW_REQUIRED' THEN 'Les montants de la clôture doivent être contrôlés.' ELSE NULL END
    );
  END IF;

  SELECT count(*) INTO v_pending_sales
  FROM public.commerce_pos_offline_receipts
  WHERE cash_session_id = v_cash_session_id
    AND business_location_id = v_location_id
    AND cashier_user_id = auth.uid()
    AND terminal_id = v_terminal_id
    AND status <> 'PROCESSED';

  IF v_pending_sales > 0 THEN
    RETURN jsonb_build_object(
      'closureId', NULL,
      'status', 'PENDING_SALES',
      'errorCode', 'PENDING_SALES',
      'errorMessage', 'La clôture attend encore des ventes à synchroniser ou à contrôler.'
    );
  END IF;

  SELECT count(*)::integer
  INTO v_server_ticket_count
  FROM public.commerce_pos_offline_receipts AS receipt
  WHERE receipt.cash_session_id = v_cash_session_id
    AND receipt.business_location_id = v_location_id
    AND receipt.cashier_user_id = auth.uid()
    AND receipt.terminal_id = v_terminal_id
    AND receipt.status = 'PROCESSED';

  IF v_server_ticket_count < v_declared_ticket_count THEN
    RETURN jsonb_build_object(
      'closureId', NULL,
      'status', 'PENDING_SALES',
      'errorCode', 'PENDING_SALES',
      'errorMessage', 'La clôture attend encore des ventes à synchroniser.'
    );
  END IF;

  SELECT COALESCE(sum(receipt.amount), 0)
  INTO v_server_cash_total
  FROM public.commerce_pos_offline_receipts AS receipt
  WHERE receipt.cash_session_id = v_cash_session_id
    AND receipt.business_location_id = v_location_id
    AND receipt.cashier_user_id = auth.uid()
    AND receipt.terminal_id = v_terminal_id
    AND receipt.status = 'PROCESSED';

  SELECT
    COALESCE(sum(CASE WHEN upper(COALESCE(NULLIF(btrim(line.value ->> 'line_type'), ''), 'ARTICLE')) = 'ARTICLE'
      THEN (line.value ->> 'quantity')::numeric * (line.value ->> 'unit_price')::numeric ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN upper(COALESCE(NULLIF(btrim(line.value ->> 'line_type'), ''), 'ARTICLE')) = 'SERVICE'
      THEN (line.value ->> 'quantity')::numeric * (line.value ->> 'unit_price')::numeric ELSE 0 END), 0)
  INTO v_server_article_total, v_server_service_total
  FROM public.commerce_pos_offline_receipts AS receipt
  CROSS JOIN LATERAL jsonb_array_elements(receipt.payload -> 'payload' -> 'lines') AS line(value)
  WHERE receipt.cash_session_id = v_cash_session_id
    AND receipt.business_location_id = v_location_id
    AND receipt.cashier_user_id = auth.uid()
    AND receipt.terminal_id = v_terminal_id
    AND receipt.status = 'PROCESSED';

  -- The offline POS currently supports cash only. This remains explicit so a
  -- future card/mobile-money path cannot silently be counted as cash.
  v_server_other_payment_total := 0;
  v_server_difference := round(v_counted_cash - (v_server_cash_total + v_server_other_payment_total), 2);
  v_totals_match := v_server_ticket_count = v_declared_ticket_count
    AND round(v_server_article_total, 2) = round(v_declared_article_total, 2)
    AND round(v_server_service_total, 2) = round(v_declared_service_total, 2)
    AND round(v_server_cash_total, 2) = round(v_declared_cash_total, 2)
    AND round(v_server_other_payment_total, 2) = round(v_declared_other_payment_total, 2)
    AND round(v_server_cash_total + v_server_other_payment_total, 2) = round(v_declared_theoretical_cash, 2);
  v_status := CASE WHEN v_totals_match THEN 'SYNCED' ELSE 'REVIEW_REQUIRED' END;

  INSERT INTO public.commerce_pos_cash_session_closures (
    cash_session_id, closure_event_id, terminal_id, business_location_id, cashier_user_id,
    opened_at_device, closed_at_device, status, payload_hash,
    declared_ticket_count, declared_article_total, declared_service_total,
    declared_cash_total, declared_other_payment_total, declared_theoretical_cash,
    counted_cash, declared_difference, discrepancy_note,
    server_ticket_count, server_article_total, server_service_total,
    server_cash_total, server_other_payment_total, server_difference,
    totals_match, payload
  ) VALUES (
    v_cash_session_id, v_event_id, v_terminal_id, v_location_id, auth.uid(),
    v_opened_at_device, v_closed_at_device, v_status, v_payload_hash,
    v_declared_ticket_count, v_declared_article_total, v_declared_service_total,
    v_declared_cash_total, v_declared_other_payment_total, v_declared_theoretical_cash,
    v_counted_cash, v_declared_difference, v_note,
    v_server_ticket_count, v_server_article_total, v_server_service_total,
    v_server_cash_total, v_server_other_payment_total, v_server_difference,
    v_totals_match, p_event
  ) RETURNING * INTO v_closure;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_CASH_SESSION_CLOSE', v_closure.id, NULL, 'CREATE', NULL,
    jsonb_build_object(
      'event_type', 'CASH_SESSION_CLOSE',
      'cash_session_id', v_cash_session_id,
      'terminal_id', v_terminal_id,
      'status', v_status,
      'ticket_count', v_server_ticket_count,
      'theoretical_cash', v_server_cash_total,
      'counted_cash', v_counted_cash,
      'difference', v_server_difference,
      'totals_match', v_totals_match
    )
  );

  RETURN jsonb_build_object(
    'closureId', v_closure.id,
    'status', v_closure.status,
    'errorCode', CASE WHEN v_closure.status = 'REVIEW_REQUIRED' THEN 'TOTALS_MISMATCH' ELSE NULL END,
    'errorMessage', CASE WHEN v_closure.status = 'REVIEW_REQUIRED' THEN 'Les montants de la clôture doivent être contrôlés.' ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_commerce_pos_cash_session_close(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_commerce_pos_cash_session_close(jsonb) TO authenticated;

COMMENT ON FUNCTION public.sync_commerce_pos_cash_session_close(jsonb) IS
  'POS-04C: records an idempotent physical cash-session close after POS offline receipts are synchronized. It never creates finance operations or changes wallets.';
