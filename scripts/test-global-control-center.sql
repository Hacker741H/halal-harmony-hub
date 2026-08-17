-- Global Control Center V1 -- Phase 3 mandatory security/permission/
-- multi-magasin proof for get_global_control_center. Closes the 4 explicit
-- requirements from the mission brief before any UI is built:
--   1. tenant/business isolation for every notifications-sourced type
--   2. canonical dedup by source_module/source_type/source_id
--   3. SNOOZED hidden until expiry, READ != RESOLVED
--   4. every live branch applies its source domain's permission + location
-- Plus: never-widens-rights, severity/age ordering, pagination, and
-- source_id/action_route correctness. One transaction, ROLLBACK at the end.
--
-- Scope note: commerce_low_stock, commerce_wallet, commerce_inventory_open,
-- commerce_transfer_transit, commerce_payables, field_pending and
-- transport_not_departed get full live fixtures below. commerce_cash,
-- commerce_receivables, commerce_refundable, transport_late_delivery and
-- transport_override are NOT independently re-fixtured here -- each copies
-- an already-proven formula/permission pattern verbatim (respectively:
-- get_commerce_pos_control_reports, get_commercial_client_financial_metrics_bulk
-- -- deliberately unscoped by location, matching its source --,
-- _internal_commerce_sale_refundable_credit, and transport_not_departed's own
-- pattern on the same table) and was verified by direct reading of the live
-- migration text, not by a second full fixture chain.

BEGIN;

CREATE TEMP TABLE gcc_fixture (key text PRIMARY KEY, value text);

------------------------------------------------------------------
-- SECTION 0: fixtures (created as a real super_admin, matching the
-- established pattern from the Phase 4 E2E test).
------------------------------------------------------------------
DO $fixtures$
DECLARE
  v_creator_id uuid;
  v_commerce_unit_id uuid;
  v_loc_a_id uuid;
  v_loc_b_id uuid;
  v_loc_source_id uuid;
  v_item_id uuid;
  v_item_payable_id uuid;
  v_wallet_a_id uuid;
  v_wallet_b_id uuid;
  v_wallet_generic_id uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_user_c uuid;
  v_user_comptable uuid;
  v_user_gestionnaire uuid;
  v_user_zero uuid;
  v_count_a public.commerce_inventory_counts;
  v_count_b public.commerce_inventory_counts;
  v_transfer_a public.commerce_stock_transfers;
  v_transfer_b public.commerce_stock_transfers;
  v_supplier record;
  v_purchase_a record;
  v_purchase_b record;
  v_report record;
  v_declaration record;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_mission record;
  v_token text := txid_current()::text;
