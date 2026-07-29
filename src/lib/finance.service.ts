import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export const FINANCE_MODULES = [
  "VEHICLE",
  "MOTO",
  "EMPLOYEE",
  "DRIVER",
  "STOCK",
  "CONTRACT",
  "EXPLOITATION",
  "HARVEST",
  "VEHICLE_MAINTENANCE",
  "MOTORCYCLE_MAINTENANCE",
  "DOCUMENT",
  "OTHER",
] as const;

export type FinanceModule = (typeof FINANCE_MODULES)[number];

export const FINANCE_OPERATION_TYPES = [
  "REVENUE",
  "EXPENSE",
  "DEPOSIT",
  "TRANSFER",
] as const;

export type FinanceOperationType = (typeof FINANCE_OPERATION_TYPES)[number];

export type FinanceOperationInput = Omit<
  TablesInsert<"finance_operations">,
  "id" | "type"
> & {
  type: FinanceOperationType;
};

export type FinanceOperationUpdateInput = Omit<
  TablesUpdate<"finance_operations">,
  "type"
> & {
  type?: FinanceOperationType;
};

export type FinanceLinkInput = {
  module: FinanceModule;
  module_record_id: string;
};

type Supabase = SupabaseClient<Database>;
type FinanceOperation = Tables<"finance_operations">;

function toJsonPayload(values: Record<string, unknown>): Json {
  const payload: { [key: string]: Json | undefined } = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      payload[key] = value;
      continue;
    }

    throw new Error(`Valeur financière non sérialisable : ${key}.`);
  }

  return payload;
}

export class FinanceService {
  constructor(private readonly supabase: Supabase) {}

  async recalculateWalletBalance(walletId: string) {
    const { error } = await this.supabase.rpc("update_wallet_balance", {
      p_wallet_id: walletId,
    });

    if (error) throw error;
  }

  async createOperation(
    input: FinanceOperationInput,
    link?: FinanceLinkInput,
  ): Promise<FinanceOperation> {
    const { data, error } = await this.supabase.rpc("finance_create_operation", {
      p_operation: toJsonPayload(input),
      p_link_module: link?.module,
      p_link_record_id: link?.module_record_id,
    });

    if (error) throw error;
    if (!data) throw new Error("La création de l'opération n'a retourné aucun résultat.");

    return data;
  }

  createRevenue(
    input: Omit<FinanceOperationInput, "type">,
    link?: FinanceLinkInput,
  ) {
    return this.createOperation({ ...input, type: "REVENUE" }, link);
  }

  createExpense(
    input: Omit<FinanceOperationInput, "type">,
    link?: FinanceLinkInput,
  ) {
    return this.createOperation({ ...input, type: "EXPENSE" }, link);
  }

  createDeposit(
    input: Omit<FinanceOperationInput, "type">,
    link?: FinanceLinkInput,
  ) {
    return this.createOperation({ ...input, type: "DEPOSIT" }, link);
  }

  createTransfer(
    input: Omit<FinanceOperationInput, "type">,
    link?: FinanceLinkInput,
  ) {
    return this.createOperation({ ...input, type: "TRANSFER" }, link);
  }

  async updateOperation(
    financeOperationId: string,
    values: FinanceOperationUpdateInput,
  ): Promise<FinanceOperation> {
    const { data, error } = await this.supabase.rpc("finance_update_operation", {
      p_operation_id: financeOperationId,
      p_values: toJsonPayload(values),
    });

    if (error) throw error;
    if (!data) throw new Error("La mise à jour de l'opération n'a retourné aucun résultat.");

    return data;
  }

  async deleteOperation(financeOperationId: string) {
    const { data, error } = await this.supabase.rpc("finance_delete_operation", {
      p_operation_id: financeOperationId,
    });

    if (error) throw error;
    if (!data) throw new Error("La suppression de l'opération a échoué.");

    return data;
  }
}
