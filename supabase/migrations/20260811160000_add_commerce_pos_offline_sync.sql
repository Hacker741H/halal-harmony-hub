-- POS-04B: safely receive a cash sale which was recorded locally while the
-- cashier terminal was offline.  This function deliberately delegates the
-- operational write to create_commerce_cash_sale: there is still one POS
-- engine for sales, invoices, payments, finance operations, wallets and stock.

CREATE TABLE IF NOT EXISTS public.commerce_pos_offline_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offline_sale_id text NOT NULL UNIQUE,
  terminal_id text NOT NULL,
  cash_session_id text NOT NULL,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE RESTRICT,
  cashier_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('PROCESSED', 'CONFLICT')),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at_device timestamptz NOT NULL,
  received_at_server timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  server_sale_id uuid REFERENCES public.commercial_sales(id) ON DELETE RESTRICT,
  server_invoice_id uuid REFERENCES public.commercial_invoices(id) ON DELETE RESTRICT,
  server_payment_id uuid REFERENCES public.commercial_invoice_payments(id) ON DELETE RESTRICT,
  server_operation_id uuid REFERENCES public.finance_operations(id) ON DELETE RESTRICT,
  amount numeric(14, 2),
  price_divergence jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message text,
  CHECK ((status = 'PROCESSED') = (server_sale_id IS NOT NULL)),
  CHECK (status <> 'PROCESSED' OR (server_invoice_id IS NOT NULL AND server_payment_id IS NOT NULL AND server_operation_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS commerce_pos_offline_receipts_location_received_idx
  ON public.commerce_pos_offline_receipts (business_location_id, received_at_server DESC);

CREATE INDEX IF NOT EXISTS commerce_pos_offline_receipts_cashier_received_idx
  ON public.commerce_pos_offline_receipts (cashier_user_id, received_at_server DESC);

ALTER TABLE public.commerce_pos_offline_receipts ENABLE ROW LEVEL SECURITY;

-- Receipts are audit records.  They are intentionally not exposed directly to
-- application roles; the narrowly scoped RPC below is the only write path.
REVOKE ALL ON TABLE public.commerce_pos_offline_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_commerce_pos_offline_sale(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_offline_sale_id text := NULLIF(btrim(p_event ->> 'offline_sale_id'), '');
  v_terminal_id text := NULLIF(btrim(p_event ->> 'terminal_id'), '');
  v_cash_session_id text := NULLIF(btrim(p_event ->> 'cash_session_id'), '');
  v_location_id uuid := NULLIF(p_event ->> 'business_location_id', '')::uuid;
  v_claimed_user_id uuid := NULLIF(p_event ->> 'cashier_user_id', '')::uuid;
  v_created_at_device timestamptz := NULLIF(p_event ->> 'created_at_device', '')::timestamptz;
  v_payload jsonb := p_event -> 'payload';
  v_payload_hash text;
  v_existing public.commerce_pos_offline_receipts;
  v_line jsonb;
  v_line_type text;
  v_item_id uuid;
  v_quantity numeric(14, 3);
  v_unit_price numeric(14, 2);
  v_total numeric(14, 2) := 0;
  v_reported_total numeric(14, 2);
  v_cash_received numeric(14, 2);
  v_change_due numeric(14, 2);
  v_client_id uuid;
  v_current_price numeric(14, 2);
  v_price_divergence jsonb := '[]'::jsonb;
  v_stock_conflicts jsonb;
  v_sale_payload jsonb;
  v_sale_result jsonb;
  v_receipt public.commerce_pos_offline_receipts;
  v_invoice_id uuid;
  v_error_code text;
  v_error_message text;
BEGIN
  PERFORM public.permission_require('commerce.pos.sell');

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour synchroniser la caisse.' USING ERRCODE = '42501';
  END IF;

  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Événement hors connexion invalide.' USING ERRCODE = '22023';
  END IF;

  IF v_offline_sale_id IS NULL OR v_offline_sale_id !~ '^[A-Za-z0-9_-]{8,120}$'
    OR v_terminal_id IS NULL OR v_terminal_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_cash_session_id IS NULL OR v_cash_session_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL OR v_claimed_user_id IS NULL OR v_created_at_device IS NULL THEN
    RAISE EXCEPTION 'Identifiants de synchronisation caisse invalides.' USING ERRCODE = '22023';
  END IF;

  IF v_claimed_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Le caissier de l’événement ne correspond pas à la session connectée.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Point de vente non autorisé.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_payload ->> 'payment_method', '') <> 'CASH'
    OR jsonb_typeof(v_payload -> 'lines') <> 'array'
    OR jsonb_array_length(v_payload -> 'lines') = 0
    OR jsonb_array_length(v_payload -> 'lines') > 100 THEN
    RAISE EXCEPTION 'Seules les ventes espèces hors connexion valides peuvent être synchronisées.' USING ERRCODE = '22023';
  END IF;

  v_payload_hash := md5(p_event::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':offline:' || v_offline_sale_id, 0));

  SELECT * INTO v_existing
  FROM public.commerce_pos_offline_receipts
  WHERE offline_sale_id = v_offline_sale_id;

  IF FOUND THEN
    IF v_existing.payload_hash <> v_payload_hash
      OR v_existing.business_location_id <> v_location_id
      OR v_existing.cashier_user_id <> auth.uid()
      OR v_existing.terminal_id <> v_terminal_id THEN
      RAISE EXCEPTION 'Identifiant de vente hors connexion déjà utilisé avec un contenu différent.' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'receiptId', v_existing.id,
      'status', v_existing.status,
      'saleId', v_existing.server_sale_id,
      'saleNumber', (SELECT sale_number FROM public.commercial_sales WHERE id = v_existing.server_sale_id),
      'invoiceNumber', (SELECT invoice_number FROM public.commercial_invoices WHERE id = v_existing.server_invoice_id),
      'paymentId', v_existing.server_payment_id,
      'operationId', v_existing.server_operation_id,
      'amount', v_existing.amount,
      'errorCode', v_existing.error_code,
      'errorMessage', v_existing.error_message
    );
  END IF;

  v_client_id := NULLIF(v_payload ->> 'client_id', '')::uuid;
  v_reported_total := NULLIF(v_payload ->> 'total', '')::numeric;
  v_cash_received := NULLIF(v_payload ->> 'cash_received', '')::numeric;
  v_change_due := NULLIF(v_payload ->> 'change_due', '')::numeric;

  IF v_reported_total IS NULL OR v_reported_total <= 0 OR (v_cash_received IS NOT NULL AND v_cash_received < 0)
    OR (v_change_due IS NOT NULL AND v_change_due < 0) THEN
    RAISE EXCEPTION 'Montants de caisse hors connexion invalides.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload -> 'lines') LOOP
    v_line_type := upper(coalesce(NULLIF(btrim(v_line ->> 'line_type'), ''), 'ARTICLE'));
    v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Quantité ou prix hors connexion invalide.' USING ERRCODE = '22023';
    END IF;

    IF v_line_type = 'ARTICLE' THEN
      v_item_id := NULLIF(v_line ->> 'inventory_item_id', '')::uuid;
      IF v_item_id IS NULL THEN
        RAISE EXCEPTION 'Article hors connexion invalide.' USING ERRCODE = '22023';
      END IF;

      SELECT local_item.sale_price
      INTO v_current_price
      FROM public.business_location_inventory_items AS local_item
      WHERE local_item.business_location_id = v_location_id
        AND local_item.inventory_item_id = v_item_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Article indisponible dans ce magasin.' USING ERRCODE = '22023';
      END IF;

      -- The price paid by the customer is never overwritten after a network
      -- outage.  Any difference with the current server price is retained in
      -- the receipt for later review.
      IF v_current_price IS DISTINCT FROM v_unit_price THEN
        v_price_divergence := v_price_divergence || jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_item_id,
          'captured_unit_price', v_unit_price,
          'current_unit_price', v_current_price
        ));
      END IF;
    ELSIF v_line_type = 'SERVICE' THEN
      IF NULLIF(btrim(coalesce(v_line ->> 'service_name', v_line ->> 'description')), '') IS NULL
        OR length(coalesce(v_line ->> 'service_name', v_line ->> 'description', '')) > 160
        OR length(coalesce(v_line ->> 'service_note', '')) > 1000
        OR NULLIF(v_line ->> 'inventory_item_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Service hors connexion invalide.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Type de ligne hors connexion invalide.' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + round(v_quantity * v_unit_price, 2);
  END LOOP;

  IF round(v_total, 2) <> round(v_reported_total, 2)
    OR (v_cash_received IS NOT NULL AND v_cash_received < v_total)
    OR (v_change_due IS NOT NULL AND round(v_change_due, 2) <> round(greatest(coalesce(v_cash_received, v_total) - v_total, 0), 2)) THEN
    RAISE EXCEPTION 'Le total espèces hors connexion ne correspond pas aux lignes du ticket.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'inventory_item_id', requested.inventory_item_id,
    'requested_quantity', requested.requested_quantity,
    'available_quantity', requested.available_quantity
  )), '[]'::jsonb)
  INTO v_stock_conflicts
  FROM (
    SELECT (source_line.value ->> 'inventory_item_id')::uuid AS inventory_item_id,
      sum((source_line.value ->> 'quantity')::numeric) AS requested_quantity,
      local_item.quantity AS available_quantity
    FROM jsonb_array_elements(v_payload -> 'lines') AS source_line(value)
    JOIN public.business_location_inventory_items AS local_item
      ON local_item.business_location_id = v_location_id
      AND local_item.inventory_item_id = (source_line.value ->> 'inventory_item_id')::uuid
    WHERE upper(coalesce(NULLIF(btrim(source_line.value ->> 'line_type'), ''), 'ARTICLE')) = 'ARTICLE'
    GROUP BY source_line.value ->> 'inventory_item_id', local_item.quantity
    HAVING local_item.quantity < sum((source_line.value ->> 'quantity')::numeric)
  ) AS requested;

  IF jsonb_array_length(v_stock_conflicts) > 0 THEN
    INSERT INTO public.commerce_pos_offline_receipts (
      offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
      status, payload_hash, payload, created_at_device, amount, price_divergence,
      error_code, error_message
    ) VALUES (
      v_offline_sale_id, v_terminal_id, v_cash_session_id, v_location_id, auth.uid(),
      'CONFLICT', v_payload_hash, p_event, v_created_at_device, v_total, v_price_divergence,
      'STOCK_CONFLICT', 'Le stock serveur ne couvre plus le ticket espèces hors connexion.'
    ) RETURNING * INTO v_receipt;

    PERFORM public.business_finance_audit_event(
      'COMMERCE_POS_OFFLINE_RECEIPT', v_receipt.id, NULL, 'CONFLICT', NULL,
      jsonb_build_object('offline_sale_id', v_offline_sale_id, 'stock_conflicts', v_stock_conflicts)
    );

    RETURN jsonb_build_object(
      'receiptId', v_receipt.id,
      'status', 'CONFLICT',
      'saleId', NULL,
      'saleNumber', NULL,
      'invoiceNumber', NULL,
      'paymentId', NULL,
      'operationId', NULL,
      'amount', v_total,
      'errorCode', 'STOCK_CONFLICT',
      'errorMessage', 'Le stock serveur ne couvre plus ce ticket. Il est conservé pour contrôle.',
      'stockConflicts', v_stock_conflicts
    );
  END IF;

  v_sale_payload := jsonb_build_object(
    'business_location_id', v_location_id,
    'client_id', v_client_id,
    'payment_method', 'CASH',
    'reference', 'POS:OFFLINE:' || v_offline_sale_id,
    'notes', 'Vente créée hors connexion le ' || to_char(v_created_at_device AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC ; terminal ' || v_terminal_id,
    'lines', v_payload -> 'lines'
  );

  BEGIN
    v_sale_result := public.create_commerce_cash_sale(v_sale_payload);
  EXCEPTION WHEN OTHERS THEN
    v_error_code := SQLSTATE;
    v_error_message := SQLERRM;

    IF v_error_code = '22023' AND v_error_message = 'Quantité indisponible dans ce magasin.' THEN
      INSERT INTO public.commerce_pos_offline_receipts (
        offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
        status, payload_hash, payload, created_at_device, amount, price_divergence,
        error_code, error_message
      ) VALUES (
        v_offline_sale_id, v_terminal_id, v_cash_session_id, v_location_id, auth.uid(),
        'CONFLICT', v_payload_hash, p_event, v_created_at_device, v_total, v_price_divergence,
        'STOCK_CONFLICT', 'Le stock a changé pendant la synchronisation de ce ticket.'
      ) RETURNING * INTO v_receipt;

      PERFORM public.business_finance_audit_event(
        'COMMERCE_POS_OFFLINE_RECEIPT', v_receipt.id, NULL, 'CONFLICT', NULL,
        jsonb_build_object('offline_sale_id', v_offline_sale_id, 'reason', v_error_message)
      );

      RETURN jsonb_build_object(
        'receiptId', v_receipt.id,
        'status', 'CONFLICT',
        'saleId', NULL,
        'saleNumber', NULL,
        'invoiceNumber', NULL,
        'paymentId', NULL,
        'operationId', NULL,
        'amount', v_total,
        'errorCode', 'STOCK_CONFLICT',
        'errorMessage', 'Le stock a changé pendant la synchronisation. Le ticket est conservé pour contrôle.'
      );
    END IF;

    RAISE;
  END;

  SELECT id INTO v_invoice_id
  FROM public.commercial_invoices
  WHERE invoice_number = v_sale_result ->> 'invoiceNumber';

  INSERT INTO public.commerce_pos_offline_receipts (
    offline_sale_id, terminal_id, cash_session_id, business_location_id, cashier_user_id,
    status, payload_hash, payload, created_at_device, processed_at,
    server_sale_id, server_invoice_id, server_payment_id, server_operation_id,
    amount, price_divergence
  ) VALUES (
    v_offline_sale_id, v_terminal_id, v_cash_session_id, v_location_id, auth.uid(),
    'PROCESSED', v_payload_hash, p_event, v_created_at_device, now(),
    (v_sale_result ->> 'saleId')::uuid, v_invoice_id, (v_sale_result ->> 'paymentId')::uuid, (v_sale_result ->> 'operationId')::uuid,
    (v_sale_result ->> 'amount')::numeric, v_price_divergence
  ) RETURNING * INTO v_receipt;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_POS_OFFLINE_RECEIPT', v_receipt.id, v_receipt.server_operation_id, 'SYNC', NULL,
    jsonb_build_object(
      'offline_sale_id', v_offline_sale_id,
      'terminal_id', v_terminal_id,
      'cash_session_id', v_cash_session_id,
      'created_at_device', v_created_at_device,
      'received_at_server', v_receipt.received_at_server,
      'price_divergence', v_price_divergence
    )
  );

  RETURN jsonb_build_object(
    'receiptId', v_receipt.id,
    'status', 'PROCESSED',
    'saleId', v_receipt.server_sale_id,
    'saleNumber', v_sale_result ->> 'saleNumber',
    'invoiceNumber', v_sale_result ->> 'invoiceNumber',
    'paymentId', v_receipt.server_payment_id,
    'operationId', v_receipt.server_operation_id,
    'amount', v_receipt.amount,
    'errorCode', NULL,
    'errorMessage', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_commerce_pos_offline_sale(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_commerce_pos_offline_sale(jsonb) TO authenticated;

COMMENT ON FUNCTION public.sync_commerce_pos_offline_sale(jsonb) IS
  'POS-04B bridge: validates one locally recorded cash sale, reuses create_commerce_cash_sale, and stores an idempotent receipt. No direct financial write occurs here.';
