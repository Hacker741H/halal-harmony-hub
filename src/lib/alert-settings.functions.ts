import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";
import { APP_ROLE_VALUES, getPermissionCodesForClient, type AppRole as PermissionAppRole } from "@/lib/permissions.functions";

export type AlertRule = Tables<"notification_alert_rules">;
export type NotificationGenerationRun = Tables<"notification_generation_runs">;
export const APP_ROLES = APP_ROLE_VALUES;
export type AppRole = PermissionAppRole;

export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

const alertSeveritySchema = z.enum(ALERT_SEVERITIES);
const appRoleSchema = z.enum(APP_ROLES);
const uuidSchema = z.string().uuid();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, "Heure invalide.");

const severityScheduleSchema = z
  .record(alertSeveritySchema)
  .refine(
    (schedule) => Object.keys(schedule).every((key) => key === "overdue" || /^\d+$/.test(key)),
    "Les paliers de gravité sont invalides.",
  );

const generalSettingsSchema = z
  .object({
    timezone: z.string().trim().min(1).max(120),
    dailyRunTime: timeSchema,
  })
  .strict();

const alertRuleSchema = z
  .object({
    alertType: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    defaultSeverity: alertSeveritySchema,
    dueDays: z.array(z.number().int().min(0).max(365)).max(12),
    severitySchedule: severityScheduleSchema,
    threshold: z.number().finite().min(0).nullable(),
    recipientRoles: z.array(appRoleSchema).min(1),
  })
  .strict();

const thresholdSchema = z
  .object({ id: uuidSchema, threshold: z.number().finite().min(0).nullable() })
  .strict();

function toJson(schedule: Record<string, (typeof ALERT_SEVERITIES)[number]>): Json {
  const result: Record<string, Json> = {};
  for (const [key, value] of Object.entries(schedule)) result[key] = value;
  return result;
}

export interface AlertSettingsData {
  company: Tables<"company_settings"> | null;
  rules: AlertRule[];
  wallets: Array<Pick<Tables<"wallets">, "id" | "name" | "balance" | "alert_threshold">>;
  inventoryItems: Array<Pick<Tables<"inventory_items">, "id" | "nom" | "stock_actuel" | "seuil_alerte">>;
  latestRun: NotificationGenerationRun | null;
  canManageAlertRules: boolean;
  canManageWalletThresholds: boolean;
  canManageStockThresholds: boolean;
  schedulerConfigured: boolean;
}

export const getAlertSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertSettingsData> => {
    const { supabase } = context;
    const permissionCodes = new Set(await getPermissionCodesForClient(supabase));
    const canManageAlertRules = permissionCodes.has("notifications.settings.manage");
    const canManageWalletThresholds = permissionCodes.has("wallets.manage");
    const canManageStockThresholds = permissionCodes.has("stocks.manage");
    const canReadRuns = permissionCodes.has("notifications.manage");
    const canReadSettings = permissionCodes.has("settings.read") || canManageAlertRules;

    const [companyResult, rulesResult, walletsResult, inventoryResult, latestRunResult, schedulerResult] = await Promise.all([
      canReadSettings
        ? supabase.from("company_settings").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      canReadSettings
        ? supabase.from("notification_alert_rules").select("*").order("alert_type", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      permissionCodes.has("wallets.read") || canManageWalletThresholds
        ? supabase.from("wallets").select("id, name, balance, alert_threshold").order("name", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      permissionCodes.has("stocks.read") || canManageStockThresholds
        ? supabase
        .from("inventory_items")
        .select("id, nom, stock_actuel, seuil_alerte")
        .order("nom", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      canReadRuns
        ? supabase
            .from("notification_generation_runs")
            .select("*")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      canReadRuns
        ? supabase.rpc("notification_scheduler_status")
        : Promise.resolve({ data: null, error: null }),
    ]);

    for (const result of [companyResult, rulesResult, walletsResult, inventoryResult, latestRunResult, schedulerResult]) {
      if (result.error) throw result.error;
    }

    return {
      company: companyResult.data,
      rules: rulesResult.data ?? [],
      wallets: walletsResult.data ?? [],
      inventoryItems: inventoryResult.data ?? [],
      latestRun: latestRunResult.data,
      canManageAlertRules,
      canManageWalletThresholds,
      canManageStockThresholds,
      schedulerConfigured: schedulerResult.data?.[0]?.scheduler_configured ?? false,
    };
  });

export const saveNotificationGeneralSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(generalSettingsSchema)
  .handler(async ({ context, data }) => {
    const { data: company, error } = await context.supabase.rpc("save_notification_general_settings", {
      p_timezone: data.timezone,
      p_daily_run_time: data.dailyRunTime,
    });
    if (error) throw error;
    if (!company) throw new Error("Les paramètres généraux n’ont pas été enregistrés.");
    return company;
  });

export const saveNotificationAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(alertRuleSchema)
  .handler(async ({ context, data }) => {
    const { data: rule, error } = await context.supabase.rpc("save_notification_alert_rule", {
      p_alert_type: data.alertType,
      p_enabled: data.enabled,
      p_default_severity: data.defaultSeverity,
      p_due_days: [...new Set(data.dueDays)].sort((left, right) => right - left),
      p_severity_schedule: toJson(data.severitySchedule),
      p_threshold: data.threshold ?? undefined,
      p_recipient_roles: data.recipientRoles,
    });
    if (error) throw error;
    if (!rule) throw new Error("La règle d’alerte n’a pas été enregistrée.");
    return rule;
  });

export const saveWalletAlertThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(thresholdSchema)
  .handler(async ({ context, data }) => {
    const { data: wallet, error } = await context.supabase.rpc("set_wallet_alert_threshold", {
      p_wallet_id: data.id,
      p_alert_threshold: data.threshold ?? undefined,
    });
    if (error) throw error;
    if (!wallet) throw new Error("Le seuil du wallet n’a pas été enregistré.");
    return wallet;
  });

export const saveInventoryAlertThreshold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({ id: uuidSchema, threshold: z.number().finite().min(0) }).strict(),
  )
  .handler(async ({ context, data }) => {
    const { data: inventoryItem, error } = await context.supabase.rpc("set_inventory_alert_threshold", {
      p_inventory_item_id: data.id,
      p_alert_threshold: data.threshold,
    });
    if (error) throw error;
    if (!inventoryItem) throw new Error("Le seuil de l’article n’a pas été enregistré.");
    return inventoryItem;
  });

export const runNotificationsManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationGenerationRun> => {
    const { data: run, error } = await context.supabase.rpc("run_notification_generation", {
      p_trigger_type: "MANUAL",
    });
    if (error) throw error;
    if (!run) throw new Error("La génération n’a pas retourné de résultat.");
    if (run.status === "FAILED") throw new Error(run.error_message ?? "La génération des alertes a échoué.");
    return run;
  });
