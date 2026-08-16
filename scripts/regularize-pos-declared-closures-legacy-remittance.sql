-- PROPOSAL ONLY -- NOT EXECUTED. Prepared per mission-master section 9
-- (AUDIT -> DRY RUN -> impact report -> authorization -> regularization),
-- awaiting explicit authorization before any COMMIT.
--
-- Regularizes the 4 real, physically-counted, never-declared-or-received
-- DECLARED-kind cash session closures found during the Phase 2 legacy
-- cartography audit, at ACCESSOIRES ET SERVICES TELEPHONE
-- (ea6525b1-1a39-407d-b5c8-0c9c1d75fce9), CASH_DRAWER wallet "MAGASIN
-- TETIDOU" (4e5f06e0-359d-45a7-aeda-6253ccf7e142):
--
--   cash-session-f31689c8-... (Traoré abdoul, closed 2026-08-14 10:20) : 400
--   cash-session-b11e5508-... (Traoré abdoul, closed 2026-08-14 10:21) : 300
--   cash-session-56d71fb3-... (Traoré abdoul, closed 2026-08-14 10:37) : 450
--   cash-session-9bc70d5e-... (Mariam keita,  closed 2026-08-14 10:37) : 600
--   TOTAL: 1750
--
-- Why the existing legacy RPCs cannot process this (verified, not assumed):
--   * declare_commerce_cash_remittance computes
--     v_expected_allocation = allocation * closure.server_cash_total / closure.counted_cash.
--     All 4 closures have server_cash_total = 0 (a pre-POS-06
--     session/terminal-attribution artifact -- these sessions predate that
--     fix, so the server-side theoretical never found their sales at all;
--     counted_cash, the cashier's own physical count, is independent of
--     that bug and is the only trustworthy figure here). expected_allocation
--     therefore always computes to 0, and declare_commerce_cash_remittance
--     explicitly rejects that: "Une cloture sans especes comptees ne peut
--     pas etre remise."
--   * confirm_commerce_cash_remittance moves a TRANSFER from the CASH_DRAWER
--     wallet to a destination wallet, requiring the CASH_DRAWER to ALREADY
--     hold at least the received amount as pre-existing balance. Since the
--     wallet-deferred-to-reception migration, sales no longer auto-fund
--     that wallet at all -- its current balance (7250) comes entirely from
--     unrelated, already-reconciled receptions on OTHER sessions. Running a
--     TRANSFER out of it to "cover" these 4 unrelated historical closures
--     would silently misattribute already-reconciled cash to a different
--     event, corrupting the wallet's meaning, even though the arithmetic
--     would happen to clear (7250 > 1750).
--
-- This script therefore does NOT reuse either legacy RPC. It inserts
-- directly, mirroring exactly what confirm_commerce_pos_cash_reception
-- already does for the current (AUTOMATIC-closure) reception path -- one
-- DEPOSIT per closure, straight to the CASH_DRAWER, never a TRANSFER,
-- never a second wallet -- just applied retroactively to these 4
-- DECLARED-kind closures via commerce_cash_remittances/
-- commerce_cash_remittance_closures for traceability, exactly as POS-05
-- already models "one physical remittance settles one closure's counted
-- cash." Kept as 4 separate remittances/DEPOSITs (not one lump sum) so
-- each closure keeps its own auditable trail, consistent with how every
-- other closure in this system resolves individually.
--
-- Basis: counted_cash is trusted as both expected and received (the
-- cashier's own count, taken at face value -- there is no way to
-- physically recount cash from a session closed on 2026-08-14). No
-- difference is recorded. Every inserted row is tagged in its note/
-- reference so this regularization is permanently traceable as such.
--
-- These tables have no direct authenticated GRANT (RPC-only writes under
-- RLS): if authorized, this must run with the same privileged/service-role
-- connection already used for migrations, not through the app.

BEGIN;

DO $regularize$
DECLARE
  v_wallet_id CONSTANT uuid := '4e5f06e0-359d-45a7-aeda-6253ccf7e142';
  v_location_id CONSTANT uuid := 'ea6525b1-1a39-407d-b5c8-0c9c1d75fce9';
  v_manager_id uuid;
  v_closure record;
  v_row_count integer;
  v_remittance_id uuid;
  v_operation_id uuid;
  v_total_deposited numeric(14, 2) := 0;
  v_expected_closures CONSTANT text[] := ARRAY[
    'cash-session-f31689c8-c1da-4135-8882-c8aed5672d80',
    'cash-session-b11e5508-f337-4115-a8c3-96fd12e5f39e',
    'cash-session-56d71fb3-a48e-4380-8be7-7d7a5d6cec38',
    'cash-session-9bc70d5e-4f87-4f6c-a829-f08fb3cc19cd'
  ];
