import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json, Tables } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

export type CommercialSale = Tables<"commercial_sales">;
export type CommercialSaleLine = Tables<"commercial_sale_lines">;
export type CommercialInvoice = Tables<"commercial_invoices">;
export type CommercialInvoicePayment = Tables<"commercial_invoice_payments">;
export type CommercialSaleFinancialSummary =
  Database["public"]["Functions"]["get_commercial_sale_financial_summary"]["Returns"][number];

export type CommercialSaleListItem = CommercialSale & {
  clientName: string | null;
  farmName: string | null;
  totalInvoiced: number | null;
  totalReceived: number | null;
  amountDue: number | null;
  invoiceStatus: string | null;
};

export type CommercialInvoicePaymentWithWallet = CommercialInvoicePayment & {
  walletName: string | null;
};

export type CommercialSaleDetail = {
  sale: CommercialSale;
  clientName: string | null;
  farmName: string | null;
  lines: CommercialSaleLine[];
  invoices: CommercialInvoice[];
  payments: CommercialInvoicePaymentWithWallet[];
  financial: CommercialSaleFinancialSummary | null;
  canReadFinance: boolean;
};

export const COMMERCIAL_SALE_STATUSES = ["DRAFT", "CONFIRMED", "CANCELLED", "ARCHIVED"] as const;
export const COMMERCIAL_INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;
export const COMMERCIAL_PAYMENT_STATUSES = ["PLANNED", "RECEIVED", "CONFIRMED", "CANCELLED"] as const;
export const COMMERCIAL_PAYMENT_KINDS = ["DEPOSIT", "PAYMENT", "SETTLEMENT", "REFUND"] as const;

const idSchema = z.string().uuid();
const nullableText = z.string().trim().max(2_000).nullable();
const nullableDate = z.string().date().nullable();

const saleLineSchema = z
  .object({
    description: z.string().trim().min(1).max(255),
    quantity: z.number().finite().positive(),
    unit: z.string().trim().min(1).max(80),
    unit_price: z.number().finite().min(0),
    inventory_item_id: idSchema.nullable(),
    harvest_id: idSchema.nullable(),
    farm_id: idSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inventory_item_id && value.harvest_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["harvest_id"],
        message: "Une ligne ne peut pas référencer simultanément un article et une récolte.",
      });
    }
  });

export const commercialSaleValuesSchema = z
  .object({
    client_id: idSchema,
    farm_id: idSchema.nullable(),
    sale_date: z.string().date(),
    reference: z.string().trim().max(255).nullable(),
    notes: nullableText,
    lines: z.array(saleLineSchema).min(1),
  })
  .strict();

export type CommercialSaleValues = z.infer<typeof commercialSaleValuesSchema>;

const commercialSaleListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).default(""),
    status: z.enum(COMMERCIAL_SALE_STATUSES).nullable().default(null),
    clientId: idSchema.nullable().default(null),
    farmId: idSchema.nullable().default(null),
    from: nullableDate.default(null),
    to: nullableDate.default(null),
  })
  .strict();

const invoiceValuesSchema = z
  .object({
    due_date: nullableDate.default(null),
    tax_rate: z.number().finite().min(0).max(100).nullable().default(null),
    notes: nullableText.default(null),
  })
  .strict();

const paymentValuesSchema = z
  .object({
    wallet_id: idSchema,
    amount: z.number().finite().positive(),
    payment_date: z.string().date(),
    status: z.enum(["PLANNED", "RECEIVED"]).default("PLANNED"),
    payment_kind: z.enum(COMMERCIAL_PAYMENT_KINDS).default("PAYMENT"),
    reference: z.string().trim().max(255).nullable(),
    notes: nullableText,
  })
  .strict();

export type CommercialInvoiceValues = z.infer<typeof invoiceValuesSchema>;
export type CommercialInvoicePaymentValues = z.infer<typeof paymentValuesSchema>;

function commercialSalePayload(values: CommercialSaleValues): Json {
  return {
    client_id: values.client_id,
    farm_id: values.farm_id,
    sale_date: values.sale_date,
    reference: values.reference,
    notes: values.notes,
    lines: values.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      inventory_item_id: line.inventory_item_id,
      harvest_id: line.harvest_id,
      farm_id: line.farm_id,
    })),
  };
}

function invoicePayload(values: CommercialInvoiceValues): Json {
  return {
    due_date: values.due_date,
    tax_rate: values.tax_rate,
    notes: values.notes,
  };
}

function paymentPayload(values: CommercialInvoicePaymentValues): Json {
  return {
    wallet_id: values.wallet_id,
    amount: values.amount,
    payment_date: values.payment_date,
    status: values.status,
    payment_kind: values.payment_kind,
    reference: values.reference,
    notes: values.notes,
  };
}