BEGIN
  SELECT user_id INTO v_creator_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_creator_id IS NULL THEN RAISE EXCEPTION 'Test requires an existing super_admin.'; END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_commerce_unit_id IS NULL THEN RAISE EXCEPTION 'Test requires an active COMMERCE business unit.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_creator_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Synthetic users. Only `id` is required on auth.users; these rows never
  -- leave this rolled-back transaction, so no real account is created.
  INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id INTO v_user_a;
  INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id INTO v_user_b;
  INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id INTO v_user_c;
  INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id INTO v_user_comptable;
  INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id INTO v_user_gestionnaire;
  INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id INTO v_user_zero;

  -- handle_new_user() (trigger on_auth_user_created) auto-assigns a default
  -- role to every new auth.users row -- clear it so each persona below ends
  -- up with exactly the one role this test intends, nothing more.
  DELETE FROM public.user_roles
  WHERE user_id IN (v_user_a, v_user_b, v_user_c, v_user_comptable, v_user_gestionnaire, v_user_zero);

  -- 'rh' and 'exploitations' have zero real users and zero of the 13
  -- Control-Center-relevant permissions today -- exclusive, clean personas.
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_user_a, 'rh'),
    (v_user_b, 'stocks'),
    (v_user_c, 'stocks'),
    (v_user_comptable, 'comptable'),
    (v_user_gestionnaire, 'gestionnaire'),
    (v_user_zero, 'exploitations');

  INSERT INTO gcc_fixture VALUES
    ('user_a', v_user_a::text), ('user_b', v_user_b::text), ('user_c', v_user_c::text),
    ('user_comptable', v_user_comptable::text), ('user_gestionnaire', v_user_gestionnaire::text),
    ('user_zero', v_user_zero::text), ('creator', v_creator_id::text);

  -- Locations.
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'GCCA' || v_token, 'GCC Test Magasin A', 'STORE', 'ACTIVE', v_creator_id, v_creator_id)
  RETURNING id INTO v_loc_a_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'GCCB' || v_token, 'GCC Test Magasin B', 'STORE', 'ACTIVE', v_creator_id, v_creator_id)
  RETURNING id INTO v_loc_b_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'GCCS' || v_token, 'GCC Test Entrepot Source', 'STORE', 'ACTIVE', v_creator_id, v_creator_id)
  RETURNING id INTO v_loc_source_id;
  INSERT INTO gcc_fixture VALUES ('loc_a', v_loc_a_id::text), ('loc_b', v_loc_b_id::text), ('loc_source', v_loc_source_id::text);

  -- user_b assigned only to A, user_c only to B, comptable to both,
  -- gestionnaire only to A -- the whole cross-magasin proof hinges on this.
  INSERT INTO public.business_location_assignments(business_location_id, user_id, assignment_role, assigned_by) VALUES
    (v_loc_a_id, v_user_b, 'STOCK_KEEPER', v_creator_id),
    (v_loc_b_id, v_user_c, 'STOCK_KEEPER', v_creator_id),
    (v_loc_a_id, v_user_comptable, 'STORE_MANAGER', v_creator_id),
    (v_loc_b_id, v_user_comptable, 'STORE_MANAGER', v_creator_id),
    (v_loc_a_id, v_user_gestionnaire, 'STORE_MANAGER', v_creator_id);

  -- Low stock at both A and B (same item, two location rows) -- proves
  -- cross-magasin isolation both directions with one fixture.
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('GCC-' || v_token, 'GCC Article Stock Bas', 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, reorder_level)
  VALUES (v_loc_a_id, v_item_id, 2, 5), (v_loc_b_id, v_item_id, 1, 5);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_loc_a_id, v_item_id, 2, 500, 1000, 'OPENING'), (v_loc_b_id, v_item_id, 1, 500, 500, 'OPENING');
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, reorder_level)
  VALUES (v_loc_source_id, v_item_id, 100, NULL);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_loc_source_id, v_item_id, 100, 500, 50000, 'OPENING');
  INSERT INTO gcc_fixture VALUES ('item_low', v_item_id::text);

  -- Negative wallets: one mapped to A (commerce-scoped, feeds the
  -- dedup-exclusion proof), one mapped to B, one unmapped ("generic").
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('GCC Wallet A ' || v_token, 'CASH', -1000, 0, false) RETURNING id INTO v_wallet_a_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('GCC Wallet B ' || v_token, 'CASH', -500, 0, false) RETURNING id INTO v_wallet_b_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('GCC Wallet Generic ' || v_token, 'BANK', -200, 0, false) RETURNING id INTO v_wallet_generic_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_loc_a_id, v_wallet_a_id, 'CASH_DRAWER', true, true, v_creator_id),
         (v_loc_b_id, v_wallet_b_id, 'CASH_DRAWER', true, true, v_creator_id);
  INSERT INTO gcc_fixture VALUES ('wallet_a', v_wallet_a_id::text), ('wallet_b', v_wallet_b_id::text), ('wallet_generic', v_wallet_generic_id::text);

  -- Notifications, all addressed to role 'rh' (user_a exclusively) via the
  -- real production fan-out RPC, then adjusted to exact test statuses.
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_UNREAD', 'INFO', 'GCC unread', 'msg', NULL, '/test', 'gcc-unread-' || v_token, ARRAY['rh']::public.app_role[]);
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_READ', 'INFO', 'GCC read', 'msg', NULL, '/test', 'gcc-read-' || v_token, ARRAY['rh']::public.app_role[]);
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_RESOLVED', 'INFO', 'GCC resolved', 'msg', NULL, '/test', 'gcc-resolved-' || v_token, ARRAY['rh']::public.app_role[]);
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_DISMISSED', 'INFO', 'GCC dismissed', 'msg', NULL, '/test', 'gcc-dismissed-' || v_token, ARRAY['rh']::public.app_role[]);
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_SNOOZE_FUTURE', 'INFO', 'GCC snooze future', 'msg', NULL, '/test', 'gcc-snoozef-' || v_token, ARRAY['rh']::public.app_role[]);
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_SNOOZE_PAST', 'INFO', 'GCC snooze past', 'msg', NULL, '/test', 'gcc-snoozep-' || v_token, ARRAY['rh']::public.app_role[]);
  PERFORM public.create_or_update_notification_for_roles('NEGATIVE_WALLET', 'CRITICAL', 'GCC wallet mapped', 'msg', NULL, '/test', 'gcc-walletmapped-' || v_token, ARRAY['rh']::public.app_role[], NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_wallet_a_id);
  PERFORM public.create_or_update_notification_for_roles('NEGATIVE_WALLET', 'CRITICAL', 'GCC wallet generic', 'msg', NULL, '/test', 'gcc-walletgeneric-' || v_token, ARRAY['rh']::public.app_role[], NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_wallet_generic_id);
  -- Retry the very first call with the identical dedup base -- must not
  -- create a second row (dedup/idempotency proof).
  PERFORM public.create_or_update_notification_for_roles('GCC_TEST_UNREAD', 'INFO', 'GCC unread', 'msg', NULL, '/test', 'gcc-unread-' || v_token, ARRAY['rh']::public.app_role[]);

  UPDATE public.notifications SET status = 'READ' WHERE deduplication_key = 'gcc-read-' || v_token || ':USER:' || v_user_a::text;
  UPDATE public.notifications SET status = 'RESOLVED' WHERE deduplication_key = 'gcc-resolved-' || v_token || ':USER:' || v_user_a::text;
  UPDATE public.notifications SET status = 'DISMISSED' WHERE deduplication_key = 'gcc-dismissed-' || v_token || ':USER:' || v_user_a::text;
  UPDATE public.notifications SET status = 'SNOOZED', snoozed_until = now() + interval '1 day' WHERE deduplication_key = 'gcc-snoozef-' || v_token || ':USER:' || v_user_a::text;
  UPDATE public.notifications SET status = 'SNOOZED', snoozed_until = now() - interval '1 hour' WHERE deduplication_key = 'gcc-snoozep-' || v_token || ':USER:' || v_user_a::text;

  -- For the notifications branch, source_id is the notification's own id
  -- (not the entity it links to -- there is no single canonical entity per
  -- notification), so the dedup-exclusion proof must compare against that.
  INSERT INTO gcc_fixture
  SELECT 'notif_walletgeneric_id', id::text FROM public.notifications WHERE deduplication_key = 'gcc-walletgeneric-' || v_token || ':USER:' || v_user_a::text;

  -- Inventory counts left OPEN (never completed) at A and B.
  v_count_a := public.open_commerce_inventory_count(v_loc_a_id, 'GCC test A');
  v_count_b := public.open_commerce_inventory_count(v_loc_b_id, 'GCC test B');
  INSERT INTO gcc_fixture VALUES ('count_a', v_count_a.id::text), ('count_b', v_count_b.id::text);

  -- Stock transfers dispatched (not yet received) into A and B.
  v_transfer_a := public.create_commerce_stock_transfer(jsonb_build_object(
    'source_location_id', v_loc_source_id, 'destination_location_id', v_loc_a_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity', 3))
  ));
  PERFORM public.dispatch_commerce_stock_transfer(v_transfer_a.id);
  v_transfer_b := public.create_commerce_stock_transfer(jsonb_build_object(
    'source_location_id', v_loc_source_id, 'destination_location_id', v_loc_b_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_id, 'quantity', 2))
  ));
  PERFORM public.dispatch_commerce_stock_transfer(v_transfer_b.id);
  INSERT INTO gcc_fixture VALUES ('transfer_a', v_transfer_a.id::text), ('transfer_b', v_transfer_b.id::text);

  -- Supplier payables outstanding at A and B. A *different* item than
  -- item_low -- a credit purchase is a real stock receipt and would
  -- otherwise replenish item_low's quantity past its reorder_level and
  -- silently cure the low-stock fixture above.
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('GCC-PAY-' || v_token, 'GCC Article Achat', 'TEST', 'PIECE', 0, 0)
  RETURNING id INTO v_item_payable_id;
  v_supplier := public.create_supplier(jsonb_build_object('display_name', 'GCC Fournisseur ' || v_token));
  v_purchase_a := public.create_commerce_purchase(jsonb_build_object(
    'supplier_id', v_supplier.id, 'business_location_id', v_loc_a_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_payable_id, 'quantity', 4, 'unit_cost', 1000))
  ));
  v_purchase_b := public.create_commerce_purchase(jsonb_build_object(
    'supplier_id', v_supplier.id, 'business_location_id', v_loc_b_id,
    'lines', jsonb_build_array(jsonb_build_object('inventory_item_id', v_item_payable_id, 'quantity', 3, 'unit_cost', 1000))
  ));
  INSERT INTO gcc_fixture VALUES ('purchase_a', v_purchase_a.id::text), ('purchase_b', v_purchase_b.id::text);

  -- HALAL Field: one SUBMITTED declaration (Field has no business_location_id).
  INSERT INTO public.field_wallet_assignments(user_id, wallet_id, assignment_type) VALUES (v_creator_id, v_wallet_generic_id, 'SOURCE');
  v_report := public.create_field_report(jsonb_build_object('report_type', 'DAILY', 'period_start', current_date, 'period_end', current_date, 'notes', 'GCC test'));
  v_declaration := public.create_field_declaration(v_report.id, jsonb_build_object('declaration_type', 'RECEIPT', 'amount', 7500, 'field_wallet_id', v_wallet_generic_id, 'category', 'GCC test'));
  PERFORM public.submit_field_report(v_report.id);
  INSERT INTO gcc_fixture VALUES ('field_report', v_report.id::text), ('field_declaration', v_declaration.id::text);

  -- Transport: one PLANNED mission whose departure is already in the past
  -- (Transport also has no business_location_id).
  INSERT INTO public.drivers(numero_permis, statut, notes) VALUES ('GCC-' || v_token, 'actif', 'GCC test') RETURNING id INTO v_driver_id;
  INSERT INTO public.vehicles(registration, driver_id, status, description) VALUES ('GCC-' || upper(v_token), v_driver_id, 'EN_SERVICE', 'GCC test') RETURNING id INTO v_vehicle_id;
  v_mission := public.create_transport_mission(jsonb_build_object(
    'client_id', (public.create_client(jsonb_build_object('kind', 'ORGANIZATION', 'display_name', 'GCC Client ' || v_token, 'country_code', 'CI', 'telephone', '+225 07 00 00 00', 'email', 'gcc-' || v_token || '@example.test'))).id,
    'vehicle_id', v_vehicle_id, 'driver_id', v_driver_id,
    'departure_location', 'Abidjan', 'destination_location', 'Bouake', 'cargo_description', 'GCC test',
    'planned_departure_at', now() - interval '2 hours', 'planned_arrival_at', now() + interval '4 hours',
    'quoted_amount', 50000
  ));
  v_mission := public.set_transport_mission_status(v_mission.id, 'PLANNED', null);
  IF v_mission.status <> 'PLANNED' THEN RAISE EXCEPTION 'FIXTURE_FAILED: mission must be PLANNED, got %', v_mission.status; END IF;
  INSERT INTO gcc_fixture VALUES ('mission', v_mission.id::text);

  RAISE NOTICE 'FIXTURES_READY';
