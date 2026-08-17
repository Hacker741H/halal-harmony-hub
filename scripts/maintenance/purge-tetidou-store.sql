-- ============================================================
-- ADMIN SCRIPT (not a migration): permanently deletes MAGASIN TETIDOU, a
-- test store, and every row exclusively tied to it. See
-- scripts/maintenance/tetidou-purge-backup-manifest.json for the audit
-- trace captured before running this.
--
-- Ends with ROLLBACK by default -- this is a dry run that exercises the
-- real DELETE logic transactionally without keeping any of it. To execute
-- for real, change the final ROLLBACK to COMMIT and re-run. Never edit the
-- identity/pre-condition asserts below to make them pass -- if they fail,
-- the data has changed since the audit and the audit must be redone
-- instead.
-- ============================================================

BEGIN;

DO $purge$
DECLARE
  v_location_id uuid := 'ea6525b1-1a39-407d-b5c8-0c9c1d75fce9';
  v_wallet_id uuid := '4e5f06e0-359d-45a7-aeda-6253ccf7e142';
  v_item_id uuid := '9674bf77-f1e4-4355-a684-b7623e1a4dd2';
  v_text text;
  v_count integer;
  v_notification_ids uuid[];
BEGIN
  ------------------------------------------------------------------
  -- IDENTITY ASSERTIONS -- abort immediately if this is not exactly the
  -- store audited (name column is intentionally NOT checked: it reads
  -- "ACCESSOIRES ET SERVICES TELEPHONE", not "MAGASIN TETIDOU" -- identity
  -- was proven via code + linked wallet name instead, see manifest).
  ------------------------------------------------------------------
  SELECT code INTO v_text FROM public.business_locations WHERE id = v_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: business_location % no longer exists.', v_location_id; END IF;
  IF v_text IS DISTINCT FROM 'MAGASIN_TETIDOU' THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: business_locations.code is not MAGASIN_TETIDOU (got %). Aborting.', v_text;
  END IF;

  SELECT name INTO v_text FROM public.wallets WHERE id = v_wallet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: wallet % no longer exists.', v_wallet_id; END IF;
  IF v_text IS DISTINCT FROM 'MAGASIN TETIDOU' THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: wallets.name is not MAGASIN TETIDOU (got %). Aborting.', v_text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.business_location_wallets WHERE business_location_id = v_location_id AND wallet_id = v_wallet_id) THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: wallet is not linked to this business_location. Aborting.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_location_wallets WHERE wallet_id = v_wallet_id AND business_location_id <> v_location_id) THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: wallet is linked to ANOTHER business_location too -- not exclusive, would need manual review. Aborting.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_location_inventory_items WHERE inventory_item_id = v_item_id AND business_location_id <> v_location_id) THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: inventory_item % is now stocked at another location -- do not delete the catalogue row. Aborting.', v_item_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_sale_lines csl JOIN public.commercial_sales cs ON cs.id = csl.sale_id WHERE csl.inventory_item_id = v_item_id AND cs.business_location_id IS DISTINCT FROM v_location_id) THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: inventory_item % is now sold from another location -- do not delete the catalogue row. Aborting.', v_item_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_sales WHERE business_location_id = v_location_id AND client_id IS NOT NULL) THEN
    RAISE EXCEPTION 'IDENTITY_CHECK_FAILED: a TETIDOU sale now references a real client -- re-audit before purging (client protection logic assumed none).';
  END IF;

  ------------------------------------------------------------------
  -- PRE-CONDITION COUNT CHECKS -- must match the audited snapshot exactly.
  -- If any of these fail, the data has changed since the audit: STOP and
  -- redo the audit, do not adjust these numbers to make the script pass.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.commercial_sales WHERE business_location_id = v_location_id; IF v_count <> 9 THEN RAISE EXCEPTION 'COUNT_DRIFT: commercial_sales expected 9, found %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_purchases WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'COUNT_DRIFT: commerce_purchases expected 0, found %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_stock_transfers WHERE source_location_id = v_location_id OR destination_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'COUNT_DRIFT: commerce_stock_transfers expected 0, found %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_sale_returns WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'COUNT_DRIFT: commerce_sale_returns expected 0, found %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_sale_refunds WHERE wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'COUNT_DRIFT: commerce_sale_refunds expected 0, found %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_store_expenses WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'COUNT_DRIFT: commerce_store_expenses expected 0, found %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id; IF v_count <> 11 THEN RAISE EXCEPTION 'COUNT_DRIFT: finance_operations expected 11, found %.', v_count; END IF;
  -- inventory_item_id is included here too: one legacy row (movement_type
  -- 'IN', business_location_id and wallet_id both NULL, predating the
  -- location-scoped stock model) only shows up via the item, not the
  -- location/wallet -- found by the FK constraint on the first dry run.
  SELECT count(*) INTO v_count FROM public.stock_movements WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id OR inventory_item_id = v_item_id; IF v_count <> 11 THEN RAISE EXCEPTION 'COUNT_DRIFT: stock_movements expected 11, found %.', v_count; END IF;

  RAISE NOTICE 'All identity and pre-condition checks passed. Proceeding.';

  ------------------------------------------------------------------
  -- Capture notification ids before removing their wallet links, so we can
  -- delete the notifications themselves afterwards -- but only the ones
  -- that end up with zero remaining wallet links (i.e. truly exclusive).
  ------------------------------------------------------------------
  SELECT array_agg(notification_id) INTO v_notification_ids FROM public.notification_wallet_links WHERE wallet_id = v_wallet_id;

  ------------------------------------------------------------------
  -- ORDER: children -> links -> events -> transactions -> stock/location
  -- state -> exclusive wallet/catalogue -> mappings -> business_location.
  -- No FK is disabled and session_replication_role is never touched: if
  -- this order is wrong anywhere, Postgres raises immediately and nothing
  -- commits.
  ------------------------------------------------------------------

  -- Leaves / links / events --
  DELETE FROM public.commercial_sale_line_costs WHERE sale_line_id IN (SELECT id FROM public.commercial_sale_lines WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id));
  DELETE FROM public.commercial_sale_stock_movement_links WHERE sale_line_id IN (SELECT id FROM public.commercial_sale_lines WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id)) OR stock_movement_id IN (SELECT id FROM public.stock_movements WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id OR inventory_item_id = v_item_id);
  DELETE FROM public.commerce_inventory_cost_events WHERE business_location_id = v_location_id;
  DELETE FROM public.business_finance_audit WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_commerce_cash_remittance_links WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_commercial_invoice_payment_links WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_commercial_refund_links WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_commerce_store_expense_links WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_supplier_payment_links WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_links WHERE finance_operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.finance_stock_movement_links WHERE operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id) OR stock_movement_id IN (SELECT id FROM public.stock_movements WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id OR inventory_item_id = v_item_id);
  DELETE FROM public.notification_wallet_links WHERE wallet_id = v_wallet_id;
  DELETE FROM public.notifications n WHERE n.id = ANY(v_notification_ids) AND NOT EXISTS (SELECT 1 FROM public.notification_wallet_links l WHERE l.notification_id = n.id);
  DELETE FROM public.business_location_inventory_item_price_history WHERE business_location_id = v_location_id;
  DELETE FROM public.commerce_cash_remittance_closures WHERE remittance_id IN (SELECT id FROM public.commerce_cash_remittances WHERE business_location_id = v_location_id OR source_wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id) OR closure_id IN (SELECT id FROM public.commerce_pos_cash_session_closures WHERE business_location_id = v_location_id);
  DELETE FROM public.commerce_inventory_count_lines WHERE count_id IN (SELECT id FROM public.commerce_inventory_counts WHERE business_location_id = v_location_id) OR stock_movement_id IN (SELECT id FROM public.stock_movements WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id OR inventory_item_id = v_item_id);
  DELETE FROM public.document_commercial_sale_links WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id);
  DELETE FROM public.payment_events WHERE commercial_payment_id IN (SELECT id FROM public.commercial_invoice_payments WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id) OR wallet_id = v_wallet_id) OR commercial_invoice_id IN (SELECT id FROM public.commercial_invoices WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id)) OR finance_operation_id IN (SELECT id FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id);
  DELETE FROM public.payment_provider_payment_requests WHERE commercial_payment_id IN (SELECT id FROM public.commercial_invoice_payments WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id) OR wallet_id = v_wallet_id) OR wallet_id = v_wallet_id;
  DELETE FROM public.payment_provider_wallet_mappings WHERE wallet_id = v_wallet_id;

  -- Transactions --
  DELETE FROM public.commercial_sale_lines WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id);
  DELETE FROM public.commercial_invoice_payments WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id) OR wallet_id = v_wallet_id;
  DELETE FROM public.commerce_sale_refunds WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id) OR wallet_id = v_wallet_id;
  DELETE FROM public.commerce_cash_remittances WHERE business_location_id = v_location_id OR source_wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id;
  DELETE FROM public.commerce_pos_control_reports WHERE business_location_id = v_location_id;
  DELETE FROM public.commerce_purchase_lines WHERE purchase_id IN (SELECT id FROM public.commerce_purchases WHERE business_location_id = v_location_id);
  DELETE FROM public.commerce_supplier_payments WHERE purchase_id IN (SELECT id FROM public.commerce_purchases WHERE business_location_id = v_location_id) OR wallet_id = v_wallet_id;
  DELETE FROM public.commerce_stock_transfer_lines WHERE transfer_id IN (SELECT id FROM public.commerce_stock_transfers WHERE source_location_id = v_location_id OR destination_location_id = v_location_id);

  DELETE FROM public.commercial_invoices WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id);
  DELETE FROM public.commerce_pos_cash_session_closures WHERE business_location_id = v_location_id;
  DELETE FROM public.commerce_pos_offline_receipts WHERE business_location_id = v_location_id;
  DELETE FROM public.commerce_purchases WHERE business_location_id = v_location_id;
  DELETE FROM public.commerce_sale_returns WHERE business_location_id = v_location_id OR sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id);
  DELETE FROM public.commerce_stock_transfers WHERE source_location_id = v_location_id OR destination_location_id = v_location_id;
  DELETE FROM public.commerce_store_expenses WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id;
  DELETE FROM public.commerce_store_planned_expenses WHERE business_location_id = v_location_id;

  -- Stock / location state --
  DELETE FROM public.commerce_inventory_counts WHERE business_location_id = v_location_id;
  DELETE FROM public.stock_movements WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id OR inventory_item_id = v_item_id;
  DELETE FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id;

  DELETE FROM public.commercial_sales WHERE business_location_id = v_location_id;
  DELETE FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_id;
  DELETE FROM public.business_location_inventory_items WHERE business_location_id = v_location_id;

  -- Exclusive wallet / catalogue --
  DELETE FROM public.business_location_wallets WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id;
  DELETE FROM public.wallets WHERE id = v_wallet_id;
  DELETE FROM public.inventory_items WHERE id = v_item_id;

  -- Mappings --
  DELETE FROM public.business_location_assignments WHERE business_location_id = v_location_id;

  -- The business_location itself --
  DELETE FROM public.business_locations WHERE id = v_location_id;

  ------------------------------------------------------------------
  -- ZERO-RESIDUE VERIFICATION -- every table that could reference the
  -- target ids must now report zero, or the transaction aborts.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.business_locations WHERE id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: business_locations still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.wallets WHERE id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: wallets still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.inventory_items WHERE id = v_item_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: inventory_items still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.business_location_assignments WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: business_location_assignments still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.business_location_wallets WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: business_location_wallets still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.business_location_inventory_items WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: business_location_inventory_items still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.business_location_inventory_item_price_history WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: price_history still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commercial_sales WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commercial_sales still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commercial_sale_lines csl JOIN public.commercial_sales cs ON cs.id = csl.sale_id WHERE cs.business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commercial_sale_lines still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commercial_invoices WHERE sale_id IN (SELECT id FROM public.commercial_sales WHERE business_location_id = v_location_id); IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commercial_invoices still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commercial_invoice_payments WHERE wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commercial_invoice_payments still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements WHERE business_location_id = v_location_id OR wallet_id = v_wallet_id OR inventory_item_id = v_item_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: stock_movements still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.finance_operations WHERE wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: finance_operations still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_pos_cash_session_closures WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commerce_pos_cash_session_closures still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_pos_control_reports WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commerce_pos_control_reports still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_cash_remittances WHERE business_location_id = v_location_id OR source_wallet_id = v_wallet_id OR destination_wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commerce_cash_remittances still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_inventory_counts WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commerce_inventory_counts still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_inventory_cost_states WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commerce_inventory_cost_states still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.commerce_inventory_cost_events WHERE business_location_id = v_location_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: commerce_inventory_cost_events still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notification_wallet_links WHERE wallet_id = v_wallet_id; IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: notification_wallet_links still has %.', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE id = ANY(v_notification_ids); IF v_count <> 0 THEN RAISE EXCEPTION 'RESIDUE: notifications still has %.', v_count; END IF;

  RAISE NOTICE 'TETIDOU_PURGE_COMPLETE: business_location %, wallet %, item % and all exclusive dependents removed. Zero residue confirmed.', v_location_id, v_wallet_id, v_item_id;
END;
$purge$;

-- EXECUTE MODE: verified clean dry run (2026-08-17) -- committing for real.
COMMIT;
