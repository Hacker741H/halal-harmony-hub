-- POS-05: resilient weekly POS synchronization is exercised at the client
-- layer. This migration completes the existing cash-remittance foundation.
-- A remittance is a treasury TRANSFER after physical receipt, never revenue.

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES
  ('commerce.cash.remittance.declare', 'commerce', 'cash_remittance_declare', 'Déclarer une remise de caisse à partir de clôtures synchronisées.', 'CRITICAL'),
  ('commerce.cash.remittance.confirm', 'commerce', 'cash_remittance_confirm', 'Confirmer la réception physique d’une remise et son transfert de trésorerie.', 'CRITICAL')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, grant_row.permission_code
FROM (VALUES
  ('caissier', 'commerce.cash.remittance.declare'),
  ('gestionnaire', 'commerce.cash.remittance.declare'),
  ('gestionnaire', 'commerce.cash.remittance.confirm'),
  ('comptable', 'commerce.cash.remittance.confirm'),
  ('admin', 'commerce.cash.remittance.declare'),
  ('admin', 'commerce.cash.remittance.confirm'),
  ('super_admin', 'commerce.cash.remittance.declare'),
  ('super_admin', 'commerce.cash.remittance.confirm')
) AS grant_row(role, permission_code)
WHERE EXISTS (SELECT 1 FROM public.roles WHERE code = grant_row.role::public.app_role)
ON CONFLICT DO NOTHING;

ALTER TABLE public.commerce_cash_remittances
  ADD COLUMN IF NOT EXISTS remittance_event_id text,
  ADD COLUMN IF NOT EXISTS expected_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS received_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS cashier_difference numeric(14, 2),
  ADD COLUMN IF NOT EXISTS remittance_difference numeric(14, 2),
  ADD COLUMN IF NOT EXISTS declared_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_note text,
  ADD COLUMN IF NOT EXISTS payload_hash text;

-- The destination is chosen and validated by the authorized receiver. It is
-- intentionally unknown while the cashier's declaration is still pending.
ALTER TABLE public.commerce_cash_remittances
  ALTER COLUMN destination_wallet_id DROP NOT NULL;

UPDATE public.commerce_cash_remittances
SET remittance_event_id = coalesce(remittance_event_id, 'legacy-remittance-' || id::text),
    expected_amount = coalesce(expected_amount, amount),
    cashier_difference = coalesce(cashier_difference, amount - coalesce(expected_amount, amount)),
    declared_at = coalesce(declared_at, created_at),
    received_amount = CASE WHEN status = 'CONFIRMED' THEN coalesce(received_amount, amount) ELSE received_amount END,
    remittance_difference = CASE
      WHEN status = 'CONFIRMED' THEN coalesce(remittance_difference, coalesce(received_amount, amount) - amount)
      ELSE remittance_difference
    END,
    payload_hash = coalesce(payload_hash, md5(id::text))
WHERE remittance_event_id IS NULL
   OR expected_amount IS NULL
   OR cashier_difference IS NULL
   OR declared_at IS NULL
   OR payload_hash IS NULL
   OR (status = 'CONFIRMED' AND (received_amount IS NULL OR remittance_difference IS NULL));