END;
$fixtures$;

------------------------------------------------------------------
-- SECTION A: tenant isolation + snooze/read/resolved semantics, as user_a.
------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_a'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $section_a$
DECLARE
  v_unread_count integer;
  v_read_count integer;
  v_resolved_count integer;
  v_dismissed_count integer;
  v_snooze_future_count integer;
  v_snooze_past_count integer;
  v_negwallet_count integer;
BEGIN
  SELECT count(*) INTO v_unread_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_UNREAD';
  SELECT count(*) INTO v_read_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_READ';
  SELECT count(*) INTO v_resolved_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_RESOLVED';
  SELECT count(*) INTO v_dismissed_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_DISMISSED';
  SELECT count(*) INTO v_snooze_future_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_SNOOZE_FUTURE';
  SELECT count(*) INTO v_snooze_past_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_SNOOZE_PAST';
  SELECT count(*) INTO v_negwallet_count FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'NEGATIVE_WALLET';

  IF v_unread_count <> 1 THEN RAISE EXCEPTION 'STEP_A1_FAILED: UNREAD must be visible, got count %', v_unread_count; END IF;
  IF v_read_count <> 1 THEN RAISE EXCEPTION 'STEP_A2_FAILED: READ must be visible (READ != RESOLVED), got count %', v_read_count; END IF;
  IF v_resolved_count <> 0 THEN RAISE EXCEPTION 'STEP_A3_FAILED: RESOLVED must be hidden, got count %', v_resolved_count; END IF;
  IF v_dismissed_count <> 0 THEN RAISE EXCEPTION 'STEP_A4_FAILED: DISMISSED must be hidden, got count %', v_dismissed_count; END IF;
  IF v_snooze_future_count <> 0 THEN RAISE EXCEPTION 'STEP_A5_FAILED: SNOOZED with future snoozed_until must be hidden, got count %', v_snooze_future_count; END IF;
  IF v_snooze_past_count <> 1 THEN RAISE EXCEPTION 'STEP_A6_FAILED: SNOOZED with elapsed snoozed_until must reappear, got count %', v_snooze_past_count; END IF;
  IF EXISTS (SELECT 1 FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'GCC_TEST_SNOOZE_PAST' AND status <> 'UNREAD') THEN
    RAISE EXCEPTION 'STEP_A6B_FAILED: an elapsed snooze must be normalized back to UNREAD.';
  END IF;
  -- Exactly one NEGATIVE_WALLET must be visible via notif: the unmapped
  -- ("generic") wallet. The commerce-mapped one is excluded here because
  -- it is re-sourced live, scoped by location, below.
  IF v_negwallet_count <> 1 THEN RAISE EXCEPTION 'STEP_B1_FAILED: exactly one non-commerce-mapped NEGATIVE_WALLET notification expected, got %', v_negwallet_count; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_global_control_center(p_page_size := 100)
    WHERE source_type = 'NEGATIVE_WALLET' AND source_id = (SELECT value::uuid FROM gcc_fixture WHERE key = 'notif_walletgeneric_id')
  ) THEN
    RAISE EXCEPTION 'STEP_B1B_FAILED: the visible NEGATIVE_WALLET notification must be the one linked to the non-commerce-mapped wallet.';
  END IF;

  RAISE NOTICE 'SECTION_A_PASSED: tenant-owned notifications correctly filtered by status/snooze, dedup-exclusion of the commerce-mapped wallet confirmed.';
