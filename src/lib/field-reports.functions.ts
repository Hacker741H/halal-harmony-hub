import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";

export const FIELD_REPORT_TYPES = ["DAILY", "WEEKLY"] as const;
export const FIELD_REPORT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "REVIEWED",
  "REJECTED",
  "CANCELLED",
] as const;
export const FIELD_DECLARATION_TYPES = ["RECEIPT", "EXPENSE", "REMITTANCE"] as const;
export const FIELD_DECLARATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
] as const;

export type FieldReport = Tables<"field_reports">;
export type FieldDeclaration = Tables<"field_declarations">;
export type FieldWalletAssignment = Tables<"field_wallet_assignments">;
export type FieldWallet = FieldWalletAssignment & {
  wallet: Pick<Tables<"wallets">, "id" | "name" | "type" | "color" | "balance">;
};
export type FieldAssignableUser = {
  userId: string;
  fullName: string | null;
  username: string | null;
};
export type FieldAssignableWallet = Pick<
  Tables<"wallets">,
  "id" | "name" | "type" | "color" | "balance"
>;
export type FieldReportDetail = FieldReport & {
  declarations: FieldDeclaration[];
  totals: {
    receipts: number;
    expenses: number;
    remittances: number;
    pending: number;
    confirmed: number;
  };
};

const idSchema = z.string().uuid();
const nullableText = z.string().trim().max(2_000).nullable().default(null);
const nullableId = idSchema.nullable().default(null);

const reportValuesSchema = z
  .object({
    reportType: z.enum(FIELD_REPORT_TYPES),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    notes: nullableText,
  })
  .strict();

const declarationValuesSchema = z
  .object({
    declarationType: z.enum(FIELD_DECLARATION_TYPES),
    amount: z.number().finite().positive(),
    occurredAt: z.string().datetime().nullable().default(null),
    fieldWalletId: idSchema,
    destinationWalletId: nullableId,
    category: z.string().trim().min(1).max(120),
    description: nullableText,
    reference: z.string().trim().max(255).nullable().default(null),
    clientId: nullableId,
    farmId: nullableId,
    inventoryItemId: nullableId,
    documentId: nullableId,
    clientSubmissionId: idSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const isRemittance = value.declarationType === "REMITTANCE";
    if (isRemittance && !value.destinationWalletId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationWalletId"],
        message: "Le wallet d’entreprise est obligatoire pour un versement.",
      });
    }
    if (!isRemittance && value.destinationWalletId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationWalletId"],
        message: "Seul un versement possède un wallet de destination.",
      });
    }
    if (isRemittance && value.destinationWalletId === value.fieldWalletId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationWalletId"],
        message: "Les wallets source et destination doivent être différents.",
      });
    }
  });

export type FieldDeclarationValues = z.infer<typeof declarationValuesSchema>;

const reportListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
    status: z.enum(FIELD_REPORT_STATUSES).nullable().default(null),
  })
  .strict();

const fieldWalletAssignmentSchema = z
  .object({
    userId: idSchema,
    walletId: idSchema,
    assignmentType: z.enum(["SOURCE", "DESTINATION"]),
    label: nullableText,
    allowImmediateReceipts: z.boolean().default(false),
  })
  .strict();

const revokeFieldWalletAssignmentSchema = z.object({ assignmentId: idSchema }).strict();

function reportPayload(values: z.infer<typeof reportValuesSchema>): Json {
  return {
    report_type: values.reportType,
    period_start: values.periodStart,
    period_end: values.periodEnd,
    notes: values.notes,
  };
}

function declarationPayload(values: FieldDeclarationValues): Json {
  return {
    declaration_type: values.declarationType,
    amount: values.amount,
    occurred_at: values.occurredAt,
    field_wallet_id: values.fieldWalletId,
    destination_wallet_id: values.destinationWalletId,
    category: values.category,
    description: values.description,
    reference: values.reference,
    client_id: values.clientId,
    farm_id: values.farmId,
    inventory_item_id: values.inventoryItemId,
    document_id: values.documentId,
    client_submission_id: values.clientSubmissionId,
  };
}

function calculateTotals(declarations: FieldDeclaration[]): FieldReportDetail["totals"] {
  return declarations.reduce(
    (totals, declaration) => {
      const amount = Number(declaration.amount);
      if (declaration.declaration_type === "RECEIPT") totals.receipts += amount;
      if (declaration.declaration_type === "EXPENSE") totals.expenses += amount;
      if (declaration.declaration_type === "REMITTANCE") totals.remittances += amount;
      if (declaration.status === "CONFIRMED") totals.confirmed += amount;
      if (declaration.status === "SUBMITTED") totals.pending += amount;
      return totals;
    },
    { receipts: 0, expenses: 0, remittances: 0, pending: 0, confirmed: 0 },
  );
}

export const getFieldReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(reportListSchema)
  .handler(async ({ context, data }) => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("field_reports")
      .select("*", { count: "exact" })
      .order("period_end", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.status) query = query.eq("status", data.status);
    const { data: reports, count, error } = await query;
    if (error) throw error;
    return { reports: reports ?? [], total: count ?? 0 };
  });

export const getFieldReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }): Promise<FieldReportDetail> => {
    const { data: report, error: reportError } = await context.supabase
      .from("field_reports")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (reportError) throw reportError;
    if (!report) throw new Error("Rapport terrain introuvable ou non autorisé.");
    const { data: declarations, error: declarationsError } = await context.supabase
      .from("field_declarations")
      .select("*")
      .eq("report_id", data)
      .order("occurred_at", { ascending: false });
    if (declarationsError) throw declarationsError;
    const rows = declarations ?? [];
    return { ...report, declarations: rows, totals: calculateTotals(rows) };
  });

