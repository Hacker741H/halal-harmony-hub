-- Server-side preview RPC: proves it sees online sales immediately, matches
-- close_commerce_pos_cash_session exactly (shared formula), and never reads
-- finance_operations. Everything reverted; safe against a linked project
-- once this migration is applied.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_cashier_id uuid;
  v_commerce_unit_id uuid;
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-prev-' || txid_current()::text;
  v_session text := 'session-prev-' || txid_current()::text;
  v_sale1 jsonb; v_sale2 jsonb; v_sale3 jsonb; v_sale4 jsonb;
  v_preview jsonb;
  v_close jsonb;
  v_report_id uuid;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_cashier_id FROM public.user_roles WHERE role = 'caissier'::public.app_role AND user_id IS DISTINCT FROM v_actor_id ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL OR v_cashier_id IS NULL THEN RAISE EXCEPTION 'Test requires a super_admin actor and a distinct caissier actor.'; END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST PREVIEW CASH ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'PRV' || v_token, 'Test Preview ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('PRV-' || v_token, 'Article test preview', 'TEST', 'PIECE', 100, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 500);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 200, 20000, 'OPENING');

  ------------------------------------------------------------------
  -- TEST A (partiel, cote serveur) : avant toute vente, apercu vide ; apres
  -- 4 ventes en ligne (8+1+5+6 unites x 500 = 10000), l'apercu voit tout
  -- IMMEDIATEMENT (create_commerce_cash_sale ecrit directement en base --
  -- c'est precisement le chemin qui manquait a l'ancien resume local seul).
  ------------------------------------------------------------------
  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  IF (v_preview ->> 'ticketCount')::integer <> 0 OR (v_preview ->> 'theoreticalCash')::numeric <> 0 THEN
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: an empty session must preview as zero, got %', v_preview;
  END IF;

  v_sale1 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:prev-1-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 8, 'unit_price', 500))
  ));
  v_sale2 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:prev-2-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 500))
  ));
  v_sale3 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:prev-3-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 5, 'unit_price', 500))
  ));
  v_sale4 := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:prev-4-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 6, 'unit_price', 500))
  ));

  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  IF (v_preview ->> 'ticketCount')::integer <> 4
    OR (v_preview ->> 'articleQuantityTotal')::numeric <> 20
    OR (v_preview ->> 'articleTotal')::numeric <> 10000
    OR (v_preview ->> 'serviceTotal')::numeric <> 0
    OR (v_preview ->> 'theoreticalCash')::numeric <> 10000
  THEN
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: expected 4 tickets / 20 articles / 10000 CA / 10000 theoretical after 4 online sales, got %', v_preview;
  END IF;

  -- N'a jamais lu finance_operations : coherent avec le fait que ces 4
  -- ventes n'en ont cree aucune (deja prouve ailleurs), et le resultat ci-
  -- dessus est correct malgre 0 ligne dans finance_operations pour ce
  -- wallet -- la seule facon d'obtenir ces chiffres est via
  -- commercial_sales/commercial_invoice_payments.
  IF EXISTS (SELECT 1 FROM public.finance_operations WHERE wallet_id = v_wallet_id) THEN
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: setup must not have created any finance_operations.';
  END IF;

  ------------------------------------------------------------------
  -- TEST H : la cloture reelle doit produire EXACTEMENT les memes chiffres
  -- que l'apercu qui precedait le clic -- meme formule partagee.
  ------------------------------------------------------------------
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'prev-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;
  IF (SELECT ticket_count FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> (v_preview ->> 'ticketCount')::integer
    OR (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> (v_preview ->> 'theoreticalCash')::numeric
    OR (SELECT article_revenue FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> (v_preview ->> 'articleTotal')::numeric
  THEN
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: the real closure report must match the preview shown before clicking exactly, got report % vs preview %',
      (SELECT to_jsonb(r) FROM public.commerce_pos_control_reports r WHERE id = v_report_id), v_preview;
  END IF;

  -- Apercu apres cloture : toujours coherent (les ventes n'ont pas bouge).
  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  IF (v_preview ->> 'theoreticalCash')::numeric <> 10000 THEN
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: preview after closure must still reflect the same real sales, got %', v_preview;
  END IF;

  ------------------------------------------------------------------
  -- Securite : magasin non autorise rejete, parametres invalides rejetes.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.get_commerce_pos_cash_session_preview('bad', v_terminal, v_location_id);
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: a malformed cash_session_id must be rejected.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM public.get_commerce_pos_cash_session_preview(v_session, v_terminal, gen_random_uuid());
    RAISE EXCEPTION 'PREVIEW_TEST_FAILED: a cashier must be rejected on a location they are not assigned to.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  RAISE NOTICE 'PREVIEW_TEST_PASSED: empty session previews as zero; 4 online sales are visible in the preview immediately (no local write needed); preview matches the real closure report exactly on ticketCount/theoreticalCash/articleTotal; preview stays correct after closure; malformed input and unauthorized location are rejected.';
END;
$test$;

ROLLBACK;
