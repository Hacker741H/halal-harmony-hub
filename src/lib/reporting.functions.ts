import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

export const REPORT_TYPES = [
  "OVERVIEW",
  "FINANCE",
  "TREASURY",
  "VEHICLES",
  "MOTORCYCLES",
  "DRIVERS",
  "EMPLOYEES",
  "FARMS",
  "MAINTENANCE",
  "STOCK",
  "COMPLIANCE",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];
export type SavedReport = Tables<"saved_reports">;
export type ReportingAccess = Record<ReportType, boolean> & {
  canManageSharedReports: boolean;
};

const reportTypeSchema = z.enum(REPORT_TYPES);
const optionalDateSchema = z.string().date().optional();
const optionalIdSchema = z.string().uuid().optional();

export const reportFiltersSchema = z
  .object({
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
    walletId: optionalIdSchema,
    operationType: z.enum(["REVENUE", "EXPENSE", "DEPOSIT", "TRANSFER"]).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    status: z.string().trim().min(1).max(80).optional(),
    driverId: optionalIdSchema,
    employeeId: optionalIdSchema,
    vehicleId: optionalIdSchema,
    motorcycleId: optionalIdSchema,
    farmId: optionalIdSchema,
    inventoryItemId: optionalIdSchema,
    search: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La date de début doit précéder la date de fin.",
        path: ["endDate"],
      });
    }
  });

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

const reportRequestSchema = z
  .object({
    reportType: reportTypeSchema,
    filters: reportFiltersSchema,
  })
  .strict();

const operationsRequestSchema = z
  .object({
    filters: reportFiltersSchema,
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();

const savedReportValuesSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    reportType: reportTypeSchema,
    filters: reportFiltersSchema,
    periodKey: z.string().trim().min(1).max(40).nullable().optional(),
    isShared: z.boolean().default(false),
  })
  .strict();

function filtersToJson(filters: ReportFilters): Json {
  const result: { [key: string]: Json | undefined } = {};
  const keys: Array<keyof ReportFilters> = [
    "startDate",
    "endDate",
    "walletId",
    "operationType",
    "category",
    "status",
    "driverId",
    "employeeId",
    "vehicleId",
    "motorcycleId",
    "farmId",
    "inventoryItemId",
    "search",
  ];

  for (const key of keys) {
    const value = filters[key];
    if (value !== undefined) result[key] = value;
  }

  return result;
}

export const getReportingAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReportingAccess> => {
    const [checks, permissionCodes] = await Promise.all([
      Promise.all(REPORT_TYPES.map(async (reportType) => {
        const { data, error } = await context.supabase.rpc("reporting_can_access_report", {
          p_report_type: reportType,
        });
        if (error) throw error;
        return [reportType, data === true] as const;
      })),
      getPermissionCodesForClient(context.supabase),
    ]);

    const canManageSharedReports = permissionCodes.includes("reports.share");

    return {
      ...Object.fromEntries(checks),
      canManageSharedReports,
    } as ReportingAccess;
  });

export const getManagementReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(reportRequestSchema)
  .handler(async ({ context, data }) => {
    const result = data.reportType === "TREASURY"
      ? await context.supabase.rpc("get_management_treasury_report", {
          p_filters: filtersToJson(data.filters),
        })
      : await context.supabase.rpc("get_management_report", {
          p_report_type: data.reportType,
          p_filters: filtersToJson(data.filters),
        });

    if (result.error) throw result.error;
    return result.data ?? {};
  });

export const getManagementReportOperations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(operationsRequestSchema)
  .handler(async ({ context, data }) => {
    const { data: operations, error } = await context.supabase.rpc(
      "get_management_report_operations",
      {
        p_filters: filtersToJson(data.filters),
        p_page: data.page,
        p_page_size: data.pageSize,
      },
    );

    if (error) throw error;
    return operations ?? [];
  });

export const exportManagementReportOperations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ filters: reportFiltersSchema }).strict())
  .handler(async ({ context, data }) => {
    const pageSize = 100;
    const maximumRows = 10_000;
    const rows: Array<{
      amount: number;
      category: string | null;
      description: string | null;
      operation_date: string;
      source_label: string;
      status: string;
      type: string;
      wallet_name: string;
    }> = [];
    let currentPage = 1;
    let totalCount = 0;

    do {
      const { data: pageRows, error } = await context.supabase.rpc(
        "get_management_report_operations",
        {
          p_filters: filtersToJson(data.filters),
          p_page: currentPage,
          p_page_size: pageSize,
        },
      );
      if (error) throw error;

      const currentRows = pageRows ?? [];
      if (currentRows.length === 0) break;
      totalCount = currentRows[0].total_count;
      if (totalCount > maximumRows) {
        throw new Error(
          `L’export contient ${totalCount} opérations. Affinez les filtres pour rester sous ${maximumRows} lignes.`,
        );
      }

      rows.push(...currentRows);
      currentPage += 1;
    } while (rows.length < totalCount);

    const header = ["Date", "Type", "Statut", "Montant", "Catégorie", "Description", "Wallet", "Source"];
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const amountFormatter = new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    const body = rows.map((row) => [
      row.operation_date,
      row.type,
      row.status,
      `${amountFormatter.format(row.amount)} FCFA`,
      row.category ?? "",
      row.description ?? "",
      row.wallet_name,
      row.source_label,
    ]);
    const generatedAt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Dakar",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    const content = [
      ["Rapport de gestion", "Opérations financières"],
      ["Fuseau horaire", "Africa/Dakar"],
      ["Généré le", generatedAt],
      header,
      ...body,
    ].map((line) => line.map(escapeCsv).join(";")).join("\n");
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Dakar",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const { error: auditError } = await context.supabase.rpc("record_reporting_export", {
      p_report_type: "FINANCE",
      p_row_count: rows.length,
    });
    if (auditError) throw auditError;

    return {
      content: `\uFEFF${content}`,
      filename: `rapport-finance-${date}.csv`,
      rowCount: rows.length,
    };
  });

