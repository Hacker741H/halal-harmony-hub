import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Wallet = Tables<"wallets">;
export type WalletInsert = TablesInsert<"wallets">;
export type WalletUpdate = TablesUpdate<"wallets">;

const walletIdSchema = z.string().uuid();
const walletValuesSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.string().trim().min(1),
    initial_balance: z.number().finite(),
    color: z.string(),
    icon: z.string(),
    is_default: z.boolean(),
    /** Sets this wallet as a sub-wallet of an existing parent (single level -- see convert_wallet_to_parent for turning an existing wallet WITH a balance into a parent). */
    parent_wallet_id: z.string().uuid().nullable(),
  })
  .strict();

const updateWalletSchema = z
  .object({
    id: walletIdSchema,
    values: walletValuesSchema.partial(),
  })
  .strict()
  .refine(
    ({ values }) => Object.keys(values).length > 0,
    "Au moins une propriété doit être mise à jour.",
  );

function toWalletJson(values: Record<string, string | number | boolean | null | undefined>): Json {
  const payload: { [key: string]: Json | undefined } = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

export const getWallets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("wallets")
      .select("*")
      .order("is_default", { ascending: false })
      .order("name", { ascending: true });

    if (error) throw error;
    return data ?? [];
  });

export const getWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(walletIdSchema)
  .handler(async ({ context, data }) => {
    const { data: wallet, error } = await context.supabase
      .from("wallets")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (error) throw error;
    return wallet;
  });

// Plain SELECT, permitted by the existing wallets_read RLS policy -- no RPC
// needed, children are just ordinary wallets rows with parent_wallet_id set.
export const getWalletChildren = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(walletIdSchema)
  .handler(async ({ context, data: parentWalletId }) => {
    const { data, error } = await context.supabase
      .from("wallets")
      .select("*")
      .eq("parent_wallet_id", parentWalletId)
      .order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const createWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(walletValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: wallet, error } = await context.supabase.rpc("wallet_create", {
      p_wallet: toWalletJson(data),
    });
    if (error) throw error;
    if (!wallet) throw new Error("Le wallet n'a pas été créé.");
    return wallet;
  });

export const updateWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateWalletSchema)
  .handler(async ({ context, data }) => {
    const { data: wallet, error } = await context.supabase.rpc("wallet_update", {
      p_wallet_id: data.id,
      p_values: toWalletJson(data.values),
    });
    if (error) throw error;
    if (!wallet) throw new Error("Le wallet n'a pas été mis à jour.");
    return wallet;
  });

export const deleteWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: walletIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: deleted, error } = await context.supabase.rpc("wallet_delete", {
      p_wallet_id: data.id,
    });
    if (error) throw error;
    if (!deleted) throw new Error("La suppression du wallet a échoué.");
    return deleted;
  });

export const getWalletStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("wallets").select("balance");
    if (error) throw error;

    const wallets = data ?? [];
    const totalBalance = wallets.reduce((sum, wallet) => sum + Number(wallet.balance ?? 0), 0);

    return {
      totalWallets: wallets.length,
      totalBalance,
    };
  });

export const WALLET_MODULES = ["MOTOS", "VEHICULES", "AGRICULTURE", "COMMERCE", "TRANSPORT"] as const;
export type WalletModule = (typeof WALLET_MODULES)[number];

export const WALLET_MODULE_LABELS: Record<WalletModule, string> = {
  MOTOS: "Motos",
  VEHICULES: "Véhicules",
  AGRICULTURE: "Agriculture",
  COMMERCE: "Commerce",
  TRANSPORT: "Transport",
};

export interface WalletModuleSummary {
  module: WalletModule;
  consolidatedBalance: number;
  incomingTotal: number;
  expenseTotal: number;
  subWalletCount: number;
}

export interface WalletModuleDetailRow {
  walletId: string;
  name: string;
  assetKind: string | null;
  isGeneral: boolean;
  isArchived: boolean;
  balance: number;
  incomingTotal: number;
  expenseTotal: number;
  motorcycleId: string | null;
  vehicleId: string | null;
  farmId: string | null;
}

export const getWalletModulesSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletModuleSummary[]> => {
    const { data, error } = await context.supabase.rpc("get_wallet_modules_summary");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      module: row.module as WalletModule,
      consolidatedBalance: Number(row.consolidated_balance),
      incomingTotal: Number(row.incoming_total),
      expenseTotal: Number(row.expense_total),
      subWalletCount: Number(row.sub_wallet_count),
    }));
  });

export const getWalletModuleDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.enum(WALLET_MODULES))
  .handler(async ({ context, data: module }): Promise<WalletModuleDetailRow[]> => {
    const { data, error } = await context.supabase.rpc("get_wallet_module_detail", { p_module: module });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      walletId: row.wallet_id,
      name: row.name,
      assetKind: row.asset_kind,
      isGeneral: row.is_general,
      isArchived: row.is_archived,
      balance: Number(row.balance),
      incomingTotal: Number(row.incoming_total),
      expenseTotal: Number(row.expense_total),
      motorcycleId: row.motorcycle_id,
      vehicleId: row.vehicle_id,
      farmId: row.farm_id,
    }));
  });

