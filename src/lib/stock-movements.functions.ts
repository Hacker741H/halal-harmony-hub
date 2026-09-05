import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type StockMovement = Tables<"stock_movements">;

const stockMovementIdSchema = z.string().uuid();
const movementTypeSchema = z.enum([
  "PURCHASE",
  "SALE",
  "IN",
  "OUT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "LOSS",
  "TRANSFER",
]);
const nullableTextSchema = z.string().trim().nullable();

const stockMovementObjectSchema = z
  .object({
    inventory_item_id: z.string().uuid(),
    movement_type: movementTypeSchema,
    quantity: z.number().finite().positive(),
    unit_price: z.number().finite().min(0).nullable(),
    wallet_id: z.string().uuid().nullable(),
    movement_date: z.string().date(),
    supplier: nullableTextSchema,
    client: nullableTextSchema,
    reference: nullableTextSchema,
    description: nullableTextSchema,
  })
  .strict();

function validateStockMovement(
  value: z.infer<typeof stockMovementObjectSchema>,
  context: z.RefinementCtx,
) {
  const isFinancial =
    value.movement_type === "PURCHASE" || value.movement_type === "SALE";

  if (isFinancial && !value.wallet_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Un wallet est obligatoire pour un achat ou une vente.",
      path: ["wallet_id"],
    });
  }

  if (isFinancial && (value.unit_price === null || value.unit_price <= 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Le prix unitaire doit être strictement positif.",
      path: ["unit_price"],
    });
  }

  if (!isFinancial && value.wallet_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Un mouvement physique non financier ne doit pas sélectionner de wallet.",
      path: ["wallet_id"],
    });
  }
}

const stockMovementValuesSchema = stockMovementObjectSchema
  .superRefine((value, context) => {
    validateStockMovement(value, context);
  });

// Hard cap: stock_movements is explicitly expected to grow to thousands of
// rows and both queries below previously fetched the entire table/item
// history unbounded. Ordered by most recent first, so the cap always keeps
// the currently-relevant rows. Real server-side pagination (page controls)
// is the recommended follow-up if a screen needs to browse past this
// window; this cap exists to close the unbounded-growth risk now.
const STOCK_MOVEMENTS_HARD_CAP = 500;

export const getStockMovements = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("stock_movements")
      .select("*")
      .order("movement_date", { ascending: false })
      .range(0, STOCK_MOVEMENTS_HARD_CAP - 1);

    if (error) throw error;

    return data ?? [];
  });

export const createStockMovement = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(stockMovementValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: movement, error } = await context.supabase.rpc(
      "create_stock_movement_with_finance",
      { p_movement: data },
    );

    if (error) throw error;
    if (!movement) throw new Error("Le mouvement de stock n'a pas été créé.");

    return movement;
  });

export const cancelStockMovement = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: stockMovementIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: cancelled, error } = await context.supabase.rpc(
      "cancel_stock_movement_with_finance",
      { p_movement_id: data.id },
    );

    if (error) throw error;

    return cancelled;
  });
