-- GFC V1 Phase 6 -- reinforces the cockpit's existing "attention" aggregate
-- (already had PLANNED_EXPENSE / CASH_REVIEW / SYNC_CONFLICT / LOW_STOCK /
-- WALLET) with the three cross-domain signals it was still missing:
-- inventory counts left open, transfers in transit awaiting receipt at this
-- location, and remaining refundable credit on returned sales. Return type
-- is still jsonb, so this is CREATE OR REPLACE, no privilege regrant needed.
-- "Creance/dette echue" was deliberately left out: neither concept has a due
-- date or materiality threshold anywhere in the schema today, and inventing
-- one here would be an undocumented business-policy call, not a UI fix.
CREATE OR REPLACE FUNCTION public.get_commerce_store_cockpit(p_location_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_profitability jsonb;
  v_stock_summary jsonb;
  v_financial_access boolean := public.user_has_permission('store.financial.read');
  v_stock_valuation_access boolean := public.user_has_permission('store.stock_valuation.read');
  v_expenses_read_access boolean := public.user_has_permission('store.expenses.read');
  v_expenses_create_access boolean := public.user_has_permission('store.expenses.create');
  v_expenses_confirm_access boolean := public.user_has_permission('store.expenses.confirm');
  v_cash_access boolean := public.user_has_permission('commerce.cash.read');
  v_stock_access boolean := public.user_has_permission('commerce.stock.read');
BEGIN
  PERFORM public.permission_require('commerce.pos.read');
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Periode invalide.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.commerce_location_access_allowed(p_location_id) THEN
    RAISE EXCEPTION 'Acces refuse a ce magasin.' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.user_has_permission('locations.manage')
    OR public.user_has_permission('commerce.stock.receive')
    OR v_financial_access
    OR v_expenses_read_access
  ) THEN
    RAISE EXCEPTION 'Acces refuse au pilotage du magasin.' USING ERRCODE = '42501';
  END IF;

  IF v_financial_access THEN
    v_profitability := public.get_commerce_store_profitability(p_location_id, p_from, p_to);
  END IF;
  IF v_stock_valuation_access THEN
    v_stock_summary := public.get_commerce_store_stock_valuation(p_location_id);
  END IF;

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'access', jsonb_build_object(
      'financial', v_financial_access,
      'stockValuation', v_stock_valuation_access,
      'expensesRead', v_expenses_read_access,
      'expensesCreate', v_expenses_create_access,
      'expensesConfirm', v_expenses_confirm_access,
      'cash', v_cash_access,
      'stock', v_stock_access
    ),
    'location', jsonb_build_object(
      'id', location_row.id,
      'name', location_row.name,
      'code', location_row.code,
      'status', location_row.status,
      'address', location_row.address,
      'openedAt', location_row.created_at::date,
      'manager', (
        SELECT jsonb_build_object(
          'id', assignment_row.user_id,
          'name', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur')
        )
        FROM public.business_location_assignments assignment_row
        LEFT JOIN public.profiles profile_row ON profile_row.id = assignment_row.user_id
        WHERE assignment_row.business_location_id = p_location_id
          AND assignment_row.assignment_role = 'STORE_MANAGER'
          AND assignment_row.end_date IS NULL
        ORDER BY assignment_row.start_date DESC, assignment_row.created_at DESC
        LIMIT 1
      ),
      'lastActivityAt', (
        SELECT max(activity_at)
        FROM (
          SELECT max(sale_row.created_at) AS activity_at FROM public.commercial_sales sale_row WHERE sale_row.business_location_id = p_location_id
          UNION ALL SELECT max(expense_row.created_at) FROM public.commerce_store_expenses expense_row WHERE expense_row.business_location_id = p_location_id
          UNION ALL SELECT max(charge_row.created_at) FROM public.commerce_store_planned_expenses charge_row WHERE charge_row.business_location_id = p_location_id
          UNION ALL SELECT max(movement_row.created_at) FROM public.stock_movements movement_row WHERE movement_row.business_location_id = p_location_id
          UNION ALL SELECT max(closure_row.received_at_server) FROM public.commerce_pos_cash_session_closures closure_row WHERE closure_row.business_location_id = p_location_id
          UNION ALL SELECT max(receipt_row.received_at_server) FROM public.commerce_pos_offline_receipts receipt_row WHERE receipt_row.business_location_id = p_location_id
        ) activity_rows
      )
    ),
    'wallets', CASE WHEN v_financial_access OR v_cash_access THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wallet_row.id, 'name', wallet_row.name, 'purpose', mapping_row.purpose,
        'isPrimary', mapping_row.is_primary, 'balance', wallet_row.balance
      ) ORDER BY mapping_row.is_primary DESC, wallet_row.name)
      FROM public.business_location_wallets mapping_row
      JOIN public.wallets wallet_row ON wallet_row.id = mapping_row.wallet_id
      WHERE mapping_row.business_location_id = p_location_id AND mapping_row.is_active
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'profitability', CASE WHEN v_financial_access THEN v_profitability ELSE NULL END,
    'costCertification', CASE WHEN v_financial_access THEN jsonb_build_object(
      'firstSnapshotAt', (
        SELECT min(line_cost.recorded_at)
        FROM public.commercial_sale_line_costs line_cost
        JOIN public.commercial_sale_lines line_row ON line_row.id = line_cost.sale_line_id
        JOIN public.commercial_sales sale_row ON sale_row.id = line_row.sale_id
        WHERE sale_row.business_location_id = p_location_id
      ),
      'selectedPeriodCertified', coalesce((v_profitability ->> 'isComplete')::boolean, false)
    ) ELSE NULL END,
    'sales', CASE WHEN v_financial_access THEN jsonb_build_object(
      'ticketCount', (
        SELECT count(*) FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
          AND sale_row.sale_date BETWEEN p_from AND p_to
      ),
      'averageBasket', COALESCE((
        SELECT round(avg(ticket_total), 2)
        FROM (
          SELECT sum(line_row.line_total) AS ticket_total
          FROM public.commercial_sales sale_row
          JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
            AND sale_row.sale_date BETWEEN p_from AND p_to
          GROUP BY sale_row.id
        ) ticket_rows
      ), 0),
      'cancelledCount', (
        SELECT count(*) FROM public.commercial_sales sale_row
        WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CANCELLED'
          AND sale_row.sale_date BETWEEN p_from AND p_to
      ),
      'recent', COALESCE((
        SELECT jsonb_agg(to_jsonb(recent_row) ORDER BY recent_row."createdAt" DESC)
        FROM (
          SELECT sale_row.id, sale_row.sale_number AS "saleNumber", sale_row.sale_date AS "saleDate",
            sale_row.status, sale_row.reference, sale_row.created_at AS "createdAt",
            COALESCE(sum(line_row.line_total), 0) AS total,
            count(*) FILTER (WHERE line_row.line_type = 'ARTICLE') AS "articleLines",
            count(*) FILTER (WHERE line_row.line_type = 'SERVICE') AS "serviceLines"
          FROM public.commercial_sales sale_row
          LEFT JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.sale_date BETWEEN p_from AND p_to
          GROUP BY sale_row.id
          ORDER BY sale_row.created_at DESC
          LIMIT 30
        ) recent_row
      ), '[]'::jsonb),
      'topItems', COALESCE((
        SELECT jsonb_agg(to_jsonb(top_row) ORDER BY top_row.revenue DESC, top_row.quantity DESC)
        FROM (
          SELECT line_row.inventory_item_id AS id, line_row.description AS name,
            sum(line_row.quantity) AS quantity, sum(line_row.line_total) AS revenue
          FROM public.commercial_sales sale_row
          JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
            AND sale_row.sale_date BETWEEN p_from AND p_to AND line_row.line_type = 'ARTICLE'
          GROUP BY line_row.inventory_item_id, line_row.description
          ORDER BY revenue DESC, quantity DESC
          LIMIT 10
        ) top_row
      ), '[]'::jsonb),
      'services', COALESCE((
        SELECT jsonb_agg(to_jsonb(service_row) ORDER BY service_row.revenue DESC)
        FROM (
          SELECT line_row.description AS name, sum(line_row.quantity) AS quantity, sum(line_row.line_total) AS revenue
          FROM public.commercial_sales sale_row
          JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
          WHERE sale_row.business_location_id = p_location_id AND sale_row.status = 'CONFIRMED'
            AND sale_row.sale_date BETWEEN p_from AND p_to AND line_row.line_type = 'SERVICE'
          GROUP BY line_row.description
          ORDER BY revenue DESC
          LIMIT 20
        ) service_row
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'stock', CASE WHEN v_stock_valuation_access THEN v_stock_summary || jsonb_build_object(
      'lowStockCount', (
        SELECT count(*) FROM public.business_location_inventory_items local_item
        WHERE local_item.business_location_id = p_location_id AND local_item.reorder_level IS NOT NULL
          AND local_item.quantity <= local_item.reorder_level
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', item_row.id, 'sku', item_row.sku, 'name', item_row.nom, 'unit', item_row.unite,
          'quantity', local_item.quantity, 'unitCost', cost_state.current_unit_cost,
          'costValue', cost_state.inventory_value, 'salePrice', local_item.sale_price,
          'potentialSaleValue', round(local_item.quantity * local_item.sale_price, 2),
          'potentialMargin', round(local_item.quantity * local_item.sale_price, 2) - cost_state.inventory_value,
          'reorderLevel', local_item.reorder_level,
          'isLow', local_item.reorder_level IS NOT NULL AND local_item.quantity <= local_item.reorder_level
        ) ORDER BY item_row.nom)
        FROM public.business_location_inventory_items local_item
        JOIN public.inventory_items item_row ON item_row.id = local_item.inventory_item_id
        LEFT JOIN public.commerce_inventory_cost_states cost_state
          ON cost_state.business_location_id = local_item.business_location_id
          AND cost_state.inventory_item_id = local_item.inventory_item_id
        WHERE local_item.business_location_id = p_location_id
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'expenses', CASE WHEN v_expenses_read_access THEN jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(expense_view) ORDER BY expense_view."expenseDate" DESC, expense_view."createdAt" DESC)
        FROM (
          SELECT expense_row.id, expense_row.category, expense_row.amount,
            expense_row.expense_date AS "expenseDate", expense_row.status, expense_row.description,
            expense_row.reference, expense_row.created_at AS "createdAt", expense_row.confirmed_at AS "confirmedAt",
            coalesce(NULLIF(creator.full_name, ''), NULLIF(creator.username, ''), 'Utilisateur') AS "createdBy",
            coalesce(NULLIF(confirmer.full_name, ''), NULLIF(confirmer.username, ''), NULL) AS "confirmedBy",
            wallet_row.id AS "walletId", wallet_row.name AS "walletName",
            operation_row.id AS "operationId", operation_row.reference AS "financeReference"
          FROM public.commerce_store_expenses expense_row
          LEFT JOIN public.profiles creator ON creator.id = expense_row.created_by
          LEFT JOIN public.profiles confirmer ON confirmer.id = expense_row.confirmed_by
          LEFT JOIN public.wallets wallet_row ON wallet_row.id = expense_row.wallet_id
          LEFT JOIN public.finance_commerce_store_expense_links expense_link ON expense_link.store_expense_id = expense_row.id
          LEFT JOIN public.finance_operations operation_row ON operation_row.id = expense_link.operation_id
          WHERE expense_row.business_location_id = p_location_id
            AND expense_row.expense_date BETWEEN p_from AND p_to
          ORDER BY expense_row.expense_date DESC, expense_row.created_at DESC
          LIMIT 100
        ) expense_view
      ), '[]'::jsonb),
      'planned', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', charge_row.id, 'category', charge_row.category, 'expectedAmount', charge_row.expected_amount,
          'dueDate', charge_row.due_date, 'status', charge_row.status, 'reference', charge_row.reference,
          'description', charge_row.description, 'paidExpenseId', charge_row.paid_expense_id,
          'createdAt', charge_row.created_at,
          'timing', CASE WHEN charge_row.status = 'PLANNED' AND charge_row.due_date < current_date THEN 'OVERDUE'
            WHEN charge_row.status = 'PLANNED' THEN 'UPCOMING' ELSE charge_row.status END
        ) ORDER BY (charge_row.status = 'PLANNED') DESC, charge_row.due_date)
        FROM public.commerce_store_planned_expenses charge_row
        WHERE charge_row.business_location_id = p_location_id
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'cash', CASE WHEN v_cash_access THEN jsonb_build_object(
      'reviewRequiredCount', (
        SELECT count(*) FROM public.commerce_pos_cash_session_closures closure_row
        WHERE closure_row.business_location_id = p_location_id AND closure_row.status = 'REVIEW_REQUIRED'
          AND closure_row.closed_at_device::date BETWEEN p_from AND p_to
      ),
      'unclosedSessionCount', (
        SELECT count(*) FROM (
          SELECT DISTINCT receipt_row.cash_session_id
          FROM public.commerce_pos_offline_receipts receipt_row
          LEFT JOIN public.commerce_pos_cash_session_closures closure_row ON closure_row.cash_session_id = receipt_row.cash_session_id
          WHERE receipt_row.business_location_id = p_location_id AND closure_row.id IS NULL
        ) open_sessions
      ),
      'closures', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', closure_row.id, 'cashSessionId', closure_row.cash_session_id, 'terminalId', closure_row.terminal_id,
          'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
          'openedAt', closure_row.opened_at_device, 'closedAt', closure_row.closed_at_device,
          'theoreticalCash', closure_row.server_cash_total, 'countedCash', closure_row.counted_cash,
          'difference', closure_row.server_difference, 'status', closure_row.status,
          'totalsMatch', closure_row.totals_match, 'requiresCashReview', closure_row.cash_discrepancy
        ) ORDER BY closure_row.closed_at_device DESC)
        FROM public.commerce_pos_cash_session_closures closure_row
        LEFT JOIN public.profiles profile_row ON profile_row.id = closure_row.cashier_user_id
        WHERE closure_row.business_location_id = p_location_id
          AND closure_row.closed_at_device::date BETWEEN p_from AND p_to
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'remittances', CASE WHEN v_cash_access THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', remittance_row.id, 'date', remittance_row.remittance_date, 'amount', remittance_row.amount,
        'status', remittance_row.status, 'reference', remittance_row.reference,
        'sourceWallet', source_wallet.name, 'destinationWallet', destination_wallet.name
      ) ORDER BY remittance_row.remittance_date DESC, remittance_row.created_at DESC)
      FROM public.commerce_cash_remittances remittance_row
      JOIN public.wallets source_wallet ON source_wallet.id = remittance_row.source_wallet_id
      JOIN public.wallets destination_wallet ON destination_wallet.id = remittance_row.destination_wallet_id
      WHERE remittance_row.business_location_id = p_location_id
        AND remittance_row.remittance_date BETWEEN p_from AND p_to
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'finance', CASE WHEN v_financial_access THEN jsonb_build_object(
      'inflows', COALESCE((
        SELECT sum(CASE
          WHEN operation_row.wallet_id = mapping_row.wallet_id AND operation_row.type IN ('REVENUE', 'DEPOSIT') THEN operation_row.amount
          WHEN operation_row.destination_wallet_id = mapping_row.wallet_id AND operation_row.type = 'TRANSFER' THEN operation_row.amount
          ELSE 0 END)
        FROM public.finance_operations operation_row
        JOIN public.business_location_wallets mapping_row
          ON mapping_row.business_location_id = p_location_id AND mapping_row.is_active
          AND (mapping_row.wallet_id = operation_row.wallet_id OR mapping_row.wallet_id = operation_row.destination_wallet_id)
        WHERE operation_row.operation_date BETWEEN p_from AND p_to AND COALESCE(operation_row.status, 'VALIDE') <> 'CANCELLED'
      ), 0),
      'outflows', COALESCE((
        SELECT sum(CASE
          WHEN operation_row.wallet_id = mapping_row.wallet_id AND operation_row.type IN ('EXPENSE','TRANSFER') THEN operation_row.amount
          ELSE 0 END)
        FROM public.finance_operations operation_row
        JOIN public.business_location_wallets mapping_row
          ON mapping_row.business_location_id = p_location_id AND mapping_row.is_active
          AND mapping_row.wallet_id = operation_row.wallet_id
        WHERE operation_row.operation_date BETWEEN p_from AND p_to AND COALESCE(operation_row.status, 'VALIDE') <> 'CANCELLED'
      ), 0),
      'operations', COALESCE((
        SELECT jsonb_agg(to_jsonb(operation_view) ORDER BY operation_view."createdAt" DESC)
        FROM (
          SELECT DISTINCT operation_row.id, operation_row.operation_date AS date, operation_row.type,
            operation_row.amount, operation_row.category, operation_row.description, operation_row.reference,
            operation_row.status, operation_row.origin, operation_row.created_at AS "createdAt",
            wallet_row.name AS "walletName"
          FROM public.finance_operations operation_row
          JOIN public.business_location_wallets mapping_row
            ON mapping_row.business_location_id = p_location_id AND mapping_row.is_active
            AND (mapping_row.wallet_id = operation_row.wallet_id OR mapping_row.wallet_id = operation_row.destination_wallet_id)
          LEFT JOIN public.wallets wallet_row ON wallet_row.id = operation_row.wallet_id
          WHERE operation_row.operation_date BETWEEN p_from AND p_to
          ORDER BY operation_row.created_at DESC
          LIMIT 50
        ) operation_view
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'sync', CASE WHEN v_cash_access THEN jsonb_build_object(
      'processedCount', (
        SELECT count(*) FROM public.commerce_pos_offline_receipts receipt_row
        WHERE receipt_row.business_location_id = p_location_id AND receipt_row.status = 'PROCESSED'
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
      ),
      'conflictCount', (
        SELECT count(*) FROM public.commerce_pos_offline_receipts receipt_row
        WHERE receipt_row.business_location_id = p_location_id AND receipt_row.status = 'CONFLICT'
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
      ),
      'pendingCount', NULL,
      'receipts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', receipt_row.id, 'offlineSaleId', receipt_row.offline_sale_id,
          'terminalId', receipt_row.terminal_id,
          'cashier', coalesce(NULLIF(profile_row.full_name, ''), NULLIF(profile_row.username, ''), 'Utilisateur'),
          'createdAtDevice', receipt_row.created_at_device, 'receivedAtServer', receipt_row.received_at_server,
          'status', receipt_row.status, 'saleId', receipt_row.server_sale_id,
          'errorCode', receipt_row.error_code, 'errorMessage', receipt_row.error_message
        ) ORDER BY receipt_row.received_at_server DESC)
        FROM public.commerce_pos_offline_receipts receipt_row
        LEFT JOIN public.profiles profile_row ON profile_row.id = receipt_row.cashier_user_id
        WHERE receipt_row.business_location_id = p_location_id
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
      ), '[]'::jsonb)
    ) ELSE NULL END,
    'attention', COALESCE((
      SELECT jsonb_agg(to_jsonb(attention_row) ORDER BY attention_row.priority, attention_row.date)
      FROM (
        SELECT 'PLANNED_EXPENSE'::text AS type, charge_row.id::text AS id,
          CASE WHEN charge_row.due_date < current_date THEN 1 ELSE 2 END AS priority,
          charge_row.due_date AS date,
          CASE WHEN charge_row.due_date < current_date THEN 'Charge en retard' ELSE 'Charge a payer prochainement' END AS title,
          charge_row.description AS detail
        FROM public.commerce_store_planned_expenses charge_row
        WHERE v_expenses_read_access AND charge_row.business_location_id = p_location_id
          AND charge_row.status = 'PLANNED' AND charge_row.due_date <= current_date + 7
        UNION ALL
        SELECT 'CASH_REVIEW', closure_row.id::text, 1, closure_row.closed_at_device::date,
          'Ecart de caisse a verifier', 'Session ' || closure_row.cash_session_id || ' : ' || closure_row.server_difference || ' FCFA'
        FROM public.commerce_pos_cash_session_closures closure_row
        WHERE v_cash_access AND closure_row.business_location_id = p_location_id
          AND (closure_row.status = 'REVIEW_REQUIRED' OR closure_row.cash_discrepancy)
        UNION ALL
        SELECT 'SYNC_CONFLICT', receipt_row.id::text, 1, receipt_row.received_at_server::date,
          'Conflit de synchronisation POS', receipt_row.offline_sale_id || coalesce(' : ' || receipt_row.error_message, '')
        FROM public.commerce_pos_offline_receipts receipt_row
        WHERE v_cash_access AND receipt_row.business_location_id = p_location_id AND receipt_row.status = 'CONFLICT'
        UNION ALL
        SELECT 'LOW_STOCK', local_item.id::text, 2, current_date,
          'Stock faible', item_row.nom || ' : ' || local_item.quantity || ' ' || coalesce(item_row.unite, 'unite')
        FROM public.business_location_inventory_items local_item
        JOIN public.inventory_items item_row ON item_row.id = local_item.inventory_item_id
        WHERE v_stock_access AND local_item.business_location_id = p_location_id
          AND local_item.reorder_level IS NOT NULL AND local_item.quantity <= local_item.reorder_level
        UNION ALL
        SELECT 'WALLET', wallet_row.id::text, 1, current_date,
          CASE WHEN wallet_row.balance < 0 THEN 'Wallet negatif' ELSE 'Wallet vide' END,
          wallet_row.name || ' : ' || wallet_row.balance || ' FCFA'
        FROM public.business_location_wallets mapping_row
        JOIN public.wallets wallet_row ON wallet_row.id = mapping_row.wallet_id
        WHERE v_financial_access AND mapping_row.business_location_id = p_location_id
          AND mapping_row.is_active AND wallet_row.balance <= 0
        UNION ALL
        SELECT 'INVENTORY_COUNT', count_row.id::text, 2, count_row.opened_at::date,
          'Inventaire ouvert', count_row.count_number || ' : a completer'
        FROM public.commerce_inventory_counts count_row
        WHERE v_stock_access AND count_row.business_location_id = p_location_id AND count_row.status = 'OPEN'
        UNION ALL
        SELECT 'STOCK_TRANSFER', transfer_row.id::text, 2, COALESCE(transfer_row.dispatched_at, transfer_row.created_at)::date,
          'Transfert en transit a receptionner', transfer_row.transfer_number
        FROM public.commerce_stock_transfers transfer_row
        WHERE v_stock_access AND transfer_row.destination_location_id = p_location_id AND transfer_row.status = 'DISPATCHED'
        UNION ALL
        SELECT 'REFUNDABLE_CREDIT', sale_row.id::text, 2, sale_row.sale_date,
          'Credit client a rembourser', sale_row.sale_number || ' : ' || public._internal_commerce_sale_refundable_credit(sale_row.id) || ' FCFA'
        FROM public.commercial_sales sale_row
        WHERE v_financial_access AND sale_row.business_location_id = p_location_id
          AND sale_row.status = 'CONFIRMED' AND sale_row.sale_date BETWEEN p_from AND p_to
          AND EXISTS (SELECT 1 FROM public.commerce_sale_returns r WHERE r.sale_id = sale_row.id)
          AND public._internal_commerce_sale_refundable_credit(sale_row.id) > 0
      ) attention_row
    ), '[]'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(to_jsonb(timeline_row) ORDER BY timeline_row."occurredAt" DESC)
      FROM (
        SELECT 'SALE'::text AS type, sale_row.id::text AS id, sale_row.created_at AS "occurredAt",
          sale_row.sale_number AS title, sale_row.status AS status,
          CASE WHEN v_financial_access THEN COALESCE(sum(line_row.line_total), 0)::text || ' FCFA' ELSE NULL END AS detail
        FROM public.commercial_sales sale_row
        LEFT JOIN public.commercial_sale_lines line_row ON line_row.sale_id = sale_row.id
        WHERE sale_row.business_location_id = p_location_id AND sale_row.sale_date BETWEEN p_from AND p_to
        GROUP BY sale_row.id
        UNION ALL
        SELECT 'EXPENSE', expense_row.id::text, expense_row.created_at,
          expense_row.description, expense_row.status,
          CASE WHEN v_expenses_read_access THEN expense_row.amount::text || ' FCFA' ELSE NULL END
        FROM public.commerce_store_expenses expense_row
        WHERE v_expenses_read_access AND expense_row.business_location_id = p_location_id
          AND expense_row.expense_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'REMITTANCE', remittance_row.id::text, remittance_row.created_at,
          coalesce(remittance_row.reference, 'Versement caisse'), remittance_row.status,
          CASE WHEN v_cash_access THEN remittance_row.amount::text || ' FCFA' ELSE NULL END
        FROM public.commerce_cash_remittances remittance_row
        WHERE v_cash_access AND remittance_row.business_location_id = p_location_id
          AND remittance_row.remittance_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'STOCK_RECEIPT', movement_row.id::text, movement_row.created_at,
          coalesce(movement_row.reference, 'Reception stock'), movement_row.status,
          item_row.nom || ' x ' || movement_row.quantity
        FROM public.stock_movements movement_row
        JOIN public.inventory_items item_row ON item_row.id = movement_row.inventory_item_id
        WHERE v_stock_access AND movement_row.business_location_id = p_location_id
          AND movement_row.movement_type = 'PURCHASE' AND movement_row.movement_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT CASE WHEN closure_row.status = 'REVIEW_REQUIRED' THEN 'CASH_DIFFERENCE' ELSE 'CASH_CLOSURE' END,
          closure_row.id::text, closure_row.closed_at_device,
          'Cloture ' || closure_row.cash_session_id, closure_row.status,
          CASE WHEN v_cash_access THEN closure_row.server_difference::text || ' FCFA' ELSE NULL END
        FROM public.commerce_pos_cash_session_closures closure_row
        WHERE v_cash_access AND closure_row.business_location_id = p_location_id
          AND closure_row.closed_at_device::date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'POS_SYNC', receipt_row.id::text, receipt_row.received_at_server,
          receipt_row.offline_sale_id, receipt_row.status, receipt_row.error_message
        FROM public.commerce_pos_offline_receipts receipt_row
        WHERE v_cash_access AND receipt_row.business_location_id = p_location_id
          AND receipt_row.received_at_server::date BETWEEN p_from AND p_to
        ORDER BY "occurredAt" DESC
        LIMIT 150
      ) timeline_row
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.business_locations location_row
  JOIN public.business_units unit_row ON unit_row.id = location_row.business_unit_id
  WHERE location_row.id = p_location_id AND unit_row.code = 'COMMERCE';

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Magasin Commerce introuvable.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$function$
