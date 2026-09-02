-- Wallet parent/sub-wallet hierarchy (user-named containers, e.g. "Marasse"
-- -> "Wave"/"Especes"/"Banque"). Distinct from the existing Finance V2
-- `module` hierarchy (fixed MOTOS/VEHICULES/AGRICULTURE/COMMERCE/TRANSPORT
-- vocabulary, asset-linked) -- this one is user-created, single level, and
-- reuses that system's core principle: no separate stored balance for the
-- parent, consolidated total is always SUM(children.balance), computed on
-- read. Additive only: no existing column, row, or balance is touched.

ALTER TABLE public.wallets
  ADD COLUMN parent_wallet_id uuid NULL REFERENCES public.wallets(id) ON DELETE RESTRICT;

ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_no_self_parent CHECK (parent_wallet_id IS NULL OR parent_wallet_id <> id);

CREATE INDEX wallets_parent_idx ON public.wallets (parent_wallet_id) WHERE parent_wallet_id IS NOT NULL;

COMMENT ON COLUMN public.wallets.parent_wallet_id IS
  'User-created single-level parent (e.g. "Marasse" containing "Wave"/"Especes"). NULL = standalone wallet or the parent itself. A wallet with children must never be directly targeted by new finance_operations -- its own balance is expected to be 0 once converted (see convert_wallet_to_parent). Distinct from wallets.module (Finance V2 asset-linked analytical grouping).';

