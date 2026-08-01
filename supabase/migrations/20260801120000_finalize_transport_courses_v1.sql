-- MT-04: finalize the Course lifecycle and add course-specific, deduplicated alerts.
-- This migration is additive. It keeps finance_operations as the sole financial journal.

INSERT INTO public.permissions(code, module, action, description, sensitivity)
VALUES (
  'missions.delete',
  'missions',
  'delete',
  'Supprimer uniquement une Course brouillon ou planifiée sans dépendance financière ou documentaire.',
  'CRITICAL'
)
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    sensitivity = EXCLUDED.sensitivity,
    updated_at = now();

INSERT INTO public.role_permissions(role, permission_code)
SELECT grant_row.role::public.app_role, 'missions.delete'
FROM (VALUES ('admin'), ('operations'), ('gestionnaire')) AS grant_row(role)
WHERE EXISTS (
  SELECT 1
  FROM public.roles r
  WHERE r.code = grant_row.role::public.app_role
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.delete_transport_mission(p_mission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $delete_transport_mission$
DECLARE
  v_mission public.transport_missions;
  v_budget_count integer := 0;
BEGIN
  PERFORM public.permission_require('missions.delete');

  SELECT * INTO v_mission
  FROM public.transport_missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_mission.status NOT IN ('DRAFT', 'PLANNED') THEN
    RAISE EXCEPTION 'Seules les Courses brouillon ou planifiées sans dépendance peuvent être supprimées. Archivez les autres Courses.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transport_mission_expenses WHERE mission_id = p_mission_id
    UNION ALL
    SELECT 1 FROM public.transport_invoices WHERE mission_id = p_mission_id
    UNION ALL
    SELECT 1 FROM public.transport_invoice_payments WHERE mission_id = p_mission_id
    UNION ALL
    SELECT 1 FROM public.document_transport_mission_links WHERE mission_id = p_mission_id
  ) THEN
    RAISE EXCEPTION 'Cette Course possède des dépendances. Elle doit être archivée afin de conserver sa traçabilité.'
      USING ERRCODE = '23503';
  END IF;

  SELECT count(*) INTO v_budget_count
  FROM public.transport_mission_budget_lines
  WHERE mission_id = p_mission_id;

  PERFORM public.business_finance_audit_event(
    'COURSE',
    p_mission_id,
    NULL,
    'DELETE',
    to_jsonb(v_mission),
    jsonb_build_object('deleted_budget_line_count', v_budget_count)
  );

  DELETE FROM public.transport_mission_budget_lines WHERE mission_id = p_mission_id;
  DELETE FROM public.transport_missions WHERE id = p_mission_id;
  RETURN true;
END;
$delete_transport_mission$;

CREATE TABLE IF NOT EXISTS public.notification_transport_mission_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.transport_missions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, mission_id)
);

CREATE TABLE IF NOT EXISTS public.notification_transport_invoice_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.transport_invoices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS notification_transport_mission_links_mission_idx
  ON public.notification_transport_mission_links(mission_id, notification_id);
CREATE INDEX IF NOT EXISTS notification_transport_invoice_links_invoice_idx
  ON public.notification_transport_invoice_links(invoice_id, notification_id);

ALTER TABLE public.notification_transport_mission_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_transport_invoice_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_transport_mission_links_read_visible ON public.notification_transport_mission_links;
CREATE POLICY notification_transport_mission_links_read_visible
  ON public.notification_transport_mission_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.id = notification_id
        AND (
          n.user_id = auth.uid()
          OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
        )
    )
  );

DROP POLICY IF EXISTS notification_transport_invoice_links_read_visible ON public.notification_transport_invoice_links;
CREATE POLICY notification_transport_invoice_links_read_visible
  ON public.notification_transport_invoice_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.id = notification_id
        AND (
          n.user_id = auth.uid()
          OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
        )
    )
  );

GRANT SELECT ON public.notification_transport_mission_links, public.notification_transport_invoice_links TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_transport_mission_links, public.notification_transport_invoice_links FROM authenticated;
GRANT ALL ON public.notification_transport_mission_links, public.notification_transport_invoice_links TO service_role;

