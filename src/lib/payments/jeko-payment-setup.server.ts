import { getRequest } from "@tanstack/react-start/server";

import type { Json } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

import { JekoProvider } from "./jeko.provider";
import { PaymentProviderError } from "./payment.types";

export type JekoStoreSetup = {
  id: string;
  name: string;
  walletId: string | null;
  walletName: string | null;
};

export type JekoCheckout = {
  requestId: string;
  reference: string;
  checkoutUrl: string | null;
  amount: number;
  reused: boolean;
};

export type JekoServerContext = {
  supabase: Parameters<typeof getPermissionCodesForClient>[0];
  userId: string;
};

export async function requireJekoPermission(context: JekoServerContext, permissionCode: string) {
  const permissions = new Set(await getPermissionCodesForClient(context.supabase));
  if (!permissions.has(permissionCode)) {
    throw new Error("Vous n’avez pas la permission d’effectuer cette action.");
  }
}

export function throwSafeJekoError(error: unknown): never {
  if (error instanceof PaymentProviderError) {
    console.error("Jèko : demande de paiement impossible.", {
      provider: error.provider,
      code: error.code,
      status: error.status ?? null,
      requestId: error.requestId ?? null,
    });
    if (error.code === "PAYMENT_CONFIGURATION_ERROR") {
      throw new Error("Le connecteur Jèko n’est pas configuré sur le serveur de l’application.");
    }
    if (error.code === "PAYMENT_TIMEOUT" || error.code === "PAYMENT_NETWORK_ERROR") {
      throw new Error("Jèko ne répond pas pour le moment. Réessayez sans créer de paiement manuel en parallèle.");
    }
    throw new Error("Jèko a refusé la demande de paiement. Vérifiez le magasin et le moyen de paiement.");
  }
  throw error;
}

export function currentJekoApplicationOrigin(): string {
  const request = getRequest();
  const candidate = request.headers.get("origin") ?? request.url;
  const url = new URL(candidate);
  const isLocalHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost";
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("L’URL de retour Jèko doit utiliser HTTPS.");
  }
  return url.origin;
}

export async function listJekoStoresWithMappings(): Promise<JekoStoreSetup[]> {
  const provider = JekoProvider.fromEnvironment();
  const stores = await provider.listStores();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: mappings, error: mappingsError } = await supabaseAdmin
    .from("payment_provider_wallet_mappings")
    .select("provider_store_id, wallet_id")
    .eq("provider", "JEKO")
    .eq("is_active", true);
  if (mappingsError) throw mappingsError;

  const walletIds = [...new Set((mappings ?? []).map((mapping) => mapping.wallet_id))];
  const { data: wallets, error: walletsError } = walletIds.length
    ? await supabaseAdmin.from("wallets").select("id, name").in("id", walletIds)
    : { data: [], error: null };
  if (walletsError) throw walletsError;

  const mappingsByStore = new Map((mappings ?? []).map((mapping) => [mapping.provider_store_id, mapping.wallet_id]));
  const walletNames = new Map((wallets ?? []).map((wallet) => [wallet.id, wallet.name]));
  return stores.map((store) => {
    const walletId = mappingsByStore.get(store.id) ?? null;
    return { id: store.id, name: store.name, walletId, walletName: walletId ? walletNames.get(walletId) ?? null : null };
  });
}

export async function configureJekoStoreWallet(context: JekoServerContext, storeId: string, walletId: string): Promise<JekoStoreSetup[]> {
  const provider = JekoProvider.fromEnvironment();
  const stores = await provider.listStores();
  if (!stores.some((store) => store.id === storeId)) {
    throw new Error("Le magasin Jèko sélectionné n’existe plus ou n’est pas accessible.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: wallet, error: walletError } = await supabaseAdmin
    .from("wallets")
    .select("id")
    .eq("id", walletId)
    .maybeSingle();
  if (walletError) throw walletError;
  if (!wallet) throw new Error("Le wallet sélectionné est introuvable.");

  const { error: mappingError } = await supabaseAdmin
    .from("payment_provider_wallet_mappings")
    .upsert({ provider: "JEKO", provider_store_id: storeId, wallet_id: walletId, is_active: true }, { onConflict: "provider,provider_store_id" });
  if (mappingError) throw mappingError;

  const { error: auditError } = await supabaseAdmin.from("security_audit_log").insert({
    actor_user_id: context.userId,
    event_type: "JEKO_WALLET_MAPPING_UPDATED",
    resource_type: "PAYMENT_PROVIDER_WALLET_MAPPING",
    resource_id: storeId,
    metadata: { provider: "JEKO", store_id: storeId, wallet_id: walletId } satisfies Json,
  });
  if (auditError) throw auditError;

  return listJekoStoresWithMappings();
}
