-- Mission "refonte caisse" -- centre de controle gestionnaire : lecture des
-- rapports avec statut calcule (jamais stocke) et detail d'un rapport avec
-- tracabilite complete jusqu'aux ventes sources.

CREATE OR REPLACE FUNCTION public.get_commerce_pos_control_reports(
  p_location_id uuid,
  p_from date,
  p_to date,
  p_status text DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.cash.reports.control');
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Periode invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;

  WITH received AS (
    SELECT
      link.closure_id,
      sum(r.received_amount) AS total_received,
      bool_or(coalesce(r.is_final, false)) AS is_finalized,
      max(r.confirmed_at) AS last_received_at
    FROM public.commerce_cash_remittances AS r
    JOIN public.commerce_cash_remittance_closures AS link ON link.remittance_id = r.id
    WHERE r.status = 'CONFIRMED'
    GROUP BY link.closure_id
  ),
  scored AS (
    SELECT
      report.*,
      coalesce(received.total_received, 0) AS received_total,
      coalesce(received.is_finalized, false) AS is_finalized,
      received.last_received_at,
      CASE
        WHEN report.flagged_for_review THEN 'REVIEW_REQUIRED'
        WHEN report.cash_expected <= 0 THEN 'RECEIVED'
        WHEN coalesce(received.is_finalized, false) THEN
          CASE WHEN round(coalesce(received.total_received, 0), 2) = round(report.cash_expected, 2)
            THEN 'RECEIVED' ELSE 'REVIEW_REQUIRED' END
        WHEN coalesce(received.total_received, 0) = 0 THEN 'PENDING_CONTROL'
        ELSE 'PARTIALLY_RECEIVED'
      END AS control_status
    FROM public.commerce_pos_control_reports AS report
    LEFT JOIN received ON received.closure_id = report.closure_id
    WHERE report.business_location_id = p_location_id
      AND report.closed_at_device::date BETWEEN p_from AND p_to
      AND (p_cashier_id IS NULL OR report.cashier_user_id = p_cashier_id)
  )
  SELECT jsonb_build_object(
    'counts', jsonb_build_object(
      'pendingControl', (SELECT count(*) FROM scored WHERE control_status = 'PENDING_CONTROL'),
      'partiallyReceived', (SELECT count(*) FROM scored WHERE control_status = 'PARTIALLY_RECEIVED'),
      'received', (SELECT count(*) FROM scored WHERE control_status = 'RECEIVED'),
      'reviewRequired', (SELECT count(*) FROM scored WHERE control_status = 'REVIEW_REQUIRED')
    ),
    'reports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', scored.id, 'closureId', scored.closure_id, 'cashSessionId', scored.cash_session_id,
        'terminalId', scored.terminal_id,
        'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
        'cashierId', scored.cashier_user_id,
        'openedAt', scored.opened_at_device, 'closedAt', scored.closed_at_device,
        'ticketCount', scored.ticket_count, 'articleRevenue', scored.article_revenue,
        'serviceRevenue', scored.service_revenue, 'totalRevenue', scored.total_revenue,
        'articleQuantityTotal', scored.article_quantity_total,
        'cashExpected', scored.cash_expected, 'mobileMoneyTotal', scored.mobile_money_total,
        'otherPaymentTotal', scored.other_payment_total,
        'receivedTotal', scored.received_total, 'remainingAmount', greatest(round(scored.cash_expected - scored.received_total, 2), 0),
        'isFinalized', scored.is_finalized, 'lastReceivedAt', scored.last_received_at,
        'syncStatus', scored.sync_status, 'controlStatus', scored.control_status,
        'flaggedForReview', scored.flagged_for_review, 'flaggedReason', scored.flagged_reason,
        'generatedAt', scored.generated_at
      ) ORDER BY scored.closed_at_device DESC)
      FROM scored
      LEFT JOIN public.profiles profile_row ON profile_row.id = scored.cashier_user_id
      WHERE p_status IS NULL OR scored.control_status = p_status
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_pos_control_reports(uuid, date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_control_reports(uuid, date, date, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_commerce_pos_control_reports(uuid, date, date, text, uuid) IS
  'Liste filtrable du centre de controle. controlStatus est toujours recalcule (PENDING_CONTROL/PARTIALLY_RECEIVED/RECEIVED/REVIEW_REQUIRED), jamais lu depuis une colonne stockee.';

-- Detail d'un rapport : mêmes chiffres que la liste, plus la tracabilite
-- complete (ventes, receptions) pour un seul rapport.
CREATE OR REPLACE FUNCTION public.get_commerce_pos_control_report_detail(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_report public.commerce_pos_control_reports;
  v_result jsonb;
BEGIN
  PERFORM public.permission_require('commerce.cash.reports.control');
  SELECT * INTO v_report FROM public.commerce_pos_control_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rapport introuvable.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.commerce_location_access_allowed(v_report.business_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_report.id, 'closureId', v_report.closure_id, 'cashSessionId', v_report.cash_session_id,
      'terminalId', v_report.terminal_id, 'businessLocationId', v_report.business_location_id,
      'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
      'openedAt', v_report.opened_at_device, 'closedAt', v_report.closed_at_device,
      'ticketCount', v_report.ticket_count, 'articleRevenue', v_report.article_revenue,
      'serviceRevenue', v_report.service_revenue, 'totalRevenue', v_report.total_revenue,
      'articleQuantityTotal', v_report.article_quantity_total,
      'cashExpected', v_report.cash_expected, 'mobileMoneyTotal', v_report.mobile_money_total,
      'otherPaymentTotal', v_report.other_payment_total, 'syncStatus', v_report.sync_status,
      'flaggedForReview', v_report.flagged_for_review, 'flaggedReason', v_report.flagged_reason,
      'generatedAt', v_report.generated_at
    ) || (
      SELECT jsonb_build_object(
        'receivedTotal', coalesce(sum(r.received_amount), 0),
        'isFinalized', coalesce(bool_or(coalesce(r.is_final, false)), false),
        'remainingAmount', greatest(round(v_report.cash_expected - coalesce(sum(r.received_amount), 0), 2), 0)
      )
      FROM public.commerce_cash_remittances r
      JOIN public.commerce_cash_remittance_closures link ON link.remittance_id = r.id
      WHERE link.closure_id = v_report.closure_id AND r.status = 'CONFIRMED'
    ),
    'sales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sale.id, 'saleNumber', sale.sale_number, 'createdAt', sale.created_at,
        'total', (SELECT coalesce(sum(l.line_total), 0) FROM public.commercial_sale_lines l WHERE l.sale_id = sale.id)
      ) ORDER BY sale.created_at)
      FROM public.commercial_sales sale
      WHERE sale.cash_session_id = v_report.cash_session_id
        AND sale.business_location_id = v_report.business_location_id
        AND sale.status = 'CONFIRMED'
    ), '[]'::jsonb),
    'receptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'receivedAmount', r.received_amount, 'expectedAmount', r.expected_amount,
        'difference', r.remittance_difference, 'isFinal', r.is_final,
        'destinationWallet', wallet_row.name, 'confirmedBy', coalesce(NULLIF(confirmer.full_name, ''), NULLIF(confirmer.username, ''), 'Utilisateur'),
        'confirmedAt', r.confirmed_at, 'note', r.confirmation_note, 'operationId', finance_link.operation_id
      ) ORDER BY r.confirmed_at)
      FROM public.commerce_cash_remittances r
      JOIN public.commerce_cash_remittance_closures link ON link.remittance_id = r.id
      LEFT JOIN public.wallets wallet_row ON wallet_row.id = r.destination_wallet_id
      LEFT JOIN public.profiles confirmer ON confirmer.id = r.confirmed_by
      LEFT JOIN public.finance_commerce_cash_remittance_links finance_link ON finance_link.remittance_id = r.id
      WHERE link.closure_id = v_report.closure_id AND r.status = 'CONFIRMED'
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.profiles profile_row
  WHERE profile_row.id = v_report.cashier_user_id;

  IF v_result IS NULL THEN
    -- le caissier peut ne plus avoir de ligne profiles ; ne jamais faire
    -- echouer la lecture du rapport pour autant.
    SELECT jsonb_build_object(
      'report', jsonb_build_object(
        'id', v_report.id, 'closureId', v_report.closure_id, 'cashSessionId', v_report.cash_session_id,
        'terminalId', v_report.terminal_id, 'businessLocationId', v_report.business_location_id,
        'cashier', 'Utilisateur', 'openedAt', v_report.opened_at_device, 'closedAt', v_report.closed_at_device,
        'ticketCount', v_report.ticket_count, 'articleRevenue', v_report.article_revenue,
        'serviceRevenue', v_report.service_revenue, 'totalRevenue', v_report.total_revenue,
        'articleQuantityTotal', v_report.article_quantity_total,
        'cashExpected', v_report.cash_expected, 'mobileMoneyTotal', v_report.mobile_money_total,
        'otherPaymentTotal', v_report.other_payment_total, 'syncStatus', v_report.sync_status,
        'flaggedForReview', v_report.flagged_for_review, 'flaggedReason', v_report.flagged_reason,
        'generatedAt', v_report.generated_at
      ),
      'sales', '[]'::jsonb, 'receptions', '[]'::jsonb
    ) INTO v_result;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_commerce_pos_control_report_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commerce_pos_control_report_detail(uuid) TO authenticated;
