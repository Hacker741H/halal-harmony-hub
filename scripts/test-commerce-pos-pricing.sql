-- Mission caisse-UX -- catalog price floor check: scenarios A-I from the
-- mission spec. Covers the online path (create_commerce_cash_sale), the
-- offline path (sync_commerce_pos_offline_sale), idempotent retry, a
-- forged client-sent catalog_price, and the deterministic grandfathering
-- policy when the catalog price rises while a cashier was offline. Everything
-- created by this script is reverted at the end; it is safe to run against a
-- linked project once the mission caisse-UX migrations are applied.
BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_commerce_unit_id uuid;
  v_wallet_id uuid;
  v_location_id uuid;
  v_item_id uuid;
  v_token text := txid_current()::text;
  v_terminal text := 'terminal-pricing-' || v_token;
  v_t_floor_15000 timestamptz;
  v_t_floor_20000 timestamptz;
  v_result_a jsonb;
  v_result_b jsonb;
  v_c_rejected boolean := false;
  v_d_rejected boolean := false;
  v_e_rejected boolean := false;
  v_f_retry jsonb;
  v_g_result jsonb;
  v_h_rejected boolean := false;
  v_i1_result jsonb;
  v_i2_rejected boolean := false;
  v_sale_count integer;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Pricing test requires one existing super_admin actor.';
  END IF;
  SELECT id INTO v_commerce_unit_id FROM public.business_units WHERE code = 'COMMERCE' AND status = 'ACTIVE';
  IF v_commerce_unit_id IS NULL THEN
    RAISE EXCEPTION 'The active COMMERCE business unit is missing.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('TEST PRICING CASH ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.business_locations(business_unit_id, code, name, location_type, status, created_by, updated_by)
  VALUES (v_commerce_unit_id, 'PRICE' || v_token, 'Test Pricing ' || v_token, 'STORE', 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_location_id;
  INSERT INTO public.business_location_wallets(business_location_id, wallet_id, purpose, is_primary, is_active, assigned_by)
  VALUES (v_location_id, v_wallet_id, 'CASH_DRAWER', true, true, v_actor_id);
  INSERT INTO public.inventory_items(sku, nom, categorie, unite, stock_actuel, seuil_alerte)
  VALUES ('PRICE-' || v_token, 'Chargeur rapide', 'TEST', 'PIECE', 1000, 0)
  RETURNING id INTO v_item_id;
  -- Catalogue = 15 000. This INSERT fires trg_track_business_location_inventory_item_price.
  INSERT INTO public.business_location_inventory_items(business_location_id, inventory_item_id, quantity, sale_price)
  VALUES (v_location_id, v_item_id, 1000, 15000);
  INSERT INTO public.commerce_inventory_cost_states (business_location_id, inventory_item_id, quantity_on_hand, current_unit_cost, inventory_value, initialized_from)
  VALUES (v_location_id, v_item_id, 1000, 9000, 9000000, 'OPENING');

  ------------------------------------------------------------------
  -- A. Vente exactement au prix catalogue (15000) -> ACCEPTEE.
  ------------------------------------------------------------------
  v_result_a := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:pricing-a-' || v_token, 'notes', NULL,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 15000))
  ));
  IF (v_result_a ->> 'amount')::numeric <> 15000 THEN
    RAISE EXCEPTION 'TEST_A_FAILED: expected amount=15000, got %', v_result_a ->> 'amount';
  END IF;

  ------------------------------------------------------------------
  -- B. Vente au-dessus du catalogue (18000) -> ACCEPTEE, CA=18000.
  ------------------------------------------------------------------
  v_result_b := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:pricing-b-' || v_token, 'notes', NULL,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 18000))
  ));
  IF (v_result_b ->> 'amount')::numeric <> 18000 THEN
    RAISE EXCEPTION 'TEST_B_FAILED: expected amount=18000 (CA = prix reellement vendu), got %', v_result_b ->> 'amount';
  END IF;
  IF (SELECT catalog_price_at_sale FROM public.commercial_sale_lines WHERE sale_id = (v_result_b ->> 'saleId')::uuid) <> 15000 THEN
    RAISE EXCEPTION 'TEST_B_FAILED: catalog_price_at_sale should trace back to 15000 for audit (surprix = 3000), not create a second revenue entry.';
  END IF;

  ------------------------------------------------------------------
  -- C. Vente sous le catalogue (14999) -> REFUSEE.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.create_commerce_cash_sale(jsonb_build_object(
      'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
      'reference', 'POS:pricing-c-' || v_token, 'notes', NULL,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 14999))
    ));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_c_rejected := true;
  END;
  IF NOT v_c_rejected THEN
    RAISE EXCEPTION 'TEST_C_FAILED: a sale 1 FCFA under the catalog floor was accepted.';
  END IF;

  ------------------------------------------------------------------
  -- D. Vente a 0 -> REFUSEE.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.create_commerce_cash_sale(jsonb_build_object(
      'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
      'reference', 'POS:pricing-d-' || v_token, 'notes', NULL,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 0))
    ));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_d_rejected := true;
  END;
  IF NOT v_d_rejected THEN
    RAISE EXCEPTION 'TEST_D_FAILED: a zero-price sale was accepted.';
  END IF;

  ------------------------------------------------------------------
  -- E. Payload falsifie : le client tente d'injecter un faux "catalog_price"
  -- (10000) a cote d'un prix demande (12000) sous le vrai catalogue serveur
  -- (15000). Le schema/RPC ne lit jamais de catalog_price venant du client
  -- -- la cle est ignoree, le prix plancher reste 15000 -> REFUSE.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.create_commerce_cash_sale(jsonb_build_object(
      'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
      'reference', 'POS:pricing-e-' || v_token, 'notes', NULL,
      'lines', jsonb_build_array(jsonb_build_object(
        'line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 12000,
        'catalog_price', 10000
      ))
    ));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_e_rejected := true;
  END;
  IF NOT v_e_rejected THEN
    RAISE EXCEPTION 'TEST_E_FAILED: a forged client-sent catalog_price was allowed to override the server floor.';
  END IF;

  ------------------------------------------------------------------
  -- F. Retry de la vente B (meme reference "POS:...") -> aucune duplication.
  ------------------------------------------------------------------
  v_f_retry := public.create_commerce_cash_sale(jsonb_build_object(
    'business_location_id', v_location_id, 'client_id', NULL, 'payment_method', 'CASH',
    'reference', 'POS:pricing-b-' || v_token, 'notes', NULL,
    'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 18000))
  ));
  IF (v_f_retry ->> 'saleId')::uuid <> (v_result_b ->> 'saleId')::uuid THEN
    RAISE EXCEPTION 'TEST_F_FAILED: retrying the same POS: reference created a second sale.';
  END IF;
  SELECT count(*) INTO v_sale_count FROM public.commercial_sales WHERE reference = 'POS:pricing-b-' || v_token;
  IF v_sale_count <> 1 THEN
    RAISE EXCEPTION 'TEST_F_FAILED: expected exactly 1 sale row for the retried reference, got %', v_sale_count;
  END IF;

  ------------------------------------------------------------------
  -- G. Vente HORS LIGNE valide avec surprix (18000 > 15000) -> synchronisee
  -- correctement.
  ------------------------------------------------------------------
  v_t_floor_15000 := clock_timestamp();
  v_g_result := public.sync_commerce_pos_offline_sale(jsonb_build_object(
    'offline_sale_id', 'pricing-offline-g-' || v_token,
    'terminal_id', v_terminal,
    'cash_session_id', 'pricing-session-g-' || v_token,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', v_t_floor_15000,
    'payload', jsonb_build_object(
      'ticket_id', 'pricing-ticket-g-' || v_token,
      'payment_method', 'CASH', 'total', 18000, 'cash_received', 18000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 18000))
    )
  ));
  IF (v_g_result ->> 'status') <> 'PROCESSED' THEN
    RAISE EXCEPTION 'TEST_G_FAILED: a legitimate offline sale with a surcharge above catalog was not processed: %', v_g_result;
  END IF;

  ------------------------------------------------------------------
  -- H. Vente HORS LIGNE sous le minimum connu (10000 < 15000) -> le serveur
  -- refuse egalement, en filet de securite du controle cote client.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.sync_commerce_pos_offline_sale(jsonb_build_object(
      'offline_sale_id', 'pricing-offline-h-' || v_token,
      'terminal_id', v_terminal,
      'cash_session_id', 'pricing-session-h-' || v_token,
      'business_location_id', v_location_id,
      'cashier_user_id', v_actor_id,
      'created_at_device', v_t_floor_15000,
      'payload', jsonb_build_object(
        'ticket_id', 'pricing-ticket-h-' || v_token,
        'payment_method', 'CASH', 'total', 10000, 'cash_received', 10000, 'change_due', 0,
        'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 10000))
      )
    ));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_h_rejected := true;
  END;
  IF NOT v_h_rejected THEN
    RAISE EXCEPTION 'TEST_H_FAILED: an offline sale under the known catalog minimum was accepted.';
  END IF;

  ------------------------------------------------------------------
  -- Le gestionnaire augmente le catalogue a 20000 PENDANT que le caissier
  -- etait (fictivement) hors ligne.
  ------------------------------------------------------------------
  UPDATE public.business_location_inventory_items
  SET sale_price = 20000, updated_at = now()
  WHERE business_location_id = v_location_id AND inventory_item_id = v_item_id;
  v_t_floor_20000 := clock_timestamp();

  ------------------------------------------------------------------
  -- I.1 Politique deterministe (le coeur du scenario section 11) : une vente
  -- hors ligne horodatee AVANT la hausse (v_t_floor_15000), a 18000 (>= 15000,
  -- < 20000), doit rester ACCEPTEE malgre la hausse survenue depuis --
  -- jamais corrompue retroactivement par le nouveau prix.
  ------------------------------------------------------------------
  v_i1_result := public.sync_commerce_pos_offline_sale(jsonb_build_object(
    'offline_sale_id', 'pricing-offline-i1-' || v_token,
    'terminal_id', v_terminal,
    'cash_session_id', 'pricing-session-i1-' || v_token,
    'business_location_id', v_location_id,
    'cashier_user_id', v_actor_id,
    'created_at_device', v_t_floor_15000,
    'payload', jsonb_build_object(
      'ticket_id', 'pricing-ticket-i1-' || v_token,
      'payment_method', 'CASH', 'total', 18000, 'cash_received', 18000, 'change_due', 0,
      'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 18000))
    )
  ));
  IF (v_i1_result ->> 'status') <> 'PROCESSED' THEN
    RAISE EXCEPTION 'TEST_I1_FAILED: a legitimately grandfathered offline sale (18000 >= 15000 floor in effect when it was made) was rejected after a later price rise to 20000: %', v_i1_result;
  END IF;

  ------------------------------------------------------------------
  -- I.2 Tentative de contournement : une vente hors ligne qui pretend avoir
  -- eu lieu MAINTENANT (apres la hausse a 20000) a 18000 (< 20000) doit etre
  -- REFUSEE -- le plancher applique est bien celui reellement en vigueur a
  -- l'horodatage revendique.
  ------------------------------------------------------------------
  BEGIN
    PERFORM public.sync_commerce_pos_offline_sale(jsonb_build_object(
      'offline_sale_id', 'pricing-offline-i2-' || v_token,
      'terminal_id', v_terminal,
      'cash_session_id', 'pricing-session-i2-' || v_token,
      'business_location_id', v_location_id,
      'cashier_user_id', v_actor_id,
      'created_at_device', clock_timestamp(),
      'payload', jsonb_build_object(
        'ticket_id', 'pricing-ticket-i2-' || v_token,
        'payment_method', 'CASH', 'total', 18000, 'cash_received', 18000, 'change_due', 0,
        'lines', jsonb_build_array(jsonb_build_object('line_type', 'ARTICLE', 'inventory_item_id', v_item_id, 'quantity', 1, 'unit_price', 18000))
      )
    ));
  EXCEPTION WHEN SQLSTATE '22023' THEN v_i2_rejected := true;
  END;
  IF NOT v_i2_rejected THEN
    RAISE EXCEPTION 'TEST_I2_FAILED: an offline sale timestamped after the price rise undercut the new floor (18000 < 20000) and was accepted.';
  END IF;

  RAISE NOTICE 'Mission caisse-UX pricing validated: exact catalog accepted, surcharge accepted with catalog_price_at_sale traced, below-floor/zero/forged-catalog_price all rejected, idempotent retry, offline surcharge processed, offline below-minimum rejected, grandfathered pre-rise offline sale accepted, post-rise undercut rejected.';
END;
$test$;

ROLLBACK;