INSERT INTO public.notification_alert_rules(
  alert_type, enabled, default_severity, due_days, recipient_roles, description
)
VALUES
  ('COURSE_BUDGET_EXCEEDED', true, 'WARNING', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'comptable', 'operations', 'gestionnaire']::public.app_role[], 'Dépenses validées supérieures au budget prévisionnel de la Course.'),
  ('COURSE_PAYMENT_RECEIVED', true, 'INFO', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'comptable', 'operations', 'gestionnaire']::public.app_role[], 'Paiement client confirmé pour une Course.'),
  ('COURSE_INVOICE_OVERDUE', true, 'WARNING', ARRAY[0]::integer[], ARRAY['super_admin', 'admin', 'comptable', 'operations', 'gestionnaire']::public.app_role[], 'Facture de Course échue et non soldée.'),
  ('COURSE_COMPLETED', true, 'INFO', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'comptable', 'operations', 'gestionnaire']::public.app_role[], 'Course terminée, à facturer ou à clôturer selon sa situation.'),
  ('COURSE_WALLET_INSUFFICIENT', true, 'CRITICAL', ARRAY[]::integer[], ARRAY['super_admin', 'admin', 'comptable', 'operations', 'gestionnaire']::public.app_role[], 'Une dépense de Course a fait passer le wallet concerné sous zéro.')
