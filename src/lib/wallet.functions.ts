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
