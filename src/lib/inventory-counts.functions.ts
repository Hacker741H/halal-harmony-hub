import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type InventoryCount = Tables<"commerce_inventory_counts">;
export type InventoryCountLine = Tables<"commerce_inventory_count_lines">;

export type InventoryCountListItem = InventoryCount & { locationName: string | null };

export type InventoryCountDetail = {
  count: InventoryCount;
  locationName: string | null;
  lines: (InventoryCountLine & { itemName: string | null; itemSku: string | null })[];
};

const idSchema = z.string().uuid();

export const INVENTORY_COUNT_STATUSES = ["OPEN", "COMPLETED", "CANCELLED"] as const;

const inventoryCountListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    businessLocationId: idSchema.nullable().default(null),
    status: z.enum(INVENTORY_COUNT_STATUSES).nullable().default(null),
  })
  .strict();

export const getInventoryCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(inventoryCountListSchema)
  .handler(async ({ context, data }): Promise<{ counts: InventoryCountListItem[]; total: number }> => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("commerce_inventory_counts")
      .select("*", { count: "exact" })
      .order("opened_at", { ascending: false })
      .range(from, to);

    if (data.businessLocationId) query = query.eq("business_location_id", data.businessLocationId);
    if (data.status) query = query.eq("status", data.status);

    const { data: counts, count, error } = await query;
    if (error) throw error;
    const rows = counts ?? [];

    const locationIds = [...new Set(rows.map((row) => row.business_location_id))];
    const locationsResult = locationIds.length
      ? await context.supabase.from("business_locations").select("id, name").in("id", locationIds)
      : { data: [], error: null };
    if (locationsResult.error) throw locationsResult.error;
    const locationNames = new Map((locationsResult.data ?? []).map((location) => [location.id, location.name]));

    return {
      counts: rows.map((row) => ({ ...row, locationName: locationNames.get(row.business_location_id) ?? null })),
      total: count ?? 0,
    };
  });

export const getInventoryCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }): Promise<InventoryCountDetail> => {
    const { data: count, error: countError } = await context.supabase
      .from("commerce_inventory_counts")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (countError) throw countError;
    if (!count) throw new Error("Inventaire introuvable ou non autorisé.");

    const [locationResult, linesResult] = await Promise.all([
      context.supabase.from("business_locations").select("name").eq("id", count.business_location_id).maybeSingle(),
      context.supabase.from("commerce_inventory_count_lines").select("*").eq("count_id", data).order("created_at"),
    ]);
    if (locationResult.error) throw locationResult.error;
    if (linesResult.error) throw linesResult.error;

    const lineRows = linesResult.data ?? [];
    const itemIds = [...new Set(lineRows.map((line) => line.inventory_item_id))];
    const itemsResult = itemIds.length
      ? await context.supabase.from("inventory_items").select("id, nom, sku").in("id", itemIds)
      : { data: [], error: null };
    if (itemsResult.error) throw itemsResult.error;
    const items = new Map((itemsResult.data ?? []).map((item) => [item.id, item]));

    return {
      count,
      locationName: locationResult.data?.name ?? null,
      lines: lineRows.map((line) => ({
        ...line,
        itemName: items.get(line.inventory_item_id)?.nom ?? null,
        itemSku: items.get(line.inventory_item_id)?.sku ?? null,
      })),
    };
  });

export const openInventoryCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ businessLocationId: idSchema, notes: z.string().trim().max(2_000).nullable() }).strict())
  .handler(async ({ context, data }) => {
    const { data: count, error } = await context.supabase.rpc("open_commerce_inventory_count", {
      p_business_location_id: data.businessLocationId,
      p_notes: data.notes ?? undefined,
    });
    if (error) throw error;
    if (!count) throw new Error("L’inventaire n’a pas été ouvert.");
    return count;
  });

export const updateInventoryCountLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ countId: idSchema, inventoryItemId: idSchema, countedQuantity: z.number().finite().min(0) }).strict())
  .handler(async ({ context, data }) => {
    const { data: line, error } = await context.supabase.rpc("update_inventory_count_line", {
      p_count_id: data.countId,
      p_inventory_item_id: data.inventoryItemId,
      p_counted_quantity: data.countedQuantity,
    });
    if (error) throw error;
    if (!line) throw new Error("La ligne n’a pas été enregistrée.");
    return line;
  });

export const completeInventoryCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: count, error } = await context.supabase.rpc("complete_commerce_inventory_count", { p_count_id: data.id });
    if (error) throw error;
    if (!count) throw new Error("L’inventaire n’a pas été validé.");
    return count;
  });

export const cancelInventoryCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: count, error } = await context.supabase.rpc("cancel_commerce_inventory_count", {
      p_count_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!count) throw new Error("L’inventaire n’a pas été annulé.");
    return count;
  });
