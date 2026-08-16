-- GFC V1 Phase 4 -- Inventaires/Transferts. TRANSFER exists as an enum
-- value but is dead (stock_movement_delta returns 0 for it, nothing ever
-- inserts one meaningfully). Rather than overload that single ambiguous
-- value for both legs of a transfer, add two explicit, correctly-signed
-- types: TRANSFER_OUT (source, negative) and TRANSFER_IN (destination,
-- positive). TRANSFER itself is left in place, unused, for backward
-- compatibility -- additive only.

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY[
    'PURCHASE'::text, 'SALE'::text, 'IN'::text, 'OUT'::text,
    'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'LOSS'::text, 'TRANSFER'::text,
    'TRANSFER_OUT'::text, 'TRANSFER_IN'::text
  ]));

CREATE OR REPLACE FUNCTION public.stock_movement_delta(p_movement_type text, p_quantity numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  CASE p_movement_type
    WHEN 'PURCHASE', 'IN', 'ADJUSTMENT_IN', 'TRANSFER_IN' THEN RETURN p_quantity;
    WHEN 'SALE', 'OUT', 'ADJUSTMENT_OUT', 'LOSS', 'TRANSFER_OUT' THEN RETURN -p_quantity;
    WHEN 'TRANSFER' THEN RETURN 0;
    ELSE RAISE EXCEPTION 'Type de mouvement de stock invalide : %', p_movement_type USING ERRCODE = '22023';
  END CASE;
END;
$function$;

-- Also widen the stock_movements_check constraint from Phase 3
-- (PURCHASE/SALE require unit_price+wallet rules; everything else must
-- have wallet_id NULL) to keep TRANSFER_OUT/TRANSFER_IN in the "no wallet"
-- bucket alongside ADJUSTMENT_IN/OUT -- these never touch Finance.
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_check CHECK (
  (movement_type = 'SALE' AND wallet_id IS NOT NULL AND unit_price IS NOT NULL AND unit_price >= 0)
  OR (movement_type = 'PURCHASE' AND unit_price IS NOT NULL AND unit_price >= 0)
  OR (movement_type NOT IN ('PURCHASE', 'SALE') AND wallet_id IS NULL)
);
