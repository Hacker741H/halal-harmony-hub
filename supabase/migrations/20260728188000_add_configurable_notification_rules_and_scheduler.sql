-- Lot 8: configurable internal-alert rules and a serialized generation journal.
-- This migration is additive and keeps the Lot 7 notification model intact.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS notification_daily_run_time time NOT NULL DEFAULT '06:00';

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS alert_threshold numeric(14, 2);

CREATE TABLE IF NOT EXISTS public.notification_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  default_severity text NOT NULL DEFAULT 'WARNING',
  severity_schedule jsonb NOT NULL DEFAULT '{"overdue":"CRITICAL","0":"CRITICAL","7":"WARNING","15":"WARNING","30":"INFO"}'::jsonb,
  due_days integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  threshold numeric(14, 2),
  recipient_roles public.app_role[] NOT NULL DEFAULT ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT notification_alert_rules_default_severity_check
    CHECK (default_severity IN ('INFO', 'WARNING', 'CRITICAL')),
  CONSTRAINT notification_alert_rules_schedule_is_object_check
    CHECK (jsonb_typeof(severity_schedule) = 'object'),
  CONSTRAINT notification_alert_rules_threshold_nonnegative_check
    CHECK (threshold IS NULL OR threshold >= 0)
);

CREATE INDEX IF NOT EXISTS notification_alert_rules_enabled_idx
  ON public.notification_alert_rules(enabled, alert_type);

DROP TRIGGER IF EXISTS trg_notification_alert_rules_updated ON public.notification_alert_rules;
CREATE TRIGGER trg_notification_alert_rules_updated
  BEFORE UPDATE ON public.notification_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.notification_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',
  trigger_type text NOT NULL,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  resolved_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_message text,
  CONSTRAINT notification_generation_runs_status_check
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT notification_generation_runs_trigger_type_check
    CHECK (trigger_type IN ('SCHEDULED', 'MANUAL', 'DASHBOARD_FALLBACK', 'TEST')),
  CONSTRAINT notification_generation_runs_counts_check
    CHECK (created_count >= 0 AND updated_count >= 0 AND resolved_count >= 0 AND error_count >= 0)
);

CREATE INDEX IF NOT EXISTS notification_generation_runs_started_idx
  ON public.notification_generation_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS notification_generation_runs_status_idx
  ON public.notification_generation_runs(status, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_settings_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL,
  entity_type text,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_settings_audit_key_created_idx
  ON public.notification_settings_audit(setting_key, created_at DESC);

ALTER TABLE public.notification_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_alert_rules_read ON public.notification_alert_rules;
CREATE POLICY notification_alert_rules_read ON public.notification_alert_rules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS notification_generation_runs_read ON public.notification_generation_runs;
CREATE POLICY notification_generation_runs_read ON public.notification_generation_runs
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]));

DROP POLICY IF EXISTS notification_settings_audit_read ON public.notification_settings_audit;
CREATE POLICY notification_settings_audit_read ON public.notification_settings_audit
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]));

GRANT SELECT ON public.notification_alert_rules TO authenticated;
GRANT SELECT ON public.notification_generation_runs TO authenticated;
GRANT SELECT ON public.notification_settings_audit TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_alert_rules FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_generation_runs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_settings_audit FROM authenticated;
GRANT ALL ON public.notification_alert_rules, public.notification_generation_runs, public.notification_settings_audit TO service_role;

-- The existing company settings policy allowed direct writes. Alert settings now
-- go through audited RPCs instead, while retaining the public read policy.
DROP POLICY IF EXISTS settings_write ON public.company_settings;
REVOKE INSERT, UPDATE, DELETE ON public.company_settings FROM authenticated;

