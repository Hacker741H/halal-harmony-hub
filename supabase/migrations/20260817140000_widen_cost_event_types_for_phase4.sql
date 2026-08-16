-- GFC V1 Phase 4D -- fixes a second bug in the just-applied Phase 4B/4C
-- migrations, caught by the same E2E test run: commerce_cost_event_
-- one_source hard-codes event_type to exactly OPENING/PURCHASE/SALE (found
-- only once the actual INSERT was attempted -- information_schema.columns
-- had not revealed this value-based CHECK earlier). Widened to also accept
-- ADJUSTMENT_SURPLUS/ADJUSTMENT_DEFICIT/TRANSFER_OUT/TRANSFER_IN, all
-- shaped exactly like PURCHASE (stock_movement_id required, sale_line_id
-- never set) -- every one of these events is always tied to a real
-- stock_movements row, never to a sale line.

ALTER TABLE public.commerce_inventory_cost_events DROP CONSTRAINT commerce_cost_event_one_source;
ALTER TABLE public.commerce_inventory_cost_events ADD CONSTRAINT commerce_cost_event_one_source CHECK (
  (event_type = 'OPENING' AND stock_movement_id IS NULL AND sale_line_id IS NULL AND justification IS NOT NULL AND btrim(justification) <> '' AND approval_actor IS NOT NULL AND btrim(approval_actor::text) <> '')
  OR (event_type IN ('PURCHASE', 'ADJUSTMENT_SURPLUS', 'ADJUSTMENT_DEFICIT', 'TRANSFER_OUT', 'TRANSFER_IN') AND stock_movement_id IS NOT NULL AND sale_line_id IS NULL)
  OR (event_type = 'SALE' AND stock_movement_id IS NOT NULL AND sale_line_id IS NOT NULL)
);