export const archiveWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: walletIdSchema, archived: z.boolean().default(true) }).strict())
  .handler(async ({ context, data }) => {
    const { data: wallet, error } = await context.supabase.rpc("archive_wallet", {
      p_wallet_id: data.id,
      p_archived: data.archived,
    });
    if (error) throw error;
    return wallet;
  });

// ---------------------------------------------------------------------
// Explicit, controlled conversion of an existing wallet (e.g. "Marasse")
// into a parent: the user allocates its current balance across existing
// and/or brand-new sub-wallets; every allocation becomes a real, traceable
// TRANSFER (see convert_wallet_to_parent). Never invoked automatically --
// the caller must always preview first and show it to the user.

const walletConversionAllocationSchema = z
  .union([
    z.object({ existingWalletId: z.string().uuid(), amount: z.number().positive() }).strict(),
    z.object({ newWalletName: z.string().trim().min(1), newWalletType: z.string().trim().min(1), amount: z.number().positive() }).strict(),
  ]);

const walletConversionInputSchema = z
  .object({
    walletId: walletIdSchema,
    allocations: z.array(walletConversionAllocationSchema).min(1),
  })
  .strict();

function toAllocationsJson(allocations: z.infer<typeof walletConversionInputSchema>["allocations"]): Json {
  return allocations.map((allocation) =>
    "existingWalletId" in allocation
      ? { existing_wallet_id: allocation.existingWalletId, amount: allocation.amount }
      : { new_wallet_name: allocation.newWalletName, new_wallet_type: allocation.newWalletType, amount: allocation.amount },
  ) as Json;
}

export interface WalletConversionTarget {
  existingWalletId?: string;
  newWalletName?: string;
  newWalletType?: string;
  name?: string;
  balanceBefore: number;
  balanceAfter: number;
  amount: number;
  isNew: boolean;
}

export interface WalletConversionJekoMapping {
  providerStoreId: string;
  walletId: string;
}

// A still-PENDING Jèko payment request against the wallet being converted
// -- unlike jekoMappings (the "where new checkouts land" config), this is
// an in-flight payment that would otherwise resolve to the frozen parent
// the moment it is paid. Requires the same remap as jekoMappings before
// convert_wallet_to_parent will proceed -- see the migration's
// _internal_plan_wallet_parent_conversion comment.
export interface WalletConversionJekoPendingRequest {
  providerStoreId: string;
  providerReference: string;
}

export interface WalletConversionPlan {
  walletId: string;
  walletName: string;
  balanceBefore: number;
  balanceAfter: number;
  targets: WalletConversionTarget[];
  jekoMappings: WalletConversionJekoMapping[];
  jekoPendingRequests: WalletConversionJekoPendingRequest[];
}

function toConversionPlan(row: unknown): WalletConversionPlan {
  const plan = row as {
    wallet_id: string;
    wallet_name: string;
    balance_before: number;
    balance_after: number;
    targets: Array<{
      existing_wallet_id?: string;
      new_wallet_name?: string;
      new_wallet_type?: string;
      name?: string;
      balance_before: number;
      balance_after: number;
      amount: number;
      is_new: boolean;
    }>;
    jeko_mappings: Array<{ provider_store_id: string; wallet_id: string }>;
    jeko_pending_requests?: Array<{ provider_store_id: string; provider_reference: string }>;
  };
  return {
    walletId: plan.wallet_id,
    walletName: plan.wallet_name,
    balanceBefore: Number(plan.balance_before),
    balanceAfter: Number(plan.balance_after),
    targets: plan.targets.map((target) => ({
      existingWalletId: target.existing_wallet_id,
      newWalletName: target.new_wallet_name,
      newWalletType: target.new_wallet_type,
      name: target.name,
      balanceBefore: Number(target.balance_before),
      balanceAfter: Number(target.balance_after),
      amount: Number(target.amount),
      isNew: target.is_new,
    })),
    jekoMappings: (plan.jeko_mappings ?? []).map((mapping) => ({
      providerStoreId: mapping.provider_store_id,
      walletId: mapping.wallet_id,
    })),
    jekoPendingRequests: (plan.jeko_pending_requests ?? []).map((request) => ({
      providerStoreId: request.provider_store_id,
      providerReference: request.provider_reference,
    })),
  };
}

export const previewWalletParentConversion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(walletConversionInputSchema)
  .handler(async ({ context, data }): Promise<WalletConversionPlan> => {
    const { data: plan, error } = await context.supabase.rpc("preview_wallet_parent_conversion", {
      p_wallet_id: data.walletId,
      p_allocations: toAllocationsJson(data.allocations),
    });
    if (error) throw error;
    return toConversionPlan(plan);
  });

export const convertWalletToParent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    walletConversionInputSchema.extend({
      jekoRemap: z.array(z.object({ providerStoreId: z.string(), newWalletId: z.string().uuid() }).strict()).optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<WalletConversionPlan> => {
    const { data: plan, error } = await context.supabase.rpc("convert_wallet_to_parent", {
      p_wallet_id: data.walletId,
      p_allocations: toAllocationsJson(data.allocations),
      p_jeko_remap: data.jekoRemap
        ? (data.jekoRemap.map((remap) => ({ provider_store_id: remap.providerStoreId, new_wallet_id: remap.newWalletId })) as Json)
        : null,
    });
    if (error) throw error;
    return toConversionPlan(plan);
  });
