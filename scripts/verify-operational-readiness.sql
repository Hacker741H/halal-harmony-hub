-- Read-only operational reconciliation for production readiness.
-- It does not create, update, or delete any business data.
WITH wallet_rows AS (
  SELECT
    wallet_id,
    wallet_name,
    stored_balance,
    calculated_balance,
    stored_balance - calculated_balance AS difference,
    incoming_total,
    expense_total,
    transfers_in_total,
    transfers_out_total
  FROM public.finance_wallet_reconciliation
),
course_rows AS (
  SELECT
    mission.id,
    mission.mission_number,
    mission.status,
    mission.driver_id,
    mission.vehicle_id,
    mission.quoted_amount,
    COALESCE(expenses.confirmed_expenses, 0) AS confirmed_expenses,
    COALESCE(payments.confirmed_payments, 0) AS confirmed_payments,
    COALESCE(invoices.invoiced_amount, 0) AS invoiced_amount,
    COALESCE(invoices.invoiced_amount, 0) - COALESCE(payments.confirmed_payments, 0) AS receivable
  FROM public.transport_missions AS mission
  LEFT JOIN LATERAL (
    SELECT sum(amount) AS confirmed_expenses
    FROM public.transport_mission_expenses
    WHERE mission_id = mission.id AND status = 'PAID'
  ) AS expenses ON true
  LEFT JOIN LATERAL (
    SELECT sum(amount) AS confirmed_payments
    FROM public.transport_invoice_payments
    WHERE mission_id = mission.id AND status = 'CONFIRMED'
  ) AS payments ON true
  LEFT JOIN LATERAL (
    SELECT sum(total_amount) AS invoiced_amount
    FROM public.transport_invoices
    WHERE mission_id = mission.id AND status <> 'CANCELLED'
  ) AS invoices ON true
),
course_finance_events AS (
  SELECT
    mission.mission_number,
    mission.driver_id,
    mission.vehicle_id,
    'EXPENSE'::text AS event_type,
    expense.id AS source_id,
    expense.status,
    expense.expense_date AS event_date,
    expense.wallet_id,
    expense.category,
    expense.amount,
    operation.id AS finance_operation_id,
    operation.status AS finance_operation_status,
    operation.amount AS finance_operation_amount
  FROM public.transport_mission_expenses AS expense
  JOIN public.transport_missions AS mission ON mission.id = expense.mission_id
  LEFT JOIN public.finance_transport_mission_expense_links AS link
    ON link.expense_id = expense.id AND link.link_type = 'EXPENSE'
  LEFT JOIN public.finance_operations AS operation ON operation.id = link.operation_id

  UNION ALL

  SELECT
    mission.mission_number,
    mission.driver_id,
    mission.vehicle_id,
    'PAYMENT'::text AS event_type,
    payment.id AS source_id,
    payment.status,
    payment.payment_date AS event_date,
    payment.wallet_id,
    payment.payment_kind AS category,
    payment.amount,
    operation.id AS finance_operation_id,
    operation.status AS finance_operation_status,
    operation.amount AS finance_operation_amount
  FROM public.transport_invoice_payments AS payment
  JOIN public.transport_missions AS mission ON mission.id = payment.mission_id
  LEFT JOIN public.finance_transport_payment_links AS link
    ON link.payment_id = payment.id AND link.link_type = 'PAYMENT'
  LEFT JOIN public.finance_operations AS operation ON operation.id = link.operation_id
)
SELECT jsonb_build_object(
  'wallets', COALESCE((SELECT jsonb_agg(to_jsonb(wallet_rows) ORDER BY wallet_name) FROM wallet_rows), '[]'::jsonb),
  'wallet_difference_count', (SELECT count(*) FROM wallet_rows WHERE difference <> 0),
  'operations_by_type_status', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('type', type, 'status', status, 'rows', rows, 'amount', amount) ORDER BY type, status)
    FROM (
      SELECT type, COALESCE(status, 'NULL') AS status, count(*) AS rows, sum(amount) AS amount
      FROM public.finance_operations
      GROUP BY type, COALESCE(status, 'NULL')
    ) AS finance_summary
  ), '[]'::jsonb),
  'courses', COALESCE((SELECT jsonb_agg(to_jsonb(course_rows) ORDER BY mission_number) FROM course_rows), '[]'::jsonb),
  'course_expenses_by_status', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('status', status, 'rows', rows, 'amount', amount) ORDER BY status)
    FROM (
      SELECT status, count(*) AS rows, sum(amount) AS amount
      FROM public.transport_mission_expenses
      GROUP BY status
    ) AS expense_summary
  ), '[]'::jsonb),
  'course_payments_by_status', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('status', status, 'rows', rows, 'amount', amount) ORDER BY status)
    FROM (
      SELECT status, count(*) AS rows, sum(amount) AS amount
      FROM public.transport_invoice_payments
      GROUP BY status
    ) AS payment_summary
  ), '[]'::jsonb),
  'course_finance_events', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'mission_number', mission_number,
        'driver_id', driver_id,
        'vehicle_id', vehicle_id,
        'event_type', event_type,
        'source_id', source_id,
        'status', status,
        'event_date', event_date,
        'wallet_id', wallet_id,
        'category', category,
        'amount', amount,
        'finance_operation_id', finance_operation_id,
        'finance_operation_status', finance_operation_status,
        'finance_operation_amount', finance_operation_amount
      )
      ORDER BY event_date, mission_number, event_type
    )
    FROM course_finance_events
    WHERE status IN ('PAID', 'CONFIRMED')
  ), '[]'::jsonb),
  'course_finance_link_anomalies', jsonb_build_object(
    'paid_expenses_without_matching_operation', (
      SELECT count(*)
      FROM course_finance_events
      WHERE event_type = 'EXPENSE'
        AND status = 'PAID'
        AND (finance_operation_id IS NULL OR finance_operation_status = 'CANCELLED' OR finance_operation_amount <> amount)
    ),
    'confirmed_payments_without_matching_operation', (
      SELECT count(*)
      FROM course_finance_events
      WHERE event_type = 'PAYMENT'
        AND status = 'CONFIRMED'
        AND (finance_operation_id IS NULL OR finance_operation_status = 'CANCELLED' OR finance_operation_amount <> amount)
    )
  )
) AS operational_reconciliation;
