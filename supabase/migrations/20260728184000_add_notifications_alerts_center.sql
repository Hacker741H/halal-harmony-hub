-- Lot 7: internal ERP notifications, explicit source links and idempotent
-- generation. This migration is additive: historical notifications and their
-- `lu` flag remain available during the transition.

-- Central model -------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'UNREAD',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS entity_route text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS deduplication_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.notifications
SET status = CASE WHEN lu THEN 'READ' ELSE 'UNREAD' END
WHERE status IS NULL OR status NOT IN ('UNREAD', 'READ', 'RESOLVED', 'DISMISSED', 'SNOOZED');

DO $notification_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_severity_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_severity_check
      CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_status_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_status_check
      CHECK (status IN ('UNREAD', 'READ', 'RESOLVED', 'DISMISSED', 'SNOOZED'));
  END IF;
END
$notification_constraints$;

CREATE INDEX IF NOT EXISTS notifications_recipient_status_created_idx
  ON public.notifications(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_due_date_idx
  ON public.notifications(due_date)
  WHERE due_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_active_deduplication_key_uidx
  ON public.notifications(deduplication_key)
  WHERE deduplication_key IS NOT NULL
    AND status IN ('UNREAD', 'READ', 'SNOOZED');

CREATE OR REPLACE FUNCTION public.tg_sync_notification_read_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $sync_notification_read_state$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL THEN
      NEW.status := CASE WHEN COALESCE(NEW.lu, false) THEN 'READ' ELSE 'UNREAD' END;
    END IF;
  ELSIF NEW.lu IS DISTINCT FROM OLD.lu AND NEW.status = OLD.status THEN
    NEW.status := CASE WHEN NEW.lu THEN 'READ' ELSE 'UNREAD' END;
  END IF;

  NEW.lu := NEW.status <> 'UNREAD';
  IF NEW.status = 'READ' AND NEW.read_at IS NULL THEN
    NEW.read_at := now();
  END IF;
  IF NEW.status = 'RESOLVED' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$sync_notification_read_state$;

DROP TRIGGER IF EXISTS trg_sync_notification_read_state ON public.notifications;
CREATE TRIGGER trg_sync_notification_read_state
  BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_notification_read_state();

-- Explicit source relations -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_driver_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, driver_id)
);
CREATE TABLE IF NOT EXISTS public.notification_employee_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, employee_id)
);
CREATE TABLE IF NOT EXISTS public.notification_contract_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, contract_id)
);
CREATE TABLE IF NOT EXISTS public.notification_document_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, document_id)
);
CREATE TABLE IF NOT EXISTS public.notification_vehicle_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, vehicle_id)
);
CREATE TABLE IF NOT EXISTS public.notification_motorcycle_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  motorcycle_id uuid NOT NULL REFERENCES public.motorcycles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, motorcycle_id)
);
CREATE TABLE IF NOT EXISTS public.notification_vehicle_maintenance_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  maintenance_id uuid NOT NULL REFERENCES public.maintenances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, maintenance_id)
);
CREATE TABLE IF NOT EXISTS public.notification_motorcycle_maintenance_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  motorcycle_maintenance_id uuid NOT NULL REFERENCES public.motorcycle_maintenances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, motorcycle_maintenance_id)
);
CREATE TABLE IF NOT EXISTS public.notification_wallet_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, wallet_id)
);
CREATE TABLE IF NOT EXISTS public.notification_inventory_links (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS notification_driver_links_driver_idx ON public.notification_driver_links(driver_id);
CREATE INDEX IF NOT EXISTS notification_employee_links_employee_idx ON public.notification_employee_links(employee_id);
CREATE INDEX IF NOT EXISTS notification_contract_links_contract_idx ON public.notification_contract_links(contract_id);
CREATE INDEX IF NOT EXISTS notification_document_links_document_idx ON public.notification_document_links(document_id);
CREATE INDEX IF NOT EXISTS notification_vehicle_links_vehicle_idx ON public.notification_vehicle_links(vehicle_id);
CREATE INDEX IF NOT EXISTS notification_motorcycle_links_motorcycle_idx ON public.notification_motorcycle_links(motorcycle_id);
CREATE INDEX IF NOT EXISTS notification_vehicle_maintenance_links_maintenance_idx ON public.notification_vehicle_maintenance_links(maintenance_id);
CREATE INDEX IF NOT EXISTS notification_motorcycle_maintenance_links_maintenance_idx ON public.notification_motorcycle_maintenance_links(motorcycle_maintenance_id);
CREATE INDEX IF NOT EXISTS notification_wallet_links_wallet_idx ON public.notification_wallet_links(wallet_id);
CREATE INDEX IF NOT EXISTS notification_inventory_links_item_idx ON public.notification_inventory_links(inventory_item_id);

-- Notification visibility is recipient-based. Alerts containing finance data
-- are therefore never represented by a broadcast (`user_id IS NULL`) row.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_read_self_or_broadcast ON public.notifications;
DROP POLICY IF EXISTS notif_update_self ON public.notifications;
DROP POLICY IF EXISTS notif_admin_write ON public.notifications;
DROP POLICY IF EXISTS notifications_read_visible ON public.notifications;
CREATE POLICY notifications_read_visible ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
  );