ON CONFLICT (alert_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public._internal_create_transport_course_notification(
  p_type text,
  p_title text,
  p_message text,
  p_deduplication_base text,
  p_mission_id uuid,
  p_due_date date DEFAULT NULL,
  p_invoice_id uuid DEFAULT NULL,
  p_wallet_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_create_transport_course_notification$
DECLARE
  v_mission public.transport_missions;
  v_rule public.notification_alert_rules;
  v_created integer := 0;
BEGIN
  SELECT * INTO v_mission
  FROM public.transport_missions
  WHERE id = p_mission_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_rule
  FROM public.notification_alert_rules
  WHERE alert_type = p_type
    AND enabled;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_created := public.create_or_update_notification_for_roles(
    p_type,
    public.notification_rule_severity(p_type, p_due_date),
    p_title,
    p_message,
    p_due_date,
    '/courses/' || p_mission_id,
    p_deduplication_base,
    v_rule.recipient_roles,
    p_driver_id => v_mission.driver_id,
    p_vehicle_id => v_mission.vehicle_id,
    p_wallet_id => p_wallet_id
  );

  INSERT INTO public.notification_transport_mission_links(notification_id, mission_id)
  SELECT n.id, p_mission_id
  FROM public.notifications n
  WHERE n.deduplication_key = p_deduplication_base || ':USER:' || n.user_id::text
  ON CONFLICT DO NOTHING;

  IF p_invoice_id IS NOT NULL THEN
    INSERT INTO public.notification_transport_invoice_links(notification_id, invoice_id)
    SELECT n.id, p_invoice_id
    FROM public.notifications n
    WHERE n.deduplication_key = p_deduplication_base || ':USER:' || n.user_id::text
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_created;
END;
$internal_create_transport_course_notification$;

CREATE OR REPLACE FUNCTION public._internal_refresh_transport_course_budget_notification(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $internal_refresh_transport_course_budget_notification$
DECLARE
  v_budget numeric := 0;
  v_expenses numeric := 0;
BEGIN
  SELECT COALESCE(sum(planned_amount), 0)
  INTO v_budget
  FROM public.transport_mission_budget_lines
  WHERE mission_id = p_mission_id;

  SELECT COALESCE(sum(amount), 0)
  INTO v_expenses
  FROM public.transport_mission_expenses
  WHERE mission_id = p_mission_id
    AND status = 'PAID';

  IF v_expenses > v_budget THEN
    RETURN public._internal_create_transport_course_notification(
      'COURSE_BUDGET_EXCEEDED',
      'Budget de Course dépassé',
      'Les dépenses validées de cette Course dépassent son budget prévisionnel.',
      'COURSE_BUDGET_EXCEEDED:' || p_mission_id,
      p_mission_id
    );
  END IF;

  UPDATE public.notifications n
  SET status = 'RESOLVED'
  FROM public.notification_transport_mission_links link
  WHERE link.notification_id = n.id
    AND link.mission_id = p_mission_id
    AND n.type = 'COURSE_BUDGET_EXCEEDED'
    AND n.status IN ('UNREAD', 'READ', 'SNOOZED');
  RETURN 0;
END;
$internal_refresh_transport_course_budget_notification$;

CREATE OR REPLACE FUNCTION public.tg_transport_course_expense_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $tg_transport_course_expense_notifications$
DECLARE
  v_wallet_negative boolean := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'PAID' OR OLD.status = 'PAID' THEN
    PERFORM public._internal_refresh_transport_course_budget_notification(NEW.mission_id);
  END IF;

  IF NEW.status = 'PAID' THEN
    SELECT COALESCE(balance, 0) < 0
    INTO v_wallet_negative
    FROM public.wallets
    WHERE id = NEW.wallet_id;

    IF v_wallet_negative THEN
      PERFORM public._internal_create_transport_course_notification(
        'COURSE_WALLET_INSUFFICIENT',
        'Wallet insuffisant pour une Course',
        'Le wallet débité par une dépense de Course est désormais négatif.',
        'COURSE_WALLET_INSUFFICIENT:' || NEW.mission_id || ':' || NEW.wallet_id,
        NEW.mission_id,
        NULL,
        NULL,
        NEW.wallet_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$tg_transport_course_expense_notifications$;

DROP TRIGGER IF EXISTS trg_transport_course_expense_notifications ON public.transport_mission_expenses;
CREATE TRIGGER trg_transport_course_expense_notifications
  AFTER UPDATE OF status ON public.transport_mission_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_transport_course_expense_notifications();

CREATE OR REPLACE FUNCTION public.tg_transport_course_payment_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $tg_transport_course_payment_notifications$
BEGIN
  IF NEW.status = 'CONFIRMED' AND OLD.status IS DISTINCT FROM 'CONFIRMED' THEN
    PERFORM public._internal_create_transport_course_notification(
      'COURSE_PAYMENT_RECEIVED',
      'Paiement de Course reçu',
      'Un paiement client a été confirmé et crédité sur le wallet sélectionné.',
      'COURSE_PAYMENT_RECEIVED:' || NEW.id,
      NEW.mission_id,
      NULL,
      NEW.invoice_id,
      NEW.wallet_id
    );
  END IF;
  RETURN NEW;
END;
$tg_transport_course_payment_notifications$;

DROP TRIGGER IF EXISTS trg_transport_course_payment_notifications ON public.transport_invoice_payments;
CREATE TRIGGER trg_transport_course_payment_notifications
  AFTER UPDATE OF status ON public.transport_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_transport_course_payment_notifications();

CREATE OR REPLACE FUNCTION public.tg_transport_course_status_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $tg_transport_course_status_notifications$
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
    PERFORM public._internal_create_transport_course_notification(
      'COURSE_COMPLETED',
      'Course terminée',
      'La Course est terminée. Vérifiez les dépenses, la facture et les paiements avant sa clôture.',
      'COURSE_COMPLETED:' || NEW.id || ':' || NEW.updated_at::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$tg_transport_course_status_notifications$;

DROP TRIGGER IF EXISTS trg_transport_course_status_notifications ON public.transport_missions;
CREATE TRIGGER trg_transport_course_status_notifications
  AFTER UPDATE OF status ON public.transport_missions
  FOR EACH ROW EXECUTE FUNCTION public.tg_transport_course_status_notifications();

CREATE OR REPLACE FUNCTION public.generate_transport_course_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $generate_transport_course_notifications$
DECLARE
  v_record record;
  v_count integer := 0;
BEGIN
  FOR v_record IN
    SELECT invoice.id AS invoice_id, invoice.mission_id, invoice.due_date
    FROM public.transport_invoices invoice
    JOIN public.notification_alert_rules rule
      ON rule.alert_type = 'COURSE_INVOICE_OVERDUE'
     AND rule.enabled
    WHERE invoice.status IN ('ISSUED', 'PARTIALLY_PAID')
      AND invoice.due_date IS NOT NULL
      AND invoice.due_date < public.notification_business_date()
  LOOP
    v_count := v_count + public._internal_create_transport_course_notification(
      'COURSE_INVOICE_OVERDUE',
      'Facture de Course impayée',
      'La date d’échéance de cette facture est dépassée et son solde reste à encaisser.',
      'COURSE_INVOICE_OVERDUE:' || v_record.invoice_id || ':' || v_record.due_date,
      v_record.mission_id,
      v_record.due_date,
      v_record.invoice_id
    );
  END LOOP;

  FOR v_record IN
    SELECT mission.id AS mission_id
    FROM public.transport_missions mission
    JOIN public.notification_alert_rules rule
      ON rule.alert_type = 'COURSE_BUDGET_EXCEEDED'
     AND rule.enabled
    WHERE mission.status NOT IN ('CANCELLED')
  LOOP
    v_count := v_count + public._internal_refresh_transport_course_budget_notification(v_record.mission_id);
  END LOOP;

  RETURN v_count;
END;
$generate_transport_course_notifications$;

CREATE OR REPLACE FUNCTION public.resolve_transport_course_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $resolve_transport_course_notifications$
DECLARE
  v_resolved integer := 0;
  v_count integer := 0;
BEGIN
  UPDATE public.notifications n
  SET status = 'RESOLVED'
  WHERE n.type = 'COURSE_BUDGET_EXCEEDED'
    AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_transport_mission_links link
      JOIN public.transport_missions mission ON mission.id = link.mission_id
      WHERE link.notification_id = n.id
        AND COALESCE((
          SELECT sum(expense.amount)
          FROM public.transport_mission_expenses expense
          WHERE expense.mission_id = mission.id
            AND expense.status = 'PAID'
        ), 0) > COALESCE((
          SELECT sum(budget.planned_amount)
          FROM public.transport_mission_budget_lines budget
          WHERE budget.mission_id = mission.id
        ), 0)
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_resolved := v_resolved + v_count;

  UPDATE public.notifications n
  SET status = 'RESOLVED'
  WHERE n.type = 'COURSE_INVOICE_OVERDUE'
    AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_transport_invoice_links link
      JOIN public.transport_invoices invoice ON invoice.id = link.invoice_id
      WHERE link.notification_id = n.id
        AND invoice.status IN ('ISSUED', 'PARTIALLY_PAID')
        AND invoice.due_date IS NOT NULL
        AND invoice.due_date < public.notification_business_date()
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_resolved := v_resolved + v_count;

  UPDATE public.notifications n
  SET status = 'RESOLVED'
  WHERE n.type = 'COURSE_WALLET_INSUFFICIENT'
    AND n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_transport_mission_links mission_link
      JOIN public.notification_wallet_links wallet_link ON wallet_link.notification_id = n.id
      JOIN public.wallets wallet ON wallet.id = wallet_link.wallet_id
      WHERE mission_link.notification_id = n.id
        AND COALESCE(wallet.balance, 0) < 0
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_resolved := v_resolved + v_count;

  RETURN v_resolved;
END;
$resolve_transport_course_notifications$;

CREATE OR REPLACE FUNCTION public.run_notification_generation(
  p_trigger_type text DEFAULT 'MANUAL',
  p_triggered_by uuid DEFAULT NULL
)
RETURNS public.notification_generation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
    v_resolved := public.resolve_configured_notifications() + public.resolve_transport_course_notifications();
    v_created := public.generate_configured_notifications() + public.generate_transport_course_notifications();
    SELECT count(*) INTO v_updated
    FROM public.notifications
    WHERE created_at < v_run.started_at
      AND updated_at >= v_run.started_at
      AND status IN ('UNREAD', 'READ', 'SNOOZED');

    UPDATE public.notification_generation_runs
    SET completed_at = now(),
        status = 'SUCCEEDED',
        created_count = v_created,
        updated_count = v_updated,
        resolved_count = v_resolved
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.notification_generation_runs
    SET completed_at = now(),
        status = 'FAILED',
        error_count = 1,
        error_message = left(SQLERRM, 1000)
    WHERE id = v_run.id
    RETURNING * INTO v_run;
  END;

  RETURN v_run;
END;
$run_notification_generation$;

REVOKE ALL ON FUNCTION public.delete_transport_mission(uuid),
  public._internal_create_transport_course_notification(text, text, text, text, uuid, date, uuid, uuid),
  public._internal_refresh_transport_course_budget_notification(uuid),
  public.tg_transport_course_expense_notifications(),
  public.tg_transport_course_payment_notifications(),
  public.tg_transport_course_status_notifications(),
  public.generate_transport_course_notifications(),
  public.resolve_transport_course_notifications()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.delete_transport_mission(uuid) TO authenticated;
REVOKE DELETE ON public.transport_missions FROM authenticated;
