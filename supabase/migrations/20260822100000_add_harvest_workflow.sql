-- Récoltes V1: separate PLANNING from EXECUTION from DELIVERY from SALE.
-- Audit confirmed the current model conflates the physical harvest event
-- with its commercial sale in one flat row, and the ONLY reason wallet/
-- quantity/price feel "mandatory at creation" is the frontend form -- the
-- existing backend (_internal_create/update_harvest_with_finance) already
-- makes Finance creation conditional on sale_wallet_id being set. This
-- migration keeps that Finance path completely untouched and reachable
-- only from a new, later, explicit "sell_harvest" action; it adds the
-- planning/execution/delivery columns and the state machine around them.
--
-- Purely additive: existing columns keep their names and meaning for the
-- commercial/vente moment specifically (quantite_kg, prix_kg, acheteur,
-- sale_wallet_id, montant_total, observations). Existing rows are
-- classified status='LEGACY' -- not rewritten, not backfilled with
-- invented physical/planning data.

ALTER TABLE public.harvests
  ADD COLUMN status text,
  ADD COLUMN planned_date date,
  ADD COLUMN parcelle text,
  ADD COLUMN responsable_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN equipe text,
  ADD COLUMN transporteur text,
  ADD COLUMN vehicule text,
  ADD COLUMN destination_prevue text,
  ADD COLUMN transport_rate_per_kg numeric(14, 2),
  ADD COLUMN planning_notes text,
  ADD COLUMN departure_notes text,
  ADD COLUMN delivery_notes text,
  ADD COLUMN poids_recolte_kg numeric(14, 2),
  ADD COLUMN poids_perte_recolte_kg numeric(14, 2),
  ADD COLUMN poids_livre_kg numeric(14, 2),
  ADD COLUMN ecart_livraison_kg numeric(14, 2) GENERATED ALWAYS AS (poids_recolte_kg - poids_livre_kg) STORED,
  ADD COLUMN destination_reelle text,
  ADD COLUMN receptionnaire text,
  ADD COLUMN transport_amount_theorique numeric(14, 2) GENERATED ALWAYS AS (transport_rate_per_kg * poids_livre_kg) STORED,
  ADD COLUMN planned_by uuid REFERENCES auth.users(id),
  ADD COLUMN started_at timestamptz,
  ADD COLUMN started_by uuid REFERENCES auth.users(id),
  ADD COLUMN harvested_at timestamptz,
  ADD COLUMN harvested_by uuid REFERENCES auth.users(id),
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivered_by uuid REFERENCES auth.users(id),
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid REFERENCES auth.users(id),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN cancel_reason text;

-- Existing rows never went through this workflow -- classify explicitly
-- rather than guess a PLANNED/STARTED/... value that never applied to them.
UPDATE public.harvests SET status = 'LEGACY' WHERE status IS NULL;

ALTER TABLE public.harvests ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.harvests ALTER COLUMN status SET DEFAULT 'PLANNED';
ALTER TABLE public.harvests ADD CONSTRAINT harvests_status_check
  CHECK (status IN ('PLANNED', 'STARTED', 'HARVESTED', 'DELIVERED', 'CLOSED', 'CANCELLED', 'LEGACY'));

-- Widen: a PLANNED harvest has no physical/commercial figures yet. The
-- generated montant_total already tolerates NULL operands (evaluates to
-- NULL, no error); the Finance-creation guard in
-- _internal_*_harvest_with_finance still requires a positive amount
-- whenever a wallet is actually supplied, which is unchanged.
ALTER TABLE public.harvests ALTER COLUMN quantite_kg DROP NOT NULL;
ALTER TABLE public.harvests ALTER COLUMN quantite_kg DROP DEFAULT;
ALTER TABLE public.harvests ALTER COLUMN prix_kg DROP NOT NULL;
ALTER TABLE public.harvests ALTER COLUMN prix_kg DROP DEFAULT;
ALTER TABLE public.harvests ALTER COLUMN date_recolte DROP NOT NULL;

