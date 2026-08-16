import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";

export type StockTransfer = Tables<"commerce_stock_transfers">;
export type StockTransferLine = Tables<"commerce_stock_transfer_lines">;

export type StockTransferListItem = StockTransfer & { sourceName: string | null; destinationName: string | null };

export type StockTransferDetail = {
  transfer: StockTransfer;
  sourceName: string | null;
  destinationName: string | null;
  lines: (StockTransferLine & { itemName: string | null; itemSku: string | null })[];
};

const idSchema = z.string().uuid();

export const STOCK_TRANSFER_STATUSES = ["CREATED", "DISPATCHED", "RECEIVED", "CANCELLED"] as const;

const transferLineSchema = z.object({ inventory_item_id: idSchema, quantity: z.number().finite().positive() }).strict();

const transferValuesSchema = z
  .object({
    source_location_id: idSchema,
    destination_location_id: idSchema,
    notes: z.string().trim().max(2_000).nullable(),
    lines: z.array(transferLineSchema).min(1).max(100),
  })
  .strict();

const transferListSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    businessLocationId: idSchema.nullable().default(null),
    status: z.enum(STOCK_TRANSFER_STATUSES).nullable().default(null),
  })
  .strict();

const receiveLineSchema = z.object({ inventory_item_id: idSchema, quantity_received: z.number().finite().min(0) }).strict();

export const getStockTransfers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(transferListSchema)
  .handler(async ({ context, data }): Promise<{ transfers: StockTransferListItem[]; total: number }> => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let query = context.supabase
      .from("commerce_stock_transfers")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.businessLocationId) {
      query = query.or(`source_location_id.eq.${data.businessLocationId},destination_location_id.eq.${data.businessLocationId}`);
    }
    if (data.status) query = query.eq("status", data.status);

    const { data: transfers, count, error } = await query;
    if (error) throw error;
    const rows = transfers ?? [];

    const locationIds = [...new Set(rows.flatMap((row) => [row.source_location_id, row.destination_location_id]))];
    const locationsResult = locationIds.length
      ? await context.supabase.from("business_locations").select("id, name").in("id", locationIds)
      : { data: [], error: null };
    if (locationsResult.error) throw locationsResult.error;
    const locationNames = new Map((locationsResult.data ?? []).map((location) => [location.id, location.name]));

    return {
      transfers: rows.map((row) => ({
        ...row,
        sourceName: locationNames.get(row.source_location_id) ?? null,
        destinationName: locationNames.get(row.destination_location_id) ?? null,
      })),
      total: count ?? 0,
    };
  });

export const getStockTransfer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }): Promise<StockTransferDetail> => {
    const { data: transfer, error: transferError } = await context.supabase
      .from("commerce_stock_transfers")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (transferError) throw transferError;
    if (!transfer) throw new Error("Transfert introuvable ou non autorisé.");

    const [sourceResult, destinationResult, linesResult] = await Promise.all([
      context.supabase.from("business_locations").select("name").eq("id", transfer.source_location_id).maybeSingle(),
      context.supabase.from("business_locations").select("name").eq("id", transfer.destination_location_id).maybeSingle(),
      context.supabase.from("commerce_stock_transfer_lines").select("*").eq("transfer_id", data).order("created_at"),
    ]);
    if (sourceResult.error) throw sourceResult.error;
    if (destinationResult.error) throw destinationResult.error;
    if (linesResult.error) throw linesResult.error;

    const lineRows = linesResult.data ?? [];
    const itemIds = [...new Set(lineRows.map((line) => line.inventory_item_id))];
    const itemsResult = itemIds.length
      ? await context.supabase.from("inventory_items").select("id, nom, sku").in("id", itemIds)
      : { data: [], error: null };
    if (itemsResult.error) throw itemsResult.error;
    const items = new Map((itemsResult.data ?? []).map((item) => [item.id, item]));

    return {
      transfer,
      sourceName: sourceResult.data?.name ?? null,
      destinationName: destinationResult.data?.name ?? null,
      lines: lineRows.map((line) => ({
        ...line,
        itemName: items.get(line.inventory_item_id)?.nom ?? null,
        itemSku: items.get(line.inventory_item_id)?.sku ?? null,
      })),
    };
  });

export const createStockTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(transferValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: transfer, error } = await context.supabase.rpc("create_commerce_stock_transfer", {
      p_transfer: data as Json,
    });
    if (error) throw error;
    if (!transfer) throw new Error("Le transfert n’a pas été créé.");
    return transfer;
  });

export const dispatchStockTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: transfer, error } = await context.supabase.rpc("dispatch_commerce_stock_transfer", { p_transfer_id: data.id });
    if (error) throw error;
    if (!transfer) throw new Error("Le transfert n’a pas été expédié.");
    return transfer;
  });

export const receiveStockTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, lines: z.array(receiveLineSchema).min(1) }).strict())
  .handler(async ({ context, data }) => {
    const { data: transfer, error } = await context.supabase.rpc("receive_commerce_stock_transfer", {
      p_transfer_id: data.id,
      p_lines: data.lines as Json,
    });
    if (error) throw error;
    if (!transfer) throw new Error("Le transfert n’a pas été réceptionné.");
    return transfer;
  });

export const cancelStockTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict())
  .handler(async ({ context, data }) => {
    const { data: transfer, error } = await context.supabase.rpc("cancel_commerce_stock_transfer", {
      p_transfer_id: data.id,
      p_reason: data.reason,
    });
    if (error) throw error;
    if (!transfer) throw new Error("Le transfert n’a pas été annulé.");
    return transfer;
  });
