-- Récoltes V1 -- mandatory scenarios A-L from the mission, plus recurrence
-- confirm/postpone/dismiss and the Global Control Center signals. One
-- transaction, ROLLBACK at the end, own synthetic fixtures throughout.

BEGIN;

DO $test$
DECLARE
  v_actor_id uuid;
  v_farm_id uuid;
  v_employee_id uuid;
  v_wallet_id uuid;
  v_op_count_before integer;
  v_op_count_after integer;
  v_harvest public.harvests;
  v_rule public.harvest_recurrence_rules;
  v_token text := txid_current()::text;
BEGIN
  SELECT user_id INTO v_actor_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role ORDER BY user_id LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Test requires an existing super_admin.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.farms (nom, code, type_culture) VALUES ('Ferme Test Hévéa ' || v_token, 'HRV-' || v_token, 'Hévéa') RETURNING id INTO v_farm_id;
  INSERT INTO public.employees (nom, prenom, poste) VALUES ('Test', 'Responsable ' || v_token, 'Chef de culture') RETURNING id INTO v_employee_id;
  INSERT INTO public.wallets(name, type, balance, initial_balance, is_default)
  VALUES ('Wallet Recolte Test ' || v_token, 'CASH', 0, 0, false) RETURNING id INTO v_wallet_id;

  SELECT count(*) INTO v_op_count_before FROM public.finance_operations;

  ------------------------------------------------------------------
  -- A. Planification : aucune donnée financière/commerciale, 0 Finance.
  ------------------------------------------------------------------
  v_harvest := public.plan_harvest(jsonb_build_object(
    'farm_id', v_farm_id, 'produit', 'Hévéa', 'planned_date', current_date + 5,
    'responsable_employee_id', v_employee_id, 'parcelle', 'Parcelle Nord',
    'transport_rate_per_kg', 15
  ));
  IF v_harvest.status <> 'PLANNED' THEN RAISE EXCEPTION 'STEP_A_FAILED: expected status PLANNED, got %', v_harvest.status; END IF;
  IF v_harvest.quantite_kg IS NOT NULL OR v_harvest.prix_kg IS NOT NULL OR v_harvest.acheteur IS NOT NULL OR v_harvest.sale_wallet_id IS NOT NULL THEN
    RAISE EXCEPTION 'STEP_A_FAILED: quantity/price/buyer/wallet must all be NULL at planning.';
  END IF;
  SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
  IF v_op_count_after <> v_op_count_before THEN RAISE EXCEPTION 'STEP_A_FAILED: planning must create zero finance_operations.'; END IF;
  RAISE NOTICE 'STEP_A_PASSED: planning creates no financial data and zero Finance operations.';

  ------------------------------------------------------------------
  -- B. Démarrage.
  ------------------------------------------------------------------
  v_harvest := public.start_harvest(v_harvest.id, jsonb_build_object('departure_notes', 'Départ équipe A'));
  IF v_harvest.status <> 'STARTED' OR v_harvest.started_at IS NULL OR v_harvest.started_by <> v_actor_id THEN
    RAISE EXCEPTION 'STEP_B_FAILED: expected STARTED with actor+timestamp, got status=%, started_at=%, started_by=%', v_harvest.status, v_harvest.started_at, v_harvest.started_by;
  END IF;
  SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
  IF v_op_count_after <> v_op_count_before THEN RAISE EXCEPTION 'STEP_B_FAILED: starting must create zero finance_operations.'; END IF;
  DECLARE
    v_retry public.harvests;
  BEGIN
    v_retry := public.start_harvest(v_harvest.id, jsonb_build_object('departure_notes', 'Ne doit pas remplacer'));
    IF v_retry.started_at <> v_harvest.started_at OR v_retry.departure_notes <> v_harvest.departure_notes THEN
      RAISE EXCEPTION 'STEP_F_START_FAILED: retrying start_harvest while already STARTED must be a pure no-op.';
    END IF;
  END;
  RAISE NOTICE 'STEP_B_PASSED: PLANNED -> STARTED, actor+timestamp recorded, 0 Finance, retry is a no-op.';

  ------------------------------------------------------------------
  -- C. Récolte : 1000 kg.
  ------------------------------------------------------------------
  v_harvest := public.record_harvest(v_harvest.id, jsonb_build_object('poids_recolte_kg', 1000, 'observations', 'Bonne récolte'));
  IF v_harvest.status <> 'HARVESTED' OR v_harvest.poids_recolte_kg <> 1000 THEN
    RAISE EXCEPTION 'STEP_C_FAILED: expected HARVESTED with poids_recolte_kg=1000, got status=%, poids=%', v_harvest.status, v_harvest.poids_recolte_kg;
  END IF;
  PERFORM public.record_harvest(v_harvest.id, jsonb_build_object('poids_recolte_kg', 999));
  IF (SELECT poids_recolte_kg FROM public.harvests WHERE id = v_harvest.id) <> 1000 THEN
    RAISE EXCEPTION 'STEP_F_RECORD_FAILED: retrying record_harvest while already HARVESTED must be a pure no-op (must not overwrite with 999).';
  END IF;
  RAISE NOTICE 'STEP_C_PASSED: STARTED -> HARVESTED, poids_recolte_kg=1000, retry is a no-op.';

  ------------------------------------------------------------------
  -- D. Livraison : 950 kg livrés, écart 50 kg. E. Transport théorique.
  ------------------------------------------------------------------
  v_harvest := public.record_harvest_delivery(v_harvest.id, jsonb_build_object('poids_livre_kg', 950, 'destination_reelle', 'Usine X'));
  IF v_harvest.status <> 'DELIVERED' OR v_harvest.poids_livre_kg <> 950 OR v_harvest.ecart_livraison_kg <> 50 THEN
    RAISE EXCEPTION 'STEP_D_FAILED: expected DELIVERED, poids_livre_kg=950, ecart=50, got status=%, poids=%, ecart=%', v_harvest.status, v_harvest.poids_livre_kg, v_harvest.ecart_livraison_kg;
  END IF;
  IF v_harvest.transport_amount_theorique <> 14250 THEN
    RAISE EXCEPTION 'STEP_E_FAILED: expected transport théorique 950*15=14250, got %', v_harvest.transport_amount_theorique;
  END IF;
  IF (SELECT balance FROM public.wallets WHERE id = v_wallet_id) <> 0 THEN RAISE EXCEPTION 'STEP_E_FAILED: wallet must be unchanged by transport calculation.'; END IF;
  SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
  IF v_op_count_after <> v_op_count_before THEN RAISE EXCEPTION 'STEP_D_E_FAILED: delivery/transport calculation must create zero finance_operations.'; END IF;
  RAISE NOTICE 'STEP_D_PASSED: HARVESTED -> DELIVERED, écart=50kg tracked (not silently corrected).';
  RAISE NOTICE 'STEP_E_PASSED: transport théorique calculé (14250) sans paiement automatique, wallet et Finance inchangés.';

  ------------------------------------------------------------------
  -- F. Retry : livraison rejouée juste après, aucun doublon.
  ------------------------------------------------------------------
  PERFORM public.record_harvest_delivery(v_harvest.id, jsonb_build_object('poids_livre_kg', 1));
  SELECT * INTO v_harvest FROM public.harvests WHERE id = v_harvest.id;
  IF v_harvest.status <> 'DELIVERED' OR v_harvest.poids_livre_kg <> 950 THEN
    RAISE EXCEPTION 'STEP_F_FAILED: retrying delivery once already DELIVERED must be a no-op, got status=%, poids_livre=%', v_harvest.status, v_harvest.poids_livre_kg;
  END IF;
  RAISE NOTICE 'STEP_F_PASSED: retrying start/record/delivery immediately after each transition changes nothing (idempotent, no duplicate transition).';

  ------------------------------------------------------------------
  -- I. Récurrence mensuelle configurée AVANT la clôture, pour que la
  -- clôture puisse rattacher last_harvest_id (ordre réaliste : la règle
  -- existe déjà quand une récolte de ce (farm, produit) se clôture).
  ------------------------------------------------------------------
  v_rule := public.configure_harvest_recurrence(jsonb_build_object(
    'farm_id', v_farm_id, 'produit', 'Hévéa', 'frequency', 'MONTHLY',
    'interval_value', 1, 'day_of_month', 18, 'reminder_days_before', 7,
    'anchor_date', current_date
  ));
  IF v_rule.next_expected_date IS NULL THEN RAISE EXCEPTION 'STEP_I_FAILED: expected a computed next_expected_date.'; END IF;
  RAISE NOTICE 'STEP_I_PASSED: monthly recurrence configured ahead of closure.';

  ------------------------------------------------------------------
  -- Close, then sell (separately) to prove Finance stays decoupled from
  -- the physical workflow, and only sell_harvest ever touches it. Closing
  -- also advances the recurrence rule (last_harvest_id, next_expected_date).
  ------------------------------------------------------------------
  v_harvest := public.close_harvest(v_harvest.id);
  IF v_harvest.status <> 'CLOSED' THEN RAISE EXCEPTION 'CLOSE_FAILED: expected CLOSED, got %', v_harvest.status; END IF;
  PERFORM public.close_harvest(v_harvest.id); -- retry, must stay idempotent
  SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
  IF v_op_count_after <> v_op_count_before THEN RAISE EXCEPTION 'STEP_L_FAILED: closing must still create zero finance_operations.'; END IF;

  SELECT * INTO v_rule FROM public.harvest_recurrence_rules WHERE id = v_rule.id;
  IF v_rule.last_harvest_id <> v_harvest.id THEN
    RAISE EXCEPTION 'STEP_I_FAILED: closing a harvest must advance its recurrence rule''s last_harvest_id, got %', v_rule.last_harvest_id;
  END IF;
  -- Force the rule into its reminder window for a deterministic assertion
  -- of the GCC signal (the rule's OWN configured 7-day window, not an
  -- invented one -- only the "is today within it" clock check is forced).
  UPDATE public.harvest_recurrence_rules SET next_expected_date = current_date + 3 WHERE id = v_rule.id;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_global_control_center(p_module := 'HALAL_FIELD', p_page_size := 100)
    WHERE source_type = 'HARVEST_RECURRENCE_DUE' AND source_id = v_rule.id
  ) THEN
    RAISE EXCEPTION 'STEP_I_FAILED: expected a HARVEST_RECURRENCE_DUE signal once inside the configured 7-day reminder window.';
  END IF;
  RAISE NOTICE 'STEP_I_PASSED: closing advanced the recurrence rule, reminder fires from the rule''s own 7-day window.';

  v_harvest := public.sell_harvest(v_harvest.id, jsonb_build_object('quantite_kg', 950, 'prix_kg', 500, 'acheteur', 'Acheteur Test', 'sale_wallet_id', v_wallet_id));
  IF v_harvest.montant_total <> 475000 THEN RAISE EXCEPTION 'SELL_FAILED: expected montant_total=475000, got %', v_harvest.montant_total; END IF;
  SELECT count(*) INTO v_op_count_after FROM public.finance_operations;
  IF v_op_count_after <> v_op_count_before + 1 THEN RAISE EXCEPTION 'SELL_FAILED: exactly one finance_operations row expected after the explicit sale, got a delta of %', v_op_count_after - v_op_count_before; END IF;
  IF (SELECT balance FROM public.wallets WHERE id = v_wallet_id) <> 475000 THEN RAISE EXCEPTION 'SELL_FAILED: wallet must reflect the sale.'; END IF;
  RAISE NOTICE 'STEP_L_PASSED: zero Finance through the whole PLANNED..CLOSED cycle; exactly one REVENUE operation appears only once sell_harvest is explicitly called, reusing the existing Finance path unchanged.';

  ------------------------------------------------------------------
  -- G. Annulation avant démarrage.
  ------------------------------------------------------------------
  DECLARE
    v_cancellable public.harvests;
  BEGIN
    v_cancellable := public.plan_harvest(jsonb_build_object('farm_id', v_farm_id, 'produit', 'Hévéa', 'planned_date', current_date + 10, 'responsable_employee_id', v_employee_id));
    v_cancellable := public.cancel_harvest(v_cancellable.id, 'Test annulation');
    IF v_cancellable.status <> 'CANCELLED' THEN RAISE EXCEPTION 'STEP_G_FAILED: expected CANCELLED, got %', v_cancellable.status; END IF;
    RAISE NOTICE 'STEP_G_PASSED: PLANNED -> CANCELLED allowed before start.';
  END;

  ------------------------------------------------------------------
  -- H. Annulation après démarrage : rejetée.
  ------------------------------------------------------------------
  DECLARE
    v_rejected boolean := false;
  BEGIN
    BEGIN
      PERFORM public.cancel_harvest(v_harvest.id, 'Ne doit pas marcher'); -- v_harvest is already CLOSED
    EXCEPTION WHEN OTHERS THEN v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'STEP_H_FAILED: cancelling a harvest past PLANNED must be rejected.'; END IF;
    RAISE NOTICE 'STEP_H_PASSED: cancellation after start is rejected.';
  END;

  ------------------------------------------------------------------
  -- J. Confirmation du prochain cycle, pas de doublon au retry.
  ------------------------------------------------------------------
  DECLARE
    v_confirmed_a public.harvests;
    v_confirmed_b public.harvests;
    v_planned_count integer;
  BEGIN
    v_confirmed_a := public.confirm_harvest_cycle(v_rule.id);
    v_confirmed_b := public.confirm_harvest_cycle(v_rule.id); -- retry
    IF v_confirmed_a.id <> v_confirmed_b.id THEN RAISE EXCEPTION 'STEP_J_FAILED: retrying confirmation must return the SAME planned harvest, got % vs %', v_confirmed_a.id, v_confirmed_b.id; END IF;
    SELECT count(*) INTO v_planned_count FROM public.harvests WHERE farm_id = v_farm_id AND produit = 'Hévéa' AND status = 'PLANNED';
    IF v_planned_count <> 1 THEN RAISE EXCEPTION 'STEP_J_FAILED: expected exactly one PLANNED harvest from the confirmed cycle, found %', v_planned_count; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.get_global_control_center(p_module := 'HALAL_FIELD', p_page_size := 100) WHERE source_type = 'HARVEST_RECURRENCE_DUE' AND source_id = v_rule.id) THEN
      RAISE NOTICE 'STEP_J_PASSED (signal correctly cleared after confirmation).';
    ELSE
      RAISE EXCEPTION 'STEP_J_FAILED: the recurrence signal must disappear once the cycle is confirmed (cycle_status left PENDING).';
    END IF;
  END;

  ------------------------------------------------------------------
  -- K. Global Control Center : signaux Récoltes.
  ------------------------------------------------------------------
  DECLARE
    v_due_harvest public.harvests;
  BEGIN
    v_due_harvest := public.plan_harvest(jsonb_build_object('farm_id', v_farm_id, 'produit', 'Cacao', 'planned_date', current_date - 1, 'responsable_employee_id', v_employee_id));
    IF NOT EXISTS (
      SELECT 1 FROM public.get_global_control_center(p_module := 'HALAL_FIELD', p_severity := 'CRITICAL', p_page_size := 100)
      WHERE source_type = 'HARVEST_DUE' AND source_id = v_due_harvest.id
    ) THEN
      RAISE EXCEPTION 'STEP_K_FAILED: an overdue PLANNED harvest (planned_date in the past) must appear as CRITICAL HARVEST_DUE.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.get_global_control_center(p_module := 'HALAL_FIELD', p_page_size := 100)
      WHERE source_type = 'HARVEST_DELIVERY_GAP' AND source_id = v_harvest.id AND amount = 50
    ) THEN
      RAISE EXCEPTION 'STEP_K_FAILED: expected a HARVEST_DELIVERY_GAP signal of 50kg for the delivered harvest.';
    END IF;

    PERFORM public.start_harvest(v_due_harvest.id, '{}'::jsonb);
    PERFORM public.record_harvest(v_due_harvest.id, jsonb_build_object('poids_recolte_kg', 200));
    IF NOT EXISTS (
      SELECT 1 FROM public.get_global_control_center(p_module := 'HALAL_FIELD', p_page_size := 100)
      WHERE source_type = 'HARVEST_NOT_DELIVERED' AND source_id = v_due_harvest.id
    ) THEN
      RAISE EXCEPTION 'STEP_K_FAILED: a HARVESTED-but-not-DELIVERED row must appear as HARVEST_NOT_DELIVERED.';
    END IF;
    RAISE NOTICE 'STEP_K_PASSED: HARVEST_DUE (overdue=CRITICAL), HARVEST_DELIVERY_GAP and HARVEST_NOT_DELIVERED all surface correctly with real source_id/amount.';
  END;

  RAISE NOTICE 'HARVEST_WORKFLOW_ALL_SCENARIOS_PASSED';
END;
$test$;

SELECT 'HARVEST_WORKFLOW_TEST_PASSED' AS result;

ROLLBACK;