COMMENT ON COLUMN public.harvests.date_recolte IS 'Legacy flat date column. New rows leave this NULL until harvested_at is recorded; kept for backward-compatible reads.';
COMMENT ON COLUMN public.harvests.quantite_kg IS 'Commercial (vente) quantity, set only via sell_harvest -- distinct from poids_recolte_kg/poids_livre_kg, the physical weights.';

CREATE INDEX harvests_status_idx ON public.harvests (status);
CREATE INDEX harvests_farm_planned_date_idx ON public.harvests (farm_id, planned_date);

-- One recurrence rule per (farm, produit). A rule proposes the next
-- planned harvest once the previous one closes; it never creates a
-- harvest by itself (mission: "Ne crée PAS automatiquement une récolte
-- définitive sans validation humaine").
CREATE TABLE public.harvest_recurrence_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id),
  produit text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'CUSTOM_DAYS')),
  interval_value integer NOT NULL DEFAULT 1 CHECK (interval_value > 0),
  day_of_month integer CHECK (day_of_month BETWEEN 1 AND 31),
  reminder_days_before integer NOT NULL DEFAULT 3 CHECK (reminder_days_before >= 0),
  enabled boolean NOT NULL DEFAULT true,
  last_harvest_id uuid REFERENCES public.harvests(id),
  next_expected_date date,
  cycle_status text NOT NULL DEFAULT 'PENDING' CHECK (cycle_status IN ('PENDING', 'CONFIRMED', 'POSTPONED', 'IGNORED')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, produit)
);

ALTER TABLE public.harvest_recurrence_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY harvest_recurrence_rules_read ON public.harvest_recurrence_rules FOR SELECT TO authenticated
  USING (public.user_has_any_permission(ARRAY['harvests.manage', 'farms.finance.read']::text[]));
CREATE POLICY harvest_recurrence_rules_write ON public.harvest_recurrence_rules FOR ALL TO authenticated
  USING (public.user_has_permission('harvests.manage'))
  WITH CHECK (public.user_has_permission('harvests.manage'));

REVOKE ALL ON public.harvest_recurrence_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.harvest_recurrence_rules TO authenticated;

------------------------------------------------------------------
-- Internal helper: compute the next expected date for a recurrence rule.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_next_harvest_occurrence(
  p_from date, p_frequency text, p_interval integer, p_day_of_month integer
) RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  IF p_frequency = 'WEEKLY' THEN
    RETURN p_from + make_interval(weeks => p_interval);
  ELSIF p_frequency = 'CUSTOM_DAYS' THEN
    RETURN p_from + make_interval(days => p_interval);
  ELSE -- MONTHLY
    RETURN LEAST(
      (date_trunc('month', p_from + make_interval(months => p_interval)) + make_interval(days => COALESCE(p_day_of_month, 1) - 1))::date,
      (date_trunc('month', p_from + make_interval(months => p_interval + 1)) - interval '1 day')::date
    );
  END IF;
END;
$function$;

