import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";
import type { Json, Tables } from "@/integrations/supabase/types";

export type Purchase = Tables<"commerce_purchases">;
export type PurchaseLine = Tables<"commerce_purchase_lines">;
export type SupplierPayment = Tables<"commerce_supplier_payments">;

export type PurchaseListItem = Purchase & {
  supplierName: string | null;
  amountDue: number | null;
};

export type SupplierPaymentWithWallet = SupplierPayment & {
  walletName: string | null;
};

export type PurchaseDetail = {
  purchase: Purchase;
  supplierName: string | null;
  locationName: string | null;
  lines: (PurchaseLine & { itemName: string | null })[];
  payments: SupplierPaymentWithWallet[];
  financial: { total_amount: number; total_paid: number; amount_due: number } | null;
  canReadFinance: boolean;
};

const idSchema = z.string().uuid();
const nullableText = z.string().trim().max(2_000).nullable();
const nullableRef = z.string().trim().max(255).nullable();

export const PURCHASE_STATUSES = ["RECEIVED", "CANCELLED"] as const;
export const SUPPLIER_PAYMENT_STATUSES = ["PLANNED", "RECEIVED", "CONFIRMED", "CANCELLED"] as const;

const purchaseLineSchema = z
  .object({
    inventory_item_id: idSchema,
    quantity: z.number().finite().positive(),
    unit_cost: z.number().finite().positive(),
  })
  .strict();

const purchaseValuesSchema = z
  .object({
    supplier_id: idSchema,
    business_location_id: idSchema,
    purchase_date: z.string().date(),
    reference: nullableRef,
    notes: nullableText,
    lines: z.array(purchaseLineSchema).min(1).max(100),
  })
  .strict();

const purchaseListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).default(""),
    supplierId: idSchema.nullable().default(null),
    businessLocationId: idSchema.nullable().default(null),
    status: z.enum(PURCHASE_STATUSES).nullable().default(null),
  })
  .strict();

const supplierPaymentValuesSchema = z
  .object({
    wallet_id: idSchema,
    amount: z.number().finite().positive(),
    payment_date: z.string().date(),
    status: z.enum(["PLANNED", "RECEIVED"]).default("PLANNED"),
    reference: nullableRef,
    notes: nullableText,
  })
  .strict();

function sanitizedSearchTerm(value: string) {
  return value.replace(/[%,().]/g, " ").trim();
}

export const getPurchases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(purchaseListSchema)
  .handler(async ({ context, data }): Promise<{ purchases: PurchaseListItem[]; total: number }> => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("commerce_purchases")
      .select("*", { count: "exact" })
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.supplierId) query = query.eq("supplier_id", data.supplierId);
    if (data.businessLocationId) query = query.eq("business_location_id", data.businessLocationId);
    if (data.status) query = query.eq("status", data.status);
    const term = sanitizedSearchTerm(data.search);
    if (term) query = query.or(`purchase_number.ilike.%${term}%,reference.ilike.%${term}%,notes.ilike.%${term}%`);

    const { data: purchases, count, error } = await query;
    if (error) throw error;
    const rows = purchases ?? [];

    const supplierIds = [...new Set(rows.map((row) => row.supplier_id))];
    const purchaseIds = rows.map((row) => row.id);
    const [suppliersResult, paymentsResult] = await Promise.all([
      supplierIds.length
        ? context.supabase.from("commerce_suppliers").select("id, display_name").in("id", supplierIds)
        : Promise.resolve({ data: [], error: null }),
      purchaseIds.length
        ? context.supabase.from("commerce_supplier_payments").select("purchase_id, amount, status").in("purchase_id", purchaseIds).eq("status", "CONFIRMED")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (suppliersResult.error) throw suppliersResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    const supplierNames = new Map((suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier.display_name]));
    const paidByPurchase = new Map<string, number>();
    for (const payment of paymentsResult.data ?? []) {
      paidByPurchase.set(payment.purchase_id, (paidByPurchase.get(payment.purchase_id) ?? 0) + Number(payment.amount));
    }

    return {
      purchases: rows.map((row) => ({
        ...row,
        supplierName: supplierNames.get(row.supplier_id) ?? null,
        amountDue: Math.max(0, Number(row.total_amount) - (paidByPurchase.get(row.id) ?? 0)),
      })),
      total: count ?? 0,
    };
  });

