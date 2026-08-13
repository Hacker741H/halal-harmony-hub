-- COURSES-02: keep historical planning fields, but make the operational model
-- rely exclusively on real, nullable transport data.

ALTER TABLE public.transport_missions
  ALTER COLUMN quoted_amount DROP NOT NULL,
  ALTER COLUMN quoted_amount DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS pricing_mode text,
  ADD COLUMN IF NOT EXISTS unit_rate numeric(14,4),
  ADD COLUMN IF NOT EXISTS actual_transport_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS actual_transport_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_transport_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.transport_missions
  DROP CONSTRAINT IF EXISTS transport_missions_real_pricing_check;
ALTER TABLE public.transport_missions
  ADD CONSTRAINT transport_missions_real_pricing_check CHECK (
    (pricing_mode IS NULL OR pricing_mode IN ('PER_KG', 'PER_TONNE', 'FLAT'))
    AND (unit_rate IS NULL OR unit_rate >= 0)
    AND (actual_transport_amount IS NULL OR actual_transport_amount >= 0)
  );

ALTER TABLE public.transport_mission_expenses
  DROP CONSTRAINT IF EXISTS transport_mission_expenses_category_check;
ALTER TABLE public.transport_mission_expenses
  ADD CONSTRAINT transport_mission_expenses_category_check CHECK (
    category IN ('FUEL', 'ROAD', 'HANDLING', 'REPAIR', 'DRIVER_ADVANCE', 'PARKING', 'MEALS', 'MISC', 'EXCEPTIONAL_MAINTENANCE')
  );

