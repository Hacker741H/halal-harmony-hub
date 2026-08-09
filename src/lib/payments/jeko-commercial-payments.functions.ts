import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

import { JekoProvider } from "./jeko.provider";
import {
  configureJekoStoreWallet,
  currentJekoApplicationOrigin,
  type JekoCheckout,
  type JekoServerContext,
  type JekoStoreSetup,
  listJekoStoresWithMappings,
  requireJekoPermission,
  throwSafeJekoError,
} from "./jeko-payment-setup.server";

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

export type { JekoCheckout, JekoStoreSetup } from "./jeko-payment-setup.server";

export const getJekoCommercialPaymentSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JekoStoreSetup[]> => {
    await requireJekoPermission(context as JekoServerContext, "sales.payments");
    try {
      return await listJekoStoresWithMappings();
    } catch (error) {
      return throwSafeJekoError(error);
    }
  });

export const configureJekoCommercialWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(configureWalletSchema)
  .handler(async ({ context, data }): Promise<JekoStoreSetup[]> => {
    await requireJekoPermission(context as JekoServerContext, "settings.manage");
    try {
      return await configureJekoStoreWallet(context as JekoServerContext, data.storeId, data.walletId);
    } catch (error) {
      return throwSafeJekoError(error);
    }
  });

export const createJekoCommercialInvoiceCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createCheckoutSchema)
  .handler(async ({ context, data }): Promise<JekoCheckout> => {
    await requireJekoPermission(context as JekoServerContext, "sales.payments");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: invoice, error: invoiceError }, { data: mapping, error: mappingError }] = await Promise.all([
      supabaseAdmin.from("commercial_invoices").select("id, sale_id, invoice_number, total_amount, status").eq("id", data.invoiceId).maybeSingle(),
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
      .from("commercial_invoice_payments")
      .select("amount, status")
      .eq("invoice_id", invoice.id)
      .eq("status", "CONFIRMED");
    if (paymentsError) throw paymentsError;
    const amountDue = Math.max(0, Number(invoice.total_amount) - (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0));
    if (data.amount > amountDue) {
      throw new Error("Le montant Jèko dépasse le reste à encaisser de cette facture.");
    }

    // The invoice reference is namespaced because transport and commercial invoices
    // both use the FAC-YYYY-XXXXXX format.
    const providerReference = `COMMERCIAL:${invoice.invoice_number}`;
    const { data: existingRequest, error: existingRequestError } = await supabaseAdmin
      .from("payment_provider_payment_requests")
      .select("provider_request_id, provider_reference, erp_amount, wallet_id, status")
      .eq("provider", "JEKO")
      .eq("provider_reference", providerReference)
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
          reference: invoice.invoice_number,
          checkoutUrl: currentRequest.redirectUrl ?? null,
          amount: Number(existingRequest.erp_amount),
          reused: true,
        };
      } catch (error) {
        return throwSafeJekoError(error);
      }
    }

    const origin = currentJekoApplicationOrigin();
    try {
      const request = await provider.createPayment({
        amountCents: data.amount * 100,
        currency: "XOF",
        reference: providerReference,
        storeId: data.storeId,
        description: `Règlement de la facture ${invoice.invoice_number}`,
        paymentDetails: {
          type: "redirect",
          paymentMethod: data.paymentMethod,
          successUrl: `${origin}/sales/${invoice.sale_id}?jeko=success&invoice=${invoice.id}`,
          errorUrl: `${origin}/sales/${invoice.sale_id}?jeko=cancelled&invoice=${invoice.id}`,
          forceProviderDirect: false,
        },
      });

      const registration: Json = {
        invoice_kind: "COMMERCIAL",
        commercial_invoice_id: invoice.id,
        provider_request_id: request.id,
        provider_reference: providerReference,
        provider_store_id: data.storeId,
        wallet_id: data.walletId,
        expected_provider_amount: data.amount * 100,
        erp_amount: data.amount,
        currency: "XOF",
      };
      const { error: registrationError } = await supabaseAdmin.rpc("register_jeko_payment_request", { p_request: registration });
      if (registrationError) {
        console.error("Jèko : demande commerciale distante créée mais enregistrement ERP impossible.", {
          provider: "JEKO",
          requestId: request.id,
          code: registrationError.code ?? null,
        });
        throw new Error("La demande Jèko a été créée mais sa liaison ERP n’a pas pu être confirmée. Ne la payez pas ; contactez l’administrateur pour la réconcilier.");
      }

      return {
        requestId: request.id,
        reference: invoice.invoice_number,
        checkoutUrl: request.redirectUrl ?? null,
        amount: data.amount,
        reused: false,
      };
    } catch (error) {
      return throwSafeJekoError(error);
    }
  });
