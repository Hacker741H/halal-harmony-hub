-- A closure being SYNCED only means that the server received it. Financial
-- control is tracked independently through the existing control report and
-- its linked, confirmed cash receptions.
--
-- A final reception closes manager control even when the received amount is
-- different from the theoretical amount. The difference remains fully
-- traceable on commerce_cash_remittances; it is not a second finance entry.

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
        WHEN coalesce(received.is_finalized, false) THEN 'RECEIVED'
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
        'receivedTotal', scored.received_total,
        'remainingAmount', greatest(round(scored.cash_expected - scored.received_total, 2), 0),
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
  'Manager cash-control workspace. SYNCED is technical only. A report remains pending until a final reception is confirmed; a cash difference stays traceable but does not keep an already controlled report pending.';
