import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

import { JekoProvider } from "./jeko.provider";
import { PaymentProviderError } from "./payment.types";

const idSchema = z.string().uuid();
const paymentMethodSchema = z.enum(["wave", "orange", "mtn", "moov", "djamo"]);

const configureWalletSchema = z.object({
  storeId: idSchema,
  walletId: idSchema,
}).strict();

const createCheckoutSchema = z.object({
  invoiceId: idSchema,
  storeId: idSchema,
  walletId: idSchema,
  amount: z.number().finite().positive().int(),
  paymentMethod: paymentMethodSchema,
}).strict();

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

type ServerContext = {
  supabase: Parameters<typeof getPermissionCodesForClient>[0];
  userId: string;
};

async function requirePermission(context: ServerContext, permissionCode: string) {
  const permissions = new Set(await getPermissionCodesForClient(context.supabase));
  if (!permissions.has(permissionCode)) {
    throw new Error("Vous n’avez pas la permission d’effectuer cette action.");
  }
}

function safeJekoError(error: unknown): never {
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

function currentApplicationOrigin(): string {
  const request = getRequest();
  const candidate = request.headers.get("origin") ?? request.url;
  const url = new URL(candidate);
  const isLocalHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost";
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("L’URL de retour Jèko doit utiliser HTTPS.");
  }
  return url.origin;
}

async function listStoresWithMappings(): Promise<JekoStoreSetup[]> {
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

export const getJekoCoursePaymentSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JekoStoreSetup[]> => {
    await requirePermission(context, "missions.payments");
    try {
      return await listStoresWithMappings();
    } catch (error) {
      return safeJekoError(error);
    }
  });

export const configureJekoCourseWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(configureWalletSchema)
  .handler(async ({ context, data }): Promise<JekoStoreSetup[]> => {
    await requirePermission(context, "settings.manage");
    try {
      const provider = JekoProvider.fromEnvironment();
      const stores = await provider.listStores();
      if (!stores.some((store) => store.id === data.storeId)) {
        throw new Error("Le magasin Jèko sélectionné n’existe plus ou n’est pas accessible.");
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("wallets")
        .select("id")
        .eq("id", data.walletId)
        .maybeSingle();
      if (walletError) throw walletError;
      if (!wallet) throw new Error("Le wallet sélectionné est introuvable.");

      const { error: mappingError } = await supabaseAdmin
        .from("payment_provider_wallet_mappings")
        .upsert({ provider: "JEKO", provider_store_id: data.storeId, wallet_id: data.walletId, is_active: true }, { onConflict: "provider,provider_store_id" });
      if (mappingError) throw mappingError;

      const { error: auditError } = await supabaseAdmin.from("security_audit_log").insert({
        actor_user_id: context.userId,
        event_type: "JEKO_WALLET_MAPPING_UPDATED",
        resource_type: "PAYMENT_PROVIDER_WALLET_MAPPING",
        resource_id: data.storeId,
        metadata: { provider: "JEKO", store_id: data.storeId, wallet_id: data.walletId } satisfies Json,
      });
      if (auditError) throw auditError;
      return await listStoresWithMappings();
    } catch (error) {
      return safeJekoError(error);
    }
  });

export const createJekoCourseInvoiceCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createCheckoutSchema)
  .handler(async ({ context, data }): Promise<JekoCheckout> => {
    await requirePermission(context, "missions.payments");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: invoice, error: invoiceError }, { data: mapping, error: mappingError }] = await Promise.all([
      supabaseAdmin.from("transport_invoices").select("id, mission_id, invoice_number, total_amount, status").eq("id", data.invoiceId).maybeSingle(),
      supabaseAdmin.from("payment_provider_wallet_mappings").select("wallet_id, is_active").eq("provider", "JEKO").eq("provider_store_id", data.storeId).maybeSingle(),
    ]);
    if (invoiceError) throw invoiceError;
    if (mappingError) throw mappingError;
    if (!invoice || !["ISSUED", "PARTIALLY_PAID"].includes(invoice.status)) {
      throw new Error("La facture doit être émise et non soldée avant de créer un paiement Jèko.");
    }
    if (!mapping?.is_active || mapping.wallet_id !== data.walletId) {
      throw new Error("Ce magasin Jèko n’est pas associé au wallet choisi. Un administrateur doit le configurer avant tout encaissement.");
    }

    const { data: payments, error: paymentsError } = await supabaseAdmin
      .from("transport_invoice_payments")
      .select("amount, status")
      .eq("invoice_id", invoice.id)
      .eq("status", "CONFIRMED");
    if (paymentsError) throw paymentsError;
    const amountDue = Math.max(0, Number(invoice.total_amount) - (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0));
    if (data.amount > amountDue) {
      throw new Error("Le montant Jèko dépasse le reste à encaisser de cette facture.");
    }

    const { data: existingRequest, error: existingRequestError } = await supabaseAdmin
      .from("payment_provider_payment_requests")
      .select("provider_request_id, provider_reference, erp_amount, wallet_id, status")
      .eq("provider", "JEKO")
      .eq("invoice_id", invoice.id)
      .eq("status", "PENDING")
      .maybeSingle();
    if (existingRequestError) throw existingRequestError;

    const provider = JekoProvider.fromEnvironment();
    if (existingRequest) {
      if (Number(existingRequest.erp_amount) !== data.amount || existingRequest.wallet_id !== data.walletId) {
        throw new Error("Une demande Jèko est déjà en attente pour cette facture. Utilisez-la ou réconciliez-la avant de modifier son montant ou son wallet.");
      }
      try {
        const currentRequest = await provider.getPayment(existingRequest.provider_request_id);
        return {
          requestId: currentRequest.id,
          reference: existingRequest.provider_reference,
          checkoutUrl: currentRequest.redirectUrl ?? null,
          amount: Number(existingRequest.erp_amount),
          reused: true,
        };
      } catch (error) {
        return safeJekoError(error);
      }
    }

    const origin = currentApplicationOrigin();
    try {
      const request = await provider.createPayment({
        amountCents: data.amount * 100,
        currency: "XOF",
        reference: invoice.invoice_number,
        storeId: data.storeId,
        description: `Règlement de la facture ${invoice.invoice_number}`,
        paymentDetails: {
          type: "redirect",
          paymentMethod: data.paymentMethod,
          successUrl: `${origin}/courses/${invoice.mission_id}?jeko=success&invoice=${invoice.id}`,
          errorUrl: `${origin}/courses/${invoice.mission_id}?jeko=cancelled&invoice=${invoice.id}`,
          forceProviderDirect: false,
        },
      });

      const registration: Json = {
        provider_request_id: request.id,
        provider_reference: invoice.invoice_number,
        provider_store_id: data.storeId,
        invoice_id: invoice.id,
        wallet_id: data.walletId,
        expected_provider_amount: data.amount * 100,
        erp_amount: data.amount,
        currency: "XOF",
      };
      const { error: registrationError } = await supabaseAdmin.rpc("register_jeko_payment_request", { p_request: registration });
      if (registrationError) {
        console.error("Jèko : demande distante créée mais enregistrement ERP impossible.", { provider: "JEKO", requestId: request.id, code: registrationError.code ?? null });
        throw new Error("La demande Jèko a été créée mais sa liaison ERP n’a pas pu être confirmée. Ne la payez pas ; contactez l’administrateur pour la réconcilier.");
      }

      return {
        requestId: request.id,
        reference: request.reference,
        checkoutUrl: request.redirectUrl ?? null,
        amount: data.amount,
        reused: false,
      };
    } catch (error) {
      return safeJekoError(error);
    }
  });