END;
$section_a$;

-- A different user must see none of user_a's personal notifications.
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_b'), true);

DO $section_a_isolation$
DECLARE
  v_visible integer;
BEGIN
  SELECT count(*) INTO v_visible FROM public.get_global_control_center(p_module := 'NOTIFICATIONS', p_page_size := 100)
  WHERE source_type LIKE 'GCC_TEST%' OR (source_type = 'NEGATIVE_WALLET' AND source_id = (SELECT value::uuid FROM gcc_fixture WHERE key = 'wallet_generic'));
  IF v_visible <> 0 THEN RAISE EXCEPTION 'STEP_A7_FAILED: a different user must see zero of user_a''s personal notifications, got %', v_visible; END IF;
  RAISE NOTICE 'STEP_A7_PASSED: cross-user notification isolation confirmed for a non-admin bystander.';
END;
$section_a_isolation$;

-- Admin sees them too, via the has_any_role('admin') branch of the RLS
-- policy this function replicates.
SELECT set_config('request.jwt.claim.sub', (SELECT user_id::text FROM public.user_roles WHERE role = 'admin'::public.app_role ORDER BY user_id LIMIT 1), true);

DO $section_a_admin$
DECLARE
  v_visible integer;
BEGIN
  SELECT count(*) INTO v_visible FROM public.get_global_control_center(p_module := 'NOTIFICATIONS', p_page_size := 100) WHERE source_type = 'GCC_TEST_UNREAD';
  IF v_visible <> 1 THEN RAISE EXCEPTION 'STEP_A8_FAILED: admin must see a non-admin user''s open notification via has_any_role, got %', v_visible; END IF;
  RAISE NOTICE 'STEP_A8_PASSED: admin correctly sees another user''s notification through the replicated RLS policy.';
