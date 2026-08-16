-- GFC V1 Phase 4D -- fixes a THIRD, separate bug caught by the same E2E test
-- run: commerce_inventory_cost_events_event_type_check is a second, distinct
-- CHECK constraint on the same event_type column, independent of
-- commerce_cost_event_one_source (already widened in migration 20260817140000).
-- Neither information_schema.columns nor the first failing INSERT revealed
-- this one -- only a full unfiltered pg_constraint listing for the table did.
-- Widened to the same 4 new event types for the same reason: every one of
-- these events is always tied to a real stock_movements row, never a sale
-- line, exactly like PURCHASE.

ALTER TABLE public.commerce_inventory_cost_events DROP CONSTRAINT commerce_inventory_cost_events_event_type_check;
ALTER TABLE public.commerce_inventory_cost_events ADD CONSTRAINT commerce_inventory_cost_events_event_type_check CHECK (
  event_type = ANY (ARRAY['OPENING'::text, 'PURCHASE'::text, 'SALE'::text, 'ADJUSTMENT_SURPLUS'::text, 'ADJUSTMENT_DEFICIT'::text, 'TRANSFER_OUT'::text, 'TRANSFER_IN'::text])
);
