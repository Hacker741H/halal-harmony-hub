import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const GLOBAL_CONTROL_CENTER_SEVERITIES = ["CRITICAL", "WARNING", "INFO"] as const;
export type GlobalControlCenterSeverity = (typeof GLOBAL_CONTROL_CENTER_SEVERITIES)[number];

export const GLOBAL_CONTROL_CENTER_MODULES = [
  "NOTIFICATIONS",
  "COMMERCE_CASH",
  "COMMERCE_CREDIT",
  "COMMERCE_STOCK",
  "FIELD",
  "TRANSPORT",
  "HALAL_FIELD",
] as const;
export type GlobalControlCenterModule = (typeof GLOBAL_CONTROL_CENTER_MODULES)[number];

// Status is a passthrough of whatever each source module already uses
// (UNREAD/READ for notifications, PENDING_CONTROL/REVIEW_REQUIRED for cash,
// OPEN for inventories, DISPATCHED for transfers, SUBMITTED for Field...).
// There is no single shared enum to validate against without hardcoding
// every domain's internal vocabulary here, so it stays a free-text filter.

const itemSchema = z.object({
  item_id: z.string(),
  source_module: z.string(),
  source_type: z.string(),
  source_id: z.string().uuid(),
  business_location_id: z.string().uuid().nullable(),
  severity: z.string(),
  status: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  amount: z.number().nullable(),
  occurred_at: z.string(),
  actor: z.string().nullable(),
  action_label: z.string(),
  // Nullable : notifications.entity_route (supabase/migrations/20260728184000_add_notifications_alerts_center.sql)
  // n'a ni NOT NULL ni DEFAULT -- toute notification anterieure a cette
  // migration (hors CONTRAINT_EXPIRY, seul type retro-rempli) a
  // legitimement entity_route = NULL en base. Le crash reel : .parse()
  // echouait sur cette seule ligne et faisait tomber tout le centre de
  // controle (tous modules confondus, pas seulement Notifications).
  action_route: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  total_count: z.number(),
});

export interface GlobalControlCenterItem {
  itemId: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  businessLocationId: string | null;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  amount: number | null;
  occurredAt: string;
  actor: string | null;
  actionLabel: string;
  actionRoute: string | null;
}

export interface GlobalControlCenterResult {
  items: GlobalControlCenterItem[];
  total: number;
}

function toItem(row: z.infer<typeof itemSchema>): GlobalControlCenterItem {
  return {
    itemId: row.item_id,
    sourceModule: row.source_module,
    sourceType: row.source_type,
    sourceId: row.source_id,
    businessLocationId: row.business_location_id,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    amount: row.amount,
    occurredAt: row.occurred_at,
    actor: row.actor,
    actionLabel: row.action_label,
    actionRoute: row.action_route,
  };
}

const filtersSchema = z
  .object({
    module: z.enum(GLOBAL_CONTROL_CENTER_MODULES).optional(),
    severity: z.enum(GLOBAL_CONTROL_CENTER_SEVERITIES).optional(),
    status: z.string().trim().min(1).max(60).optional(),
    businessLocationId: z.string().uuid().optional(),
    from: z.string().trim().min(1).max(20).optional(),
    to: z.string().trim().min(1).max(20).optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export type GlobalControlCenterFilters = z.infer<typeof filtersSchema>;

export const getGlobalControlCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(filtersSchema)
  .handler(async ({ context, data }): Promise<GlobalControlCenterResult> => {
    const { data: rows, error } = await context.supabase.rpc("get_global_control_center", {
      p_module: data.module,
      p_severity: data.severity,
      p_status: data.status,
      p_business_location_id: data.businessLocationId,
      p_from: data.from,
      p_to: data.to,
      p_page: data.page,
      p_page_size: data.pageSize,
    });
    if (error) throw error;

    const parsed = z.array(itemSchema).parse(rows ?? []);
    return { items: parsed.map(toItem), total: parsed[0]?.total_count ?? 0 };
  });

export interface GlobalControlCenterSeverityCounts {
  critical: number;
  warning: number;
  info: number;
}

export const getGlobalControlCenterSeverityCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GlobalControlCenterSeverityCounts> => {
    const [critical, warning, info] = await Promise.all(
      GLOBAL_CONTROL_CENTER_SEVERITIES.map((severity) =>
        context.supabase.rpc("get_global_control_center", {
          p_severity: severity,
          p_page: 1,
          p_page_size: 1,
        }),
      ),
    );
    for (const result of [critical, warning, info]) {
      if (result.error) throw result.error;
    }
    const countOf = (result: typeof critical) => {
      const rows = z.array(itemSchema).parse(result.data ?? []);
      return rows[0]?.total_count ?? 0;
    };
    return { critical: countOf(critical), warning: countOf(warning), info: countOf(info) };
  });

const locationSchema = z.object({ id: z.string().uuid(), name: z.string(), code: z.string() });
export type GlobalControlCenterLocation = z.infer<typeof locationSchema>;

export const getGlobalControlCenterLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GlobalControlCenterLocation[]> => {
    const { data, error } = await context.supabase.rpc("get_commerce_pos_locations");
    if (error) throw error;
    return z.array(locationSchema).parse(data ?? []);
  });