ALTER TABLE public.commerce_cash_remittances
  ALTER COLUMN remittance_event_id SET NOT NULL,
  ALTER COLUMN expected_amount SET NOT NULL,
  ALTER COLUMN cashier_difference SET NOT NULL,
  ALTER COLUMN declared_at SET NOT NULL,
  ALTER COLUMN payload_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_cash_remittances_event_uidx
  ON public.commerce_cash_remittances(remittance_event_id);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commerce_cash_remittances'::regclass
      AND conname = 'commerce_cash_remittances_pos05_amounts_check'
  ) THEN
    ALTER TABLE public.commerce_cash_remittances
      ADD CONSTRAINT commerce_cash_remittances_pos05_amounts_check CHECK (
        expected_amount > 0
        AND amount > 0
        AND (received_amount IS NULL OR received_amount > 0)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commerce_cash_remittances'::regclass
      AND conname = 'commerce_cash_remittances_pos05_state_check'
  ) THEN
    ALTER TABLE public.commerce_cash_remittances
      ADD CONSTRAINT commerce_cash_remittances_pos05_state_check CHECK (
        (status = 'DECLARED' AND received_amount IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL)
        OR (status = 'CONFIRMED' AND received_amount IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
        OR status = 'CANCELLED'
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commerce_cash_remittances'::regclass
      AND conname = 'commerce_cash_remittances_pos05_text_check'
  ) THEN
    ALTER TABLE public.commerce_cash_remittances
      ADD CONSTRAINT commerce_cash_remittances_pos05_text_check CHECK (
        length(remittance_event_id) BETWEEN 8 AND 160
        AND length(payload_hash) >= 32
        AND (confirmation_note IS NULL OR length(confirmation_note) <= 1000)
      );
  END IF;
END;
$constraints$;

CREATE TABLE IF NOT EXISTS public.commerce_cash_remittance_closures (
  remittance_id uuid NOT NULL REFERENCES public.commerce_cash_remittances(id) ON DELETE RESTRICT,
  closure_id uuid NOT NULL REFERENCES public.commerce_pos_cash_session_closures(id) ON DELETE RESTRICT,
  allocated_counted_amount numeric(14, 2) NOT NULL CHECK (allocated_counted_amount > 0),
  allocated_expected_amount numeric(14, 2) NOT NULL CHECK (allocated_expected_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remittance_id, closure_id)
);

CREATE INDEX IF NOT EXISTS commerce_cash_remittance_closures_closure_idx
  ON public.commerce_cash_remittance_closures(closure_id, remittance_id);

ALTER TABLE public.commerce_cash_remittance_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.commerce_cash_remittance_closures FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declare_commerce_cash_remittance(p_declaration jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_event_id text := NULLIF(btrim(p_declaration ->> 'remittance_event_id'), '');
  v_location_id uuid;
  v_note text := NULLIF(btrim(p_declaration ->> 'note'), '');
  v_reference text := NULLIF(btrim(p_declaration ->> 'reference'), '');
  v_payload_hash text;
  v_existing public.commerce_cash_remittances;
  v_source_wallet_id uuid;
  v_closure_input jsonb;
  v_closure public.commerce_pos_cash_session_closures;
  v_closure_id uuid;
  v_allocation numeric(14, 2);
  v_already_allocated numeric(14, 2);
  v_expected_allocation numeric(14, 2);
  v_declared_amount numeric(14, 2) := 0;
  v_expected_amount numeric(14, 2) := 0;
  v_remittance public.commerce_cash_remittances;
BEGIN
  PERFORM public.permission_require('commerce.cash.remittance.declare');
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour déclarer une remise.' USING ERRCODE = '42501';
  END IF;
  IF p_declaration IS NULL OR jsonb_typeof(p_declaration) <> 'object'
    OR jsonb_typeof(p_declaration -> 'closures') <> 'array'
    OR jsonb_array_length(p_declaration -> 'closures') = 0 THEN
    RAISE EXCEPTION 'Déclaration de remise invalide.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_location_id := NULLIF(p_declaration ->> 'business_location_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Magasin invalide.' USING ERRCODE = '22023';
  END;
  IF v_event_id IS NULL OR v_event_id !~ '^[A-Za-z0-9_-]{8,160}$'
    OR v_location_id IS NULL
    OR (v_note IS NOT NULL AND length(v_note) > 1000)
    OR (v_reference IS NOT NULL AND length(v_reference) > 160) THEN
    RAISE EXCEPTION 'Déclaration de remise invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorisé.' USING ERRCODE = '42501';
  END IF;

  v_payload_hash := md5(p_declaration::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_location_id::text || ':remittance:' || v_event_id, 0));
  SELECT * INTO v_existing
  FROM public.commerce_cash_remittances
  WHERE remittance_event_id = v_event_id;
  IF FOUND THEN
    IF v_existing.business_location_id <> v_location_id
      OR v_existing.declared_by <> auth.uid()
      OR v_existing.payload_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'Cet identifiant de remise correspond déjà à une autre déclaration.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
      'expectedAmount', v_existing.expected_amount, 'declaredAmount', v_existing.amount,
      'receivedAmount', v_existing.received_amount);
  END IF;

  SELECT mapping.wallet_id INTO v_source_wallet_id
  FROM public.business_location_wallets mapping
  WHERE mapping.business_location_id = v_location_id
    AND mapping.purpose = 'CASH_DRAWER'
    AND mapping.is_primary
    AND mapping.is_active
  ORDER BY mapping.assigned_at DESC
  LIMIT 1;
  IF v_source_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Aucun wallet de caisse principal actif pour ce magasin.' USING ERRCODE = '23503';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pos05_remittance_allocations(
    closure_id uuid PRIMARY KEY,
    allocated_counted_amount numeric(14, 2) NOT NULL,
    allocated_expected_amount numeric(14, 2) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pos05_remittance_allocations;

  FOR v_closure_input IN SELECT value FROM jsonb_array_elements(p_declaration -> 'closures') LOOP
    BEGIN
      v_closure_id := NULLIF(v_closure_input ->> 'closure_id', '')::uuid;
      v_allocation := NULLIF(v_closure_input ->> 'amount', '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Clôture ou montant de remise invalide.' USING ERRCODE = '22023';
    END;
    IF v_closure_id IS NULL OR v_allocation IS NULL OR v_allocation <= 0 THEN
      RAISE EXCEPTION 'Chaque clôture doit avoir un montant strictement positif.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_closure
    FROM public.commerce_pos_cash_session_closures
    WHERE id = v_closure_id
    FOR UPDATE;
    IF NOT FOUND OR v_closure.business_location_id <> v_location_id THEN
      RAISE EXCEPTION 'Clôture introuvable dans ce magasin.' USING ERRCODE = '23503';
    END IF;
    IF v_closure.cashier_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Un caissier ne peut déclarer que ses propres clôtures.' USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(sum(CASE
      WHEN remittance.status = 'DECLARED' THEN link.allocated_counted_amount
      WHEN remittance.status = 'CONFIRMED' AND remittance.amount > 0
        THEN round(link.allocated_counted_amount * remittance.received_amount / remittance.amount, 2)
      ELSE 0 END), 0)
    INTO v_already_allocated
    FROM public.commerce_cash_remittance_closures link
    JOIN public.commerce_cash_remittances remittance ON remittance.id = link.remittance_id
    WHERE link.closure_id = v_closure_id
      AND remittance.status <> 'CANCELLED';

    IF round(v_allocation, 2) > round(v_closure.counted_cash - v_already_allocated, 2) THEN
      RAISE EXCEPTION 'Le montant dépasse le solde encore remisable de cette clôture.' USING ERRCODE = '22023';
    END IF;
    v_expected_allocation := round(v_allocation * v_closure.server_cash_total / NULLIF(v_closure.counted_cash, 0), 2);
    IF v_expected_allocation IS NULL OR v_expected_allocation <= 0 THEN
      RAISE EXCEPTION 'Une clôture sans espèces comptées ne peut pas être remise.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO pos05_remittance_allocations(closure_id, allocated_counted_amount, allocated_expected_amount)
    VALUES (v_closure_id, round(v_allocation, 2), v_expected_allocation);
    v_declared_amount := v_declared_amount + round(v_allocation, 2);
    v_expected_amount := v_expected_amount + v_expected_allocation;
  END LOOP;

  INSERT INTO public.commerce_cash_remittances(
    remittance_event_id, business_location_id, source_wallet_id, destination_wallet_id,
    expected_amount, amount, cashier_difference, remittance_date, status,
    reference, notes, declared_by, declared_at, payload_hash
  ) VALUES (
    v_event_id, v_location_id, v_source_wallet_id, NULL,
    round(v_expected_amount, 2), round(v_declared_amount, 2), round(v_declared_amount - v_expected_amount, 2),
    current_date, 'DECLARED', v_reference, v_note, auth.uid(), now(), v_payload_hash
  ) RETURNING * INTO v_remittance;

  INSERT INTO public.commerce_cash_remittance_closures(
    remittance_id, closure_id, allocated_counted_amount, allocated_expected_amount
  )
  SELECT v_remittance.id, closure_id, allocated_counted_amount, allocated_expected_amount
  FROM pos05_remittance_allocations;

  PERFORM public.business_finance_audit_event(
    'COMMERCE_CASH_REMITTANCE', v_remittance.id, NULL, 'CREATE', NULL,
    jsonb_build_object('status', 'DECLARED', 'location_id', v_location_id,
      'expected_amount', v_expected_amount, 'declared_amount', v_declared_amount,
      'closure_count', (SELECT count(*) FROM pos05_remittance_allocations))
  );
  RETURN jsonb_build_object('id', v_remittance.id, 'status', v_remittance.status,
    'expectedAmount', v_remittance.expected_amount, 'declaredAmount', v_remittance.amount,
    'receivedAmount', v_remittance.received_amount);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_commerce_cash_remittance(
  p_remittance_id uuid,
  p_received_amount numeric,
  p_destination_wallet_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_before public.commerce_cash_remittances;
  v_remittance public.commerce_cash_remittances;
  v_operation public.finance_operations;
  v_note text := NULLIF(btrim(p_note), '');
  v_source_balance numeric(14, 2);
BEGIN
  PERFORM public.permission_require('commerce.cash.remittance.confirm');
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour confirmer une remise.' USING ERRCODE = '42501';
  END IF;
  IF p_received_amount IS NULL OR p_received_amount <= 0
    OR p_destination_wallet_id IS NULL
    OR (v_note IS NOT NULL AND length(v_note) > 1000) THEN
    RAISE EXCEPTION 'Confirmation de remise invalide.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-remittance-confirm:' || p_remittance_id::text, 0));
  SELECT * INTO v_before
  FROM public.commerce_cash_remittances
  WHERE id = p_remittance_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Remise introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_before.business_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorisé.' USING ERRCODE = '42501';
  END IF;
  IF v_before.declared_by = auth.uid() THEN
    RAISE EXCEPTION 'Le déclarant ne peut pas confirmer sa propre remise.' USING ERRCODE = '42501';
  END IF;
  IF v_before.status = 'CONFIRMED' THEN
    IF round(v_before.received_amount, 2) <> round(p_received_amount, 2)
      OR v_before.destination_wallet_id <> p_destination_wallet_id THEN
      RAISE EXCEPTION 'Cette remise a déjà été confirmée avec un autre montant ou wallet.' USING ERRCODE = '22023';
    END IF;
    SELECT operation.* INTO v_operation
    FROM public.finance_commerce_cash_remittance_links link
    JOIN public.finance_operations operation ON operation.id = link.operation_id
    WHERE link.remittance_id = v_before.id;
    RETURN jsonb_build_object('id', v_before.id, 'status', v_before.status,
      'operationId', v_operation.id, 'receivedAmount', v_before.received_amount);
  END IF;
  IF v_before.status <> 'DECLARED' THEN
    RAISE EXCEPTION 'Seule une remise déclarée peut être confirmée.' USING ERRCODE = '22023';
  END IF;
  IF round(p_received_amount, 2) > round(v_before.amount, 2) THEN
    RAISE EXCEPTION 'Le montant reçu ne peut pas dépasser le montant déclaré remis.' USING ERRCODE = '22023';
  END IF;
  IF p_destination_wallet_id = v_before.source_wallet_id
    OR NOT EXISTS (
      SELECT 1 FROM public.business_location_wallets mapping
      WHERE mapping.business_location_id = v_before.business_location_id
        AND mapping.wallet_id = p_destination_wallet_id
        AND mapping.is_active
        AND mapping.purpose IN ('COLLECTION', 'OPERATING')
    ) THEN
    RAISE EXCEPTION 'Le wallet destination n’est pas autorisé pour ce magasin.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.wallets
  WHERE id IN (v_before.source_wallet_id, p_destination_wallet_id)
  ORDER BY id
  FOR UPDATE;
  SELECT balance INTO v_source_balance FROM public.wallets WHERE id = v_before.source_wallet_id;
  IF v_source_balance IS NULL OR v_source_balance < p_received_amount THEN
    RAISE EXCEPTION 'Le wallet de caisse ne contient pas le montant reçu.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_operations(
    wallet_id, destination_wallet_id, type, amount, operation_date, category,
    description, reference, status, origin, module, module_id, notes, created_by
  ) VALUES (
    v_before.source_wallet_id, p_destination_wallet_id, 'TRANSFER', round(p_received_amount, 2), current_date,
    'REMISE DE CAISSE', 'Réception physique de remise de caisse',
    coalesce(v_before.reference, 'REMISE:' || v_before.remittance_event_id), 'VALIDE',
    'COMMERCE_CASH_REMITTANCE', 'COMMERCE_CASH_REMITTANCE', v_before.id, v_note, auth.uid()
  ) RETURNING * INTO v_operation;

  INSERT INTO public.finance_commerce_cash_remittance_links(remittance_id, operation_id)
  VALUES (v_before.id, v_operation.id);

  UPDATE public.commerce_cash_remittances
  SET destination_wallet_id = p_destination_wallet_id,
      received_amount = round(p_received_amount, 2),
      remittance_difference = round(p_received_amount - amount, 2),
      status = 'CONFIRMED',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      confirmation_note = v_note,
      updated_at = now()
  WHERE id = v_before.id
  RETURNING * INTO v_remittance;

  PERFORM public.update_wallet_balance(v_before.source_wallet_id);
  PERFORM public.update_wallet_balance(p_destination_wallet_id);
  PERFORM public.business_finance_audit_event(
    'COMMERCE_CASH_REMITTANCE', v_remittance.id, v_operation.id, 'CONFIRM',
    to_jsonb(v_before), to_jsonb(v_remittance)
  );
  RETURN jsonb_build_object('id', v_remittance.id, 'status', v_remittance.status,
    'operationId', v_operation.id, 'receivedAmount', v_remittance.received_amount);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_commerce_cash_remittance_workspace(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_can_declare boolean := public.user_has_permission('commerce.cash.remittance.declare');
  v_can_confirm boolean := public.user_has_permission('commerce.cash.remittance.confirm');
  v_all_cashiers boolean := v_can_confirm;
BEGIN
  PERFORM public.permission_require('commerce.cash.read');
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Magasin non autorisé.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'access', jsonb_build_object('declare', v_can_declare, 'confirm', v_can_confirm),
    'summary', jsonb_build_object(
      'closedTheoretical', coalesce((SELECT sum(closure.server_cash_total)
        FROM public.commerce_pos_cash_session_closures closure
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'closedCounted', coalesce((SELECT sum(closure.counted_cash)
        FROM public.commerce_pos_cash_session_closures closure
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'awaitingConfirmation', coalesce((SELECT sum(remittance.amount)
        FROM public.commerce_cash_remittances remittance
        WHERE remittance.business_location_id = p_location_id AND remittance.status = 'DECLARED'
          AND (v_all_cashiers OR remittance.declared_by = auth.uid())), 0),
      'confirmedReceived', coalesce((SELECT sum(remittance.received_amount)
        FROM public.commerce_cash_remittances remittance
        WHERE remittance.business_location_id = p_location_id AND remittance.status = 'CONFIRMED'
          AND (v_all_cashiers OR remittance.declared_by = auth.uid())), 0),
      'remainingToRemit', coalesce((SELECT sum(greatest(closure.counted_cash - coalesce(used.amount, 0), 0))
        FROM public.commerce_pos_cash_session_closures closure
        LEFT JOIN LATERAL (
          SELECT sum(CASE
            WHEN remittance.status = 'DECLARED' THEN link.allocated_counted_amount
            WHEN remittance.status = 'CONFIRMED' AND remittance.amount > 0
              THEN round(link.allocated_counted_amount * remittance.received_amount / remittance.amount, 2)
            ELSE 0 END) AS amount
          FROM public.commerce_cash_remittance_closures link
          JOIN public.commerce_cash_remittances remittance ON remittance.id = link.remittance_id
          WHERE link.closure_id = closure.id AND remittance.status <> 'CANCELLED'
        ) used ON true
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'cashDifference', coalesce((SELECT sum(closure.server_difference)
        FROM public.commerce_pos_cash_session_closures closure
        WHERE closure.business_location_id = p_location_id
          AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())), 0),
      'remittanceDifference', coalesce((SELECT sum(remittance.remittance_difference)
        FROM public.commerce_cash_remittances remittance
        WHERE remittance.business_location_id = p_location_id AND remittance.status = 'CONFIRMED'
          AND (v_all_cashiers OR remittance.declared_by = auth.uid())), 0)
    ),
    'closures', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', closure.id, 'cashSessionId', closure.cash_session_id,
        'closedAt', closure.closed_at_device,
        'cashierId', closure.cashier_user_id,
        'cashier', coalesce(NULLIF(profile.full_name, ''), NULLIF(profile.username, ''), 'Utilisateur'),
        'theoreticalCash', closure.server_cash_total, 'countedCash', closure.counted_cash,
        'cashDifference', closure.server_difference, 'status', closure.status,
        'remainingAmount', greatest(closure.counted_cash - coalesce(used.amount, 0), 0)
      ) ORDER BY closure.closed_at_device DESC)
      FROM public.commerce_pos_cash_session_closures closure
      LEFT JOIN public.profiles profile ON profile.id = closure.cashier_user_id
      LEFT JOIN LATERAL (
        SELECT sum(CASE
          WHEN remittance.status = 'DECLARED' THEN link.allocated_counted_amount
          WHEN remittance.status = 'CONFIRMED' AND remittance.amount > 0
            THEN round(link.allocated_counted_amount * remittance.received_amount / remittance.amount, 2)
          ELSE 0 END) AS amount
        FROM public.commerce_cash_remittance_closures link
        JOIN public.commerce_cash_remittances remittance ON remittance.id = link.remittance_id
        WHERE link.closure_id = closure.id AND remittance.status <> 'CANCELLED'
      ) used ON true
      WHERE closure.business_location_id = p_location_id
        AND (v_all_cashiers OR closure.cashier_user_id = auth.uid())
    ), '[]'::jsonb),
    'destinationWallets', CASE WHEN v_can_confirm THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', wallet.id, 'name', wallet.name, 'purpose', mapping.purpose)
        ORDER BY mapping.is_primary DESC, wallet.name)
      FROM public.business_location_wallets mapping
      JOIN public.wallets wallet ON wallet.id = mapping.wallet_id
      WHERE mapping.business_location_id = p_location_id
        AND mapping.is_active
        AND mapping.purpose IN ('COLLECTION', 'OPERATING')
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'remittances', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', remittance.id, 'eventId', remittance.remittance_event_id,
        'status', remittance.status, 'declaredAt', remittance.declared_at,
        'confirmedAt', remittance.confirmed_at,
        'expectedAmount', remittance.expected_amount, 'declaredAmount', remittance.amount,
        'receivedAmount', remittance.received_amount,
        'cashDifference', remittance.cashier_difference,
        'remittanceDifference', remittance.remittance_difference,
        'note', remittance.notes, 'confirmationNote', remittance.confirmation_note,
        'cashierId', remittance.declared_by,
        'cashier', coalesce(NULLIF(declarant.full_name, ''), NULLIF(declarant.username, ''), 'Utilisateur'),
        'confirmer', CASE WHEN remittance.confirmed_by IS NULL THEN NULL
          ELSE coalesce(NULLIF(confirmer.full_name, ''), NULLIF(confirmer.username, ''), 'Utilisateur') END,
        'sourceWallet', source_wallet.name, 'destinationWallet', destination_wallet.name,
        'closures', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', closure.id, 'cashSessionId', closure.cash_session_id,
          'closedAt', closure.closed_at_device, 'allocatedAmount', link.allocated_counted_amount
        ) ORDER BY closure.closed_at_device)
          FROM public.commerce_cash_remittance_closures link
          JOIN public.commerce_pos_cash_session_closures closure ON closure.id = link.closure_id
          WHERE link.remittance_id = remittance.id), '[]'::jsonb)
      ) ORDER BY remittance.declared_at DESC)
      FROM public.commerce_cash_remittances remittance
      LEFT JOIN public.profiles declarant ON declarant.id = remittance.declared_by
      LEFT JOIN public.profiles confirmer ON confirmer.id = remittance.confirmed_by
      JOIN public.wallets source_wallet ON source_wallet.id = remittance.source_wallet_id
      LEFT JOIN public.wallets destination_wallet ON destination_wallet.id = remittance.destination_wallet_id
      WHERE remittance.business_location_id = p_location_id
        AND (v_all_cashiers OR remittance.declared_by = auth.uid())
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.declare_commerce_cash_remittance(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_commerce_cash_remittance(uuid, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_commerce_cash_remittance_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_commerce_cash_remittance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_commerce_cash_remittance(uuid, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_commerce_cash_remittance_workspace(uuid) TO authenticated;

COMMENT ON FUNCTION public.confirm_commerce_cash_remittance(uuid, numeric, uuid, text) IS
  'POS-05: confirms physical receipt once and creates one idempotent Finance TRANSFER. It never creates revenue or changes commercial KPIs.';