export const getReportingFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: canAccessOverview, error: accessError } = await context.supabase.rpc(
      "reporting_can_access_report",
      { p_report_type: "OVERVIEW" },
    );
    if (accessError) throw accessError;
    if (canAccessOverview !== true) {
      throw new Error("Vous n'êtes pas autorisé à consulter les rapports.");
    }

    const { data: canViewFinance, error: financeAccessError } = await context.supabase.rpc(
      "reporting_can_access_report",
      { p_report_type: "FINANCE" },
    );
    if (financeAccessError) throw financeAccessError;

    const [vehiclesResult, motorcyclesResult, driversResult, employeesResult, farmsResult, inventoryResult, walletsResult, categoriesResult] =
      await Promise.all([
        context.supabase.from("vehicles").select("id, registration, brand, model").order("registration"),
        context.supabase.from("motorcycles").select("id, immatriculation, marque, modele").order("immatriculation"),
        context.supabase.from("drivers").select("id, employee_id").order("created_at", { ascending: false }),
        context.supabase.from("employees").select("id, nom, prenom").order("nom"),
        context.supabase.from("farms").select("id, nom").order("nom"),
        context.supabase.from("inventory_items").select("id, nom, sku").order("nom"),
        canViewFinance
          ? context.supabase.from("wallets").select("id, name").order("name")
          : Promise.resolve({ data: [], error: null }),
        canViewFinance
          ? context.supabase
              .from("finance_operations")
              .select("category")
              .not("category", "is", null)
              .order("category")
          : Promise.resolve({ data: [], error: null }),
      ]);

    const results = [
      vehiclesResult,
      motorcyclesResult,
      driversResult,
      employeesResult,
      farmsResult,
      inventoryResult,
      walletsResult,
      categoriesResult,
    ];
    const failedResult = results.find((result) => result.error);
    if (failedResult?.error) throw failedResult.error;

    const employeeNames = new Map(
      (employeesResult.data ?? []).map((employee) => [
        employee.id,
        [employee.nom, employee.prenom].filter(Boolean).join(" "),
      ]),
    );
    const categories = Array.from(
      new Set(
        (categoriesResult.data ?? [])
          .map((row) => row.category)
          .filter((category): category is string => category !== null),
      ),
    );

    return {
      wallets: walletsResult.data ?? [],
      vehicles: (vehiclesResult.data ?? []).map((vehicle) => ({
        id: vehicle.id,
        label: [vehicle.registration, vehicle.brand, vehicle.model].filter(Boolean).join(" · "),
      })),
      motorcycles: (motorcyclesResult.data ?? []).map((motorcycle) => ({
        id: motorcycle.id,
        label: [motorcycle.immatriculation, motorcycle.marque, motorcycle.modele]
          .filter(Boolean)
          .join(" · "),
      })),
      drivers: (driversResult.data ?? []).map((driver) => ({
        id: driver.id,
        label: employeeNames.get(driver.employee_id ?? "") ?? "Chauffeur sans employé lié",
      })),
      employees: (employeesResult.data ?? []).map((employee) => ({
        id: employee.id,
        label: [employee.nom, employee.prenom].filter(Boolean).join(" "),
      })),
      farms: farmsResult.data ?? [],
      inventoryItems: (inventoryResult.data ?? []).map((item) => ({
        id: item.id,
        label: [item.nom, item.sku].filter(Boolean).join(" · "),
      })),
      categories,
      canViewFinance: canViewFinance === true,
    };
  });

export const getSavedReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("saved_reports")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  });

export const createSavedReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(savedReportValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: savedReport, error } = await context.supabase
      .from("saved_reports")
      .insert({
        name: data.name,
        report_type: data.reportType,
        filters: filtersToJson(data.filters),
        visible_columns: [],
        sort: {},
        period_key: data.periodKey ?? null,
        is_shared: data.isShared,
      })
      .select()
      .single();

    if (error) throw error;
    return savedReport;
  });

export const deleteSavedReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("saved_reports").delete().eq("id", data.id);
    if (error) throw error;
  });
