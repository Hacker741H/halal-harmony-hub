import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";

export type Supplier = Tables<"commerce_suppliers">;

export type SupplierDuplicate = {
  id: string;
  supplier_number: string;
  display_name: string;
  legal_name: string | null;
  telephone: string | null;
  email: string | null;
  matched_fields: string[];
  name_similarity: number;
};

export type SupplierFinancialMetrics = {
  purchase_count: number;
  total_purchased: number;
  total_paid: number;
  amount_due: number;
};

const supplierIdSchema = z.string().uuid();
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const nullableContactSchema = z.string().trim().max(120).nullable();
const nullablePhoneSchema = z.string().trim().max(50).nullable();
const nullableEmailSchema = z.string().trim().email().max(255).nullable();

export const SUPPLIER_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const SUPPLIER_COUNTRY_CODES = ["CI", "SN"] as const;

const supplierValuesSchema = z
  .object({
    display_name: z.string().trim().min(1).max(255),
    legal_name: nullableContactSchema,
    telephone: nullablePhoneSchema,
    email: nullableEmailSchema,
    country_code: z.enum(SUPPLIER_COUNTRY_CODES),
    city: nullableContactSchema,
    address: nullableTextSchema,
    notes: nullableTextSchema,
  })
  .strict();

export type SupplierValues = z.infer<typeof supplierValuesSchema>;

const supplierListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).default(""),
    status: z.enum(SUPPLIER_STATUSES).nullable().default(null),
  })
  .strict();

const supplierUpdateSchema = z.object({ id: supplierIdSchema, values: supplierValuesSchema }).strict();

function supplierPayload(values: SupplierValues): Json {
  return {
    display_name: values.display_name,
    legal_name: values.legal_name,
    telephone: values.telephone,
    email: values.email,
    country_code: values.country_code,
    city: values.city,
    address: values.address,
    notes: values.notes,
  };
}

function sanitizedSearchTerm(value: string) {
  return value.replace(/[%,().]/g, " ").trim();
}

export const getSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(supplierListSchema)
  .handler(async ({ context, data }) => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("commerce_suppliers")
      .select("*", { count: "exact" })
      .order("status", { ascending: true })
      .order("display_name", { ascending: true })
      .range(from, to);

    if (data.status) query = query.eq("status", data.status);
    const term = sanitizedSearchTerm(data.search);
    if (term) {
      query = query.or(
        `display_name.ilike.%${term}%,legal_name.ilike.%${term}%,telephone.ilike.%${term}%,email.ilike.%${term}%,supplier_number.ilike.%${term}%`,
      );
    }

    const { data: suppliers, count, error } = await query;
    if (error) throw error;
    return { suppliers: suppliers ?? [], total: count ?? 0 };
  });

export const getSupplier = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(supplierIdSchema)
  .handler(async ({ context, data }) => {
    const { data: supplier, error } = await context.supabase
      .from("commerce_suppliers")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (error) throw error;
    if (!supplier) throw new Error("Fournisseur introuvable ou non autorisé.");
    return supplier;
  });

export const createSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(supplierValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: supplier, error } = await context.supabase.rpc("create_supplier", {
      p_supplier: supplierPayload(data),
    });
    if (error) throw error;
    if (!supplier) throw new Error("Le fournisseur n’a pas été créé.");
    return supplier;
  });

export const updateSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(supplierUpdateSchema)
  .handler(async ({ context, data }) => {
    const { data: supplier, error } = await context.supabase.rpc("update_supplier", {
      p_supplier_id: data.id,
      p_values: supplierPayload(data.values),
    });
    if (error) throw error;
    if (!supplier) throw new Error("Le fournisseur n’a pas été mis à jour.");
    return supplier;
  });

export const archiveSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: supplierIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: supplier, error } = await context.supabase.rpc("archive_supplier", { p_supplier_id: data.id });
    if (error) throw error;
    if (!supplier) throw new Error("Le fournisseur n’a pas été archivé.");
    return supplier;
  });

export const restoreSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: supplierIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: supplier, error } = await context.supabase.rpc("restore_supplier", { p_supplier_id: data.id });
    if (error) throw error;
    if (!supplier) throw new Error("Le fournisseur n’a pas été restauré.");
    return supplier;
  });

export const detectSupplierDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ values: supplierValuesSchema, excludeSupplierId: supplierIdSchema.nullable().default(null) }).strict())
  .handler(async ({ context, data }): Promise<SupplierDuplicate[]> => {
    const { data: duplicates, error } = await context.supabase.rpc("detect_supplier_duplicates", {
      p_supplier: supplierPayload(data.values),
      p_exclude_supplier_id: data.excludeSupplierId ?? undefined,
    });
    if (error) throw error;
    return duplicates ?? [];
  });

export const getSupplierFinancialMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(supplierIdSchema)
  .handler(async ({ context, data }): Promise<SupplierFinancialMetrics> => {
    const { data: metrics, error } = await context.supabase.rpc("get_supplier_financial_metrics", { p_supplier_id: data });
    if (error) throw error;
    return metrics?.[0] ?? { purchase_count: 0, total_purchased: 0, total_paid: 0, amount_due: 0 };
  });