BEGIN
  -- The executing actor must be a real manager-tier user (never the
  -- cashier who counted the cash) -- same separation-of-duties rule
  -- confirm_commerce_cash_remittance already enforces.
  SELECT user_id INTO v_manager_id
  FROM public.user_roles
  WHERE role IN ('gestionnaire'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
  ORDER BY user_id LIMIT 1;
  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: no manager-tier actor found to attribute this regularization to.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_manager_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  IF (SELECT count(*) FROM public.commerce_pos_cash_session_closures
      WHERE cash_session_id = ANY(v_expected_closures)) <> 4 THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: expected exactly the 4 known closures, state has drifted since the audit.';
  END IF;

  FOR v_closure IN
    SELECT closure.id, closure.cash_session_id, closure.counted_cash, closure.business_location_id
    FROM public.commerce_pos_cash_session_closures closure
    WHERE closure.cash_session_id = ANY(v_expected_closures)
    ORDER BY closure.received_at_server
  LOOP
    -- Pre-check: refuse to guess if anything has moved since the audit.
    IF v_closure.business_location_id <> v_location_id THEN
      RAISE EXCEPTION 'REGULARIZE_ABORTED: closure % is not at the expected location.', v_closure.cash_session_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.commerce_cash_remittance_closures link WHERE link.closure_id = v_closure.id) THEN
      RAISE EXCEPTION 'REGULARIZE_ABORTED: closure % already has a remittance link -- state has drifted, refusing to double-process.', v_closure.cash_session_id;
    END IF;
    IF v_closure.counted_cash IS NULL OR v_closure.counted_cash <= 0 THEN
      RAISE EXCEPTION 'REGULARIZE_ABORTED: closure % has no positive counted_cash to regularize.', v_closure.cash_session_id;
    END IF;

    INSERT INTO public.finance_operations(
      wallet_id, destination_wallet_id, type, amount, operation_date, category,
      description, reference, status, origin, module, module_id, notes, created_by
    ) VALUES (
      v_wallet_id, NULL, 'DEPOSIT', round(v_closure.counted_cash, 2), current_date,
      'REMISE DE CAISSE',
      'Regularisation historique -- cloture DECLARED pre-POS-06 jamais remise -- ' || v_closure.cash_session_id,
      'POS-LEGACY-REGULARIZE:' || v_closure.cash_session_id, 'VALIDE',
      'COMMERCE_CASH_REMITTANCE', 'COMMERCE_CASH_REMITTANCE', NULL,
      'Regularisation historique (mission maitre, Phase 2 legacy). server_cash_total=0 sur cette cloture (artefact pre-attribution POS-06, sessions non rattachees) -- montant base sur counted_cash (compte physique du caissier), seule valeur fiable disponible. Aucun ecart enregistre : counted_cash traite comme recu integralement.',
      v_manager_id
    ) RETURNING id INTO v_operation_id;

    INSERT INTO public.commerce_cash_remittances(
      remittance_event_id, business_location_id, source_wallet_id, destination_wallet_id,
      expected_amount, amount, cashier_difference, remittance_date, status,
      reference, notes, declared_by, declared_at, payload_hash,
      received_amount, remittance_difference, confirmed_by, confirmed_at, confirmation_note, is_final
    ) VALUES (
      'pos-legacy-regularize-' || v_closure.cash_session_id, v_location_id, v_wallet_id, NULL,
      round(v_closure.counted_cash, 2), round(v_closure.counted_cash, 2), 0, current_date, 'CONFIRMED',
      'Regularisation historique -- ' || v_closure.cash_session_id,
      'Cloture DECLARED pre-POS-06, server_cash_total=0, jamais remise. Montant = counted_cash du caissier.',
      NULL, now(), md5('pos-legacy-regularize-' || v_closure.cash_session_id),
      round(v_closure.counted_cash, 2), 0, v_manager_id, now(),
      'Regularisation historique mission maitre Phase 2.', true
    ) RETURNING id INTO v_remittance_id;

    INSERT INTO public.commerce_cash_remittance_closures(
      remittance_id, closure_id, allocated_counted_amount, allocated_expected_amount
    ) VALUES (
      v_remittance_id, v_closure.id, round(v_closure.counted_cash, 2), round(v_closure.counted_cash, 2)
    );

    INSERT INTO public.finance_commerce_cash_remittance_links(remittance_id, operation_id)
    VALUES (v_remittance_id, v_operation_id);

    v_total_deposited := v_total_deposited + v_closure.counted_cash;
  END LOOP;

  PERFORM public.update_wallet_balance(v_wallet_id);

  IF v_total_deposited <> 1750 THEN
    RAISE EXCEPTION 'REGULARIZE_ABORTED: total deposited must be exactly 1750 (400+300+450+600), got %.', v_total_deposited;
  END IF;

  RAISE NOTICE 'REGULARIZE_OK: 4 DEPOSIT operations totalling % credited to wallet %, one CONFIRMED remittance per closure, all traceable via reference POS-LEGACY-REGULARIZE:<cash_session_id>.', v_total_deposited, v_wallet_id;
END;
$regularize$;

-- In-transaction verification, visible whether this run ends in ROLLBACK
-- or COMMIT.
SELECT
  (SELECT balance FROM public.wallets WHERE id = '4e5f06e0-359d-45a7-aeda-6253ccf7e142') AS wallet_balance_after,
  (SELECT count(*) FROM public.commerce_cash_remittances WHERE remittance_event_id LIKE 'pos-legacy-regularize-%') AS remittances_created,
  (SELECT coalesce(sum(amount), 0) FROM public.finance_operations WHERE reference LIKE 'POS-LEGACY-REGULARIZE:%') AS finance_operations_total;

ROLLBACK; -- change to COMMIT on a deliberate, separately-authorized copy to actually apply
