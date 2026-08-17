import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";

export type Client = Tables<"transport_clients">;

export type ClientDuplicate = {
  id: string;
  client_number: string;
  display_name: string;
  legal_name: string | null;
  telephone: string | null;
  email: string | null;
  registration_identifier_type: string | null;
  registration_identifier_value: string | null;
  matched_fields: string[];
  name_similarity: number;
};

export type ClientFinancialMetrics = {
  metrics_available: boolean;
  mission_count: number | null;
  total_billed: number | null;
  total_received: number | null;
  amount_due: number | null;
  total_expenses: number | null;
  gross_result: number | null;
  cash_result: number | null;
  last_mission_at: string | null;
  last_payment_at: string | null;
};

export type CommercialClientFinancialMetrics = {
  metrics_available: boolean;
  sale_count: number;
  total_invoiced: number;
  total_received: number;
  total_returned: number;
  amount_due: number;
  last_sale_at: string | null;
  last_payment_at: string | null;
};

export type CommercialClientFinancialMetricsBulkEntry = {
  client_id: string;
  sale_count: number;
  total_invoiced: number;
  total_received: number;
  total_returned: number;
  amount_due: number;
};

export type ClientAuditEntry = {
  id: string;
  action: string;
  created_at: string;
  performed_by: string | null;
  before_value: Json | null;
  after_value: Json | null;
};

const clientIdSchema = z.string().uuid();
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const nullableContactSchema = z.string().trim().max(120).nullable();
const nullablePhoneSchema = z.string().trim().max(50).nullable();
const nullableEmailSchema = z.string().trim().email().max(255).nullable();

export const CLIENT_KINDS = ["ORGANIZATION", "INDIVIDUAL"] as const;
export const CLIENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const CLIENT_IDENTIFIER_TYPES = ["NINEA", "RCCM"] as const;
export const CLIENT_COUNTRY_CODES = ["CI", "SN"] as const;

const clientValuesSchema = z
  .object({
    kind: z.enum(CLIENT_KINDS),
    display_name: z.string().trim().min(1).max(255),
    legal_name: nullableContactSchema,
    country_code: z.enum(CLIENT_COUNTRY_CODES),
    city: nullableContactSchema,
    address: nullableTextSchema,
    telephone: nullablePhoneSchema,
    email: nullableEmailSchema,
    contact_name: nullableContactSchema,
    contact_phone: nullablePhoneSchema,
    contact_email: nullableEmailSchema,
    registration_identifier_type: z.enum(CLIENT_IDENTIFIER_TYPES).nullable(),
    registration_identifier_value: nullableContactSchema,
    notes: nullableTextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasType = value.registration_identifier_type !== null;
    const hasValue = value.registration_identifier_value !== null;
    if (hasType !== hasValue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registration_identifier_value"],
        message: "Le type et la valeur de l’identifiant légal doivent être renseignés ensemble.",
      });
    }
  });

export type ClientValues = z.infer<typeof clientValuesSchema>;

const clientListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).default(""),
    status: z.enum(CLIENT_STATUSES).nullable().default(null),
  })
  .strict();

const clientUpdateSchema = z.object({ id: clientIdSchema, values: clientValuesSchema }).strict();
const clientMergeSchema = z
  .object({ sourceClientId: clientIdSchema, targetClientId: clientIdSchema, reason: z.string().trim().min(10).max(2_000) })
  .strict()
  .refine((value) => value.sourceClientId !== value.targetClientId, {
    message: "Le client source et le client cible doivent être différents.",
    path: ["targetClientId"],
  });

function clientPayload(values: ClientValues): Json {
  return {
    kind: values.kind,
    display_name: values.display_name,
    legal_name: values.legal_name,
    country_code: values.country_code,
    city: values.city,
    address: values.address,
    telephone: values.telephone,
    email: values.email,
    contact_name: values.contact_name,
    contact_phone: values.contact_phone,
    contact_email: values.contact_email,
    registration_identifier_type: values.registration_identifier_type,
    registration_identifier_value: values.registration_identifier_value,
    notes: values.notes,
  };
}

function sanitizedSearchTerm(value: string) {
  return value.replace(/[%,().]/g, " ").trim();
}

