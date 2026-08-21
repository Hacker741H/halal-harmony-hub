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

function toWalletJson(values: Record<string, string | number | boolean | undefined>): Json {
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

export const reassignWalletAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({
        id: walletIdSchema,
        module: z.enum(WALLET_MODULES),
        assetKind: z.enum(["MOTORCYCLE", "VEHICLE", "FARM", "BUSINESS_LOCATION", "GENERAL"]).nullable(),
        motorcycleId: z.string().uuid().nullable().optional(),
        vehicleId: z.string().uuid().nullable().optional(),
        farmId: z.string().uuid().nullable().optional(),
      })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    const { data: wallet, error } = await context.supabase.rpc("reassign_wallet_asset", {
      p_wallet_id: data.id,
      p_new_module: data.module,
      // The generated RPC arg type is `string` (no `| null`) because the SQL
      // parameter has no DEFAULT -- the column and the function body both
      // accept NULL just fine, this is purely a codegen gap for a required
      // text arg.
      p_new_asset_kind: data.assetKind as string,
      p_motorcycle_id: data.motorcycleId ?? undefined,
      p_vehicle_id: data.vehicleId ?? undefined,
      p_farm_id: data.farmId ?? undefined,
    });
    if (error) throw error;
    return wallet;
  });