function sanitizedSearchTerm(value: string) {
  return value.replace(/[%,().]/g, " ").trim();
}

export const getCommercialSales = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(commercialSaleListSchema)
  .handler(async ({ context, data }): Promise<{ sales: CommercialSaleListItem[]; total: number }> => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("commercial_sales")
      .select("*", { count: "exact" })
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.status) query = query.eq("status", data.status);
    if (data.clientId) query = query.eq("client_id", data.clientId);
    if (data.farmId) query = query.eq("farm_id", data.farmId);
    if (data.from) query = query.gte("sale_date", data.from);
    if (data.to) query = query.lte("sale_date", data.to);

    const term = sanitizedSearchTerm(data.search);
    if (term) {
      query = query.or(`sale_number.ilike.%${term}%,reference.ilike.%${term}%,notes.ilike.%${term}%`);
    }

    const { data: sales, count, error } = await query;
    if (error) throw error;
    const rows = sales ?? [];
    const saleIds = rows.map((sale) => sale.id);
    const clientIds = [...new Set(rows.map((sale) => sale.client_id))];
    const farmIds = [...new Set(rows.flatMap((sale) => sale.farm_id ? [sale.farm_id] : []))];
    const permissionCodes = new Set(await getPermissionCodesForClient(context.supabase));
    const canReadFinance = permissionCodes.has("sales.finance.read");

    const [clientsResult, farmsResult, invoicesResult, paymentsResult] = await Promise.all([
      clientIds.length
        ? context.supabase.from("transport_clients").select("id, display_name").in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),
      farmIds.length
        ? context.supabase.from("farms").select("id, nom").in("id", farmIds)
        : Promise.resolve({ data: [], error: null }),
      canReadFinance && saleIds.length
        ? context.supabase.from("commercial_invoices").select("sale_id, total_amount, status, created_at").in("sale_id", saleIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canReadFinance && saleIds.length
        ? context.supabase.from("commercial_invoice_payments").select("sale_id, amount, status").in("sale_id", saleIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [clientsResult, farmsResult, invoicesResult, paymentsResult]) {
      if (result.error) throw result.error;
    }

    const clients = new Map((clientsResult.data ?? []).map((client) => [client.id, client.display_name]));
    const farms = new Map((farmsResult.data ?? []).map((farm) => [farm.id, farm.nom]));
    const invoicesBySale = new Map<string, { total_amount: number; status: string }[]>();
    for (const invoice of invoicesResult.data ?? []) {
      invoicesBySale.set(invoice.sale_id, [...(invoicesBySale.get(invoice.sale_id) ?? []), invoice]);
    }
    const paymentsBySale = new Map<string, { amount: number; status: string }[]>();
    for (const payment of paymentsResult.data ?? []) {
      paymentsBySale.set(payment.sale_id, [...(paymentsBySale.get(payment.sale_id) ?? []), payment]);
    }

    return {
      sales: rows.map((sale) => {
        const invoices = (invoicesBySale.get(sale.id) ?? []).filter((invoice) => invoice.status !== "CANCELLED");
        const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);
        const totalReceived = (paymentsBySale.get(sale.id) ?? [])
          .filter((payment) => payment.status === "CONFIRMED")
          .reduce((sum, payment) => sum + Number(payment.amount), 0);
        return {
          ...sale,
          clientName: clients.get(sale.client_id) ?? null,
          farmName: sale.farm_id ? farms.get(sale.farm_id) ?? null : null,
          totalInvoiced: canReadFinance ? totalInvoiced : null,
          totalReceived: canReadFinance ? totalReceived : null,
          amountDue: canReadFinance ? totalInvoiced - totalReceived : null,
          invoiceStatus: canReadFinance ? invoices[0]?.status ?? null : null,
        };
      }),
      total: count ?? 0,
    };
  });

