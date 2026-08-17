-- Fixes a runtime-only bug in get_global_control_center (20260821100000):
-- the commerce_payables branch read `commerce_supplier_payments` without a
-- table alias, so its bare `amount`/`status` columns collided with this
-- function's own RETURNS TABLE OUT parameters of the same names (PL/pgSQL
-- exposes RETURNS TABLE columns as variables throughout the function body).
-- Every other branch already qualifies its columns; this was the one spot
-- that didn't. No behavior change beyond making the query parse: same
-- filter (purchase_id = p.id AND status = 'CONFIRMED'), same sum(amount).

CREATE OR REPLACE FUNCTION public.get_global_control_center(
  p_module text DEFAULT NULL,
  p_severity text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_business_location_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS TABLE(
  item_id text,
  source_module text,
  source_type text,
  source_id uuid,
  business_location_id uuid,
  severity text,
  status text,
  title text,
  description text,
  amount numeric,
  occurred_at timestamptz,
  actor text,
  action_label text,
  action_route text,
  metadata jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_page_size integer := LEAST(100, GREATEST(1, COALESCE(p_page_size, 25)));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;
  IF p_severity IS NOT NULL AND p_severity NOT IN ('INFO', 'WARNING', 'CRITICAL') THEN
    RAISE EXCEPTION 'Severite invalide.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH
  -- Branch: existing notifications engine (Fleet expiries, generic wallet/
  -- stock alerts, Transport COURSE_* alerts, assignment inconsistencies).
  notif AS (
    SELECT
      'NOTIFICATIONS:' || n.type || ':' || n.id::text AS item_id,
      'NOTIFICATIONS'::text AS source_module,
      n.type AS source_type,
      n.id AS source_id,
      NULL::uuid AS business_location_id,
      n.severity,
      CASE WHEN n.status = 'SNOOZED' AND n.snoozed_until <= now() THEN 'UNREAD' ELSE n.status END AS status,
      n.titre AS title,
      n.message AS description,
      NULL::numeric AS amount,
      n.created_at AS occurred_at,
      NULL::text AS actor,
      'Ouvrir'::text AS action_label,
      n.entity_route AS action_route,
      '{}'::jsonb AS metadata
    FROM public.notifications n
    WHERE (n.user_id = v_actor OR public.has_any_role(v_actor, ARRAY['super_admin', 'admin']::public.app_role[]))
      AND (n.status IN ('UNREAD', 'READ') OR (n.status = 'SNOOZED' AND n.snoozed_until <= now()))
      -- These two types are re-sourced live below, scoped by business
      -- location, for anything mapped to a Commerce store -- excluded here
      -- only for the commerce-mapped subset so the same fact never shows
      -- twice; non-commerce wallets/items (Field, generic company wallets)
      -- still come through this branch untouched.
      AND NOT (n.type = 'NEGATIVE_WALLET' AND EXISTS (
        SELECT 1 FROM public.notification_wallet_links wl
        JOIN public.business_location_wallets blw ON blw.wallet_id = wl.wallet_id
        WHERE wl.notification_id = n.id
      ))
      AND NOT (n.type = 'LOW_STOCK' AND EXISTS (
        SELECT 1 FROM public.notification_inventory_links il
        JOIN public.business_location_inventory_items blii ON blii.inventory_item_id = il.inventory_item_id
        WHERE il.notification_id = n.id
      ))
  ),

  -- Branch: Commerce cash control reports (status computed exactly as
  -- get_commerce_pos_control_reports does -- copied verbatim, not
  -- re-derived, to avoid behavioral drift between the two).
  cash_received AS (
    SELECT
      link.closure_id,
      sum(r.received_amount) AS total_received,
      bool_or(coalesce(r.is_final, false)) AS is_finalized
    FROM public.commerce_cash_remittances r
    JOIN public.commerce_cash_remittance_closures link ON link.remittance_id = r.id
    WHERE r.status = 'CONFIRMED'
    GROUP BY link.closure_id
  ),
  cash_scored AS (
    SELECT
      report.*,
      coalesce(cash_received.total_received, 0) AS received_total,
      CASE
        WHEN report.flagged_for_review THEN 'REVIEW_REQUIRED'
        WHEN report.cash_expected <= 0 THEN 'RECEIVED'
        WHEN coalesce(cash_received.is_finalized, false) THEN
          CASE WHEN round(coalesce(cash_received.total_received, 0), 2) = round(report.cash_expected, 2)
            THEN 'RECEIVED' ELSE 'REVIEW_REQUIRED' END
        WHEN coalesce(cash_received.total_received, 0) = 0 THEN 'PENDING_CONTROL'
        ELSE 'PARTIALLY_RECEIVED'
      END AS control_status
    FROM public.commerce_pos_control_reports report
    LEFT JOIN cash_received ON cash_received.closure_id = report.closure_id
  ),
  commerce_cash AS (
    SELECT
      'COMMERCE_CASH:' || cash_scored.control_status || ':' || cash_scored.id::text AS item_id,
      'COMMERCE_CASH'::text, cash_scored.control_status::text, cash_scored.id, cash_scored.business_location_id,
      CASE WHEN cash_scored.control_status = 'REVIEW_REQUIRED' THEN 'CRITICAL' ELSE 'WARNING' END::text,
      'UNREAD'::text,
      CASE cash_scored.control_status
        WHEN 'REVIEW_REQUIRED' THEN 'Ecart de caisse a verifier'
        WHEN 'PARTIALLY_RECEIVED' THEN 'Reception de caisse partielle'
        ELSE 'Rapport de caisse a confirmer'
      END::text,
      ('Session ' || cash_scored.cash_session_id || ' -- attendu ' || cash_scored.cash_expected::text
        || ' FCFA, recu ' || cash_scored.received_total::text || ' FCFA')::text,
      cash_scored.cash_expected,
      cash_scored.closed_at_device,
      NULL::text,
      'Ouvrir le rapport'::text,
      ('/commerce?report=' || cash_scored.id::text)::text,
      '{}'::jsonb
    FROM cash_scored
    WHERE public.user_has_permission('commerce.cash.reports.control')
      AND public.commerce_location_access_allowed(cash_scored.business_location_id)
      AND cash_scored.control_status IN ('PENDING_CONTROL', 'PARTIALLY_RECEIVED', 'REVIEW_REQUIRED')
  ),

  -- Branch: client receivables (same formula as
  -- get_commercial_client_financial_metrics_bulk, unscoped to all clients).
  commerce_receivables AS (
    SELECT
      'COMMERCE_CREDIT:CLIENT_RECEIVABLE:' || c.id::text,
      'COMMERCE_CREDIT'::text, 'CLIENT_RECEIVABLE'::text, c.id, NULL::uuid,
      'WARNING'::text, 'UNREAD'::text,
      'Creance client'::text,
      (c.display_name || ' doit ' || due.amount_due::text || ' FCFA')::text,
      due.amount_due, due.last_sale_at, NULL::text,
      'Ouvrir la fiche client'::text, ('/clients/' || c.id::text)::text, '{}'::jsonb
    FROM public.transport_clients c
    JOIN LATERAL (
      SELECT
        GREATEST(0,
          COALESCE((SELECT sum(i.total_amount) FROM public.commercial_invoices i WHERE i.client_id = c.id AND i.status <> 'CANCELLED'), 0)
          - COALESCE((SELECT sum(rl.quantity_returned * rl.historical_unit_sale_price) FROM public.commerce_sale_return_lines rl JOIN public.commerce_sale_returns r ON r.id = rl.return_id JOIN public.commercial_sales s ON s.id = r.sale_id WHERE s.client_id = c.id), 0)
          - COALESCE((SELECT sum(p.amount) FROM public.commercial_invoice_payments p JOIN public.commercial_invoices i ON i.id = p.invoice_id WHERE i.client_id = c.id AND p.status = 'CONFIRMED' AND i.status <> 'CANCELLED'), 0)
        ) AS amount_due,
        (SELECT max(s.created_at) FROM public.commercial_sales s WHERE s.client_id = c.id AND s.status <> 'CANCELLED') AS last_sale_at
    ) due ON true
    WHERE public.user_has_permission('sales.finance.read')
      AND due.amount_due > 0
  ),

  -- Branch: supplier payables (same formula as
  -- get_commerce_purchase_financial_summary, per purchase).
  commerce_payables AS (
    SELECT
      'COMMERCE_CREDIT:SUPPLIER_PAYABLE:' || p.id::text,
      'COMMERCE_CREDIT'::text, 'SUPPLIER_PAYABLE'::text, p.id, p.business_location_id,
      'WARNING'::text, 'UNREAD'::text,
      'Dette fournisseur'::text,
      (s.display_name || ' -- achat ' || p.purchase_number || ' : ' || due.amount_due::text || ' FCFA restant')::text,
      due.amount_due, p.purchase_date, NULL::text,
      'Ouvrir l''achat'::text, ('/purchases/' || p.id::text)::text, '{}'::jsonb
    FROM public.commerce_purchases p
    JOIN public.commerce_suppliers s ON s.id = p.supplier_id
    JOIN LATERAL (
      SELECT GREATEST(0, p.total_amount - COALESCE(
        (SELECT sum(sp.amount) FROM public.commerce_supplier_payments sp WHERE sp.purchase_id = p.id AND sp.status = 'CONFIRMED'), 0
      )) AS amount_due
    ) due ON true
    WHERE public.user_has_permission('purchases.finance.read')
      AND public.commerce_location_access_allowed(p.business_location_id)
      AND due.amount_due > 0
  ),

  -- Branch: refundable credit on returned sales.
  commerce_refundable AS (
    SELECT
      'COMMERCE_CREDIT:REFUNDABLE_CREDIT:' || s.id::text,
      'COMMERCE_CREDIT'::text, 'REFUNDABLE_CREDIT'::text, s.id, s.business_location_id,
      'WARNING'::text, 'UNREAD'::text,
      'Credit client a rembourser'::text,
      (s.sale_number || ' : ' || refundable.amount::text || ' FCFA')::text,
      refundable.amount, s.sale_date, NULL::text,
      'Ouvrir la vente'::text, ('/sales/' || s.id::text)::text, '{}'::jsonb
    FROM public.commercial_sales s
    JOIN LATERAL (SELECT public._internal_commerce_sale_refundable_credit(s.id) AS amount) refundable ON true
    WHERE public.user_has_permission('sales.refunds.read')
      AND s.status = 'CONFIRMED'
      AND EXISTS (SELECT 1 FROM public.commerce_sale_returns r WHERE r.sale_id = s.id)
      AND refundable.amount > 0
      AND (s.business_location_id IS NULL OR public.commerce_location_access_allowed(s.business_location_id))
  ),

  -- Branch: Commerce-scoped stock faible (distinct from notifications'
  -- global inventory_items.stock_actuel reading -- this one reads the
  -- per-location GFC V1 model).
  commerce_low_stock AS (
    SELECT
      'COMMERCE_STOCK:LOW_STOCK:' || bli.id::text,
      'COMMERCE_STOCK'::text, 'LOW_STOCK'::text, bli.inventory_item_id, bli.business_location_id,
      CASE WHEN bli.quantity <= 0 THEN 'CRITICAL' ELSE 'WARNING' END::text, 'UNREAD'::text,
      'Stock faible'::text,
      (item.nom || ' : ' || bli.quantity::text || ' ' || coalesce(item.unite, 'unite'))::text,
      NULL::numeric, now(), NULL::text,
      'Ouvrir les stocks'::text, '/stocks'::text, '{}'::jsonb
    FROM public.business_location_inventory_items bli
    JOIN public.inventory_items item ON item.id = bli.inventory_item_id
    WHERE public.user_has_permission('commerce.stock.read')
      AND public.commerce_location_access_allowed(bli.business_location_id)
      AND bli.reorder_level IS NOT NULL AND bli.quantity <= bli.reorder_level
  ),

  -- Branch: Commerce-scoped wallet negatif/vide.
  commerce_wallet AS (
    SELECT
      'COMMERCE_STOCK:WALLET_NEGATIVE:' || w.id::text,
      'COMMERCE_STOCK'::text, 'WALLET_NEGATIVE'::text, w.id, mapping.business_location_id,
      'CRITICAL'::text, 'UNREAD'::text,
      CASE WHEN w.balance < 0 THEN 'Wallet negatif' ELSE 'Wallet vide' END::text,
      (w.name || ' : ' || w.balance::text || ' FCFA')::text,
      w.balance, now(), NULL::text,
      'Ouvrir le wallet'::text, ('/wallets/' || w.id::text)::text, '{}'::jsonb
    FROM public.business_location_wallets mapping
    JOIN public.wallets w ON w.id = mapping.wallet_id
    WHERE public.user_has_permission('store.financial.read')
      AND public.commerce_location_access_allowed(mapping.business_location_id)
      AND mapping.is_active
      AND w.balance <= 0
  ),

  commerce_inventory_open AS (
    SELECT
      'COMMERCE_STOCK:INVENTORY_OPEN:' || ic.id::text,
      'COMMERCE_STOCK'::text, 'INVENTORY_OPEN'::text, ic.id, ic.business_location_id,
      'WARNING'::text, 'UNREAD'::text,
      'Inventaire ouvert'::text,
      (ic.count_number || ' a completer')::text,
      NULL::numeric, ic.opened_at, NULL::text,
      'Ouvrir l''inventaire'::text, ('/inventory-counts/' || ic.id::text)::text, '{}'::jsonb
    FROM public.commerce_inventory_counts ic
    WHERE public.user_has_permission('inventory.counts.read')
      AND public.commerce_location_access_allowed(ic.business_location_id)
      AND ic.status = 'OPEN'
  ),

  commerce_transfer_transit AS (
    SELECT
      'COMMERCE_STOCK:TRANSFER_TRANSIT:' || t.id::text,
      'COMMERCE_STOCK'::text, 'TRANSFER_TRANSIT'::text, t.id, t.destination_location_id,
      'WARNING'::text, 'UNREAD'::text,
      'Transfert en transit'::text,
      (t.transfer_number || ' a receptionner')::text,
      NULL::numeric, COALESCE(t.dispatched_at, t.created_at), NULL::text,
      'Ouvrir le transfert'::text, ('/stock-transfers/' || t.id::text)::text, '{}'::jsonb
    FROM public.commerce_stock_transfers t
    WHERE public.user_has_permission('transfers.read')
      AND public.commerce_location_access_allowed(t.destination_location_id)
      AND t.status = 'DISPATCHED'
  ),

  -- Branch: HALAL Field declarations awaiting confirm/reject. No
  -- business_location_id anywhere in Field (verified) -- left NULL, not
  -- guessed.
  field_pending AS (
    SELECT
      'FIELD:DECLARATION_PENDING:' || d.id::text,
      'FIELD'::text, 'DECLARATION_PENDING'::text, d.id, NULL::uuid,
      'WARNING'::text, 'UNREAD'::text,
      'Declaration terrain a traiter'::text,
      (coalesce(fr.report_number, '') || ' -- ' || d.category || ' : ' || d.amount::text || ' FCFA')::text,
      d.amount, coalesce(d.submitted_at, d.occurred_at), NULL::text,
      'Ouvrir le rapport'::text, ('/field/' || d.report_id::text)::text, '{}'::jsonb
    FROM public.field_declarations d
    JOIN public.field_reports fr ON fr.id = d.report_id
    WHERE (public.user_has_permission('field.reports.confirm') OR public.user_has_permission('field.reports.review'))
      AND d.status = 'SUBMITTED'
  ),

  -- Branch: Transport operational timing gaps not tracked by notifications
  -- today (verified: only COURSE_INVOICE_OVERDUE/BUDGET/WALLET are).
  transport_not_departed AS (
    SELECT
      'TRANSPORT:NOT_DEPARTED:' || m.id::text,
      'TRANSPORT'::text, 'NOT_DEPARTED'::text, m.id, NULL::uuid,
      'WARNING'::text, 'UNREAD'::text,
      'Course jamais partie'::text,
      (m.mission_number || ' -- depart prevu le ' || to_char(m.planned_departure_at, 'DD/MM/YYYY HH24:MI'))::text,
      NULL::numeric, m.planned_departure_at, NULL::text,
      'Ouvrir les departs'::text, ('/courses/' || m.id::text)::text, '{}'::jsonb
    FROM public.transport_missions m
    WHERE public.user_has_permission('departures.read')
      AND m.status = 'PLANNED' AND m.planned_departure_at IS NOT NULL AND m.planned_departure_at < now()
  ),
  transport_late_delivery AS (
    SELECT
      'TRANSPORT:LATE_DELIVERY:' || m.id::text,
      'TRANSPORT'::text, 'LATE_DELIVERY'::text, m.id, NULL::uuid,
      'WARNING'::text, 'UNREAD'::text,
      'Livraison en retard'::text,
      (m.mission_number || ' -- arrivee prevue le ' || to_char(m.planned_arrival_at, 'DD/MM/YYYY HH24:MI'))::text,
      NULL::numeric, m.planned_arrival_at, NULL::text,
      'Ouvrir les livraisons'::text, ('/courses/' || m.id::text)::text, '{}'::jsonb
    FROM public.transport_missions m
    WHERE public.user_has_permission('deliveries.read')
      AND m.status = 'IN_PROGRESS' AND m.planned_arrival_at IS NOT NULL AND m.planned_arrival_at < now() AND m.delivery_status IS NULL
  ),
  transport_override AS (
    SELECT
      'TRANSPORT:PLANNING_OVERRIDE:' || m.id::text,
      'TRANSPORT'::text, 'PLANNING_OVERRIDE'::text, m.id, NULL::uuid,
      'INFO'::text, 'UNREAD'::text,
      'Derogation planning'::text,
      m.overlap_exception_reason,
      NULL::numeric, m.updated_at, NULL::text,
      'Ouvrir la course'::text, ('/courses/' || m.id::text)::text, '{}'::jsonb
    FROM public.transport_missions m
    WHERE public.user_has_permission('missions.read')
      AND m.status IN ('PLANNED', 'IN_PROGRESS')
      AND m.overlap_exception_reason IS NOT NULL
  ),

  items AS (
    SELECT * FROM notif
    UNION ALL SELECT * FROM commerce_cash
    UNION ALL SELECT * FROM commerce_receivables
    UNION ALL SELECT * FROM commerce_payables
    UNION ALL SELECT * FROM commerce_refundable
    UNION ALL SELECT * FROM commerce_low_stock
    UNION ALL SELECT * FROM commerce_wallet
    UNION ALL SELECT * FROM commerce_inventory_open
    UNION ALL SELECT * FROM commerce_transfer_transit
    UNION ALL SELECT * FROM field_pending
    UNION ALL SELECT * FROM transport_not_departed
    UNION ALL SELECT * FROM transport_late_delivery
    UNION ALL SELECT * FROM transport_override
  ),

  filtered AS (
    SELECT items.*, count(*) OVER() AS total_count
    FROM items
    WHERE (p_module IS NULL OR items.source_module = p_module)
      AND (p_severity IS NULL OR items.severity = p_severity)
      AND (p_status IS NULL OR items.status = p_status)
      AND (p_business_location_id IS NULL OR items.business_location_id = p_business_location_id)
      AND (p_from IS NULL OR items.occurred_at::date >= p_from)
      AND (p_to IS NULL OR items.occurred_at::date <= p_to)
  )
  SELECT
    filtered.item_id, filtered.source_module, filtered.source_type, filtered.source_id,
    filtered.business_location_id, filtered.severity, filtered.status, filtered.title,
    filtered.description, filtered.amount, filtered.occurred_at, filtered.actor,
    filtered.action_label, filtered.action_route, filtered.metadata, filtered.total_count
  FROM filtered
  ORDER BY
    CASE filtered.severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
    filtered.occurred_at ASC
  LIMIT v_page_size
  OFFSET (v_page - 1) * v_page_size;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_global_control_center(text, text, text, uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_global_control_center(text, text, text, uuid, date, date, integer, integer) TO authenticated;
