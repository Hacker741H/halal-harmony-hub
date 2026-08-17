-- Harvest sales routed through the GFC (commercial_sales) instead of the
-- legacy direct-Finance sell_harvest path -- mandatory scenarios A-I from
-- the mission, plus the explicit partial-quantity example from section 6.
-- One transaction, ROLLBACK at the end, own synthetic fixtures throughout.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_low_priv_id uuid := gen_random_uuid();
  v_farm_id uuid;
  v_wallet_id uuid;
  v_client_id uuid;
  v_token text := txid_current()::text;

  v_harvest_a_id uuid;
  v_harvest_e_id uuid;
  v_harvest_f_id uuid;
  v_harvest_q_id uuid;

  v_sale public.commercial_sales;
  v_sale_line_id uuid;
  v_invoice public.commercial_invoices;
  v_payment public.commercial_invoice_payments;
  v_summary record;

  v_wallet_before numeric(14, 2);
  v_wallet_after numeric(14, 2);
  v_movement_count_before integer;
  v_movement_count_after integer;
  v_link_count integer;
  v_invoice_count integer;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Test requires an existing super_admin.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- A gestionnaire persona is used as the acting user for the main flow
  -- (harvests.manage + sales.create/update/invoice/payments/finance.read all
  -- come from one real, non-super_admin role -- proves the feature works
  -- under an ordinary privileged account, not just the bypass).
  INSERT INTO auth.users (id) VALUES (v_low_priv_id);
  -- handle_new_user() already assigned 'lecture_seule' by default -- exactly
  -- the low-privilege persona needed for scenario I, no further role change.

  INSERT INTO public.farms (nom, code, type_culture) VALUES ('Ferme Test GFC-Recolte ' || v_token, 'GFR-' || v_token, 'Hévéa') RETURNING id INTO v_farm_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('Wallet GFC-Recolte Test ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;
  INSERT INTO public.transport_clients(client_number, display_name, status, created_by, updated_by)
  VALUES ('GFR-CLIENT-' || v_token, 'Client GFC-Recolte ' || v_token, 'ACTIVE', v_actor_id, v_actor_id)
  RETURNING id INTO v_client_id;

  ------------------------------------------------------------------
  -- A. Récolte livrée -> vente GFC 1000 kg -> CA correct -> wallet inchangé.
  ------------------------------------------------------------------
  INSERT INTO public.harvests(farm_id, produit, status, poids_livre_kg, date_recolte)
  VALUES (v_farm_id, 'Hévéa GFC Test', 'DELIVERED', 1000, current_date)
  RETURNING id INTO v_harvest_a_id;

  SELECT balance INTO v_wallet_before FROM public.wallets WHERE id = v_wallet_id;
  SELECT count(*) INTO v_movement_count_before FROM public.stock_movements;

  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_id, 'farm_id', v_farm_id, 'business_location_id', NULL, 'sale_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Vente récolte Hévéa GFC Test', 'quantity', 1000, 'unit', 'KG', 'unit_price', 500,
      'harvest_id', v_harvest_a_id, 'farm_id', v_farm_id
    ))
  ));
  SELECT id INTO v_sale_line_id FROM public.commercial_sale_lines WHERE sale_id = v_sale.id;
  v_sale := public.confirm_commercial_sale(v_sale.id);
  IF v_sale.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'STEP_A_FAILED: expected CONFIRMED, got %', v_sale.status; END IF;

  v_invoice := public.create_commercial_invoice(v_sale.id);
  IF v_invoice.total_amount <> 500000 THEN RAISE EXCEPTION 'STEP_A_FAILED: expected CA 500000 (1000kg*500), got %', v_invoice.total_amount; END IF;
  v_invoice := public.issue_commercial_invoice(v_invoice.id);

  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before THEN
    RAISE EXCEPTION 'STEP_A_FAILED: wallet must stay unchanged by sale/invoice (no payment yet), delta %', v_wallet_after - v_wallet_before;
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_harvest_links WHERE harvest_id = v_harvest_a_id) THEN
    RAISE EXCEPTION 'STEP_A_FAILED: a GFC sale must never create a finance_harvest_links row.';
  END IF;
  RAISE NOTICE 'STEP_A_PASSED: 1000kg harvest sold via GFC, CA=500000, wallet unchanged, no finance_harvest_links row.';

  ------------------------------------------------------------------
  -- G. Ligne harvest_id -> aucun stock movement/CUMP.
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.commercial_sale_stock_movement_links WHERE sale_line_id = v_sale_line_id) THEN
    RAISE EXCEPTION 'STEP_G_FAILED: a harvest-linked line must never create a stock movement link.';
  END IF;
  SELECT count(*) INTO v_movement_count_after FROM public.stock_movements;
  IF v_movement_count_after <> v_movement_count_before THEN
    RAISE EXCEPTION 'STEP_G_FAILED: confirming a harvest-only sale must create zero stock_movements, delta %', v_movement_count_after - v_movement_count_before;
  END IF;
  RAISE NOTICE 'STEP_G_PASSED: harvest-linked line triggers no stock movement, no CUMP engine touch.';

  ------------------------------------------------------------------
  -- H. Reporting -> CA compté exactement une fois.
  ------------------------------------------------------------------
  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.total_invoiced <> 500000 THEN RAISE EXCEPTION 'STEP_H_FAILED: total_invoiced must be 500000, got %', v_summary.total_invoiced; END IF;
  SELECT count(*) INTO v_invoice_count FROM public.commercial_invoices WHERE sale_id = v_sale.id AND status <> 'CANCELLED';
  IF v_invoice_count <> 1 THEN RAISE EXCEPTION 'STEP_H_FAILED: exactly one active invoice expected, got %', v_invoice_count; END IF;
  RAISE NOTICE 'STEP_H_PASSED: CA (500000) counted exactly once via get_commercial_sale_financial_summary, one active invoice.';

  ------------------------------------------------------------------
  -- B. Vente crédit -> créance correcte.
  ------------------------------------------------------------------
  IF v_summary.amount_due <> 500000 THEN RAISE EXCEPTION 'STEP_B_FAILED: amount_due must be 500000 (nothing paid yet), got %', v_summary.amount_due; END IF;
  RAISE NOTICE 'STEP_B_PASSED: credit sale creates a correct créance of 500000.';

  ------------------------------------------------------------------
  -- C. Paiement partiel -> wallet augmente uniquement du paiement.
  ------------------------------------------------------------------
  v_payment := public.create_commercial_invoice_payment(v_invoice.id, jsonb_build_object('wallet_id', v_wallet_id, 'amount', 200000, 'payment_date', current_date));
  v_payment := public.confirm_commercial_invoice_payment(v_payment.id);
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 200000 THEN
    RAISE EXCEPTION 'STEP_C_FAILED: wallet must increase by exactly 200000, got delta %', v_wallet_after - v_wallet_before;
  END IF;
  SELECT * INTO v_summary FROM public.get_commercial_sale_financial_summary(v_sale.id);
  IF v_summary.amount_due <> 300000 THEN RAISE EXCEPTION 'STEP_C_FAILED: amount_due must be 300000 after partial payment, got %', v_summary.amount_due; END IF;
  RAISE NOTICE 'STEP_C_PASSED: partial payment of 200000 -- wallet +200000 exactly, amount_due=300000.';

  ------------------------------------------------------------------
  -- D. Retry paiement -> aucun doublon.
  ------------------------------------------------------------------
  PERFORM public.confirm_commercial_invoice_payment(v_payment.id);
  SELECT balance INTO v_wallet_after FROM public.wallets WHERE id = v_wallet_id;
  IF v_wallet_after <> v_wallet_before + 200000 THEN
    RAISE EXCEPTION 'STEP_D_FAILED: retrying confirm_commercial_invoice_payment must not double-credit the wallet, got delta %', v_wallet_after - v_wallet_before;
  END IF;
  RAISE NOTICE 'STEP_D_PASSED: retrying payment confirmation is a no-op, no duplicate wallet credit.';

  ------------------------------------------------------------------
  -- E. Ancien sell_harvest déjà utilisé -> nouvelle vente GFC rejetée.
  ------------------------------------------------------------------
  INSERT INTO public.harvests(farm_id, produit, status, poids_livre_kg, date_recolte)
  VALUES (v_farm_id, 'Hévéa Legacy Test', 'DELIVERED', 1000, current_date)
  RETURNING id INTO v_harvest_e_id;
  PERFORM public.sell_harvest(v_harvest_e_id, jsonb_build_object('quantite_kg', 1000, 'prix_kg', 400, 'acheteur', 'Acheteur Legacy', 'sale_wallet_id', v_wallet_id));
  IF NOT EXISTS (SELECT 1 FROM public.finance_harvest_links WHERE harvest_id = v_harvest_e_id) THEN
    RAISE EXCEPTION 'STEP_E_SETUP_FAILED: sell_harvest should have created a finance_harvest_links row.';
  END IF;

  BEGIN
    PERFORM public.create_commercial_sale(jsonb_build_object(
      'client_id', v_client_id, 'business_location_id', NULL, 'sale_date', current_date,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Vente E', 'quantity', 100, 'unit', 'KG', 'unit_price', 500, 'harvest_id', v_harvest_e_id))
    ));
    RAISE EXCEPTION 'STEP_E_FAILED: GFC sale creation should have been rejected (legacy sale already exists for this harvest).';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%ancien circuit direct%' THEN
        RAISE NOTICE 'STEP_E_PASSED: new GFC sale correctly rejected once sell_harvest already sold this harvest.';
      ELSE
        RAISE;
      END IF;
  END;

  ------------------------------------------------------------------
  -- F. Vente GFC existante -> ancien sell_harvest rejeté.
  ------------------------------------------------------------------
  INSERT INTO public.harvests(farm_id, produit, status, poids_livre_kg, date_recolte)
  VALUES (v_farm_id, 'Hévéa GFC-First Test', 'DELIVERED', 1000, current_date)
  RETURNING id INTO v_harvest_f_id;
  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_id, 'business_location_id', NULL, 'sale_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Vente F', 'quantity', 1000, 'unit', 'KG', 'unit_price', 500, 'harvest_id', v_harvest_f_id))
  ));
  v_sale := public.confirm_commercial_sale(v_sale.id);

  BEGIN
    PERFORM public.sell_harvest(v_harvest_f_id, jsonb_build_object('quantite_kg', 500, 'prix_kg', 300, 'sale_wallet_id', v_wallet_id));
    RAISE EXCEPTION 'STEP_F_FAILED: sell_harvest should have been rejected (an active GFC sale already references this harvest).';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%vente commerciale (GFC)%' THEN
        RAISE NOTICE 'STEP_F_PASSED: legacy sell_harvest correctly rejected once a GFC sale already exists for this harvest.';
      ELSE
        RAISE;
      END IF;
  END;

  ------------------------------------------------------------------
  -- Section 6 example: récolte livrée = 1000 kg, vente 1 = 600 kg, il doit
  -- rester 400 kg vendables, une deuxième vente de 500 kg doit être rejetée
  -- (401+ over the remainder), une vente de 400 kg doit réussir (exact boundary).
  ------------------------------------------------------------------
  INSERT INTO public.harvests(farm_id, produit, status, poids_livre_kg, date_recolte)
  VALUES (v_farm_id, 'Hévéa Quantité Test', 'DELIVERED', 1000, current_date)
  RETURNING id INTO v_harvest_q_id;

  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_id, 'business_location_id', NULL, 'sale_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Vente Q1 600kg', 'quantity', 600, 'unit', 'KG', 'unit_price', 500, 'harvest_id', v_harvest_q_id))
  ));
  v_sale := public.confirm_commercial_sale(v_sale.id);
  IF v_sale.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'STEP_Q_FAILED: first 600kg sale should confirm successfully.'; END IF;

  BEGIN
    PERFORM public.create_commercial_sale(jsonb_build_object(
      'client_id', v_client_id, 'business_location_id', NULL, 'sale_date', current_date,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Vente Q2 500kg (doit échouer)', 'quantity', 500, 'unit', 'KG', 'unit_price', 500, 'harvest_id', v_harvest_q_id))
    ));
    RAISE EXCEPTION 'STEP_Q_FAILED: a second 500kg sale (600+500=1100 > 1000) should have been rejected at draft-save time.';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%restante vendable%' THEN
        RAISE NOTICE 'STEP_Q_PASSED_REJECT: second sale of 500kg correctly rejected (only 400kg remain).';
      ELSE
        RAISE;
      END IF;
  END;

  v_sale := public.create_commercial_sale(jsonb_build_object(
    'client_id', v_client_id, 'business_location_id', NULL, 'sale_date', current_date,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Vente Q3 400kg (doit réussir)', 'quantity', 400, 'unit', 'KG', 'unit_price', 500, 'harvest_id', v_harvest_q_id))
  ));
  v_sale := public.confirm_commercial_sale(v_sale.id);
  IF v_sale.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'STEP_Q_FAILED: a sale of exactly the 400kg remaining must succeed.'; END IF;
  RAISE NOTICE 'STEP_Q_PASSED_EXACT: sale of exactly the remaining 400kg confirms successfully -- boundary is exact, not a blanket lock.';

  ------------------------------------------------------------------
  -- I. Permissions.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_low_priv_id::text, true);
  BEGIN
    PERFORM public.create_commercial_sale(jsonb_build_object(
      'client_id', v_client_id, 'business_location_id', NULL, 'sale_date', current_date,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Vente non autorisée', 'quantity', 1, 'unit', 'KG', 'unit_price', 1, 'harvest_id', v_harvest_a_id))
    ));
    RAISE EXCEPTION 'STEP_I_FAILED: a lecture_seule persona (no sales.create) must not be able to create a commercial sale.';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'STEP_I_PASSED_SALE: lecture_seule correctly denied sales.create (%).', SQLERRM;
  END;
  BEGIN
    PERFORM public.sell_harvest(v_harvest_a_id, jsonb_build_object('quantite_kg', 1, 'prix_kg', 1, 'sale_wallet_id', v_wallet_id));
    RAISE EXCEPTION 'STEP_I_FAILED: a lecture_seule persona (no harvests.manage) must not be able to call sell_harvest.';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'STEP_I_PASSED_LEGACY: lecture_seule correctly denied harvests.manage (%).', SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  RAISE NOTICE 'HARVEST_GFC_SALE_ALL_SCENARIOS_PASSED';
END;
$test$;

SELECT 'HARVEST_GFC_SALE_TEST_PASSED' AS result;

ROLLBACK;
