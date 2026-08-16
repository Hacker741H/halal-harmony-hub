import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";

export type CommerceSaleReturn = Tables<"commerce_sale_returns">;
export type CommerceSaleReturnLine = Tables<"commerce_sale_return_lines">;
export type CommerceSaleRefund = Tables<"commerce_sale_refunds">;

const idSchema = z.string().uuid();

export const RETURN_DISPOSITIONS = ["RESTOCK", "DAMAGED", "SCRAPPED"] as const;

const returnLineSchema = z
  .object({
    original_sale_line_id: idSchema,
    quantity_returned: z.number().finite().positive(),
    disposition: z.enum(RETURN_DISPOSITIONS).nullable(),
  })
  .strict();

const createReturnSchema = z
  .object({
    saleId: idSchema,
    reason: z.string().trim().min(3).max(2_000),
    idempotencyKey: z.string().trim().min(1).max(200),
    lines: z.array(returnLineSchema).min(1).max(100),
  })
  .strict();

const createRefundSchema = z
  .object({
    saleId: idSchema,
    walletId: idSchema,
    amount: z.number().finite().positive(),
    refundDate: z.string().date(),
    reference: z.string().trim().max(255).nullable(),
    notes: z.string().trim().max(2_000).nullable(),
  })
  .strict();

export const createCommerceSaleReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createReturnSchema)
  .handler(async ({ context, data }) => {
    const { data: saleReturn, error } = await context.supabase.rpc("create_commerce_sale_return", {
      p_return: {
        sale_id: data.saleId,
        reason: data.reason,
        idempotency_key: data.idempotencyKey,
        lines: data.lines.map((line) => ({
          original_sale_line_id: line.original_sale_line_id,
          quantity_returned: line.quantity_returned,
          disposition: line.disposition,
        })),
      } as Json,
    });
    if (error) throw error;
    if (!saleReturn) throw new Error("Le retour n’a pas été enregistré.");
    return saleReturn;
  });

export const createCommerceSaleRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createRefundSchema)
  .handler(async ({ context, data }) => {
    const { data: refund, error } = await context.supabase.rpc("create_commerce_sale_refund", {
      p_sale_id: data.saleId,
      p_refund: {
        wallet_id: data.walletId,
        amount: data.amount,
        refund_date: data.refundDate,
        reference: data.reference,
        notes: data.notes,
      } as Json,
    });
    if (error) throw error;
    if (!refund) throw new Error("Le remboursement n’a pas été enregistré.");
    return refund;
  });

export const confirmCommerceSaleRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: refund, error } = await context.supabase.rpc("confirm_commerce_sale_refund", { p_refund_id: data.id });
    if (error) throw error;
    if (!refund) throw new Error("Le remboursement n’a pas été confirmé.");
    return refund;
  });

export const cancelCommerceSaleRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: refund, error } = await context.supabase.rpc("cancel_commerce_sale_refund", {
      p_refund_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!refund) throw new Error("Le remboursement n’a pas été annulé.");
    return refund;
  });