INSERT INTO public.notification_alert_rules (
  alert_type, enabled, default_severity, due_days, recipient_roles, description
)
VALUES
  ('DRIVER_LICENSE_EXPIRY', true, 'WARNING', ARRAY[30, 15, 7], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Expiration du permis chauffeur'),
  ('CONTRACT_EXPIRY', true, 'WARNING', ARRAY[30, 15, 7], ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[], 'Expiration d’un contrat'),
  ('DOCUMENT_EXPIRY', true, 'WARNING', ARRAY[30, 15, 7], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Expiration d’un document'),
  ('MOTORCYCLE_ASSURANCE_EXPIRY', true, 'WARNING', ARRAY[30, 15, 7], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Expiration de l’assurance moto'),
  ('MOTORCYCLE_VISIT_EXPIRY', true, 'WARNING', ARRAY[30, 15, 7], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Expiration de la visite technique moto'),
  ('MOTORCYCLE_MAINTENANCE_DATE', true, 'WARNING', ARRAY[30, 15, 7], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Entretien moto planifié'),
  ('MOTORCYCLE_MAINTENANCE_KILOMETRAGE', true, 'CRITICAL', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Entretien moto au kilométrage atteint'),
  ('NEGATIVE_WALLET', true, 'CRITICAL', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[], 'Wallet négatif'),
  ('LOW_WALLET', false, 'WARNING', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[], 'Wallet sous son seuil configuré'),
  ('LOW_STOCK', true, 'WARNING', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Stock inférieur ou égal au seuil de l’article'),
  ('VEHICLE_ASSIGNMENT_INCONSISTENCY', true, 'WARNING', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Affectation véhicule incohérente'),
  ('MOTORCYCLE_ASSIGNMENT_INCONSISTENCY', true, 'WARNING', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[], 'Affectation moto incohérente')
ON CONFLICT (alert_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notification_business_date()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $notification_business_date$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.company_settings ORDER BY created_at ASC LIMIT 1),
    'Africa/Dakar'
  ))::date;
$notification_business_date$;

CREATE OR REPLACE FUNCTION public.notification_rule_severity(
  p_alert_type text,
  p_due_date date DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $notification_rule_severity$
DECLARE
  v_default text;
  v_schedule jsonb;
  v_due_days integer[];
  v_remaining integer;
  v_stage integer;
BEGIN
  SELECT default_severity, severity_schedule, due_days
  INTO v_default, v_schedule, v_due_days
  FROM public.notification_alert_rules
  WHERE alert_type = p_alert_type;

  IF NOT FOUND OR p_due_date IS NULL THEN
    RETURN COALESCE(v_default, 'WARNING');
  END IF;

  v_remaining := p_due_date - public.notification_business_date();
  IF v_remaining < 0 THEN
    RETURN COALESCE(v_schedule ->> 'overdue', v_default, 'CRITICAL');
  END IF;
  IF v_remaining = 0 THEN
    RETURN COALESCE(v_schedule ->> '0', v_schedule ->> 'overdue', v_default, 'CRITICAL');
  END IF;

  SELECT min(day_value)
  INTO v_stage
  FROM unnest(COALESCE(v_due_days, ARRAY[]::integer[])) AS day_value
  WHERE day_value >= v_remaining;

  RETURN COALESCE(v_schedule ->> v_stage::text, v_default, 'WARNING');
END
$notification_rule_severity$;

CREATE OR REPLACE FUNCTION public.tg_apply_notification_due_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $apply_notification_due_stage$
BEGIN
  IF NEW.due_date IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.notification_alert_rules
       WHERE alert_type = NEW.type AND enabled
     ) THEN
    NEW.severity := public.notification_rule_severity(NEW.type, NEW.due_date);
  END IF;
  RETURN NEW;
END
$apply_notification_due_stage$;

CREATE OR REPLACE FUNCTION public.generate_configured_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $generate_configured_notifications$
DECLARE
  v_today date := public.notification_business_date();
  v_count integer := 0;
  v_created integer := 0;
  v_record record;
BEGIN
  FOR v_record IN
    SELECT d.id, d.date_expiration_permis, r.recipient_roles
    FROM public.drivers d
    JOIN public.notification_alert_rules r ON r.alert_type = 'DRIVER_LICENSE_EXPIRY' AND r.enabled
    WHERE d.date_expiration_permis IS NOT NULL
      AND d.statut NOT IN ('inactif', 'archive')
      AND d.date_expiration_permis <= v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'DRIVER_LICENSE_EXPIRY', public.notification_rule_severity('DRIVER_LICENSE_EXPIRY', v_record.date_expiration_permis),
      'Permis chauffeur à échéance', 'Le permis associé à ce chauffeur arrive à échéance ou est expiré.',
      v_record.date_expiration_permis, '/drivers/' || v_record.id,
      'DRIVER_LICENSE_EXPIRY:' || v_record.id || ':' || v_record.date_expiration_permis,
      v_record.recipient_roles, p_driver_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT c.id, c.date_fin, r.recipient_roles
    FROM public.contracts c
    JOIN public.notification_alert_rules r ON r.alert_type = 'CONTRACT_EXPIRY' AND r.enabled
    WHERE c.date_fin IS NOT NULL
      AND c.date_fin <= v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'CONTRACT_EXPIRY', public.notification_rule_severity('CONTRACT_EXPIRY', v_record.date_fin),
      'Contrat à échéance', 'Un contrat arrive à échéance ou est expiré.', v_record.date_fin, '/contracts',
      'CONTRACT_EXPIRY:' || v_record.id || ':' || v_record.date_fin,
      v_record.recipient_roles, p_contract_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT d.id, d.date_expiration, r.recipient_roles
    FROM public.documents d
    JOIN public.notification_alert_rules r ON r.alert_type = 'DOCUMENT_EXPIRY' AND r.enabled
    WHERE d.archived_at IS NULL
      AND d.date_expiration IS NOT NULL
      AND d.date_expiration <= v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'DOCUMENT_EXPIRY', public.notification_rule_severity('DOCUMENT_EXPIRY', v_record.date_expiration),
      'Document à échéance', 'Un document arrive à échéance ou est expiré.', v_record.date_expiration, '/documents',
      'DOCUMENT_EXPIRY:' || v_record.id || ':' || v_record.date_expiration,
      v_record.recipient_roles, p_document_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT m.id, m.assurance_expiration AS due_date, r.recipient_roles, r.alert_type
    FROM public.motorcycles m
    JOIN public.notification_alert_rules r ON r.alert_type = 'MOTORCYCLE_ASSURANCE_EXPIRY' AND r.enabled
    WHERE m.assurance_expiration IS NOT NULL
      AND m.assurance_expiration <= v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
    UNION ALL
    SELECT m.id, m.visite_expiration, r.recipient_roles, r.alert_type
    FROM public.motorcycles m
    JOIN public.notification_alert_rules r ON r.alert_type = 'MOTORCYCLE_VISIT_EXPIRY' AND r.enabled
    WHERE m.visite_expiration IS NOT NULL
      AND m.visite_expiration <= v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      v_record.alert_type, public.notification_rule_severity(v_record.alert_type, v_record.due_date),
      CASE WHEN v_record.alert_type = 'MOTORCYCLE_ASSURANCE_EXPIRY' THEN 'Assurance moto à échéance' ELSE 'Visite technique moto à échéance' END,
      'Une obligation réglementaire de cette moto arrive à échéance ou est expirée.',
      v_record.due_date, '/motorcycles/' || v_record.id,
      v_record.alert_type || ':' || v_record.id || ':' || v_record.due_date,
      v_record.recipient_roles, p_motorcycle_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT mm.id, mm.motorcycle_id, mm.next_date, r.recipient_roles
    FROM public.motorcycle_maintenances mm
    JOIN public.notification_alert_rules r ON r.alert_type = 'MOTORCYCLE_MAINTENANCE_DATE' AND r.enabled
    WHERE mm.next_date IS NOT NULL
      AND mm.next_date <= v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'MOTORCYCLE_MAINTENANCE_DATE', public.notification_rule_severity('MOTORCYCLE_MAINTENANCE_DATE', v_record.next_date),
      'Entretien moto à prévoir', 'Un entretien de moto arrive à échéance ou est en retard.', v_record.next_date,
      '/motorcycles/' || v_record.motorcycle_id || '?tab=entretiens',
      'MOTORCYCLE_MAINTENANCE_DATE:' || v_record.id || ':' || v_record.next_date,
      v_record.recipient_roles, p_motorcycle_id => v_record.motorcycle_id,
      p_motorcycle_maintenance_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT mm.id, mm.motorcycle_id, mm.next_kilometrage, r.recipient_roles
    FROM public.motorcycle_maintenances mm
    JOIN public.motorcycles m ON m.id = mm.motorcycle_id
    JOIN public.notification_alert_rules r ON r.alert_type = 'MOTORCYCLE_MAINTENANCE_KILOMETRAGE' AND r.enabled
    WHERE mm.next_kilometrage IS NOT NULL
      AND m.kilometrage IS NOT NULL
      AND m.kilometrage >= mm.next_kilometrage
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'MOTORCYCLE_MAINTENANCE_KILOMETRAGE', public.notification_rule_severity('MOTORCYCLE_MAINTENANCE_KILOMETRAGE', NULL),
      'Entretien moto dépassé', 'Le kilométrage prévu pour un entretien de moto est atteint ou dépassé.', NULL,
      '/motorcycles/' || v_record.motorcycle_id || '?tab=entretiens',
      'MOTORCYCLE_MAINTENANCE_KILOMETRAGE:' || v_record.id || ':' || v_record.next_kilometrage,
      v_record.recipient_roles, p_motorcycle_id => v_record.motorcycle_id,
      p_motorcycle_maintenance_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT w.id, r.recipient_roles
    FROM public.wallets w
    JOIN public.notification_alert_rules r ON r.alert_type = 'NEGATIVE_WALLET' AND r.enabled
    WHERE COALESCE(w.balance, 0) < 0
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'NEGATIVE_WALLET', public.notification_rule_severity('NEGATIVE_WALLET', NULL),
      'Wallet négatif', 'Le solde de ce wallet est négatif et nécessite une vérification.', NULL, '/wallets',
      'NEGATIVE_WALLET:' || v_record.id, v_record.recipient_roles, p_wallet_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT w.id, r.recipient_roles
    FROM public.wallets w
    JOIN public.notification_alert_rules r ON r.alert_type = 'LOW_WALLET' AND r.enabled
    WHERE r.threshold IS NOT NULL
      AND COALESCE(w.balance, 0) >= 0
      AND COALESCE(w.balance, 0) < COALESCE(w.alert_threshold, r.threshold)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'LOW_WALLET', public.notification_rule_severity('LOW_WALLET', NULL),
      'Wallet sous son seuil', 'Le solde de ce wallet est inférieur à son seuil d’alerte.', NULL, '/wallets',
      'LOW_WALLET:' || v_record.id, v_record.recipient_roles, p_wallet_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT i.id, i.stock_actuel, r.recipient_roles
    FROM public.inventory_items i
    JOIN public.notification_alert_rules r ON r.alert_type = 'LOW_STOCK' AND r.enabled
    WHERE i.seuil_alerte IS NOT NULL AND i.stock_actuel <= i.seuil_alerte
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'LOW_STOCK', CASE WHEN v_record.stock_actuel <= 0 THEN 'CRITICAL' ELSE public.notification_rule_severity('LOW_STOCK', NULL) END,
      'Stock faible', 'Le niveau de stock de cet article est inférieur ou égal à son seuil d’alerte.', NULL, '/stocks',
      'LOW_STOCK:' || v_record.id, v_record.recipient_roles, p_inventory_item_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT v.id, r.recipient_roles
    FROM public.vehicles v
    JOIN public.notification_alert_rules r ON r.alert_type = 'VEHICLE_ASSIGNMENT_INCONSISTENCY' AND r.enabled
    LEFT JOIN public.driver_vehicle_assignments a
      ON a.vehicle_id = v.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
    WHERE v.driver_id IS NOT NULL
      AND (a.id IS NULL OR a.driver_id IS DISTINCT FROM v.driver_id)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'VEHICLE_ASSIGNMENT_INCONSISTENCY', public.notification_rule_severity('VEHICLE_ASSIGNMENT_INCONSISTENCY', NULL),
      'Affectation véhicule incohérente', 'Le chauffeur historique du véhicule ne correspond pas à son affectation active.', NULL,
      '/vehicles/' || v_record.id, 'VEHICLE_ASSIGNMENT_INCONSISTENCY:' || v_record.id,
      v_record.recipient_roles, p_vehicle_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT m.id, r.recipient_roles
    FROM public.motorcycles m
    JOIN public.notification_alert_rules r ON r.alert_type = 'MOTORCYCLE_ASSIGNMENT_INCONSISTENCY' AND r.enabled
    LEFT JOIN public.driver_motorcycle_assignments a
      ON a.motorcycle_id = m.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
    WHERE m.driver_id IS NOT NULL
      AND (a.id IS NULL OR a.driver_id IS DISTINCT FROM m.driver_id)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'MOTORCYCLE_ASSIGNMENT_INCONSISTENCY', public.notification_rule_severity('MOTORCYCLE_ASSIGNMENT_INCONSISTENCY', NULL),
      'Affectation moto incohérente', 'Le chauffeur historique de la moto ne correspond pas à son affectation active.', NULL,
      '/motorcycles/' || v_record.id, 'MOTORCYCLE_ASSIGNMENT_INCONSISTENCY:' || v_record.id,
      v_record.recipient_roles, p_motorcycle_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  RETURN v_count;
END
$generate_configured_notifications$;

CREATE OR REPLACE FUNCTION public.resolve_configured_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $resolve_configured_notifications$
DECLARE
  v_resolved integer := 0;
  v_changed integer := 0;
  v_today date := public.notification_business_date();
BEGIN
  v_resolved := public.resolve_obsolete_notifications();

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND EXISTS (
      SELECT 1 FROM public.notification_alert_rules r
      WHERE r.alert_type = n.type AND NOT r.enabled
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.due_date IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.notification_alert_rules r
      WHERE r.alert_type = n.type
        AND r.enabled
        AND cardinality(r.due_days) > 0
        AND n.due_date > v_today + COALESCE((SELECT max(day_value) FROM unnest(r.due_days) AS day_value), 0)
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'LOW_WALLET'
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_wallet_links l
      JOIN public.wallets w ON w.id = l.wallet_id
      JOIN public.notification_alert_rules r ON r.alert_type = 'LOW_WALLET' AND r.enabled
      WHERE l.notification_id = n.id
        AND r.threshold IS NOT NULL
        AND COALESCE(w.balance, 0) >= 0
        AND COALESCE(w.balance, 0) < COALESCE(w.alert_threshold, r.threshold)
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'LOW_STOCK'
    AND EXISTS (
      SELECT 1
      FROM public.notification_inventory_links l
      WHERE l.notification_id = n.id
        AND n.deduplication_key NOT LIKE 'LOW_STOCK:' || l.inventory_item_id::text || ':USER:%'
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND EXISTS (
      SELECT 1
      FROM public.notification_alert_rules r
      WHERE r.alert_type = n.type
        AND r.enabled
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = n.user_id AND ur.role = ANY(r.recipient_roles)
        )
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_resolved + v_changed;
END
$resolve_configured_notifications$;

CREATE OR REPLACE FUNCTION public.run_notification_generation(
  p_trigger_type text DEFAULT 'MANUAL',
  p_triggered_by uuid DEFAULT NULL
)
RETURNS public.notification_generation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $run_notification_generation$
DECLARE
  v_run public.notification_generation_runs;
  v_created integer := 0;
  v_updated integer := 0;
  v_resolved integer := 0;
  v_actor uuid := COALESCE(p_triggered_by, auth.uid());
BEGIN
  IF p_trigger_type NOT IN ('SCHEDULED', 'MANUAL', 'DASHBOARD_FALLBACK', 'TEST') THEN
    RAISE EXCEPTION 'Type de déclenchement invalide.';
  END IF;
  IF auth.uid() IS NOT NULL AND p_triggered_by IS NOT NULL AND p_triggered_by <> auth.uid() THEN
    RAISE EXCEPTION 'Le déclencheur doit correspondre à l’utilisateur authentifié.';
  END IF;
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à générer les alertes.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('notification-generation', 0));

  INSERT INTO public.notification_generation_runs(trigger_type, triggered_by)
  VALUES (p_trigger_type, v_actor)
  RETURNING * INTO v_run;

  BEGIN
    v_resolved := public.resolve_configured_notifications();
    v_created := public.generate_configured_notifications();
    SELECT count(*) INTO v_updated
    FROM public.notifications
    WHERE created_at < v_run.started_at
      AND updated_at >= v_run.started_at
      AND status IN ('UNREAD', 'READ', 'SNOOZED');

    UPDATE public.notification_generation_runs
    SET completed_at = now(), status = 'SUCCEEDED', created_count = v_created,
        updated_count = v_updated, resolved_count = v_resolved
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.notification_generation_runs
    SET completed_at = now(), status = 'FAILED', error_count = 1,
        error_message = left(SQLERRM, 1000)
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  END;

  RETURN v_run;
END
$run_notification_generation$;

CREATE OR REPLACE FUNCTION public.generate_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $generate_notifications$
DECLARE
  v_run public.notification_generation_runs;
BEGIN
  v_run := public.run_notification_generation('MANUAL', auth.uid());
  IF v_run.status = 'FAILED' THEN
    RAISE EXCEPTION '%', COALESCE(v_run.error_message, 'La génération a échoué.');
  END IF;
  RETURN v_run.created_count;
END
$generate_notifications$;

CREATE OR REPLACE FUNCTION public.generate_notifications_dashboard_fallback()
RETURNS public.notification_generation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $generate_notifications_dashboard_fallback$
BEGIN
  RETURN public.run_notification_generation('DASHBOARD_FALLBACK', auth.uid());
END
$generate_notifications_dashboard_fallback$;

CREATE OR REPLACE FUNCTION public.save_notification_general_settings(
  p_timezone text,
  p_daily_run_time time
)
RETURNS public.company_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $save_notification_general_settings$
DECLARE
  v_before public.company_settings;
  v_after public.company_settings;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier les paramètres généraux.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Fuseau horaire invalide.';
  END IF;

  SELECT * INTO v_before FROM public.company_settings ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  UPDATE public.company_settings
  SET timezone = p_timezone, notification_daily_run_time = p_daily_run_time
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  INSERT INTO public.notification_settings_audit(setting_key, before_value, after_value, performed_by)
  VALUES ('company.notification_schedule', to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$save_notification_general_settings$;

CREATE OR REPLACE FUNCTION public.save_notification_alert_rule(
  p_alert_type text,
  p_enabled boolean,
  p_default_severity text,
  p_due_days integer[],
  p_severity_schedule jsonb,
  p_threshold numeric,
  p_recipient_roles public.app_role[]
)
RETURNS public.notification_alert_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $save_notification_alert_rule$
DECLARE
  v_before public.notification_alert_rules;
  v_after public.notification_alert_rules;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier les règles d’alerte.';
  END IF;
  IF p_default_severity NOT IN ('INFO', 'WARNING', 'CRITICAL') THEN
    RAISE EXCEPTION 'Gravité invalide.';
  END IF;
  IF jsonb_typeof(p_severity_schedule) <> 'object' THEN
    RAISE EXCEPTION 'Planning de gravité invalide.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_due_days, ARRAY[]::integer[])) AS day_value
    WHERE day_value < 0 OR day_value > 365
  ) THEN
    RAISE EXCEPTION 'Les délais doivent être compris entre 0 et 365 jours.';
  END IF;
  IF p_threshold IS NOT NULL AND p_threshold < 0 THEN
    RAISE EXCEPTION 'Le seuil ne peut pas être négatif.';
  END IF;
  IF cardinality(COALESCE(p_recipient_roles, ARRAY[]::public.app_role[])) = 0 THEN
    RAISE EXCEPTION 'Au moins un rôle destinataire est requis.';
  END IF;

  SELECT * INTO v_before FROM public.notification_alert_rules
  WHERE alert_type = p_alert_type FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Règle d’alerte inconnue.';
  END IF;

  UPDATE public.notification_alert_rules
  SET enabled = p_enabled,
      default_severity = p_default_severity,
      due_days = ARRAY(SELECT DISTINCT day_value FROM unnest(COALESCE(p_due_days, ARRAY[]::integer[])) AS day_value ORDER BY day_value DESC),
      severity_schedule = p_severity_schedule,
      threshold = p_threshold,
      recipient_roles = p_recipient_roles,
      updated_by = auth.uid()
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  INSERT INTO public.notification_settings_audit(setting_key, entity_type, entity_id, before_value, after_value, performed_by)
  VALUES ('notification_alert_rule.' || p_alert_type, 'notification_alert_rule', v_before.id, to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$save_notification_alert_rule$;

CREATE OR REPLACE FUNCTION public.set_wallet_alert_threshold(
  p_wallet_id uuid,
  p_alert_threshold numeric
)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_wallet_alert_threshold$
DECLARE
  v_before public.wallets;
  v_after public.wallets;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'comptable']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier le seuil de ce wallet.';
  END IF;
  IF p_alert_threshold IS NOT NULL AND p_alert_threshold < 0 THEN
    RAISE EXCEPTION 'Le seuil ne peut pas être négatif.';
  END IF;
  SELECT * INTO v_before FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet introuvable.'; END IF;
  UPDATE public.wallets SET alert_threshold = p_alert_threshold WHERE id = p_wallet_id RETURNING * INTO v_after;
  INSERT INTO public.notification_settings_audit(setting_key, entity_type, entity_id, before_value, after_value, performed_by)
  VALUES ('wallet.alert_threshold', 'wallet', p_wallet_id, to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$set_wallet_alert_threshold$;

CREATE OR REPLACE FUNCTION public.set_inventory_alert_threshold(
  p_inventory_item_id uuid,
  p_alert_threshold numeric
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_inventory_alert_threshold$
DECLARE
  v_before public.inventory_items;
  v_after public.inventory_items;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier le seuil de cet article.';
  END IF;
  IF p_alert_threshold IS NULL OR p_alert_threshold < 0 THEN
    RAISE EXCEPTION 'Le seuil doit être positif ou nul.';
  END IF;
  SELECT * INTO v_before FROM public.inventory_items WHERE id = p_inventory_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article introuvable.'; END IF;
  UPDATE public.inventory_items SET seuil_alerte = p_alert_threshold WHERE id = p_inventory_item_id RETURNING * INTO v_after;
  INSERT INTO public.notification_settings_audit(setting_key, entity_type, entity_id, before_value, after_value, performed_by)
  VALUES ('inventory_item.seuil_alerte', 'inventory_item', p_inventory_item_id, to_jsonb(v_before), to_jsonb(v_after), auth.uid());
  RETURN v_after;
END
$set_inventory_alert_threshold$;

REVOKE ALL ON FUNCTION public.generate_configured_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_configured_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_notification_generation(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_notifications_dashboard_fallback() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_notification_general_settings(text, time) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_notification_alert_rule(text, boolean, text, integer[], jsonb, numeric, public.app_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_wallet_alert_threshold(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_inventory_alert_threshold(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_notification_generation(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_notifications_dashboard_fallback() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_notification_general_settings(text, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_notification_alert_rule(text, boolean, text, integer[], jsonb, numeric, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_wallet_alert_threshold(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_inventory_alert_threshold(uuid, numeric) TO authenticated;
