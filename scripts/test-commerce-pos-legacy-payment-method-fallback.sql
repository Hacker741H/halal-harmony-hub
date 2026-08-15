-- Mission caisse: a session straddling the Phase-2 migration boundary can
-- contain a pre-migration payment (commercial_invoice_payments.payment_method
-- IS NULL, its real method only ever recorded on the linked legacy
-- finance_operations row) alongside post-migration payments (payment_method
-- always populated, never linked to any finance_operations at all). The
-- theoretical cash total must count both, using the stable module/module_id
-- link for the legacy row -- never an amount/date heuristic, never a second
-- Finance write. Reproduces the real session cash-session-b9604df6-... found
-- in production: 1000 CASH historique + 1800 CASH nouveau = 2800.
-- Everything reverted; safe against a linked project once this migration is
-- applied.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_location_id uuid;
  v_wallet_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-legacy-' || txid_current()::text;
  v_session text := 'session-legacy-' || txid_current()::text;
  v_sale_old jsonb;
  v_sale_new jsonb;
  v_old_payment_id uuid;
  v_finance_op_count_before integer;
  v_preview jsonb;
  v_close jsonb;
  v_report_id uuid;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Test requires a super_admin actor.'; END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST LEGACY CASH ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'LGC' || v_token, 'Test Legacy ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('LGC-' || v_token, 'Article test legacy', 'TEST', 'PIECE', 100, 0)
  RETURNING id INTO v_item_id;
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 100, 500);
  INSERT INTO public.commerce_inventory_cost_states(business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 100, 200, 20000, 'OPENING');

  ------------------------------------------------------------------
  -- Vente "historique" : creee normalement (1000 CASH), puis retro-datee
  -- exactement comme une vraie ligne pre-migration -- payment_method remis a
  -- NULL, et un lien finance_operations ajoute pour simuler l'ecriture que
  -- l'ancien code creait a l'epoque. Ceci n'ecrit PAS une nouvelle ecriture
  -- Finance pour du code post-migration : c'est le montage de la fixture qui
  -- reproduit un etat deja existant en production, pas le comportement testé.
  ------------------------------------------------------------------
  v_sale_old := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:legacy-old-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 2, 'unit_price', 500))
  ));
  IF (v_sale_old ->> 'amount')::numeric <> 1000 THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: setup sale (historique) must total 1000, got %', v_sale_old ->> 'amount';
  END IF;
  v_old_payment_id := (v_sale_old ->> 'paymentId')::uuid;
  UPDATE public.commercial_invoice_payments SET payment_method = NULL WHERE id = v_old_payment_id;
  INSERT INTO public.finance_operations(
    wallet_id, type, amount, operation_date, category, status, origin, module, module_id, payment_method, created_by
  ) VALUES (
    v_wallet_id, 'REVENUE', 1000, current_date, 'VENTE MAGASIN', 'VALIDE',
    'COMMERCE_POS_PAYMENT', 'COMMERCIAL_INVOICE_PAYMENT', v_old_payment_id, 'CASH', v_actor_id
  );

  SELECT count(*) INTO v_finance_op_count_before FROM public.finance_operations WHERE wallet_id = v_wallet_id;
  IF v_finance_op_count_before <> 1 THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: fixture must have created exactly the one legacy finance_operations row, got %', v_finance_op_count_before;
  END IF;

  ------------------------------------------------------------------
  -- Vente "nouvelle" : post-migration, payment_method deja renseigne par la
  -- RPC elle-meme, aucune finance_operations. 500 (article) + 1300 (service)
  -- = 1800 CASH.
  ------------------------------------------------------------------
  v_sale_new := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:legacy-new-' || v_token, 'notes', NULL, 'cash_session_id', v_session, 'terminal_id', v_terminal,
    'lines', jsonb_build_array(
      jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 500),
      jsonb_build_object('line_type', 'SERVICE', 'service_name', 'Reparation', 'quantity', 1, 'unit_price', 1300)
    )
  ));
  IF (v_sale_new ->> 'amount')::numeric <> 1800 THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: setup sale (nouvelle) must total 1800, got %', v_sale_new ->> 'amount';
  END IF;

  -- La vente post-migration ne doit jamais creer de finance_operations,
  -- meme dans une session qui contient deja un paiement legacy.
  IF (SELECT count(*) FROM public.finance_operations WHERE wallet_id = v_wallet_id) <> 1 THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: the post-migration sale must not create any finance_operations row.';
  END IF;

  ------------------------------------------------------------------
  -- Le coeur du test : l'apercu doit voir 2 tickets, 2800 de CA, et surtout
  -- 2800 de theorique especes -- pas 1800. Le repli legacy doit combler
  -- exactement les 1000 manquants, via le lien stable module/module_id.
  ------------------------------------------------------------------
  v_preview := public.get_commerce_pos_cash_session_preview(v_session, v_terminal, v_location_id);
  IF (v_preview ->> 'ticketCount')::integer <> 2
    OR (v_preview ->> 'articleTotal')::numeric <> 1500
    OR (v_preview ->> 'serviceTotal')::numeric <> 1300
    OR (v_preview ->> 'theoreticalCash')::numeric <> 2800
    OR (v_preview ->> 'mobileMoneyTotal')::numeric <> 0
    OR (v_preview ->> 'otherPaymentTotal')::numeric <> 0
  THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: expected 2 tickets / 1500 articles / 1300 services / 2800 theoretical cash (1000 legacy + 1800 nouveau), got %', v_preview;
  END IF;

  ------------------------------------------------------------------
  -- Meme preuve cote cloture reelle -- meme formule partagee, ne doit pas
  -- diverger de l'apercu.
  ------------------------------------------------------------------
  v_close := public.close_commerce_pos_cash_session(jsonb_build_object(
    'cash_session_id', v_session, 'event_id', 'legacy-close-' || v_token, 'terminal_id', v_terminal,
    'business_location_id', v_location_id, 'cashier_user_id', v_actor_id,
    'opened_at_device', now() - interval '1 hour', 'closed_at_device', now()
  ));
  v_report_id := (v_close ->> 'reportId')::uuid;
  IF (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id) <> 2800 THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: the real closure report must also show 2800, got %',
      (SELECT cash_expected FROM public.commerce_pos_control_reports WHERE id = v_report_id);
  END IF;

  -- La cloture elle-meme ne doit toujours creer aucune ecriture Finance --
  -- le repli est une simple lecture, jamais une nouvelle ecriture.
  IF (SELECT count(*) FROM public.finance_operations WHERE wallet_id = v_wallet_id) <> 1 THEN
    RAISE EXCEPTION 'LEGACY_TEST_FAILED: the closure must not have created any new finance_operations row (still exactly the 1 legacy fixture row).';
  END IF;

  RAISE NOTICE 'LEGACY_TEST_PASSED: a session mixing one pre-migration payment (payment_method NULL, real method only on its linked legacy finance_operations row) and one post-migration payment (payment_method populated directly) previews and closes at the correct 2800 theoretical cash (1000 + 1800), with zero new finance_operations written by either the preview or the real closure.';
END;
$test$;

ROLLBACK;
