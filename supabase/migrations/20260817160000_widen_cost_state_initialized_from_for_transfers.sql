-- GFC V1 Phase 4D -- fixes a FOURTH bug caught by the same E2E test run, on a
-- different table this time: commerce_inventory_cost_states_initialized_from_check
-- only allowed OPENING/PURCHASE. receive_commerce_stock_transfer self-initializes
-- a destination cost-state row (initialized_from='TRANSFER') the first time a
-- store receives an item it never held before -- widened to allow that value.

ALTER TABLE public.commerce_inventory_cost_states DROP CONSTRAINT commerce_inventory_cost_states_initialized_from_check;
ALTER TABLE public.commerce_inventory_cost_states ADD CONSTRAINT commerce_inventory_cost_states_initialized_from_check CHECK (
  initialized_from = ANY (ARRAY['OPENING'::text, 'PURCHASE'::text, 'TRANSFER'::text])
);