export const getPurchase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }): Promise<PurchaseDetail> => {
    const { data: purchase, error: purchaseError } = await context.supabase
      .from("commerce_purchases")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (purchaseError) throw purchaseError;
    if (!purchase) throw new Error("Achat introuvable ou non autorisé.");

    const permissionCodes = new Set(await getPermissionCodesForClient(context.supabase));
    const canReadFinance = permissionCodes.has("purchases.finance.read");

    const [supplierResult, locationResult, linesResult, paymentsResult, summaryResult] = await Promise.all([
      context.supabase.from("commerce_suppliers").select("display_name").eq("id", purchase.supplier_id).maybeSingle(),
      context.supabase.from("business_locations").select("name").eq("id", purchase.business_location_id).maybeSingle(),
      context.supabase.from("commerce_purchase_lines").select("*").eq("purchase_id", data).order("created_at"),
      canReadFinance
        ? context.supabase.from("commerce_supplier_payments").select("*").eq("purchase_id", data).order("payment_date", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canReadFinance
        ? context.supabase.rpc("get_commerce_purchase_financial_summary", { p_purchase_id: data })
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [supplierResult, locationResult, linesResult, paymentsResult, summaryResult]) {
      if (result.error) throw result.error;
    }

    const lineRows = linesResult.data ?? [];
    const itemIds = [...new Set(lineRows.map((line) => line.inventory_item_id))];
    const itemsResult = itemIds.length
      ? await context.supabase.from("inventory_items").select("id, nom").in("id", itemIds)
      : { data: [], error: null };
    if (itemsResult.error) throw itemsResult.error;
    const itemNames = new Map((itemsResult.data ?? []).map((item) => [item.id, item.nom]));

    const paymentRows = paymentsResult.data ?? [];
    const walletIds = [...new Set(paymentRows.map((payment) => payment.wallet_id))];
    const walletsResult = walletIds.length
      ? await context.supabase.from("wallets").select("id, name").in("id", walletIds)
      : { data: [], error: null };
    if (walletsResult.error) throw walletsResult.error;
    const walletNames = new Map((walletsResult.data ?? []).map((wallet) => [wallet.id, wallet.name]));

    return {
      purchase,
      supplierName: supplierResult.data?.display_name ?? null,
      locationName: locationResult.data?.name ?? null,
      lines: lineRows.map((line) => ({ ...line, itemName: itemNames.get(line.inventory_item_id) ?? null })),
      payments: paymentRows.map((payment) => ({ ...payment, walletName: walletNames.get(payment.wallet_id) ?? null })),
      financial: summaryResult.data?.[0] ?? null,
      canReadFinance,
    };
  });

export const createPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(purchaseValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: purchase, error } = await context.supabase.rpc("create_commerce_purchase", {
      p_purchase: data as Json,
    });
    if (error) throw error;
    if (!purchase) throw new Error("L’achat n’a pas été enregistré.");
    return purchase;
  });

export const createSupplierPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ purchaseId: idSchema, payment: supplierPaymentValuesSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc("create_supplier_payment", {
      p_purchase_id: data.purchaseId,
      p_payment: data.payment as Json,
    });
    if (error) throw error;
    if (!payment) throw new Error("Le paiement n’a pas été enregistré.");
    return payment;
  });

export const confirmSupplierPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc("confirm_supplier_payment", { p_payment_id: data.id });
    if (error) throw error;
    if (!payment) throw new Error("Le paiement n’a pas été confirmé.");
    return payment;
  });

export const cancelSupplierPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc("cancel_supplier_payment", {
      p_payment_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!payment) throw new Error("Le paiement n’a pas été annulé.");
    return payment;
  });
