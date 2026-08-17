import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

export type Notification = Tables<"notifications">;

export const NOTIFICATION_STATUSES = [
  "UNREAD",
  "READ",
  "RESOLVED",
  "DISMISSED",
  "SNOOZED",
] as const;

export const NOTIFICATION_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

const notificationIdSchema = z.string().uuid();
const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);

const notificationListSchema = z
  .object({
    status: notificationStatusSchema.optional(),
    severity: notificationSeveritySchema.optional(),
    type: z.string().trim().min(1).max(120).optional(),
    dueDays: z.union([z.literal(7), z.literal(30)]).optional(),
    search: z.string().trim().max(160).optional(),
    page: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(100).default(30),
  })
  .strict();

const entityRelationSchema = z.enum([
  "driver",
  "employee",
  "contract",
  "document",
  "vehicle",
  "motorcycle",
  "vehicle_maintenance",
  "motorcycle_maintenance",
  "wallet",
  "inventory_item",
]);

export type NotificationEntityRelation = z.infer<typeof entityRelationSchema>;

export interface NotificationListResult {
  notifications: Notification[];
  total: number;
}

export interface NotificationSummary {
  canGenerate: boolean;
  unread: number;
  critical: number;
  dueInSevenDays: number;
  dueInThirtyDays: number;
  lowStock: number;
  overdueMaintenance: number;
}

function isoDateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(notificationListSchema)
  .handler(async ({ context, data }): Promise<NotificationListResult> => {
    let query = context.supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (data.status) query = query.eq("status", data.status);
    if (data.severity) query = query.eq("severity", data.severity);
    if (data.type) query = query.eq("type", data.type);
    if (data.search) {
      const search = data.search.replaceAll(",", " ");
      query = query.or(`titre.ilike.%${search}%,message.ilike.%${search}%`);
    }

    if (data.dueDays) {
      const today = new Date().toISOString().slice(0, 10);
      query = query.gte("due_date", today).lte("due_date", isoDateAfter(data.dueDays));
    }

    const from = data.page * data.pageSize;
    const { data: notifications, count, error } = await query.range(from, from + data.pageSize - 1);
    if (error) throw error;

    return { notifications: notifications ?? [], total: count ?? 0 };
  });

export const getNotificationSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationSummary> => {
    const [summaryResult, permissionCodes] = await Promise.all([
      context.supabase.rpc("get_notification_summary_counts").single(),
      getPermissionCodesForClient(context.supabase),
    ]);
    if (summaryResult.error) throw summaryResult.error;
    const counts = summaryResult.data;

    return {
      canGenerate: permissionCodes.includes("notifications.manage"),
      unread: Number(counts.unread),
      critical: Number(counts.critical),
      dueInSevenDays: Number(counts.due_in_seven_days),
      dueInThirtyDays: Number(counts.due_in_thirty_days),
      lowStock: Number(counts.low_stock),
      overdueMaintenance: Number(counts.overdue_maintenance),
    };
  });

export const updateNotificationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z
      .object({
        id: notificationIdSchema,
        status: notificationStatusSchema,
        snoozed_until: z.string().datetime().nullable().optional(),
      })
      .strict(),
  )
  .handler(async ({ context, data }) => {
    const { data: notification, error } = await context.supabase.rpc(
      "update_notification_status",
      {
        p_notification_id: data.id,
        p_status: data.status,
        p_snoozed_until: data.snoozed_until ?? undefined,
      },
    );
    if (error) throw error;
    if (!notification) throw new Error("La notification n'a pas été mise à jour.");
    return notification;
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("mark_all_notifications_read");
    if (error) throw error;
    return data ?? 0;
  });

export const getNotificationsForEntity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ entityId: notificationIdSchema, relation: entityRelationSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let result:
      | { data: Array<{ notification_id: string }> | null; error: Error | null }
      | undefined;

    switch (data.relation) {
      case "driver":
        result = await supabase
          .from("notification_driver_links")
          .select("notification_id")
          .eq("driver_id", data.entityId);
        break;
      case "employee":
        result = await supabase
          .from("notification_employee_links")
          .select("notification_id")
          .eq("employee_id", data.entityId);
        break;
      case "contract":
        result = await supabase
          .from("notification_contract_links")
          .select("notification_id")
          .eq("contract_id", data.entityId);
        break;
      case "document":
        result = await supabase
          .from("notification_document_links")
          .select("notification_id")
          .eq("document_id", data.entityId);
        break;
      case "vehicle":
        result = await supabase
          .from("notification_vehicle_links")
          .select("notification_id")
          .eq("vehicle_id", data.entityId);
        break;
      case "motorcycle":
        result = await supabase
          .from("notification_motorcycle_links")
          .select("notification_id")
          .eq("motorcycle_id", data.entityId);
        break;
      case "vehicle_maintenance":
        result = await supabase
          .from("notification_vehicle_maintenance_links")
          .select("notification_id")
          .eq("maintenance_id", data.entityId);
        break;
      case "motorcycle_maintenance":
        result = await supabase
          .from("notification_motorcycle_maintenance_links")
          .select("notification_id")
          .eq("motorcycle_maintenance_id", data.entityId);
        break;
      case "wallet":
        result = await supabase
          .from("notification_wallet_links")
          .select("notification_id")
          .eq("wallet_id", data.entityId);
        break;
      case "inventory_item":
        result = await supabase
          .from("notification_inventory_links")
          .select("notification_id")
          .eq("inventory_item_id", data.entityId);
        break;
    }

    if (!result) return [];
    if (result.error) throw result.error;
    const ids = (result.data ?? []).map((link) => link.notification_id);
    if (ids.length === 0) return [];

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return notifications ?? [];
  });