-- ---------------------------------------------------------------------
-- Single-level depth + no self/cycle, enforced at the only two write
-- paths (RLS has no INSERT/UPDATE policy on wallets -- every write is
-- already forced through wallet_create/wallet_update). A wallet can be
-- EITHER a parent (has children) OR a child (has parent_wallet_id set),
-- never both -- enforced by requiring the target of a new parent-link to
-- itself be parentless, and requiring a wallet being (re)parented to
-- itself be childless.
CREATE OR REPLACE FUNCTION public._internal_validate_wallet_parent_link(p_wallet_id uuid, p_parent_wallet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_parent public.wallets;
  v_child_count integer;
BEGIN
  IF p_parent_wallet_id IS NULL THEN
    RETURN;
  END IF;

  IF p_wallet_id IS NOT NULL AND p_parent_wallet_id = p_wallet_id THEN
    RAISE EXCEPTION 'Un wallet ne peut pas être son propre parent.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_parent FROM public.wallets WHERE id = p_parent_wallet_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet parent introuvable.' USING ERRCODE = '23503';
  END IF;
  IF v_parent.is_archived THEN
    RAISE EXCEPTION 'Le wallet parent est archivé.' USING ERRCODE = '22023';
  END IF;
  IF v_parent.parent_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ce wallet est déjà un sous-wallet : impossible d''y rattacher un autre sous-wallet (un seul niveau de hiérarchie).' USING ERRCODE = '22023';
  END IF;

  IF p_wallet_id IS NOT NULL THEN
    SELECT count(*) INTO v_child_count FROM public.wallets WHERE parent_wallet_id = p_wallet_id;
    IF v_child_count > 0 THEN
      RAISE EXCEPTION 'Ce wallet a déjà ses propres sous-wallets : il ne peut pas devenir lui-même un sous-wallet.' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_validate_wallet_parent_link(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_validate_wallet_parent_link(uuid, uuid) FROM anon;

-- wallet_create: accept an optional parent_wallet_id in the same jsonb
-- payload style as every other field on this function.
CREATE OR REPLACE FUNCTION public.wallet_create(p_wallet jsonb)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_wallet public.wallets;
  v_name text := NULLIF(trim(p_wallet ->> 'name'), '');
  v_type text := NULLIF(trim(p_wallet ->> 'type'), '');
  v_initial_balance numeric(14, 2) := COALESCE(NULLIF(p_wallet ->> 'initial_balance', '')::numeric, 0);
  v_is_default boolean := COALESCE(NULLIF(p_wallet ->> 'is_default', '')::boolean, false);
  v_parent_wallet_id uuid := NULLIF(p_wallet ->> 'parent_wallet_id', '')::uuid;
BEGIN
  PERFORM public.security_require_finance_role();
  IF v_name IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'Le nom et le type du wallet sont obligatoires.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._internal_validate_wallet_parent_link(NULL, v_parent_wallet_id);
  IF v_is_default THEN
    UPDATE public.wallets SET is_default = false, updated_at = now() WHERE is_default = true;
  END IF;
  INSERT INTO public.wallets(name, type, initial_balance, balance, color, icon, is_default, parent_wallet_id)
  VALUES (
    v_name,
    v_type,
    v_initial_balance,
    v_initial_balance,
    NULLIF(trim(p_wallet ->> 'color'), ''),
    NULLIF(trim(p_wallet ->> 'icon'), ''),
    v_is_default,
    v_parent_wallet_id
  )
  RETURNING * INTO v_wallet;
  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (auth.uid(), 'WALLET_CREATED', 'WALLET', v_wallet.id, jsonb_build_object('name', v_wallet.name));
  RETURN v_wallet;
END;
$function$;

-- wallet_update: same p_values-presence pattern as every other field.
-- Reparenting an EXISTING wallet (as opposed to setting a parent at
-- creation time) is gated behind wallets.hierarchy.manage specifically --
-- the same permission already used for reassign_wallet_asset/archive_wallet,
-- the other two "changes this wallet's structural role" actions.
CREATE OR REPLACE FUNCTION public.wallet_update(p_wallet_id uuid, p_values jsonb)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.wallets;
  v_wallet public.wallets;
  v_make_default boolean;
  v_new_initial_balance numeric;
  v_new_parent_wallet_id uuid;
BEGIN
  PERFORM public.security_require_finance_role();
  IF p_values ? 'balance' THEN
    RAISE EXCEPTION 'Le solde est calculé automatiquement et ne peut pas être modifié directement.' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'name' AND NULLIF(trim(p_values ->> 'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Le nom du wallet ne peut pas être vide.' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'type' AND NULLIF(trim(p_values ->> 'type'), '') IS NULL THEN
    RAISE EXCEPTION 'Le type du wallet ne peut pas être vide.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF p_values ? 'parent_wallet_id' THEN
    PERFORM public._internal_require_wallet_hierarchy_manage();
    v_new_parent_wallet_id := NULLIF(p_values ->> 'parent_wallet_id', '')::uuid;
    PERFORM public._internal_validate_wallet_parent_link(p_wallet_id, v_new_parent_wallet_id);
  ELSE
    v_new_parent_wallet_id := v_before.parent_wallet_id;
  END IF;

  v_make_default := CASE WHEN p_values ? 'is_default' THEN COALESCE(NULLIF(p_values ->> 'is_default', '')::boolean, false) ELSE v_before.is_default END;
  IF v_make_default THEN
    UPDATE public.wallets SET is_default = false, updated_at = now() WHERE is_default = true AND id <> p_wallet_id;
  END IF;

  v_new_initial_balance := CASE WHEN p_values ? 'initial_balance' THEN NULLIF(p_values ->> 'initial_balance', '')::numeric ELSE v_before.initial_balance END;

  UPDATE public.wallets
  SET name = CASE WHEN p_values ? 'name' THEN trim(p_values ->> 'name') ELSE name END,
      type = CASE WHEN p_values ? 'type' THEN trim(p_values ->> 'type') ELSE type END,
      initial_balance = v_new_initial_balance,
      color = CASE WHEN p_values ? 'color' THEN NULLIF(trim(p_values ->> 'color'), '') ELSE color END,
      icon = CASE WHEN p_values ? 'icon' THEN NULLIF(trim(p_values ->> 'icon'), '') ELSE icon END,
      is_default = v_make_default,
      parent_wallet_id = v_new_parent_wallet_id,
      updated_at = now()
  WHERE id = p_wallet_id
  RETURNING * INTO v_wallet;

  PERFORM public.update_wallet_balance(p_wallet_id);
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;

  IF p_values ? 'initial_balance' AND v_new_initial_balance IS DISTINCT FROM v_before.initial_balance THEN
    INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
    VALUES (
      'wallet', p_wallet_id, 'UPDATE',
      jsonb_build_object('initial_balance', v_before.initial_balance),
      jsonb_build_object('initial_balance', v_new_initial_balance, 'delta', v_new_initial_balance - v_before.initial_balance),
      auth.uid()
    );
  END IF;

  INSERT INTO public.security_audit_log(actor_user_id, event_type, resource_type, resource_id, metadata)
  VALUES (auth.uid(), 'WALLET_UPDATED', 'WALLET', p_wallet_id, jsonb_build_object('name', v_wallet.name));
  RETURN v_wallet;
END;
$function$;

-- ---------------------------------------------------------------------
-- finance_create_operation gates on finance_require_write_role() (needs
-- finance.create/finance.update/finance.cancel/wallets.manage). But
-- wallets.hierarchy.manage -- the permission this migration uses to gate
-- convert_wallet_to_parent below -- is granted to 'gestionnaire', a role
-- that has NONE of those finance permissions (confirmed against
-- 20260729091000_add_granular_permissions.sql's explicit gestionnaire
-- allow-list). Without this split, a gestionnaire authorized for wallet
-- hierarchy actions would pass the outer check and then hit a confusing
-- 42501 deep inside the allocation loop. Fix: extract the actual body into
-- an internal function with no permission check of its own, called by
-- finance_create_operation (after ITS check, unchanged for every existing
-- caller) and by convert_wallet_to_parent (after ITS OWN, already-passed
-- wallets.hierarchy.manage check) -- never reachable unchecked from outside.
CREATE OR REPLACE FUNCTION public._internal_create_finance_operation(p_operation jsonb, p_link_module text DEFAULT NULL::text, p_link_record_id uuid DEFAULT NULL::uuid)
 RETURNS finance_operations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_operation public.finance_operations;
  v_type text := upper(trim(COALESCE(p_operation ->> 'type', '')));
  v_wallet_id uuid := NULLIF(p_operation ->> 'wallet_id', '')::uuid;
  v_destination_wallet_id uuid := NULLIF(p_operation ->> 'destination_wallet_id', '')::uuid;
  v_amount numeric(14, 2) := NULLIF(p_operation ->> 'amount', '')::numeric;
  v_source_balance numeric(14, 2);
BEGIN
  IF v_type NOT IN ('REVENUE', 'EXPENSE', 'DEPOSIT', 'TRANSFER') THEN
    RAISE EXCEPTION 'Type financier invalide : %', v_type USING ERRCODE = '22023';
  END IF;

  IF v_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet source est obligatoire et doit exister.' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (SELECT 1 FROM public.wallets WHERE id = v_wallet_id AND is_archived) THEN
    RAISE EXCEPTION 'Ce wallet est archivé : réactivez-le avant d''y enregistrer une opération.' USING ERRCODE = '22023';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.' USING ERRCODE = '22023';
  END IF;

  IF v_type = 'TRANSFER' THEN
    IF v_destination_wallet_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = v_destination_wallet_id) THEN
      RAISE EXCEPTION 'Le wallet destination est obligatoire pour un transfert.' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wallets WHERE id = v_destination_wallet_id AND is_archived) THEN
      RAISE EXCEPTION 'Le wallet destination est archivé.' USING ERRCODE = '22023';
    END IF;
    IF v_wallet_id = v_destination_wallet_id THEN
      RAISE EXCEPTION 'Les wallets source et destination doivent être différents.' USING ERRCODE = '22023';
    END IF;

    SELECT balance INTO v_source_balance
    FROM public.wallets
    WHERE id = v_wallet_id
    FOR UPDATE;

    IF COALESCE(v_source_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Solde insuffisant. Disponible : % FCFA.', COALESCE(v_source_balance, 0) USING ERRCODE = '23514';
    END IF;
  ELSIF v_destination_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Seul un transfert peut désigner un wallet destination.' USING ERRCODE = '22023';
  END IF;

  IF (p_link_module IS NULL) <> (p_link_record_id IS NULL) THEN
    RAISE EXCEPTION 'Le module et son identifiant doivent être fournis ensemble.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_operations (
    wallet_id, destination_wallet_id, type, amount, operation_date,
    category, description, reference, status, origin, module, module_id,
    payment_method, payment_reference, supplier, client, employee, project,
    vehicle_id, farm_id, motorcycle_id, driver_id, employee_id, contract_id,
    harvest_id, maintenance_id, motorcycle_maintenance_id, inventory_item_id,
    attachment_url, notes, created_by
  ) VALUES (
    v_wallet_id, v_destination_wallet_id, v_type, v_amount,
    COALESCE(NULLIF(p_operation ->> 'operation_date', '')::date, current_date),
    NULLIF(p_operation ->> 'category', ''), NULLIF(p_operation ->> 'description', ''),
    NULLIF(p_operation ->> 'reference', ''), COALESCE(NULLIF(p_operation ->> 'status', ''), 'VALIDE'),
    NULLIF(p_operation ->> 'origin', ''), NULLIF(p_operation ->> 'module', ''),
    NULLIF(p_operation ->> 'module_id', '')::uuid, NULLIF(p_operation ->> 'payment_method', ''),
    NULLIF(p_operation ->> 'payment_reference', ''), NULLIF(p_operation ->> 'supplier', ''),
    NULLIF(p_operation ->> 'client', ''), NULLIF(p_operation ->> 'employee', ''),
    NULLIF(p_operation ->> 'project', ''), NULLIF(p_operation ->> 'vehicle_id', '')::uuid,
    NULLIF(p_operation ->> 'farm_id', '')::uuid, NULLIF(p_operation ->> 'motorcycle_id', '')::uuid,
    NULLIF(p_operation ->> 'driver_id', '')::uuid, NULLIF(p_operation ->> 'employee_id', '')::uuid,
    NULLIF(p_operation ->> 'contract_id', '')::uuid, NULLIF(p_operation ->> 'harvest_id', '')::uuid,
    NULLIF(p_operation ->> 'maintenance_id', '')::uuid,
    NULLIF(p_operation ->> 'motorcycle_maintenance_id', '')::uuid,
    NULLIF(p_operation ->> 'inventory_item_id', '')::uuid,
    NULLIF(p_operation ->> 'attachment_url', ''), NULLIF(p_operation ->> 'notes', ''), auth.uid()
  ) RETURNING * INTO v_operation;

  IF p_link_module IS NOT NULL THEN
    INSERT INTO public.finance_links (finance_operation_id, module, module_record_id)
    VALUES (v_operation.id, p_link_module, p_link_record_id)
    ON CONFLICT (finance_operation_id, module, module_record_id) DO NOTHING;
  END IF;

  PERFORM public.update_wallet_balance(v_wallet_id);
  IF v_destination_wallet_id IS NOT NULL THEN
    PERFORM public.update_wallet_balance(v_destination_wallet_id);
  END IF;

  RETURN v_operation;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_create_finance_operation(jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_create_finance_operation(jsonb, text, uuid) FROM anon;

-- ---------------------------------------------------------------------
-- PHASE 2B -- central, table-level guard. The audit found that
-- _internal_create_finance_operation is NOT the only writer of
-- finance_operations: Commerce POS, Transport/Courses, Field and several
-- legacy backfills each INSERT INTO finance_operations directly, in their
-- own dedicated functions. Rewriting ~19 pre-existing functions to funnel
-- through one engine is a far bigger change than this mission asks for.
-- A BEFORE INSERT/UPDATE trigger on the table itself protects every one
-- of them uniformly instead -- today's writers and any future one --
-- with zero changes to those files.
--
-- The one legitimate exception is convert_wallet_to_parent's own
-- migration-transfer loop below, where the source (the wallet being
-- converted) necessarily already has children by the time each transfer
-- posts -- that IS the conversion. That function alone flips a
-- transaction-local setting immediately before its loop and back off
-- immediately after.
--
-- Precisely what this does and does not rely on: set_config() itself is a
-- plain PostgreSQL builtin with no GRANT/REVOKE story -- ANY role,
-- including authenticated, can call set_config('wallet_hierarchy.conversion_bypass',
-- 'on', true) directly, in isolation. That alone is harmless: nothing
-- reads this setting except the trigger above, and doing so buys an
-- attacker nothing unless they can ALSO get a finance_operations INSERT
-- to run in that very same transaction. The real boundary is
-- architectural, not this GUC: every request Supabase exposes to
-- authenticated/anon goes through PostgREST's REST/RPC layer, where one
-- HTTP call runs exactly one function in its own transaction -- there is
-- no way for an external caller to submit "set_config, then
-- finance_create_operation" as two statements sharing a transaction, and
-- no other RPC in this schema calls set_config on this setting for them.
-- (A trusted, first-party connection with raw multi-statement SQL access
-- -- e.g. this migration's own author, or a future admin console with
-- direct Postgres access -- is a different, already-privileged trust
-- boundary, equivalent to any other superuser/service-role capability,
-- not an authenticated-user exploit.) Being transaction-local
-- (set_config(..., true)), the flag can never leak to a concurrent
-- session either way, and if the loop raises partway through, the whole
-- transaction (and the setting with it) rolls back -- it cannot get
-- stuck "on".
CREATE OR REPLACE FUNCTION public._internal_enforce_wallet_not_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('wallet_hierarchy.conversion_bypass', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.wallets WHERE parent_wallet_id = NEW.wallet_id) THEN
    RAISE EXCEPTION 'Ce wallet est un wallet parent consolidateur : choisissez un sous-wallet pour cette opération.' USING ERRCODE = '22023';
  END IF;

  IF NEW.destination_wallet_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.wallets WHERE parent_wallet_id = NEW.destination_wallet_id) THEN
    RAISE EXCEPTION 'Le wallet destination est un wallet parent consolidateur : choisissez un sous-wallet.' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_enforce_wallet_not_parent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_enforce_wallet_not_parent() FROM anon;
-- (Trigger functions return the `trigger` pseudo-type, which PostgreSQL
-- refuses to invoke from plain SQL -- REVOKE here is defensive and
-- consistent with the rest of this file, not load-bearing: the only way
-- this function ever runs is as a trigger, regardless of any GRANT.)

DROP TRIGGER IF EXISTS trg_enforce_wallet_not_parent ON public.finance_operations;
CREATE TRIGGER trg_enforce_wallet_not_parent
  BEFORE INSERT OR UPDATE OF wallet_id, destination_wallet_id ON public.finance_operations
  FOR EACH ROW
  EXECUTE FUNCTION public._internal_enforce_wallet_not_parent();

CREATE OR REPLACE FUNCTION public.finance_create_operation(p_operation jsonb, p_link_module text DEFAULT NULL::text, p_link_record_id uuid DEFAULT NULL::uuid)
 RETURNS finance_operations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.finance_require_write_role();
  RETURN public._internal_create_finance_operation(p_operation, p_link_module, p_link_record_id);
END;
$function$;

-- ---------------------------------------------------------------------
-- Explicit, controlled conversion of an existing wallet into a parent.
-- Never moves money silently: every allocation becomes a real, auditable
-- TRANSFER via the existing finance_create_operation (same row lock, same
-- balance checks, same update_wallet_balance call it already uses for any
-- other transfer) -- this function only orchestrates which wallets are
-- involved, it does not touch balance arithmetic itself.
--
-- Two entry points sharing one internal planner:
--   preview_wallet_parent_conversion -- read-only, validates and returns
--     the exact plan (before/after balances, JEKO mapping if any) so the
--     caller can show it to the user before anything is written.
--   convert_wallet_to_parent -- re-validates against a freshly locked
--     balance (state may have changed since the preview was shown) and
--     actually executes it.
--
-- p_allocations shape: jsonb array, each element either
--   {"existing_wallet_id": "<uuid>", "amount": <number>}
-- or
--   {"new_wallet_name": "<text>", "new_wallet_type": "<text>", "amount": <number>}

CREATE OR REPLACE FUNCTION public._internal_plan_wallet_parent_conversion(p_wallet_id uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_wallet public.wallets;
  v_allocation jsonb;
  v_existing_id uuid;
  v_new_name text;
  v_new_type text;
  v_amount numeric(14, 2);
  v_sum numeric(14, 2) := 0;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_targets jsonb := '[]'::jsonb;
  v_target_wallet public.wallets;
  v_jeko_mapping jsonb;
  v_jeko_pending jsonb;
BEGIN
  PERFORM public._internal_require_wallet_hierarchy_manage();

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF v_wallet.is_archived THEN
    RAISE EXCEPTION 'Ce wallet est archivé.' USING ERRCODE = '22023';
  END IF;
  IF v_wallet.parent_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ce wallet est déjà un sous-wallet : il ne peut pas devenir parent.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets WHERE parent_wallet_id = p_wallet_id) THEN
    RAISE EXCEPTION 'Ce wallet a déjà des sous-wallets : cette conversion ne s''applique qu''à la toute première répartition.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Au moins une répartition est requise.' USING ERRCODE = '22023';
  END IF;

  FOR v_allocation IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_existing_id := NULLIF(v_allocation ->> 'existing_wallet_id', '')::uuid;
    v_new_name := NULLIF(trim(v_allocation ->> 'new_wallet_name'), '');
    v_new_type := NULLIF(trim(v_allocation ->> 'new_wallet_type'), '');
    v_amount := NULLIF(v_allocation ->> 'amount', '')::numeric;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Chaque répartition doit avoir un montant strictement positif.' USING ERRCODE = '22023';
    END IF;
    IF (v_existing_id IS NULL) = (v_new_name IS NULL) THEN
      RAISE EXCEPTION 'Chaque répartition doit désigner soit un sous-wallet existant, soit un nom pour un nouveau sous-wallet (jamais les deux, ni aucun des deux).' USING ERRCODE = '22023';
    END IF;
    IF v_new_name IS NOT NULL AND v_new_type IS NULL THEN
      RAISE EXCEPTION 'Le type est obligatoire pour un nouveau sous-wallet.' USING ERRCODE = '22023';
    END IF;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_id = p_wallet_id THEN
        RAISE EXCEPTION 'Le wallet parent ne peut pas être sa propre destination.' USING ERRCODE = '22023';
      END IF;
      IF v_existing_id = ANY(v_seen_ids) THEN
        RAISE EXCEPTION 'Le même sous-wallet existant ne peut pas recevoir deux répartitions distinctes.' USING ERRCODE = '22023';
      END IF;
      v_seen_ids := array_append(v_seen_ids, v_existing_id);

      SELECT * INTO v_target_wallet FROM public.wallets WHERE id = v_existing_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Un des sous-wallets existants sélectionnés est introuvable.' USING ERRCODE = '23503';
      END IF;
      IF v_target_wallet.is_archived THEN
        RAISE EXCEPTION 'Le sous-wallet "%" est archivé.', v_target_wallet.name USING ERRCODE = '22023';
      END IF;
      IF v_target_wallet.parent_wallet_id IS NOT NULL AND v_target_wallet.parent_wallet_id <> p_wallet_id THEN
        RAISE EXCEPTION 'Le sous-wallet "%" appartient déjà à un autre wallet parent.', v_target_wallet.name USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.wallets WHERE parent_wallet_id = v_target_wallet.id) THEN
        RAISE EXCEPTION 'Le wallet "%" a lui-même des sous-wallets : impossible de l''utiliser comme destination (un seul niveau de hiérarchie).', v_target_wallet.name USING ERRCODE = '22023';
      END IF;

      v_targets := v_targets || jsonb_build_object(
        'existing_wallet_id', v_existing_id,
        'name', v_target_wallet.name,
        'balance_before', COALESCE(v_target_wallet.balance, 0),
        'balance_after', COALESCE(v_target_wallet.balance, 0) + v_amount,
        'amount', v_amount,
        'is_new', false
      );
    ELSE
      v_targets := v_targets || jsonb_build_object(
        'new_wallet_name', v_new_name,
        'new_wallet_type', v_new_type,
        'balance_before', 0,
        'balance_after', v_amount,
        'amount', v_amount,
        'is_new', true
      );
    END IF;

    v_sum := v_sum + v_amount;
  END LOOP;

  IF v_sum <> COALESCE(v_wallet.balance, 0) THEN
    RAISE EXCEPTION 'La somme des répartitions (% FCFA) doit être exactement égale au solde actuel du wallet (% FCFA).', v_sum, COALESCE(v_wallet.balance, 0) USING ERRCODE = '22023';
  END IF;

  -- A Jèko Course payment already RECEIVED but not yet CONFIRMED still
  -- carries this wallet's id on transport_invoice_payments -- by this
  -- stage its payment_provider_payment_requests row is already COMPLETED,
  -- so the PENDING-request remap below can no longer reach it. There is
  -- no safe automatic remap for one specific already-received payment
  -- (that would move a real receipt to a different wallet without a
  -- traceable operation), so block until a human confirms or cancels it
  -- explicitly, on the wallet it was actually received on.
  IF EXISTS (
    SELECT 1 FROM public.transport_invoice_payments
    WHERE wallet_id = p_wallet_id AND status IN ('PLANNED', 'RECEIVED')
  ) THEN
    RAISE EXCEPTION 'Ce wallet a des paiements Course reçus mais pas encore confirmés : confirmez-les ou annulez-les avant de convertir ce wallet.' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('provider_store_id', provider_store_id, 'wallet_id', wallet_id))
  INTO v_jeko_mapping
  FROM public.payment_provider_wallet_mappings
  WHERE wallet_id = p_wallet_id AND provider = 'JEKO' AND is_active;

  -- Still-PENDING Jèko requests (Course or Commercial -- both share this
  -- table) that would otherwise resolve to this wallet's frozen id the
  -- moment they are paid, arbitrarily long after this conversion.
  SELECT jsonb_agg(jsonb_build_object(
    'provider_store_id', provider_store_id,
    'provider_reference', provider_reference
  ))
  INTO v_jeko_pending
  FROM public.payment_provider_payment_requests
  WHERE wallet_id = p_wallet_id AND provider = 'JEKO' AND status = 'PENDING';

  RETURN jsonb_build_object(
    'wallet_id', p_wallet_id,
    'wallet_name', v_wallet.name,
    'balance_before', COALESCE(v_wallet.balance, 0),
    'balance_after', 0::numeric,
    'targets', v_targets,
    'jeko_mappings', COALESCE(v_jeko_mapping, '[]'::jsonb),
    'jeko_pending_requests', COALESCE(v_jeko_pending, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_plan_wallet_parent_conversion(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_plan_wallet_parent_conversion(uuid, jsonb) FROM anon;

CREATE OR REPLACE FUNCTION public.preview_wallet_parent_conversion(p_wallet_id uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  -- The planner only SELECTs (including its FOR UPDATE row lock, released
  -- at this function's own commit) -- it never INSERTs/UPDATEs/DELETEs, so
  -- calling it directly is already side-effect-free. Reuses the exact same
  -- validation as the real conversion rather than a second, potentially
  -- diverging copy of it.
  RETURN public._internal_plan_wallet_parent_conversion(p_wallet_id, p_allocations);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_wallet_parent_conversion(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_wallet_parent_conversion(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_wallet_parent_conversion(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_wallet_to_parent(p_wallet_id uuid, p_allocations jsonb, p_jeko_remap jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_plan jsonb;
  v_target jsonb;
  v_target_wallet_id uuid;
  v_remap jsonb;
  v_remapped_count integer;
  v_remapped_requests_count integer;
BEGIN
  v_plan := public._internal_plan_wallet_parent_conversion(p_wallet_id, p_allocations);

  IF (jsonb_array_length(v_plan -> 'jeko_mappings') > 0 OR jsonb_array_length(v_plan -> 'jeko_pending_requests') > 0)
     AND (p_jeko_remap IS NULL OR jsonb_array_length(p_jeko_remap) = 0) THEN
    RAISE EXCEPTION 'Ce wallet est actuellement lié à des paiements Jèko (configuration active ou demande en attente) : indiquez le sous-wallet de remplacement avant de continuer.' USING ERRCODE = '22023';
  END IF;

  -- From this point on the wallet being converted is about to have
  -- children -- these transfers are the one sanctioned exception to "a
  -- parent wallet is never a direct finance_operations source" enforced
  -- by trg_enforce_wallet_not_parent. Scope the bypass as tightly as
  -- possible: only this loop, switched back off immediately after
  -- regardless of how the loop ends (and automatically undone by
  -- rollback if it never gets the chance to run -- see the guard
  -- function's own comment).
  PERFORM set_config('wallet_hierarchy.conversion_bypass', 'on', true);

  FOR v_target IN SELECT * FROM jsonb_array_elements(v_plan -> 'targets')
  LOOP
    IF (v_target ->> 'is_new')::boolean THEN
      INSERT INTO public.wallets (name, type, initial_balance, balance, parent_wallet_id)
      VALUES (v_target ->> 'new_wallet_name', v_target ->> 'new_wallet_type', 0, 0, p_wallet_id)
      RETURNING id INTO v_target_wallet_id;
    ELSE
      v_target_wallet_id := (v_target ->> 'existing_wallet_id')::uuid;
      UPDATE public.wallets SET parent_wallet_id = p_wallet_id, updated_at = now() WHERE id = v_target_wallet_id;
    END IF;

    PERFORM public._internal_create_finance_operation(jsonb_build_object(
      'type', 'TRANSFER',
      'wallet_id', p_wallet_id,
      'destination_wallet_id', v_target_wallet_id,
      'amount', (v_target ->> 'amount')::numeric,
      'category', 'Conversion en wallet parent',
      'description', format('Répartition du solde historique de "%s" lors de sa conversion en wallet parent.', v_plan ->> 'wallet_name'),
      'operation_date', current_date::text
    ));
  END LOOP;

  PERFORM set_config('wallet_hierarchy.conversion_bypass', 'off', true);

  IF p_jeko_remap IS NOT NULL THEN
    FOR v_remap IN SELECT * FROM jsonb_array_elements(p_jeko_remap)
    LOOP
      UPDATE public.payment_provider_wallet_mappings
      SET wallet_id = (v_remap ->> 'new_wallet_id')::uuid, updated_at = now()
      WHERE provider = 'JEKO'
        AND provider_store_id = v_remap ->> 'provider_store_id'
        AND wallet_id = p_wallet_id;
      GET DIAGNOSTICS v_remapped_count = ROW_COUNT;

      -- Any request still PENDING for this store, redirected so that
      -- whenever it is actually paid/processed it credits the chosen
      -- sub-wallet instead of the now-frozen parent. A request that has
      -- already moved past PENDING is deliberately not touched here --
      -- see the transport_invoice_payments block above, and the central
      -- trigger backstop either way.
      UPDATE public.payment_provider_payment_requests
      SET wallet_id = (v_remap ->> 'new_wallet_id')::uuid, updated_at = now()
      WHERE provider = 'JEKO'
        AND provider_store_id = v_remap ->> 'provider_store_id'
        AND wallet_id = p_wallet_id
        AND status = 'PENDING';
      GET DIAGNOSTICS v_remapped_requests_count = ROW_COUNT;

      IF v_remapped_count = 0 AND v_remapped_requests_count = 0 THEN
        RAISE EXCEPTION 'Le mapping ou la demande Jèko à remplacer (magasin %) n''a pas été trouvé ou ne pointe plus vers ce wallet.', v_remap ->> 'provider_store_id' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.business_finance_audit(source_type, source_id, action, before_value, after_value, performed_by)
  VALUES ('wallet', p_wallet_id, 'UPDATE', jsonb_build_object('parent_conversion', false), v_plan, auth.uid());

  RETURN v_plan;
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_wallet_to_parent(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_wallet_to_parent(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.convert_wallet_to_parent(uuid, jsonb, jsonb) TO authenticated;