GRANT SELECT ON public.notifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated;
GRANT ALL ON public.notifications TO service_role;

DO $notification_link_rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'notification_driver_links',
    'notification_employee_links',
    'notification_contract_links',
    'notification_document_links',
    'notification_vehicle_links',
    'notification_motorcycle_links',
    'notification_vehicle_maintenance_links',
    'notification_motorcycle_maintenance_links',
    'notification_wallet_links',
    'notification_inventory_links'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_read_visible', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = notification_id AND (n.user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY[''super_admin'', ''admin'']::public.app_role[]))))',
      v_table || '_read_visible',
      v_table
    );
  END LOOP;
END
$notification_link_rls$;

-- Helpers -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_or_update_notification_for_roles(
  p_type text,
  p_severity text,
  p_title text,
  p_message text,
  p_due_date date,
  p_entity_route text,
  p_deduplication_base text,
  p_roles public.app_role[],
  p_driver_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_contract_id uuid DEFAULT NULL,
  p_document_id uuid DEFAULT NULL,
  p_vehicle_id uuid DEFAULT NULL,
  p_motorcycle_id uuid DEFAULT NULL,
  p_vehicle_maintenance_id uuid DEFAULT NULL,
  p_motorcycle_maintenance_id uuid DEFAULT NULL,
  p_wallet_id uuid DEFAULT NULL,
  p_inventory_item_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_or_update_notification_for_roles$
DECLARE
  v_recipient_id uuid;
  v_notification_id uuid;
  v_status text;
  v_key text;
  v_count integer := 0;
BEGIN
  FOR v_recipient_id IN
    SELECT DISTINCT user_id
    FROM public.user_roles
    WHERE role = ANY(p_roles)
  LOOP
    v_key := p_deduplication_base || ':USER:' || v_recipient_id::text;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

    SELECT id, status
    INTO v_notification_id, v_status
    FROM public.notifications
    WHERE deduplication_key = v_key
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_status IN ('RESOLVED', 'DISMISSED') THEN
      -- The same situation was already closed by a user or source correction.
      -- A changed source date/threshold receives a different deterministic key.
      CONTINUE;
    ELSIF FOUND THEN
      UPDATE public.notifications
      SET type = p_type,
          severity = p_severity,
          titre = p_title,
          message = p_message,
          due_date = p_due_date,
          entity_route = p_entity_route,
          status = CASE
            WHEN status = 'SNOOZED' AND snoozed_until IS NOT NULL AND snoozed_until > now() THEN 'SNOOZED'
            WHEN status = 'SNOOZED' THEN 'UNREAD'
            ELSE status
          END,
          snoozed_until = CASE
            WHEN status = 'SNOOZED' AND snoozed_until IS NOT NULL AND snoozed_until > now() THEN snoozed_until
            ELSE NULL
          END
      WHERE id = v_notification_id;
    ELSE
      INSERT INTO public.notifications(
        user_id, type, severity, titre, message, due_date, entity_route,
        status, deduplication_key
      )
      VALUES (
        v_recipient_id, p_type, p_severity, p_title, p_message, p_due_date,
        p_entity_route, 'UNREAD', v_key
      )
      RETURNING id INTO v_notification_id;
      v_count := v_count + 1;
    END IF;

    IF p_driver_id IS NOT NULL THEN
      INSERT INTO public.notification_driver_links(notification_id, driver_id)
      VALUES (v_notification_id, p_driver_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_employee_id IS NOT NULL THEN
      INSERT INTO public.notification_employee_links(notification_id, employee_id)
      VALUES (v_notification_id, p_employee_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_contract_id IS NOT NULL THEN
      INSERT INTO public.notification_contract_links(notification_id, contract_id)
      VALUES (v_notification_id, p_contract_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_document_id IS NOT NULL THEN
      INSERT INTO public.notification_document_links(notification_id, document_id)
      VALUES (v_notification_id, p_document_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_vehicle_id IS NOT NULL THEN
      INSERT INTO public.notification_vehicle_links(notification_id, vehicle_id)
      VALUES (v_notification_id, p_vehicle_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_motorcycle_id IS NOT NULL THEN
      INSERT INTO public.notification_motorcycle_links(notification_id, motorcycle_id)
      VALUES (v_notification_id, p_motorcycle_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_vehicle_maintenance_id IS NOT NULL THEN
      INSERT INTO public.notification_vehicle_maintenance_links(notification_id, maintenance_id)
      VALUES (v_notification_id, p_vehicle_maintenance_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_motorcycle_maintenance_id IS NOT NULL THEN
      INSERT INTO public.notification_motorcycle_maintenance_links(notification_id, motorcycle_maintenance_id)
      VALUES (v_notification_id, p_motorcycle_maintenance_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_wallet_id IS NOT NULL THEN
      INSERT INTO public.notification_wallet_links(notification_id, wallet_id)
      VALUES (v_notification_id, p_wallet_id) ON CONFLICT DO NOTHING;
    END IF;
    IF p_inventory_item_id IS NOT NULL THEN
      INSERT INTO public.notification_inventory_links(notification_id, inventory_item_id)
      VALUES (v_notification_id, p_inventory_item_id) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_count;
END
$create_or_update_notification_for_roles$;

CREATE OR REPLACE FUNCTION public.resolve_obsolete_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $resolve_obsolete_notifications$
DECLARE
  v_resolved integer := 0;
  v_changed integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à actualiser les alertes.';
  END IF;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'DRIVER_LICENSE_EXPIRY'
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_driver_links l
      JOIN public.drivers d ON d.id = l.driver_id
      WHERE l.notification_id = n.id
        AND d.date_expiration_permis = n.due_date
        AND d.statut NOT IN ('inactif', 'archive')
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'CONTRACT_EXPIRY'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_contract_links l
      JOIN public.contracts c ON c.id = l.contract_id
      WHERE l.notification_id = n.id AND c.date_fin = n.due_date
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'DOCUMENT_EXPIRY'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_document_links l
      JOIN public.documents d ON d.id = l.document_id
      WHERE l.notification_id = n.id
        AND d.date_expiration = n.due_date
        AND d.archived_at IS NULL
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type IN ('MOTORCYCLE_ASSURANCE_EXPIRY', 'MOTORCYCLE_VISIT_EXPIRY')
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_motorcycle_links l
      JOIN public.motorcycles m ON m.id = l.motorcycle_id
      WHERE l.notification_id = n.id
        AND (
          (n.type = 'MOTORCYCLE_ASSURANCE_EXPIRY' AND m.assurance_expiration = n.due_date)
          OR (n.type = 'MOTORCYCLE_VISIT_EXPIRY' AND m.visite_expiration = n.due_date)
        )
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'MOTORCYCLE_MAINTENANCE_DATE'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_motorcycle_maintenance_links l
      JOIN public.motorcycle_maintenances m ON m.id = l.motorcycle_maintenance_id
      WHERE l.notification_id = n.id AND m.next_date = n.due_date
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'MOTORCYCLE_MAINTENANCE_KILOMETRAGE'
    AND NOT EXISTS (
      SELECT 1
      FROM public.notification_motorcycle_maintenance_links l
      JOIN public.motorcycle_maintenances mm ON mm.id = l.motorcycle_maintenance_id
      JOIN public.motorcycles m ON m.id = mm.motorcycle_id
      WHERE l.notification_id = n.id
        AND mm.next_kilometrage IS NOT NULL
        AND m.kilometrage IS NOT NULL
        AND m.kilometrage >= mm.next_kilometrage
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'NEGATIVE_WALLET'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_wallet_links l
      JOIN public.wallets w ON w.id = l.wallet_id
      WHERE l.notification_id = n.id AND COALESCE(w.balance, 0) < 0
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'LOW_STOCK'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_inventory_links l
      JOIN public.inventory_items i ON i.id = l.inventory_item_id
      WHERE l.notification_id = n.id
        AND i.seuil_alerte IS NOT NULL
        AND i.stock_actuel <= i.seuil_alerte
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'VEHICLE_ASSIGNMENT_INCONSISTENCY'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_vehicle_links l
      JOIN public.vehicles v ON v.id = l.vehicle_id
      LEFT JOIN public.driver_vehicle_assignments a
        ON a.vehicle_id = v.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
      WHERE l.notification_id = n.id
        AND v.driver_id IS NOT NULL
        AND (a.id IS NULL OR a.driver_id IS DISTINCT FROM v.driver_id)
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  UPDATE public.notifications n
  SET status = 'RESOLVED', resolved_at = now()
  WHERE n.status IN ('UNREAD', 'READ', 'SNOOZED')
    AND n.type = 'MOTORCYCLE_ASSIGNMENT_INCONSISTENCY'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_motorcycle_links l
      JOIN public.motorcycles m ON m.id = l.motorcycle_id
      LEFT JOIN public.driver_motorcycle_assignments a
        ON a.motorcycle_id = m.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
      WHERE l.notification_id = n.id
        AND m.driver_id IS NOT NULL
        AND (a.id IS NULL OR a.driver_id IS DISTINCT FROM m.driver_id)
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  v_resolved := v_resolved + v_changed;

  RETURN v_resolved;
END
$resolve_obsolete_notifications$;

CREATE OR REPLACE FUNCTION public.generate_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $generate_notifications$
DECLARE
  v_today date := current_date;
  v_count integer := 0;
  v_created integer := 0;
  v_severity text;
  v_record record;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à générer les alertes.';
  END IF;

  PERFORM public.resolve_obsolete_notifications();

  FOR v_record IN
    SELECT d.id, d.date_expiration_permis
    FROM public.drivers d
    WHERE d.date_expiration_permis IS NOT NULL
      AND d.statut NOT IN ('inactif', 'archive')
      AND d.date_expiration_permis <= v_today + 30
  LOOP
    v_severity := CASE
      WHEN v_record.date_expiration_permis < v_today THEN 'CRITICAL'
      WHEN v_record.date_expiration_permis = v_today THEN 'CRITICAL'
      ELSE 'WARNING'
    END;
    v_created := public.create_or_update_notification_for_roles(
      'DRIVER_LICENSE_EXPIRY', v_severity, 'Permis chauffeur à échéance',
      'Le permis associé à ce chauffeur arrive à échéance ou est expiré.',
      v_record.date_expiration_permis, '/drivers/' || v_record.id,
      'DRIVER_LICENSE_EXPIRY:' || v_record.id || ':' || v_record.date_expiration_permis,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_driver_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT c.id, c.date_fin
    FROM public.contracts c
    WHERE c.date_fin IS NOT NULL AND c.date_fin <= v_today + 30
  LOOP
    v_severity := CASE WHEN v_record.date_fin <= v_today THEN 'CRITICAL' ELSE 'WARNING' END;
    v_created := public.create_or_update_notification_for_roles(
      'CONTRACT_EXPIRY', v_severity, 'Contrat à échéance',
      'Un contrat arrive à échéance ou est expiré.', v_record.date_fin, '/contracts',
      'CONTRACT_EXPIRY:' || v_record.id || ':' || v_record.date_fin,
      ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[],
      p_contract_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT d.id, d.date_expiration
    FROM public.documents d
    WHERE d.archived_at IS NULL
      AND d.date_expiration IS NOT NULL
      AND d.date_expiration <= v_today + 30
  LOOP
    v_severity := CASE WHEN v_record.date_expiration <= v_today THEN 'CRITICAL' ELSE 'WARNING' END;
    v_created := public.create_or_update_notification_for_roles(
      'DOCUMENT_EXPIRY', v_severity, 'Document à échéance',
      'Un document arrive à échéance ou est expiré.', v_record.date_expiration, '/documents',
      'DOCUMENT_EXPIRY:' || v_record.id || ':' || v_record.date_expiration,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_document_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT m.id, m.assurance_expiration AS due_date, 'MOTORCYCLE_ASSURANCE_EXPIRY'::text AS notification_type
    FROM public.motorcycles m
    WHERE m.assurance_expiration IS NOT NULL AND m.assurance_expiration <= v_today + 30
    UNION ALL
    SELECT m.id, m.visite_expiration, 'MOTORCYCLE_VISIT_EXPIRY'::text
    FROM public.motorcycles m
    WHERE m.visite_expiration IS NOT NULL AND m.visite_expiration <= v_today + 30
  LOOP
    v_severity := CASE WHEN v_record.due_date <= v_today THEN 'CRITICAL' ELSE 'WARNING' END;
    v_created := public.create_or_update_notification_for_roles(
      v_record.notification_type, v_severity,
      CASE WHEN v_record.notification_type = 'MOTORCYCLE_ASSURANCE_EXPIRY' THEN 'Assurance moto à échéance' ELSE 'Visite technique moto à échéance' END,
      'Une obligation réglementaire de cette moto arrive à échéance ou est expirée.',
      v_record.due_date, '/motorcycles/' || v_record.id,
      v_record.notification_type || ':' || v_record.id || ':' || v_record.due_date,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_motorcycle_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT mm.id, mm.motorcycle_id, mm.next_date
    FROM public.motorcycle_maintenances mm
    WHERE mm.next_date IS NOT NULL AND mm.next_date <= v_today + 30
  LOOP
    v_severity := CASE WHEN v_record.next_date <= v_today THEN 'CRITICAL' ELSE 'WARNING' END;
    v_created := public.create_or_update_notification_for_roles(
      'MOTORCYCLE_MAINTENANCE_DATE', v_severity, 'Entretien moto à prévoir',
      'Un entretien de moto arrive à échéance ou est en retard.', v_record.next_date,
      '/motorcycles/' || v_record.motorcycle_id || '?tab=entretiens',
      'MOTORCYCLE_MAINTENANCE_DATE:' || v_record.id || ':' || v_record.next_date,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_motorcycle_id => v_record.motorcycle_id,
      p_motorcycle_maintenance_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT mm.id, mm.motorcycle_id, mm.next_kilometrage
    FROM public.motorcycle_maintenances mm
    JOIN public.motorcycles m ON m.id = mm.motorcycle_id
    WHERE mm.next_kilometrage IS NOT NULL
      AND m.kilometrage IS NOT NULL
      AND m.kilometrage >= mm.next_kilometrage
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'MOTORCYCLE_MAINTENANCE_KILOMETRAGE', 'CRITICAL', 'Entretien moto dépassé',
      'Le kilométrage prévu pour un entretien de moto est atteint ou dépassé.', NULL,
      '/motorcycles/' || v_record.motorcycle_id || '?tab=entretiens',
      'MOTORCYCLE_MAINTENANCE_KILOMETRAGE:' || v_record.id || ':' || v_record.next_kilometrage,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_motorcycle_id => v_record.motorcycle_id,
      p_motorcycle_maintenance_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN SELECT id FROM public.wallets WHERE COALESCE(balance, 0) < 0 LOOP
    v_created := public.create_or_update_notification_for_roles(
      'NEGATIVE_WALLET', 'CRITICAL', 'Wallet négatif',
      'Le solde de ce wallet est négatif et nécessite une vérification.', NULL, '/wallets',
      'NEGATIVE_WALLET:' || v_record.id,
      ARRAY['super_admin', 'admin', 'gestionnaire', 'comptable']::public.app_role[],
      p_wallet_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT id, seuil_alerte, stock_actuel
    FROM public.inventory_items
    WHERE seuil_alerte IS NOT NULL AND stock_actuel <= seuil_alerte
  LOOP
    v_severity := CASE WHEN v_record.stock_actuel <= 0 THEN 'CRITICAL' ELSE 'WARNING' END;
    v_created := public.create_or_update_notification_for_roles(
      'LOW_STOCK', v_severity, 'Stock faible',
      'Le niveau de stock de cet article est inférieur ou égal à son seuil d''alerte.', NULL, '/stocks',
      'LOW_STOCK:' || v_record.id || ':' || v_record.seuil_alerte,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_inventory_item_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT v.id
    FROM public.vehicles v
    LEFT JOIN public.driver_vehicle_assignments a
      ON a.vehicle_id = v.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
    WHERE v.driver_id IS NOT NULL
      AND (a.id IS NULL OR a.driver_id IS DISTINCT FROM v.driver_id)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'VEHICLE_ASSIGNMENT_INCONSISTENCY', 'WARNING', 'Affectation véhicule incohérente',
      'Le chauffeur historique du véhicule ne correspond pas à son affectation active.', NULL,
      '/vehicles/' || v_record.id, 'VEHICLE_ASSIGNMENT_INCONSISTENCY:' || v_record.id,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_vehicle_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  FOR v_record IN
    SELECT m.id
    FROM public.motorcycles m
    LEFT JOIN public.driver_motorcycle_assignments a
      ON a.motorcycle_id = m.id AND a.status = 'ACTIVE' AND a.end_date IS NULL
    WHERE m.driver_id IS NOT NULL
      AND (a.id IS NULL OR a.driver_id IS DISTINCT FROM m.driver_id)
  LOOP
    v_created := public.create_or_update_notification_for_roles(
      'MOTORCYCLE_ASSIGNMENT_INCONSISTENCY', 'WARNING', 'Affectation moto incohérente',
      'Le chauffeur historique de la moto ne correspond pas à son affectation active.', NULL,
      '/motorcycles/' || v_record.id, 'MOTORCYCLE_ASSIGNMENT_INCONSISTENCY:' || v_record.id,
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[],
      p_motorcycle_id => v_record.id
    );
    v_count := v_count + v_created;
  END LOOP;

  RETURN v_count;
END
$generate_notifications$;

CREATE OR REPLACE FUNCTION public.update_notification_status(
  p_notification_id uuid,
  p_status text,
  p_snoozed_until timestamptz DEFAULT NULL
)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $update_notification_status$
DECLARE
  v_notification public.notifications;
BEGIN
  IF p_status NOT IN ('READ', 'RESOLVED', 'DISMISSED', 'SNOOZED', 'UNREAD') THEN
    RAISE EXCEPTION 'Statut de notification invalide.';
  END IF;

  SELECT * INTO v_notification
  FROM public.notifications
  WHERE id = p_notification_id
    AND (
      user_id = auth.uid()
      OR public.has_any_role(auth.uid(), ARRAY['super_admin', 'admin']::public.app_role[])
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification introuvable ou non autorisée.';
  END IF;

  IF p_status = 'SNOOZED' AND (p_snoozed_until IS NULL OR p_snoozed_until <= now()) THEN
    RAISE EXCEPTION 'Une date de report future est requise.';
  END IF;

  UPDATE public.notifications
  SET status = p_status,
      snoozed_until = CASE WHEN p_status = 'SNOOZED' THEN p_snoozed_until ELSE NULL END,
      read_at = CASE WHEN p_status IN ('READ', 'RESOLVED', 'DISMISSED', 'SNOOZED') THEN COALESCE(read_at, now()) ELSE NULL END,
      resolved_at = CASE WHEN p_status = 'RESOLVED' THEN now() ELSE NULL END
  WHERE id = p_notification_id
  RETURNING * INTO v_notification;

  RETURN v_notification;
END
$update_notification_status$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $mark_all_notifications_read$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.notifications
  SET status = 'READ', read_at = now()
  WHERE user_id = auth.uid() AND status = 'UNREAD';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$mark_all_notifications_read$;

REVOKE ALL ON FUNCTION public.create_or_update_notification_for_roles(text, text, text, text, date, text, text, public.app_role[], uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_obsolete_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_notification_status(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_obsolete_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_notification_status(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