------------------------------------------------------------------
-- plan_harvest: the ONLY creation entry point for the new workflow.
-- Accepts exclusively what can genuinely be known ahead of time.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_plan_harvest(p_harvest jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_harvest public.harvests;
BEGIN
  INSERT INTO public.harvests (
    farm_id, produit, planned_date, responsable_employee_id,
    parcelle, equipe, transporteur, vehicule, destination_prevue,
    transport_rate_per_kg, planning_notes, planned_by, status
  ) VALUES (
    NULLIF(p_harvest ->> 'farm_id', '')::uuid,
    NULLIF(trim(p_harvest ->> 'produit'), ''),
    NULLIF(p_harvest ->> 'planned_date', '')::date,
    NULLIF(p_harvest ->> 'responsable_employee_id', '')::uuid,
    NULLIF(trim(p_harvest ->> 'parcelle'), ''),
    NULLIF(trim(p_harvest ->> 'equipe'), ''),
    NULLIF(trim(p_harvest ->> 'transporteur'), ''),
    NULLIF(trim(p_harvest ->> 'vehicule'), ''),
    NULLIF(trim(p_harvest ->> 'destination_prevue'), ''),
    NULLIF(p_harvest ->> 'transport_rate_per_kg', '')::numeric,
    NULLIF(trim(p_harvest ->> 'planning_notes'), ''),
    auth.uid(),
    'PLANNED'
  ) RETURNING * INTO v_harvest;

  IF v_harvest.farm_id IS NULL OR v_harvest.produit IS NULL OR v_harvest.planned_date IS NULL OR v_harvest.responsable_employee_id IS NULL THEN
    RAISE EXCEPTION 'Exploitation, produit, date prévue et responsable sont obligatoires pour planifier une récolte.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'CREATE', NULL, to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.plan_harvest(p_harvest jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_plan_harvest(p_harvest); END; $function$;

------------------------------------------------------------------
-- start_harvest: PLANNED -> STARTED. Idempotent (already-STARTED or
-- beyond returns the row unchanged, no duplicate transition).
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_start_harvest(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;

  IF v_before.status <> 'PLANNED' THEN
    IF v_before.status = 'STARTED' THEN RETURN v_before; END IF;
    RAISE EXCEPTION 'Cette récolte n''est plus en attente de démarrage (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.harvests SET
    status = 'STARTED',
    started_at = now(),
    started_by = auth.uid(),
    responsable_employee_id = COALESCE(NULLIF(p_payload ->> 'responsable_employee_id', '')::uuid, responsable_employee_id),
    equipe = COALESCE(NULLIF(trim(p_payload ->> 'equipe'), ''), equipe),
    transporteur = COALESCE(NULLIF(trim(p_payload ->> 'transporteur'), ''), transporteur),
    vehicule = COALESCE(NULLIF(trim(p_payload ->> 'vehicule'), ''), vehicule),
    departure_notes = NULLIF(trim(p_payload ->> 'departure_notes'), ''),
    updated_at = now()
  WHERE id = p_harvest_id
  RETURNING * INTO v_harvest;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_harvest(p_harvest_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_start_harvest(p_harvest_id, p_payload); END; $function$;

------------------------------------------------------------------
-- record_harvest: STARTED -> HARVESTED. Requires the real harvested
-- weight -- never required before this point.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_record_harvest(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
  v_poids numeric(14, 2) := NULLIF(p_payload ->> 'poids_recolte_kg', '')::numeric;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;

  IF v_before.status <> 'STARTED' THEN
    IF v_before.status = 'HARVESTED' THEN RETURN v_before; END IF;
    RAISE EXCEPTION 'Cette récolte doit d''abord être démarrée (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;
  IF v_poids IS NULL OR v_poids <= 0 THEN
    RAISE EXCEPTION 'Le poids réellement récolté est obligatoire et doit être positif.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.harvests SET
    status = 'HARVESTED',
    harvested_at = now(),
    harvested_by = auth.uid(),
    poids_recolte_kg = v_poids,
    poids_perte_recolte_kg = NULLIF(p_payload ->> 'poids_perte_recolte_kg', '')::numeric,
    observations = COALESCE(NULLIF(trim(p_payload ->> 'observations'), ''), observations),
    date_recolte = now()::date,
    updated_at = now()
  WHERE id = p_harvest_id
  RETURNING * INTO v_harvest;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_harvest(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_record_harvest(p_harvest_id, p_payload); END; $function$;

------------------------------------------------------------------
-- record_harvest_delivery: HARVESTED -> DELIVERED.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_record_harvest_delivery(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
  v_poids numeric(14, 2) := NULLIF(p_payload ->> 'poids_livre_kg', '')::numeric;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;

  IF v_before.status <> 'HARVESTED' THEN
    IF v_before.status = 'DELIVERED' THEN RETURN v_before; END IF;
    RAISE EXCEPTION 'Cette récolte doit d''abord être enregistrée comme récoltée (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;
  IF v_poids IS NULL OR v_poids < 0 THEN
    RAISE EXCEPTION 'Le poids livré est obligatoire et ne peut être négatif.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.harvests SET
    status = 'DELIVERED',
    delivered_at = now(),
    delivered_by = auth.uid(),
    poids_livre_kg = v_poids,
    destination_reelle = COALESCE(NULLIF(trim(p_payload ->> 'destination_reelle'), ''), destination_prevue),
    receptionnaire = NULLIF(trim(p_payload ->> 'receptionnaire'), ''),
    delivery_notes = NULLIF(trim(p_payload ->> 'delivery_notes'), ''),
    updated_at = now()
  WHERE id = p_harvest_id
  RETURNING * INTO v_harvest;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_harvest_delivery(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_record_harvest_delivery(p_harvest_id, p_payload); END; $function$;

------------------------------------------------------------------
-- close_harvest: DELIVERED -> CLOSED. Advances the recurrence rule's
-- next_expected_date, if one exists for this (farm, produit).
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_close_harvest(p_harvest_id uuid)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
  v_rule public.harvest_recurrence_rules;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;

  IF v_before.status <> 'DELIVERED' THEN
    IF v_before.status = 'CLOSED' THEN RETURN v_before; END IF;
    RAISE EXCEPTION 'Cette récolte doit d''abord être livrée (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.harvests SET status = 'CLOSED', closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = p_harvest_id
  RETURNING * INTO v_harvest;

  SELECT * INTO v_rule FROM public.harvest_recurrence_rules
  WHERE farm_id = v_harvest.farm_id AND produit = v_harvest.produit AND enabled FOR UPDATE;
  IF FOUND THEN
    UPDATE public.harvest_recurrence_rules SET
      last_harvest_id = v_harvest.id,
      next_expected_date = public._internal_next_harvest_occurrence(
        COALESCE(v_harvest.harvested_at::date, v_harvest.planned_date, current_date),
        v_rule.frequency, v_rule.interval_value, v_rule.day_of_month
      ),
      cycle_status = 'PENDING',
      updated_at = now()
    WHERE id = v_rule.id;
  END IF;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_harvest(p_harvest_id uuid)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_close_harvest(p_harvest_id); END; $function$;

------------------------------------------------------------------
-- cancel_harvest: PLANNED -> CANCELLED only. Never after STARTED.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_cancel_harvest(p_harvest_id uuid, p_reason text)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
  v_harvest public.harvests;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;

  IF v_before.status = 'CANCELLED' THEN RETURN v_before; END IF;
  IF v_before.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Une récolte déjà démarrée ne peut plus être annulée (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.harvests SET
    status = 'CANCELLED', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = NULLIF(trim(p_reason), ''), updated_at = now()
  WHERE id = p_harvest_id
  RETURNING * INTO v_harvest;

  PERFORM public.business_finance_audit_event('HARVEST', v_harvest.id, NULL, 'UPDATE', to_jsonb(v_before), to_jsonb(v_harvest));
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_harvest(p_harvest_id uuid, p_reason text DEFAULT NULL)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_cancel_harvest(p_harvest_id, p_reason); END; $function$;

------------------------------------------------------------------
-- sell_harvest: the ONLY place quantite_kg/prix_kg/acheteur/wallet are
-- ever set. Reuses _internal_update_harvest_with_finance UNCHANGED --
-- same Finance path, same conditional-on-wallet behaviour, same audit.
-- Allowed from HARVESTED onward: a harvest can be sold immediately after
-- being recorded, without waiting for delivery or closure.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_sell_harvest(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_before public.harvests;
BEGIN
  SELECT * INTO v_before FROM public.harvests WHERE id = p_harvest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Récolte introuvable.' USING ERRCODE = 'P0002'; END IF;
  IF v_before.status IN ('PLANNED', 'STARTED') THEN
    RAISE EXCEPTION 'Une récolte doit être au moins enregistrée (récoltée) avant de pouvoir être vendue (statut actuel : %).', v_before.status USING ERRCODE = '22023';
  END IF;

  RETURN public._internal_update_harvest_with_finance(
    jsonb_build_object(
      'id', p_harvest_id,
      'farm_id', v_before.farm_id,
      'date_recolte', COALESCE(v_before.date_recolte, current_date),
      'produit', v_before.produit,
      'quantite_kg', p_payload ->> 'quantite_kg',
      'prix_kg', p_payload ->> 'prix_kg',
      'acheteur', p_payload ->> 'acheteur',
      'observations', v_before.observations,
      'sale_wallet_id', p_payload ->> 'sale_wallet_id'
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sell_harvest(p_harvest_id uuid, p_payload jsonb)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_sell_harvest(p_harvest_id, p_payload); END; $function$;

------------------------------------------------------------------
-- Recurrence configuration + confirm/postpone/dismiss the proposed cycle.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._internal_configure_harvest_recurrence(p_rule jsonb)
RETURNS public.harvest_recurrence_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_rule public.harvest_recurrence_rules;
  v_farm_id uuid := NULLIF(p_rule ->> 'farm_id', '')::uuid;
  v_produit text := NULLIF(trim(p_rule ->> 'produit'), '');
  v_frequency text := NULLIF(p_rule ->> 'frequency', '');
  v_interval integer := COALESCE(NULLIF(p_rule ->> 'interval_value', '')::integer, 1);
  v_day_of_month integer := NULLIF(p_rule ->> 'day_of_month', '')::integer;
  v_reminder_days integer := COALESCE(NULLIF(p_rule ->> 'reminder_days_before', '')::integer, 3);
  v_anchor date := COALESCE(NULLIF(p_rule ->> 'anchor_date', '')::date, current_date);
BEGIN
  IF v_farm_id IS NULL OR v_produit IS NULL OR v_frequency NOT IN ('WEEKLY', 'MONTHLY', 'CUSTOM_DAYS') THEN
    RAISE EXCEPTION 'Exploitation, produit et fréquence valides sont obligatoires.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.harvest_recurrence_rules (
    farm_id, produit, frequency, interval_value, day_of_month, reminder_days_before,
    enabled, next_expected_date, cycle_status, created_by
  ) VALUES (
    v_farm_id, v_produit, v_frequency, v_interval, v_day_of_month, v_reminder_days,
    true, public._internal_next_harvest_occurrence(v_anchor, v_frequency, v_interval, v_day_of_month),
    'PENDING', auth.uid()
  )
  ON CONFLICT (farm_id, produit) DO UPDATE SET
    frequency = excluded.frequency,
    interval_value = excluded.interval_value,
    day_of_month = excluded.day_of_month,
    reminder_days_before = excluded.reminder_days_before,
    enabled = true,
    next_expected_date = public._internal_next_harvest_occurrence(v_anchor, excluded.frequency, excluded.interval_value, excluded.day_of_month),
    cycle_status = 'PENDING',
    updated_at = now()
  RETURNING * INTO v_rule;

  RETURN v_rule;
END;
$function$;

CREATE OR REPLACE FUNCTION public.configure_harvest_recurrence(p_rule jsonb)
RETURNS public.harvest_recurrence_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_configure_harvest_recurrence(p_rule); END; $function$;

-- CONFIRM: creates the next PLANNED harvest from the rule. Idempotent --
-- a cycle already CONFIRMED returns the existing planned harvest instead
-- of creating a second one.
CREATE OR REPLACE FUNCTION public._internal_confirm_harvest_cycle(p_rule_id uuid)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_rule public.harvest_recurrence_rules;
  v_existing public.harvests;
  v_harvest public.harvests;
BEGIN
  SELECT * INTO v_rule FROM public.harvest_recurrence_rules WHERE id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Règle de récurrence introuvable.' USING ERRCODE = 'P0002'; END IF;

  IF v_rule.cycle_status = 'CONFIRMED' THEN
    SELECT * INTO v_existing FROM public.harvests
    WHERE farm_id = v_rule.farm_id AND produit = v_rule.produit AND planned_date = v_rule.next_expected_date AND status = 'PLANNED'
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  v_harvest := public._internal_plan_harvest(jsonb_build_object(
    'farm_id', v_rule.farm_id,
    'produit', v_rule.produit,
    'planned_date', v_rule.next_expected_date,
    'responsable_employee_id', (SELECT responsable_employee_id FROM public.harvests WHERE id = v_rule.last_harvest_id),
    'planning_notes', 'Cycle confirmé depuis la récurrence configurée.'
  ));

  UPDATE public.harvest_recurrence_rules SET cycle_status = 'CONFIRMED', updated_at = now() WHERE id = p_rule_id;
  RETURN v_harvest;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_harvest_cycle(p_rule_id uuid)
RETURNS public.harvests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$ BEGIN PERFORM public.permission_require('harvests.manage'); RETURN public._internal_confirm_harvest_cycle(p_rule_id); END; $function$;

CREATE OR REPLACE FUNCTION public.postpone_harvest_cycle(p_rule_id uuid, p_new_date date)
RETURNS public.harvest_recurrence_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_rule public.harvest_recurrence_rules;
BEGIN
  PERFORM public.permission_require('harvests.manage');
  IF p_new_date IS NULL THEN RAISE EXCEPTION 'Une nouvelle date est obligatoire pour reporter le cycle.' USING ERRCODE = '22023'; END IF;
  UPDATE public.harvest_recurrence_rules
  SET next_expected_date = p_new_date, cycle_status = 'POSTPONED', updated_at = now()
  WHERE id = p_rule_id
  RETURNING * INTO v_rule;
  IF NOT FOUND THEN RAISE EXCEPTION 'Règle de récurrence introuvable.' USING ERRCODE = 'P0002'; END IF;
  RETURN v_rule;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_harvest_cycle(p_rule_id uuid)
RETURNS public.harvest_recurrence_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_rule public.harvest_recurrence_rules;
BEGIN
  PERFORM public.permission_require('harvests.manage');
  UPDATE public.harvest_recurrence_rules SET cycle_status = 'IGNORED', updated_at = now()
  WHERE id = p_rule_id
  RETURNING * INTO v_rule;
  IF NOT FOUND THEN RAISE EXCEPTION 'Règle de récurrence introuvable.' USING ERRCODE = 'P0002'; END IF;
  RETURN v_rule;
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_harvest(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_harvest(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_harvest(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_harvest_delivery(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_harvest(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_harvest(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sell_harvest(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configure_harvest_recurrence(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_harvest_cycle(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.postpone_harvest_cycle(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_harvest_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_harvest(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_harvest(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_harvest(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_harvest_delivery(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_harvest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_harvest(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_harvest(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_harvest_recurrence(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_harvest_cycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.postpone_harvest_cycle(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_harvest_cycle(uuid) TO authenticated;

-- Internal-only (no direct grant, called exclusively from the wrappers/
-- other internals above): _internal_plan_harvest, _internal_start_harvest,
-- _internal_record_harvest, _internal_record_harvest_delivery,
-- _internal_close_harvest, _internal_cancel_harvest, _internal_sell_harvest,
-- _internal_configure_harvest_recurrence, _internal_confirm_harvest_cycle,
-- _internal_next_harvest_occurrence.
REVOKE ALL ON FUNCTION public._internal_plan_harvest(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_start_harvest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_record_harvest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_record_harvest_delivery(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_close_harvest(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_cancel_harvest(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_sell_harvest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_configure_harvest_recurrence(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_confirm_harvest_cycle(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._internal_next_harvest_occurrence(date, text, integer, integer) FROM PUBLIC, anon, authenticated;
