import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type Farm = Tables<"farms">;
export type FarmInsert = TablesInsert<"farms">;
export type FarmUpdate = TablesUpdate<"farms">;

const farmIdSchema = z.string().uuid();
const nullableTextSchema = z.string().nullable();
const nullableDateSchema = z.string().date().nullable();
const farmStatusSchema = z.enum([
  "actif",
  "inactif",
  "archive",
  "en_service",
  "en_reparation",
]);

const farmValuesSchema = z
  .object({
    code: z.string(),
    nom: z.string(),
    localisation: z.string(),
    village: nullableTextSchema,
    departement: nullableTextSchema,
    type_culture: nullableTextSchema,
    superficie: z.number().finite().min(0).nullable(),
    proprietaire: nullableTextSchema,
    telephone: nullableTextSchema,
    nature: nullableTextSchema,
    prix_kg: z.number().finite().min(0),
    date_debut_contrat: nullableDateSchema,
    date_fin_contrat: nullableDateSchema,
    latitude: z.number().finite().nullable(),
    longitude: z.number().finite().nullable(),
    description: nullableTextSchema,
    statut: farmStatusSchema,
  })
  .strict();

const updateFarmSchema = z
  .object({
    id: farmIdSchema,
    values: farmValuesSchema.omit({ statut: true }).partial(),
  })
  .strict()
  .refine(
    ({ values }) => Object.keys(values).length > 0,
    "Au moins une propriÃ©tÃ© doit Ãªtre mise Ã  jour.",
  );

export const getFarms = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("farms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const createFarm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(farmValuesSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("farms")
      .insert(data)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const updateFarm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateFarmSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("farms")
      .update(data.values)
      .eq("id", data.id)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const deleteFarm = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: farmIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { error } = await supabase
      .from("farms")
      .delete()
      .eq("id", data.id);

    if (error) throw error;

    return true;
  });

export const getFarm = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(farmIdSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: farm, error } = await supabase
      .from("farms")
      .select("*")
      .eq("id", data)
      .single();

    if (error) throw error;

    return farm;
  });