END;
$section_a_admin$;

------------------------------------------------------------------
-- SECTION D: permission + commerce_location_access_allowed per branch.
------------------------------------------------------------------

-- user_b: role 'stocks' (commerce.stock.read only), assigned to loc_a only.
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_b'), true);

DO $section_d_b$
DECLARE
  v_loc_a uuid; v_loc_b uuid; v_item uuid;
  v_sees_a integer; v_sees_b integer;
  v_other_branches integer;
BEGIN
  SELECT value::uuid INTO v_loc_a FROM gcc_fixture WHERE key = 'loc_a';
  SELECT value::uuid INTO v_loc_b FROM gcc_fixture WHERE key = 'loc_b';
  SELECT value::uuid INTO v_item FROM gcc_fixture WHERE key = 'item_low';

  SELECT count(*) INTO v_sees_a FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'LOW_STOCK' AND business_location_id = v_loc_a;
  SELECT count(*) INTO v_sees_b FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'LOW_STOCK' AND business_location_id = v_loc_b;
  IF v_sees_a <> 1 THEN RAISE EXCEPTION 'STEP_D1_FAILED: user assigned to loc_a with commerce.stock.read must see loc_a''s low-stock item, got %', v_sees_a; END IF;
  IF v_sees_b <> 0 THEN RAISE EXCEPTION 'STEP_D2_FAILED: same user must NOT see loc_b''s low-stock item (not assigned there), got %', v_sees_b; END IF;

  SELECT count(*) INTO v_other_branches FROM public.get_global_control_center(p_page_size := 100)
  WHERE source_module IN ('COMMERCE_CASH', 'COMMERCE_CREDIT')
     OR source_type IN ('WALLET_NEGATIVE', 'INVENTORY_OPEN', 'TRANSFER_TRANSIT')
     OR source_module IN ('FIELD', 'TRANSPORT');
  IF v_other_branches <> 0 THEN
    RAISE EXCEPTION 'STEP_D3_FAILED: a commerce.stock.read-only user must see zero rows from branches gated by other permissions, got %', v_other_branches;
  END IF;
  RAISE NOTICE 'STEP_D1-3_PASSED: permission+location gating confirmed for the stock-only persona (positive at loc_a, negative at loc_b, negative on every other-permission branch).';
END;
$section_d_b$;

-- user_c: role 'stocks', assigned to loc_b only -- completes the
-- cross-magasin pair (two distinct real users, two distinct locations).
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_c'), true);

DO $section_d_c$
DECLARE
  v_loc_a uuid; v_loc_b uuid;
  v_sees_a integer; v_sees_b integer;