export const getCommercialSale = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }): Promise<CommercialSaleDetail> => {
    const { data: sale, error: saleError } = await context.supabase
      .from("commercial_sales")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (saleError) throw saleError;
    if (!sale) throw new Error("Vente introuvable ou non autorisée.");

    const permissionCodes = new Set(await getPermissionCodesForClient(context.supabase));
    const canReadFinance = permissionCodes.has("sales.finance.read");
    const [clientResult, farmResult, linesResult, invoicesResult, paymentsResult, summaryResult] = await Promise.all([
      context.supabase.from("transport_clients").select("display_name").eq("id", sale.client_id).maybeSingle(),
      sale.farm_id
        ? context.supabase.from("farms").select("nom").eq("id", sale.farm_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      context.supabase.from("commercial_sale_lines").select("*").eq("sale_id", data).order("created_at"),
      canReadFinance
        ? context.supabase.from("commercial_invoices").select("*").eq("sale_id", data).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canReadFinance
        ? context.supabase.from("commercial_invoice_payments").select("*").eq("sale_id", data).order("payment_date", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canReadFinance
        ? context.supabase.rpc("get_commercial_sale_financial_summary", { p_sale_id: data })
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [clientResult, farmResult, linesResult, invoicesResult, paymentsResult, summaryResult]) {
      if (result.error) throw result.error;
    }
    const walletIds = [...new Set((paymentsResult.data ?? []).map((payment) => payment.wallet_id))];
    const walletsResult = walletIds.length
      ? await context.supabase.from("wallets").select("id, name").in("id", walletIds)
      : { data: [], error: null };
    if (walletsResult.error) throw walletsResult.error;
    const walletNames = new Map((walletsResult.data ?? []).map((wallet) => [wallet.id, wallet.name]));

    return {
      sale,
      clientName: clientResult.data?.display_name ?? null,
      farmName: farmResult.data?.nom ?? null,
      lines: linesResult.data ?? [],
      invoices: invoicesResult.data ?? [],
      payments: (paymentsResult.data ?? []).map((payment) => ({
        ...payment,
        walletName: walletNames.get(payment.wallet_id) ?? null,
      })),
      financial: summaryResult.data?.[0] ?? null,
      canReadFinance,
    };
  });

export const createCommercialSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(commercialSaleValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: sale, error } = await context.supabase.rpc("create_commercial_sale", {
      p_sale: commercialSalePayload(data),
    });
    if (error) throw error;
    if (!sale) throw new Error("La vente n’a pas été créée.");
    return sale;
  });

export const updateCommercialSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, values: commercialSaleValuesSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: sale, error } = await context.supabase.rpc("update_commercial_sale", {
      p_sale_id: data.id,
      p_sale: commercialSalePayload(data.values),
    });
    if (error) throw error;
    if (!sale) throw new Error("La vente n’a pas été mise à jour.");
    return sale;
  });

export const confirmCommercialSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: sale, error } = await context.supabase.rpc("confirm_commercial_sale", { p_sale_id: data.id });
    if (error) throw error;
    if (!sale) throw new Error("La vente n’a pas été confirmée.");
    return sale;
  });

export const cancelCommercialSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: sale, error } = await context.supabase.rpc("cancel_commercial_sale", {
      p_sale_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!sale) throw new Error("La vente n’a pas été annulée.");
    return sale;
  });

export const createCommercialInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ saleId: idSchema, invoice: invoiceValuesSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: invoice, error } = await context.supabase.rpc("create_commercial_invoice", {
      p_sale_id: data.saleId,
      p_invoice: invoicePayload(data.invoice),
    });
    if (error) throw error;
    if (!invoice) throw new Error("La facture n’a pas été créée.");
    return invoice;
  });

export const issueCommercialInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: invoice, error } = await context.supabase.rpc("issue_commercial_invoice", { p_invoice_id: data.id });
    if (error) throw error;
    if (!invoice) throw new Error("La facture n’a pas été émise.");
    return invoice;
  });

export const cancelCommercialInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: invoice, error } = await context.supabase.rpc("cancel_commercial_invoice", {
      p_invoice_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!invoice) throw new Error("La facture n’a pas été annulée.");
    return invoice;
  });

export const createCommercialInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ invoiceId: idSchema, payment: paymentValuesSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc("create_commercial_invoice_payment", {
      p_invoice_id: data.invoiceId,
      p_payment: paymentPayload(data.payment),
    });
    if (error) throw error;
    if (!payment) throw new Error("Le paiement n’a pas été créé.");
    return payment;
  });

export const confirmCommercialInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc("confirm_commercial_invoice_payment", {
      p_payment_id: data.id,
    });
    if (error) throw error;
    if (!payment) throw new Error("Le paiement n’a pas été confirmé.");
    return payment;
  });

export const cancelCommercialInvoicePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc("cancel_commercial_invoice_payment", {
      p_payment_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!payment) throw new Error("Le paiement n’a pas été annulé.");
    return payment;
  });

export const getCommercialSaleFinancialSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }): Promise<CommercialSaleFinancialSummary[]> => {
    const { data: summary, error } = await context.supabase.rpc("get_commercial_sale_financial_summary", {
      p_sale_id: data,
    });
    if (error) throw error;
    return summary ?? [];
  });