export const getFieldWallets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FieldWallet[]> => {
    const { data: assignments, error: assignmentsError } = await context.supabase
      .from("field_wallet_assignments")
      .select("*")
      .eq("is_active", true)
      .order("assigned_at", { ascending: true });
    if (assignmentsError) throw assignmentsError;
    const rows = assignments ?? [];
    if (rows.length === 0) return [];
    const walletIds = rows.map((row) => row.wallet_id);
    const { data: wallets, error: walletsError } = await context.supabase
      .from("wallets")
      .select("id, name, type, color, balance")
      .in("id", walletIds);
    if (walletsError) throw walletsError;
    const walletsById = new Map((wallets ?? []).map((wallet) => [wallet.id, wallet]));
    return rows.flatMap((assignment) => {
      const wallet = walletsById.get(assignment.wallet_id);
      return wallet ? [{ ...assignment, wallet }] : [];
    });
  });

export const getFieldAssignmentCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FieldAssignableUser[]> => {
    const { data: permitted, error: permissionError } = await context.supabase.rpc(
      "user_has_permission",
      {
        p_permission_code: "field.wallets.assign",
      },
    );
    if (permissionError) throw permissionError;
    if (!permitted) throw new Error("Vous n’avez pas la permission d’affecter un wallet terrain.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .order("full_name", { ascending: true });
    if (error) throw error;
    return (profiles ?? []).map((profile) => ({
      userId: profile.id,
      fullName: profile.full_name,
      username: profile.username,
    }));
  });

export const getFieldAssignableWallets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FieldAssignableWallet[]> => {
    const { data: permitted, error: permissionError } = await context.supabase.rpc(
      "user_has_permission",
      {
        p_permission_code: "field.wallets.assign",
      },
    );
    if (permissionError) throw permissionError;
    if (!permitted) throw new Error("Vous n’avez pas la permission d’affecter un wallet terrain.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wallets, error } = await supabaseAdmin
      .from("wallets")
      .select("id, name, type, color, balance")
      .order("name", { ascending: true });
    if (error) throw error;
    return wallets ?? [];
  });

export const createFieldReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(reportValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: report, error } = await context.supabase.rpc("create_field_report", {
      p_report: reportPayload(data),
    });
    if (error) throw error;
    if (!report) throw new Error("Le rapport terrain n’a pas été créé.");
    return report;
  });

export const assignFieldWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(fieldWalletAssignmentSchema)
  .handler(async ({ context, data }) => {
    const { data: assignment, error } = await context.supabase.rpc("assign_field_wallet", {
      p_assignment: {
        user_id: data.userId,
        wallet_id: data.walletId,
        assignment_type: data.assignmentType,
        label: data.label,
        allow_immediate_receipts: data.allowImmediateReceipts,
      },
    });
    if (error) throw error;
    if (!assignment) throw new Error("L’affectation du wallet terrain a échoué.");
    return assignment;
  });

export const createImmediateFieldReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({ reportId: idSchema, values: declarationValuesSchema })
      .strict()
      .superRefine((value, context) => {
        if (value.values.declarationType !== "RECEIPT") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["values", "declarationType"],
            message: "Seule une recette peut être créditée immédiatement.",
          });
        }
        if (!value.values.clientSubmissionId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["values", "clientSubmissionId"],
            message: "La clé de synchronisation est obligatoire pour une recette immédiate.",
          });
        }
      }),
  )
  .handler(async ({ context, data }) => {
    const { data: declaration, error } = await context.supabase.rpc(
      "create_immediate_field_receipt",
      {
        p_report_id: data.reportId,
        p_receipt: declarationPayload(data.values),
      },
    );
    if (error) throw error;
    if (!declaration) throw new Error("La recette immédiate n’a pas pu être comptabilisée.");
    return declaration;
  });

export const revokeFieldWalletAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(revokeFieldWalletAssignmentSchema)
  .handler(async ({ context, data }) => {
    const { data: assignment, error } = await context.supabase.rpc(
      "revoke_field_wallet_assignment",
      {
        p_assignment_id: data.assignmentId,
      },
    );
    if (error) throw error;
    if (!assignment) throw new Error("Le retrait de l’affectation du wallet terrain a échoué.");
    return assignment;
  });

export const createFieldDeclaration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ reportId: idSchema, values: declarationValuesSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: declaration, error } = await context.supabase.rpc("create_field_declaration", {
      p_report_id: data.reportId,
      p_declaration: declarationPayload(data.values),
    });
    if (error) throw error;
    if (!declaration) throw new Error("La déclaration terrain n’a pas été créée.");
    return declaration;
  });

export const submitFieldReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: report, error } = await context.supabase.rpc("submit_field_report", {
      p_report_id: data.id,
    });
    if (error) throw error;
    if (!report) throw new Error("Le rapport terrain n’a pas été envoyé.");
    return report;
  });

export const confirmFieldDeclaration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: declaration, error } = await context.supabase.rpc("confirm_field_declaration", {
      p_declaration_id: data.id,
    });
    if (error) throw error;
    if (!declaration) throw new Error("La déclaration terrain n’a pas été confirmée.");
    return declaration;
  });

export const rejectFieldDeclaration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(5).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: declaration, error } = await context.supabase.rpc("reject_field_declaration", {
      p_declaration_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!declaration) throw new Error("La déclaration terrain n’a pas été refusée.");
    return declaration;
  });