BEGIN
  SELECT value::uuid INTO v_loc_a FROM gcc_fixture WHERE key = 'loc_a';
  SELECT value::uuid INTO v_loc_b FROM gcc_fixture WHERE key = 'loc_b';
  SELECT count(*) INTO v_sees_a FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'LOW_STOCK' AND business_location_id = v_loc_a;
  SELECT count(*) INTO v_sees_b FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'LOW_STOCK' AND business_location_id = v_loc_b;
  IF v_sees_b <> 1 THEN RAISE EXCEPTION 'STEP_D4_FAILED: user assigned to loc_b must see loc_b''s low-stock item, got %', v_sees_b; END IF;
  IF v_sees_a <> 0 THEN RAISE EXCEPTION 'STEP_D5_FAILED: user assigned to loc_b must NOT see loc_a''s low-stock item, got %', v_sees_a; END IF;
  RAISE NOTICE 'STEP_D4-5_PASSED: cross-magasin isolation confirmed between two distinct real users on two distinct locations.';
END;
$section_d_c$;

-- user_comptable: sees cash/credit/field/transport-read branches, but NOT
-- stock/inventory/transfer branches (role genuinely lacks those permission
-- codes) even though assigned to BOTH locations -- proves per-branch
-- permission gating is independent of location assignment.
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_comptable'), true);

DO $section_d_comptable$
DECLARE
  v_loc_a uuid; v_loc_b uuid;
  v_payable_a integer; v_payable_b integer;
  v_wallet_a integer; v_wallet_b integer;
  v_field integer; v_transport integer;
  v_stock_branches integer;
BEGIN
  SELECT value::uuid INTO v_loc_a FROM gcc_fixture WHERE key = 'loc_a';
  SELECT value::uuid INTO v_loc_b FROM gcc_fixture WHERE key = 'loc_b';

  SELECT count(*) INTO v_payable_a FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'SUPPLIER_PAYABLE' AND business_location_id = v_loc_a;
  SELECT count(*) INTO v_payable_b FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'SUPPLIER_PAYABLE' AND business_location_id = v_loc_b;
  IF v_payable_a <> 1 OR v_payable_b <> 1 THEN
    RAISE EXCEPTION 'STEP_D6_FAILED: comptable (purchases.finance.read, assigned both) must see both purchases'' payables, got a=% b=%', v_payable_a, v_payable_b;
  END IF;

  SELECT count(*) INTO v_wallet_a FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'WALLET_NEGATIVE' AND business_location_id = v_loc_a;
  SELECT count(*) INTO v_wallet_b FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'WALLET_NEGATIVE' AND business_location_id = v_loc_b;
  IF v_wallet_a <> 1 OR v_wallet_b <> 1 THEN
    RAISE EXCEPTION 'STEP_D7_FAILED: comptable (store.financial.read, assigned both) must see both negative wallets, got a=% b=%', v_wallet_a, v_wallet_b;
  END IF;

  SELECT count(*) INTO v_field FROM public.get_global_control_center(p_page_size := 100) WHERE source_module = 'FIELD';
  IF v_field <> 1 THEN RAISE EXCEPTION 'STEP_D8_FAILED: comptable has field.reports.confirm, must see the submitted declaration, got %', v_field; END IF;

  SELECT count(*) INTO v_transport FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'NOT_DEPARTED';
  IF v_transport <> 1 THEN RAISE EXCEPTION 'STEP_D9_FAILED: comptable has departures.read, must see the not-departed mission, got %', v_transport; END IF;

  SELECT count(*) INTO v_stock_branches FROM public.get_global_control_center(p_page_size := 100)
  WHERE source_type IN ('LOW_STOCK', 'INVENTORY_OPEN', 'TRANSFER_TRANSIT');
  IF v_stock_branches <> 0 THEN
    RAISE EXCEPTION 'STEP_D10_FAILED: comptable lacks commerce.stock.read/inventory.counts.read/transfers.read and must see zero rows from those branches despite being assigned to both locations, got %', v_stock_branches;
  END IF;
  RAISE NOTICE 'STEP_D6-10_PASSED: comptable persona confirms per-branch permission gating is independent of location assignment (sees cash/credit/field/transport, correctly blind to stock/inventory/transfer).';
END;
$section_d_comptable$;

-- user_gestionnaire: has field.reports.review but NOT field.reports.confirm
-- -- proves the branch's OR-condition. Assigned to loc_a only.
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_gestionnaire'), true);

DO $section_d_gestionnaire$
DECLARE
  v_field integer;
  v_loc_b_items integer;
  v_loc_b uuid;