CREATE OR REPLACE FUNCTION public.create_transport_mission(p_mission jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $create_transport_mission$
DECLARE
  v_mission public.transport_missions;
  v_vehicle public.vehicles;
  v_driver public.drivers;
  v_vehicle_id uuid := NULLIF(p_mission ->> 'vehicle_id', '')::uuid;
  v_driver_id uuid := NULLIF(p_mission ->> 'driver_id', '')::uuid;
  v_departure timestamptz := NULLIF(p_mission ->> 'planned_departure_at', '')::timestamptz;
  v_arrival timestamptz := NULLIF(p_mission ->> 'planned_arrival_at', '')::timestamptz;
  v_has_conflict boolean := false;
  v_mode text := upper(NULLIF(btrim(p_mission ->> 'pricing_mode'), ''));
  v_rate numeric := NULLIF(p_mission ->> 'unit_rate', '')::numeric;
  v_weight numeric := NULLIF(p_mission ->> 'cargo_weight_kg', '')::numeric;
  v_flat_amount numeric := NULLIF(p_mission ->> 'actual_transport_amount', '')::numeric;
  v_amount numeric;
BEGIN
  PERFORM public.permission_require('missions.create');

  IF NULLIF(btrim(p_mission ->> 'client_id'), '') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.transport_clients
      WHERE id = (p_mission ->> 'client_id')::uuid AND status = 'ACTIVE'
    ) THEN
    RAISE EXCEPTION 'Un client actif est obligatoire.' USING ERRCODE = '23503';
  END IF;
  IF v_departure IS NOT NULL AND v_arrival IS NOT NULL AND v_arrival <= v_departure THEN
    RAISE EXCEPTION 'L''arrivée prévue doit être postérieure au départ prévu.' USING ERRCODE = '22023';
  END IF;
  IF v_weight IS NOT NULL AND v_weight < 0 THEN
    RAISE EXCEPTION 'Le poids réel ne peut pas être négatif.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('PER_KG', 'PER_TONNE', 'FLAT') THEN
    RAISE EXCEPTION 'Mode de tarification invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_rate IS NOT NULL AND v_rate < 0 OR v_flat_amount IS NOT NULL AND v_flat_amount < 0 THEN
    RAISE EXCEPTION 'Le tarif et le montant réel ne peuvent pas être négatifs.' USING ERRCODE = '22023';
  END IF;

  IF v_vehicle_id IS NOT NULL THEN
    SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_vehicle_id;
    IF NOT FOUND OR v_vehicle.status IS DISTINCT FROM 'EN_SERVICE' THEN
      RAISE EXCEPTION 'Le véhicule sélectionné est indisponible.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_driver_id IS NOT NULL THEN
    SELECT * INTO v_driver FROM public.drivers WHERE id = v_driver_id;
    IF NOT FOUND OR lower(coalesce(v_driver.statut::text, '')) NOT IN ('actif', 'active') THEN
      RAISE EXCEPTION 'Le chauffeur sélectionné est indisponible.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_departure IS NOT NULL AND v_arrival IS NOT NULL
    AND (v_vehicle_id IS NOT NULL OR v_driver_id IS NOT NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.transport_missions scheduled
      WHERE scheduled.status IN ('PLANNED', 'IN_PROGRESS')
        AND scheduled.planned_departure_at IS NOT NULL
        AND scheduled.planned_arrival_at IS NOT NULL
        AND tstzrange(scheduled.planned_departure_at, scheduled.planned_arrival_at, '[)')
            && tstzrange(v_departure, v_arrival, '[)')
        AND (scheduled.vehicle_id = v_vehicle_id OR scheduled.driver_id = v_driver_id)
    ) INTO v_has_conflict;
    IF v_has_conflict THEN
      RAISE EXCEPTION 'Le véhicule ou le chauffeur est déjà affecté sur ce créneau.' USING ERRCODE = '23P01';
    END IF;
  END IF;

  v_amount := CASE
    WHEN v_mode = 'PER_KG' AND v_weight IS NOT NULL AND v_rate IS NOT NULL THEN round(v_weight * v_rate, 2)
    WHEN v_mode = 'PER_TONNE' AND v_weight IS NOT NULL AND v_rate IS NOT NULL THEN round(v_weight / 1000 * v_rate, 2)
    WHEN v_mode = 'FLAT' THEN v_flat_amount
    ELSE NULL
  END;

  INSERT INTO public.transport_missions(
    mission_number, client_id, vehicle_id, driver_id, departure_location,
    destination_location, cargo_description, cargo_quantity, cargo_unit,
    cargo_weight_kg, cargo_volume_m3, distance_km, planned_departure_at,
    planned_arrival_at, quoted_amount, pricing_mode, unit_rate,
    actual_transport_amount, actual_transport_confirmed_at,
    actual_transport_confirmed_by, reference, notes, created_by, updated_by
  ) VALUES (
    public._internal_next_transport_mission_number(),
    (p_mission ->> 'client_id')::uuid, v_vehicle_id, v_driver_id,
    NULLIF(btrim(p_mission ->> 'departure_location'), ''),
    NULLIF(btrim(p_mission ->> 'destination_location'), ''),
    NULLIF(btrim(p_mission ->> 'cargo_description'), ''),
    NULLIF(p_mission ->> 'cargo_quantity', '')::numeric,
    NULLIF(btrim(p_mission ->> 'cargo_unit'), ''), v_weight,
    NULLIF(p_mission ->> 'cargo_volume_m3', '')::numeric,
    NULLIF(p_mission ->> 'distance_km', '')::numeric,
    v_departure, v_arrival, NULL, v_mode, v_rate, v_amount,
    CASE WHEN v_amount IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN v_amount IS NOT NULL THEN auth.uid() ELSE NULL END,
    NULLIF(btrim(p_mission ->> 'reference'), ''),
    NULLIF(btrim(p_mission ->> 'notes'), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event('COURSE', v_mission.id, NULL, 'CREATE', NULL, to_jsonb(v_mission));
  RETURN v_mission;
END;
$create_transport_mission$;

CREATE OR REPLACE FUNCTION public.update_transport_mission_actuals(p_mission_id uuid, p_actuals jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $update_transport_mission_actuals$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_reason text := NULLIF(btrim(p_actuals ->> 'reason'), '');
  v_weight numeric;
  v_mode text;
  v_rate numeric;
  v_flat_amount numeric;
  v_amount numeric;
  v_start numeric;
  v_end numeric;
BEGIN
  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status IN ('COMPLETED', 'CLOSED') THEN
    PERFORM public.permission_require('deliveries.correct');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'La justification est obligatoire après finalisation.' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NOT public.user_has_permission('missions.update') AND NOT public.user_has_permission('deliveries.confirm') THEN
      PERFORM public.permission_require('missions.update');
    END IF;
  END IF;
  IF v_before.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Une Course archivée ne peut pas être corrigée.' USING ERRCODE = '22023';
  END IF;

  v_weight := CASE WHEN p_actuals ? 'cargo_weight_kg' THEN NULLIF(p_actuals ->> 'cargo_weight_kg', '')::numeric ELSE v_before.cargo_weight_kg END;
  v_mode := CASE WHEN p_actuals ? 'pricing_mode' THEN upper(NULLIF(btrim(p_actuals ->> 'pricing_mode'), '')) ELSE v_before.pricing_mode END;
  v_rate := CASE WHEN p_actuals ? 'unit_rate' THEN NULLIF(p_actuals ->> 'unit_rate', '')::numeric ELSE v_before.unit_rate END;
  v_flat_amount := CASE WHEN p_actuals ? 'actual_transport_amount' THEN NULLIF(p_actuals ->> 'actual_transport_amount', '')::numeric ELSE v_before.actual_transport_amount END;
  v_start := CASE WHEN p_actuals ? 'start_odometer' THEN NULLIF(p_actuals ->> 'start_odometer', '')::numeric ELSE v_before.start_odometer END;
  v_end := CASE WHEN p_actuals ? 'end_odometer' THEN NULLIF(p_actuals ->> 'end_odometer', '')::numeric ELSE v_before.end_odometer END;

  IF v_weight IS NOT NULL AND v_weight < 0 OR v_rate IS NOT NULL AND v_rate < 0
    OR v_flat_amount IS NOT NULL AND v_flat_amount < 0 OR v_start IS NOT NULL AND v_start < 0
    OR v_end IS NOT NULL AND v_end < 0 THEN
    RAISE EXCEPTION 'Les valeurs réelles ne peuvent pas être négatives.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('PER_KG', 'PER_TONNE', 'FLAT') THEN
    RAISE EXCEPTION 'Mode de tarification invalide.' USING ERRCODE = '22023';
  END IF;
  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
    RAISE EXCEPTION 'Le kilométrage d''arrivée doit être supérieur ou égal au départ.' USING ERRCODE = '22023';
  END IF;

  v_amount := CASE
    WHEN v_mode = 'PER_KG' AND v_weight IS NOT NULL AND v_rate IS NOT NULL THEN round(v_weight * v_rate, 2)
    WHEN v_mode = 'PER_TONNE' AND v_weight IS NOT NULL AND v_rate IS NOT NULL THEN round(v_weight / 1000 * v_rate, 2)
    WHEN v_mode = 'FLAT' THEN v_flat_amount
    ELSE NULL
  END;
  IF v_before.actual_transport_amount IS DISTINCT FROM v_amount AND EXISTS (
    SELECT 1 FROM public.transport_invoices
    WHERE mission_id = p_mission_id AND status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'Le montant réel est déjà lié à une facture active. Corrigez d''abord la facture via le workflow Finance.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transport_missions SET
    destination_location = CASE WHEN p_actuals ? 'destination_location' THEN NULLIF(btrim(p_actuals ->> 'destination_location'), '') ELSE destination_location END,
    cargo_description = CASE WHEN p_actuals ? 'cargo_description' THEN NULLIF(btrim(p_actuals ->> 'cargo_description'), '') ELSE cargo_description END,
    cargo_weight_kg = v_weight,
    pricing_mode = v_mode,
    unit_rate = v_rate,
    actual_transport_amount = v_amount,
    actual_transport_confirmed_at = CASE WHEN v_amount IS DISTINCT FROM v_before.actual_transport_amount THEN CASE WHEN v_amount IS NULL THEN NULL ELSE now() END ELSE actual_transport_confirmed_at END,
    actual_transport_confirmed_by = CASE WHEN v_amount IS DISTINCT FROM v_before.actual_transport_amount THEN CASE WHEN v_amount IS NULL THEN NULL ELSE auth.uid() END ELSE actual_transport_confirmed_by END,
    start_odometer = v_start,
    end_odometer = v_end,
    notes = CASE WHEN v_reason IS NOT NULL THEN concat_ws(E'\n', notes, 'Correction : ' || v_reason) ELSE notes END,
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = p_mission_id
  RETURNING * INTO v_mission;

  PERFORM public.business_finance_audit_event(
    'COURSE', v_mission.id, NULL,
    CASE WHEN v_before.status IN ('COMPLETED', 'CLOSED') THEN 'CORRECT' ELSE 'UPDATE' END,
    to_jsonb(v_before), to_jsonb(v_mission) || jsonb_build_object('correction_reason', v_reason)
  );
  RETURN v_mission;
END;
$update_transport_mission_actuals$;

CREATE OR REPLACE FUNCTION public.assign_transport_mission(p_mission_id uuid, p_assignment jsonb)
RETURNS public.transport_missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $assign_transport_mission$
DECLARE
  v_before public.transport_missions;
  v_mission public.transport_missions;
  v_vehicle_id uuid := NULLIF(p_assignment ->> 'vehicle_id', '')::uuid;
  v_driver_id uuid := NULLIF(p_assignment ->> 'driver_id', '')::uuid;
  v_reason text := NULLIF(btrim(p_assignment ->> 'override_reason'), '');
  v_vehicle public.vehicles;
  v_driver public.drivers;
  v_has_conflict boolean := false;
BEGIN
  PERFORM public.permission_require('assignments.manage');
  SELECT * INTO v_before FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status NOT IN ('DRAFT', 'PLANNED') THEN
    RAISE EXCEPTION 'Cette Course ne peut plus être affectée.' USING ERRCODE = '22023';
  END IF;
  IF v_vehicle_id IS NULL OR v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Sélectionnez un véhicule et un chauffeur pour cette affectation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = v_vehicle_id;
  IF NOT FOUND OR v_vehicle.status IS DISTINCT FROM 'EN_SERVICE' THEN
    RAISE EXCEPTION 'Le véhicule sélectionné est indisponible.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_driver FROM public.drivers WHERE id = v_driver_id;
  IF NOT FOUND OR lower(coalesce(v_driver.statut::text, '')) NOT IN ('actif', 'active') THEN
    RAISE EXCEPTION 'Le chauffeur sélectionné est indisponible.' USING ERRCODE = '22023';
  END IF;

  IF v_before.planned_departure_at IS NOT NULL AND v_before.planned_arrival_at IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.transport_missions scheduled
      WHERE scheduled.id <> p_mission_id
        AND scheduled.status IN ('PLANNED', 'IN_PROGRESS')
        AND scheduled.overlap_exception_reason IS NULL
        AND scheduled.planned_departure_at IS NOT NULL
        AND scheduled.planned_arrival_at IS NOT NULL
        AND tstzrange(scheduled.planned_departure_at, scheduled.planned_arrival_at, '[)')
          && tstzrange(v_before.planned_departure_at, v_before.planned_arrival_at, '[)')
        AND (scheduled.vehicle_id = v_vehicle_id OR scheduled.driver_id = v_driver_id)
    ) INTO v_has_conflict;
  END IF;
  IF v_has_conflict AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Cette affectation entre en conflit avec une autre Course. Une dérogation justifiée est requise.' USING ERRCODE = '23P01';
  END IF;
  IF v_reason IS NOT NULL THEN PERFORM public.permission_require('missions.override'); END IF;
  IF v_before.vehicle_id = v_vehicle_id AND v_before.driver_id = v_driver_id
    AND v_before.overlap_exception_reason IS NOT DISTINCT FROM v_reason THEN RETURN v_before; END IF;

  UPDATE public.transport_missions SET vehicle_id = v_vehicle_id, driver_id = v_driver_id,
    overlap_exception_reason = v_reason, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_mission_id RETURNING * INTO v_mission;
  PERFORM public.business_finance_audit_event('COURSE', v_mission.id, NULL, 'ASSIGN', to_jsonb(v_before), to_jsonb(v_mission));
  RETURN v_mission;
END;
$assign_transport_mission$;

CREATE OR REPLACE FUNCTION public.create_transport_invoice(p_mission_id uuid, p_invoice jsonb)
RETURNS public.transport_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $create_transport_invoice$
DECLARE
  v_invoice public.transport_invoices;
  v_mission public.transport_missions;
  v_requested_subtotal numeric;
  v_subtotal numeric;
  v_rate numeric;
  v_tax numeric;
  v_vat_enabled boolean;
BEGIN
  PERFORM public.permission_require('missions.invoice');
  SELECT * INTO v_mission FROM public.transport_missions WHERE id = p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.status IN ('CANCELLED', 'CLOSED') THEN
    RAISE EXCEPTION 'Course introuvable ou non facturable.' USING ERRCODE = '22023';
  END IF;
  IF v_mission.actual_transport_amount IS NULL THEN
    RAISE EXCEPTION 'Le transport réel doit être calculé ou confirmé avant la facturation.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transport_invoices WHERE mission_id = p_mission_id AND status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'Une facture active existe déjà pour cette Course.' USING ERRCODE = '23505';
  END IF;
  v_requested_subtotal := NULLIF(p_invoice ->> 'subtotal_amount', '')::numeric;
  IF v_requested_subtotal IS NOT NULL AND v_requested_subtotal IS DISTINCT FROM v_mission.actual_transport_amount THEN
    RAISE EXCEPTION 'La facture doit reprendre exactement le montant du transport réel.' USING ERRCODE = '22023';
  END IF;
  v_subtotal := v_mission.actual_transport_amount;
  SELECT COALESCE(vat_enabled, false), COALESCE(vat_rate, 0)
    INTO v_vat_enabled, v_rate FROM public.company_settings ORDER BY created_at LIMIT 1;
  IF NOT COALESCE(v_vat_enabled, false) THEN v_rate := 0;
  ELSE v_rate := COALESCE(NULLIF(p_invoice ->> 'tax_rate', '')::numeric, v_rate, 0); END IF;
  IF v_rate < 0 OR v_rate > 100 THEN RAISE EXCEPTION 'Taux de TVA invalide.' USING ERRCODE = '22023'; END IF;
  v_tax := round(v_subtotal * v_rate / 100, 2);
  INSERT INTO public.transport_invoices(invoice_number, mission_id, client_id, due_date, subtotal_amount,
    tax_rate, tax_amount, total_amount, notes, created_by, updated_by)
  VALUES(public._internal_next_transport_invoice_number(), p_mission_id, v_mission.client_id,
    NULLIF(p_invoice ->> 'due_date', '')::date, v_subtotal, v_rate, v_tax, round(v_subtotal + v_tax, 2),
    NULLIF(btrim(p_invoice ->> 'notes'), ''), auth.uid(), auth.uid())
  RETURNING * INTO v_invoice;
  PERFORM public.business_finance_audit_event('COURSE_INVOICE', v_invoice.id, NULL, 'CREATE', NULL, to_jsonb(v_invoice));
  RETURN v_invoice;
END;
$create_transport_invoice$;

CREATE OR REPLACE FUNCTION public._internal_refresh_transport_course_budget_notification(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_refresh_transport_course_budget_notification$
BEGIN
  UPDATE public.notifications n SET status = 'RESOLVED'
  FROM public.notification_transport_mission_links link
  WHERE link.notification_id = n.id AND link.mission_id = p_mission_id
    AND n.type = 'COURSE_BUDGET_EXCEEDED' AND n.status IN ('UNREAD', 'READ', 'SNOOZED');
  RETURN 0;
END;
$internal_refresh_transport_course_budget_notification$;

CREATE OR REPLACE FUNCTION public.get_client_financial_metrics(p_client_id uuid)
RETURNS TABLE(metrics_available boolean, mission_count bigint, total_billed numeric, total_received numeric,
  amount_due numeric, total_expenses numeric, gross_result numeric, cash_result numeric,
  last_mission_at timestamptz, last_payment_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $get_client_financial_metrics$
BEGIN
  PERFORM public.permission_require('clients.financial.read');
  RETURN QUERY SELECT true,
    (SELECT count(*) FROM public.transport_missions WHERE client_id = p_client_id),
    COALESCE((SELECT sum(total_amount) FROM public.transport_invoices WHERE client_id = p_client_id AND status <> 'CANCELLED'), 0),
    COALESCE((SELECT sum(payment.amount) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id = payment.invoice_id WHERE invoice.client_id = p_client_id AND payment.status = 'CONFIRMED'), 0),
    COALESCE((SELECT sum(total_amount) FROM public.transport_invoices WHERE client_id = p_client_id AND status <> 'CANCELLED'), 0)
      - COALESCE((SELECT sum(payment.amount) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id = payment.invoice_id WHERE invoice.client_id = p_client_id AND payment.status = 'CONFIRMED'), 0),
    COALESCE((SELECT sum(expense.amount) FROM public.transport_mission_expenses expense JOIN public.transport_missions mission ON mission.id = expense.mission_id WHERE mission.client_id = p_client_id AND expense.status = 'PAID'), 0),
    CASE WHEN EXISTS (SELECT 1 FROM public.transport_missions WHERE client_id = p_client_id AND actual_transport_amount IS NULL) THEN NULL
      ELSE COALESCE((SELECT sum(actual_transport_amount) FROM public.transport_missions WHERE client_id = p_client_id), 0)
        - COALESCE((SELECT sum(expense.amount) FROM public.transport_mission_expenses expense JOIN public.transport_missions mission ON mission.id = expense.mission_id WHERE mission.client_id = p_client_id AND expense.status = 'PAID'), 0) END,
    COALESCE((SELECT sum(payment.amount) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id = payment.invoice_id WHERE invoice.client_id = p_client_id AND payment.status = 'CONFIRMED'), 0)
      - COALESCE((SELECT sum(expense.amount) FROM public.transport_mission_expenses expense JOIN public.transport_missions mission ON mission.id = expense.mission_id WHERE mission.client_id = p_client_id AND expense.status = 'PAID'), 0),
    (SELECT max(created_at) FROM public.transport_missions WHERE client_id = p_client_id),
    (SELECT max(payment.created_at) FROM public.transport_invoice_payments payment JOIN public.transport_invoices invoice ON invoice.id = payment.invoice_id WHERE invoice.client_id = p_client_id);
END;
$get_client_financial_metrics$;

CREATE OR REPLACE FUNCTION public.get_transport_mission_financial_summary(p_mission_id uuid)
RETURNS TABLE(quoted_amount numeric, budget_amount numeric, actual_expenses numeric, invoiced_amount numeric, received_amount numeric, amount_due numeric, gross_result numeric, cash_result numeric, cost_per_km numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $get_transport_mission_financial_summary$
DECLARE
  v_mission public.transport_missions;
  v_expenses numeric;
  v_invoiced numeric;
  v_received numeric;
BEGIN
  PERFORM public.permission_require('missions.finance.read');
  SELECT * INTO v_mission FROM public.transport_missions WHERE id = p_mission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002'; END IF;

  SELECT sum(amount) INTO v_expenses FROM public.transport_mission_expenses WHERE mission_id = p_mission_id AND status = 'PAID';
  SELECT COALESCE(sum(total_amount), 0) INTO v_invoiced FROM public.transport_invoices WHERE mission_id = p_mission_id AND status <> 'CANCELLED';
  SELECT COALESCE(sum(amount), 0) INTO v_received FROM public.transport_invoice_payments WHERE mission_id = p_mission_id AND status = 'CONFIRMED';

  RETURN QUERY SELECT
    v_mission.actual_transport_amount,
    NULL::numeric,
    v_expenses,
    v_invoiced,
    v_received,
    v_invoiced - v_received,
    CASE WHEN v_mission.actual_transport_amount IS NULL OR v_expenses IS NULL THEN NULL ELSE v_mission.actual_transport_amount - v_expenses END,
    CASE WHEN v_received = 0 AND v_expenses IS NULL THEN NULL ELSE v_received - COALESCE(v_expenses, 0) END,
    CASE WHEN v_expenses IS NOT NULL AND v_mission.start_odometer IS NOT NULL AND v_mission.end_odometer > v_mission.start_odometer
      THEN round(v_expenses / (v_mission.end_odometer - v_mission.start_odometer), 2) ELSE NULL END;
END;
$get_transport_mission_financial_summary$;

REVOKE ALL ON FUNCTION public.update_transport_mission_actuals(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_transport_mission_actuals(uuid, jsonb) TO authenticated;
