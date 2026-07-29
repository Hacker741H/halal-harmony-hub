import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type Stock = Tables<"inventory_items">;
export type StockInsert = TablesInsert<"inventory_items">;
export type StockUpdate = TablesUpdate<"inventory_items">;

const stockIdSchema = z.string().uuid();
const stockValuesSchema = z
  .object({
    nom: z.string().trim().min(1),
    categorie: z.string().nullable(),
    sku: z.string().nullable(),
    unite: z.string().nullable(),
    stock_actuel: z.number().finite(),
    seuil_alerte: z.number().finite().nullable(),
  })
  .strict();

const updateStockSchema = z
  .object({
    id: stockIdSchema,
    values: stockValuesSchema.partial(),
  })
  .strict()
  .refine(
    ({ values }) => Object.keys(values).length > 0,
    "Au moins une propriÃ©tÃ© doit Ãªtre mise Ã  jour.",
  );

export const getStocks = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const createStock = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(stockValuesSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("inventory_items")
      .insert(data)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const updateStock = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateStockSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("inventory_items")
      .update(data.values)
      .eq("id", data.id)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const deleteStock = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: stockIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { error } = await supabase
      .from("inventory_items")
      .delete()
      .eq("id", data.id);

    if (error) throw error;

    return true;
  });