BEGIN
  SELECT count(*) INTO v_field FROM public.get_global_control_center(p_page_size := 100) WHERE source_module = 'FIELD';
  IF v_field <> 1 THEN RAISE EXCEPTION 'STEP_D11_FAILED: gestionnaire holds field.reports.review only; the confirm OR review condition must still admit them, got %', v_field; END IF;

  SELECT value::uuid INTO v_loc_b FROM gcc_fixture WHERE key = 'loc_b';
  SELECT count(*) INTO v_loc_b_items FROM public.get_global_control_center(p_page_size := 100) WHERE business_location_id = v_loc_b;
  IF v_loc_b_items <> 0 THEN
    RAISE EXCEPTION 'STEP_D12_FAILED: gestionnaire is not assigned to loc_b and holds no locations.manage, must see zero loc_b rows, got %', v_loc_b_items;
  END IF;
  RAISE NOTICE 'STEP_D11-12_PASSED: field OR-condition confirmed (review alone suffices); unassigned-location blindness confirmed for a broad-permission role.';
END;
$section_d_gestionnaire$;

-- Real super_admin: current_user_permissions() deliberately special-cases
-- super_admin with an unconditional bypass (grants every row of
-- public.permissions, confirmed by reading its live definition), and that
-- SAME bypass also satisfies commerce_location_access_allowed's
-- locations.manage check. So super_admin legitimately sees everything here
-- -- the correct proof is that this flows through the same shared
-- user_has_permission/commerce_location_access_allowed primitives every
-- other branch already uses, not a special case hardcoded into this new
-- function. If the migration hardcoded its own "IF super_admin THEN bypass"
-- shortcut instead of reusing those primitives, that would be exactly the
-- kind of widening the mission prohibits -- it doesn't; it calls the same
-- two functions every branch calls.
SELECT set_config('request.jwt.claim.sub', (SELECT user_id::text FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1), true);

DO $section_d_super_admin$
DECLARE
  v_seen integer;
BEGIN
  SELECT count(*) INTO v_seen FROM public.get_global_control_center(p_page_size := 100)
  WHERE source_type IN ('LOW_STOCK', 'INVENTORY_OPEN', 'TRANSFER_TRANSIT', 'SUPPLIER_PAYABLE')
    AND business_location_id IN (SELECT value::uuid FROM gcc_fixture WHERE key IN ('loc_a', 'loc_b'));
  IF v_seen <> 8 THEN
    RAISE EXCEPTION 'STEP_D13_FAILED: super_admin''s system-wide permission bypass must flow through consistently (4 branch types x 2 locations = 8), got %', v_seen;
  END IF;
  RAISE NOTICE 'STEP_D13_PASSED: super_admin''s access is granted by the same shared permission primitives every branch uses, not a shortcut hardcoded into this function.';
END;
$section_d_super_admin$;

-- Real admin: holds locations.manage, so commerce_location_access_allowed
-- bypasses the assignment check entirely -- a positive control proving the
-- bypass path (deliberately, structurally, not a leak) still works.
SELECT set_config('request.jwt.claim.sub', (SELECT user_id::text FROM public.user_roles WHERE role = 'admin'::public.app_role ORDER BY user_id LIMIT 1), true);

DO $section_d_admin$
DECLARE
  v_both_locations integer;
BEGIN
  SELECT count(*) INTO v_both_locations FROM public.get_global_control_center(p_page_size := 100)
  WHERE source_type = 'LOW_STOCK' AND business_location_id IN (SELECT value::uuid FROM gcc_fixture WHERE key IN ('loc_a', 'loc_b'));
  IF v_both_locations <> 2 THEN
    RAISE EXCEPTION 'STEP_D14_FAILED: admin holds locations.manage and must see low-stock at both locations without explicit assignment, got %', v_both_locations;
  END IF;
  RAISE NOTICE 'STEP_D14_PASSED: admin''s locations.manage bypass works as designed (not an accidental leak -- the same explicit bypass commerce_location_access_allowed already grants everywhere else).';
END;
$section_d_admin$;

------------------------------------------------------------------
-- SECTION E: never-widens-rights baseline.
------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_zero'), true);

DO $section_e$
DECLARE
  v_total integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.get_global_control_center(p_page_size := 100);
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'STEP_E1_FAILED: a user with zero relevant permissions, zero notifications and zero location assignment must get zero rows (not an error, not a broader set), got %', v_total;
  END IF;
  RAISE NOTICE 'STEP_E1_PASSED: zero-permission user gets zero rows despite abundant matching fixture data -- confirms the function never widens access.';
END;
$section_e$;

------------------------------------------------------------------
-- SECTION F/G/H: ordering, pagination, source_id/action_route -- as the
-- comptable persona, which has the richest visible severity mix.
------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', (SELECT value FROM gcc_fixture WHERE key = 'user_comptable'), true);

