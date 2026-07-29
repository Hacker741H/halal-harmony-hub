import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { FinanceService, FINANCE_MODULES, FINANCE_OPERATION_TYPES } from "@/lib/finance.service";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type FinanceOperation = Tables<"finance_operations">;
export type FinanceOperationInsert = TablesInsert<"finance_operations">;
export type FinanceOperationUpdate = TablesUpdate<"finance_operations">;
export type FinanceOperationWithWallets = FinanceOperation & {
  wallet: Pick<Tables<"wallets">, "id" | "name" | "type" | "color"> | null;
  destination_wallet: Pick<Tables<"wallets">, "id" | "name" | "type" | "color"> | null;
};

const financeOperationIdSchema = z.string().uuid();
const walletIdSchema = z.string().uuid();
const nullableTextSchema = z.string().nullable();
const nullableIdSchema = z.string().uuid().nullable();
const financeTypeSchema = z.enum(FINANCE_OPERATION_TYPES);

const financeOperationValuesSchema = z
  .object({
    amount: z.number().finite().positive(),
    attachment_url: nullableTextSchema.optional(),
    category: nullableTextSchema.optional(),
    client: nullableTextSchema.optional(),
    contract_id: nullableIdSchema.optional(),
    description: nullableTextSchema.optional(),
    destination_wallet_id: walletIdSchema.nullable().optional(),
    driver_id: nullableIdSchema.optional(),
    employee: nullableTextSchema.optional(),
    employee_id: nullableIdSchema.optional(),
    farm_id: nullableIdSchema.optional(),
    harvest_id: nullableIdSchema.optional(),
    inventory_item_id: nullableIdSchema.optional(),
    maintenance_id: nullableIdSchema.optional(),
    module: nullableTextSchema.optional(),
    module_id: nullableIdSchema.optional(),
    motorcycle_id: nullableIdSchema.optional(),
    motorcycle_maintenance_id: nullableIdSchema.optional(),
    notes: nullableTextSchema.optional(),
    operation_date: z.string().date(),
    origin: nullableTextSchema.optional(),
    payment_method: nullableTextSchema.optional(),
    payment_reference: nullableTextSchema.optional(),
    project: nullableTextSchema.optional(),
    reference: nullableTextSchema.optional(),
    status: nullableTextSchema.optional(),
    supplier: nullableTextSchema.optional(),
    type: financeTypeSchema,
    vehicle_id: nullableIdSchema.optional(),
    wallet_id: walletIdSchema,
  })
  .strict();

export type FinanceOperationValues = z.infer<typeof financeOperationValuesSchema>;

const financeLinkSchema = z
  .object({
    module: z.enum(FINANCE_MODULES),
    module_record_id: z.string().uuid(),
  })
  .strict();

const createFinanceOperationSchema = z
  .object({
    operation: financeOperationValuesSchema,
    link: financeLinkSchema.optional(),
  })
  .strict();

const updateFinanceOperationSchema = z
  .object({
    id: financeOperationIdSchema,
    values: financeOperationValuesSchema.partial(),
  })
  .strict()
  .refine(
    ({ values }) => Object.keys(values).length > 0,
    "Au moins une propriété doit être mise à jour.",
  );

const financeOperationSelect = `
    *,
    wallet:wallets!finance_operations_wallet_id_fkey(
      id,
      name,
      type,
      color
    ),
    destination_wallet:wallets!finance_operations_destination_wallet_id_fkey(
      id,
      name,
      type,
      color
    )
  ` as const;

export const getFinanceOperations = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select(financeOperationSelect)
      .order("operation_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getFinanceOperationsByType = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(financeTypeSchema)
  .handler(async ({ context, data: type }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select(financeOperationSelect)
      .eq("type", type)
      .order("operation_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getFinanceOperationsByWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(walletIdSchema)
  .handler(async ({ context, data: walletId }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select(financeOperationSelect)
      .or(`wallet_id.eq.${walletId},destination_wallet_id.eq.${walletId}`)
      .order("operation_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getFinanceOperationsByFarm = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(z.string().uuid())
  .handler(async ({ context, data: farmId }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select(financeOperationSelect)
      .eq("farm_id", farmId)
      .order("operation_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const createFinanceOperation = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(createFinanceOperationSchema)
  .handler(async ({ context, data }) => {
    const service = new FinanceService(context.supabase);

    return service.createOperation(data.operation, data.link);
  });

export const updateFinanceOperation = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateFinanceOperationSchema)
  .handler(async ({ context, data }) => {
    const service = new FinanceService(context.supabase);

    return service.updateOperation(data.id, data.values);
  });

export const deleteFinanceOperation = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: financeOperationIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const service = new FinanceService(context.supabase);

    return service.deleteOperation(data.id);
  });

export const getFinanceStats = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("finance_operations")
      .select("type, amount");

    if (error) throw error;

    const operations = data ?? [];
    const totalFor = (type: (typeof FINANCE_OPERATION_TYPES)[number]) =>
      operations
        .filter((operation) => operation.type === type)
        .reduce((sum, operation) => sum + Number(operation.amount), 0);

    const recettes = totalFor("REVENUE");
    const depenses = totalFor("EXPENSE");
    const versements = totalFor("DEPOSIT");
    const transferts = totalFor("TRANSFER");

    return {
      totalOperations: operations.length,
      recettes,
      depenses,
      versements,
      transferts,
      resultat: recettes - depenses,
    };
  });

export const getTreasury = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("wallets").select("balance");

    if (error) throw error;

    return (data ?? []).reduce((sum, wallet) => sum + Number(wallet.balance ?? 0), 0);
  });
