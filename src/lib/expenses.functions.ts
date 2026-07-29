import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { FinanceService } from "@/lib/finance.service";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type Expense = Tables<"finance_operations">;

const expenseIdSchema = z.string().uuid();
const expenseValuesSchema = z
  .object({
    amount: z.number().finite().positive(),
    category: z.string().trim().min(1),
    description: z.string().nullable(),
    farm_id: z.string().uuid(),
    operation_date: z.string().date(),
    supplier: z.string().nullable(),
    wallet_id: z.string().uuid(),
  })
  .strict();

const updateExpenseSchema = z
  .object({
    id: expenseIdSchema,
    values: expenseValuesSchema.partial(),
  })
  .strict()
  .refine(
    ({ values }) => Object.keys(values).length > 0,
    "Au moins une propriété doit être mise à jour.",
  );

export const getExpenses = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("type", "EXPENSE")
      .order("operation_date", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getExpensesByFarm = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(z.string().uuid())
  .handler(async ({ context, data: farmId }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("type", "EXPENSE")
      .eq("farm_id", farmId)
      .order("operation_date", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const createExpense = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(expenseValuesSchema)
  .handler(async ({ context, data }) => {
    const service = new FinanceService(context.supabase);

    return service.createExpense(
      {
        ...data,
        module: "EXPLOITATION",
        module_id: data.farm_id,
      },
      {
        module: "EXPLOITATION",
        module_record_id: data.farm_id,
      },
    );
  });

export const updateExpense = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateExpenseSchema)
  .handler(async ({ context, data }) => {
    const service = new FinanceService(context.supabase);

    return service.updateOperation(data.id, data.values);
  });

export const deleteExpense = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: expenseIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const service = new FinanceService(context.supabase);

    return service.deleteOperation(data.id);
  });