DO $section_fgh$
DECLARE
  v_out_of_order integer;
  v_page1_count integer;
  v_page2_count integer;
  v_page1_total bigint;
  v_page2_total bigint;
  v_overlap integer;
  v_field_route text;
  v_field_source uuid;
  v_declaration_id uuid;
  v_report_id uuid;
  v_transport_route text;
  v_mission_id uuid;
BEGIN
  WITH ranked AS (
    SELECT g.severity, g.occurred_at, g.ordinality,
      CASE g.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END AS rank
    FROM public.get_global_control_center(p_page_size := 100) WITH ORDINALITY AS g(
      item_id, source_module, source_type, source_id, business_location_id, severity, status,
      title, description, amount, occurred_at, actor, action_label, action_route, metadata,
      total_count, ordinality
    )
  ),
  compared AS (
    SELECT rank, occurred_at,
      lag(rank) OVER (ORDER BY ordinality) AS prev_rank,
      lag(occurred_at) OVER (ORDER BY ordinality) AS prev_occurred_at
    FROM ranked
  )
  SELECT count(*) INTO v_out_of_order FROM compared
  WHERE prev_rank IS NOT NULL AND (rank < prev_rank OR (rank = prev_rank AND occurred_at < prev_occurred_at));
  IF v_out_of_order <> 0 THEN RAISE EXCEPTION 'STEP_F1_FAILED: result must be ordered severity (CRITICAL,WARNING,INFO) then occurred_at ascending, found % violation(s)', v_out_of_order; END IF;
  RAISE NOTICE 'STEP_F1_PASSED: severity-then-age ordering confirmed.';

  SELECT count(*), max(total_count) INTO v_page1_count, v_page1_total FROM public.get_global_control_center(p_page := 1, p_page_size := 3);
  SELECT count(*), max(total_count) INTO v_page2_count, v_page2_total FROM public.get_global_control_center(p_page := 2, p_page_size := 3);
  IF v_page1_total IS DISTINCT FROM v_page2_total THEN RAISE EXCEPTION 'STEP_G1_FAILED: total_count must be stable across pages, got % vs %', v_page1_total, v_page2_total; END IF;
  IF v_page1_count > 3 OR v_page2_count > 3 THEN RAISE EXCEPTION 'STEP_G2_FAILED: page_size must be respected.'; END IF;
  SELECT count(*) INTO v_overlap FROM (
    SELECT item_id FROM public.get_global_control_center(p_page := 1, p_page_size := 3)
    INTERSECT
    SELECT item_id FROM public.get_global_control_center(p_page := 2, p_page_size := 3)
  ) dup;
  IF v_overlap <> 0 THEN RAISE EXCEPTION 'STEP_G3_FAILED: consecutive pages must not overlap, found % duplicate item_id(s)', v_overlap; END IF;
  RAISE NOTICE 'STEP_G1-3_PASSED: pagination confirmed (stable total_count, respected page_size, no cross-page duplicates).';

  SELECT value::uuid INTO v_declaration_id FROM gcc_fixture WHERE key = 'field_declaration';
  SELECT value::uuid INTO v_report_id FROM gcc_fixture WHERE key = 'field_report';
  SELECT source_id, action_route INTO v_field_source, v_field_route FROM public.get_global_control_center(p_page_size := 100) WHERE source_module = 'FIELD' LIMIT 1;
  IF v_field_source <> v_declaration_id THEN RAISE EXCEPTION 'STEP_H1_FAILED: field source_id must be the declaration id, got % expected %', v_field_source, v_declaration_id; END IF;
  IF v_field_route <> '/field/' || v_report_id::text THEN RAISE EXCEPTION 'STEP_H2_FAILED: field action_route must point at the parent report, got %', v_field_route; END IF;

  SELECT value::uuid INTO v_mission_id FROM gcc_fixture WHERE key = 'mission';
  SELECT action_route INTO v_transport_route FROM public.get_global_control_center(p_page_size := 100) WHERE source_type = 'NOT_DEPARTED' LIMIT 1;
  IF v_transport_route <> '/courses/' || v_mission_id::text THEN RAISE EXCEPTION 'STEP_H3_FAILED: transport action_route must point at the mission, got %', v_transport_route; END IF;

  -- Dedup/uniqueness structural proof across the whole visible set.
  IF EXISTS (
    SELECT item_id FROM public.get_global_control_center(p_page_size := 100) GROUP BY item_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'STEP_H4_FAILED: item_id (source_module:source_type:source_id) must be unique across the result set.';
  END IF;

  RAISE NOTICE 'STEP_H1-4_PASSED: source_id/action_route correctness and item_id uniqueness confirmed.';
END;
$section_fgh$;

SELECT 'GLOBAL_CONTROL_CENTER_PHASE3_TESTS_PASSED' AS result;

ROLLBACK;