export const getClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(clientListSchema)
  .handler(async ({ context, data }) => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("transport_clients")
      .select("*", { count: "exact" })
      .order("status", { ascending: true })
      .order("display_name", { ascending: true })
      .range(from, to);

    if (data.status) query = query.eq("status", data.status);
    const term = sanitizedSearchTerm(data.search);
    if (term) {
      query = query.or(
        `display_name.ilike.%${term}%,legal_name.ilike.%${term}%,telephone.ilike.%${term}%,email.ilike.%${term}%,client_number.ilike.%${term}%`,
      );
    }

    const { data: clients, count, error } = await query;
    if (error) throw error;
    return { clients: clients ?? [], total: count ?? 0 };
  });

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(clientIdSchema)
  .handler(async ({ context, data }) => {
    const { data: client, error } = await context.supabase
      .from("transport_clients")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (error) throw error;
    if (!client) throw new Error("Client introuvable ou non autorisé.");
    return client;
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(clientValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: client, error } = await context.supabase.rpc("create_client", {
      p_client: clientPayload(data),
    });
    if (error) throw error;
    if (!client) throw new Error("Le client n’a pas été créé.");
    return client;
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(clientUpdateSchema)
  .handler(async ({ context, data }) => {
    const { data: client, error } = await context.supabase.rpc("update_client", {
      p_client_id: data.id,
      p_values: clientPayload(data.values),
    });
    if (error) throw error;
    if (!client) throw new Error("Le client n’a pas été mis à jour.");
    return client;
  });

export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: clientIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: client, error } = await context.supabase.rpc("archive_client", { p_client_id: data.id });
    if (error) throw error;
    if (!client) throw new Error("Le client n’a pas été archivé.");
    return client;
  });

export const restoreClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: clientIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: client, error } = await context.supabase.rpc("restore_client", { p_client_id: data.id });
    if (error) throw error;
    if (!client) throw new Error("Le client n’a pas été restauré.");
    return client;
  });

export const detectClientDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ values: clientValuesSchema, excludeClientId: clientIdSchema.nullable().default(null) }).strict())
  .handler(async ({ context, data }): Promise<ClientDuplicate[]> => {
    const { data: duplicates, error } = await context.supabase.rpc("detect_client_duplicates", {
      p_client: clientPayload(data.values),
      p_exclude_client_id: data.excludeClientId ?? undefined,
    });
    if (error) throw error;
    return duplicates ?? [];
  });

export const mergeClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(clientMergeSchema)
  .handler(async ({ context, data }) => {
    const { data: client, error } = await context.supabase.rpc("merge_clients", {
      p_source_client_id: data.sourceClientId,
      p_target_client_id: data.targetClientId,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!client) throw new Error("La fusion des clients a échoué.");
    return client;
  });

export const getClientFinancialMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(clientIdSchema)
  .handler(async ({ context, data }): Promise<ClientFinancialMetrics> => {
    const { data: metrics, error } = await context.supabase.rpc("get_client_financial_metrics", { p_client_id: data });
    if (error) throw error;
    return metrics?.[0] ?? {
      metrics_available: false,
      mission_count: null,
      total_billed: null,
      total_received: null,
      amount_due: null,
      total_expenses: null,
      gross_result: null,
      cash_result: null,
      last_mission_at: null,
      last_payment_at: null,
    };
  });

export const getCommercialClientFinancialMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(clientIdSchema)
  .handler(async ({ context, data }): Promise<CommercialClientFinancialMetrics> => {
    const { data: metrics, error } = await context.supabase.rpc("get_commercial_client_financial_metrics", { p_client_id: data });
    if (error) throw error;
    return metrics?.[0] ?? {
      metrics_available: false,
      sale_count: 0,
      total_invoiced: 0,
      total_received: 0,
      total_returned: 0,
      amount_due: 0,
      last_sale_at: null,
      last_payment_at: null,
    };
  });

export const getCommercialClientFinancialMetricsBulk = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.array(clientIdSchema).max(200))
  .handler(async ({ context, data }): Promise<CommercialClientFinancialMetricsBulkEntry[]> => {
    if (data.length === 0) return [];
    const { data: metrics, error } = await context.supabase.rpc("get_commercial_client_financial_metrics_bulk", { p_client_ids: data });
    if (error) throw error;
    return metrics ?? [];
  });

export const getClientAuditHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(clientIdSchema)
  .handler(async ({ context, data }): Promise<ClientAuditEntry[]> => {
    const { data: history, error } = await context.supabase.rpc("get_client_audit_history", { p_client_id: data });
    if (error) throw error;
    return history ?? [];
  });
