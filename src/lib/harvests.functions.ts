import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type Harvest = Tables<"harvests">;
export type HarvestInsert = TablesInsert<"harvests">;
export type HarvestUpdate = TablesUpdate<"harvests">;

const harvestIdSchema = z.string().uuid();
const harvestValuesSchema = z
  .object({
    farm_id: z.string().uuid(),
    date_recolte: z.string().date(),
    produit: z.string().trim().min(1),
    quantite_kg: z.number().finite().positive(),
    prix_kg: z.number().finite().min(0),
    acheteur: z.string().nullable(),
    observations: z.string().nullable(),
    sale_wallet_id: z.string().uuid().nullable(),
  })
  .strict();

const updateHarvestSchema = z
  .object({
    id: harvestIdSchema,
    values: harvestValuesSchema.partial(),
  })
  .strict()
  .refine(
    ({ values }) => Object.keys(values).length > 0,
    "Au moins une propriÃ©tÃ© doit Ãªtre mise Ã  jour.",
  );

export const getHarvests = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("harvests")
      .select(
        `
        *,
        farms (
          id,
          code,
          nom
        )
      `,
      )
      .order("date_recolte", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getHarvestsByFarm = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(z.string().uuid())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: harvests, error } = await supabase
      .from("harvests")
      .select("*")
      .eq("farm_id", data)
      .order("date_recolte", { ascending: false });

    if (error) throw error;

    return harvests ?? [];
  });

export const createHarvest = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(harvestValuesSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: harvest, error } = await supabase
      .rpc("create_harvest_with_finance", { p_harvest: data });

    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été créée.");

    return harvest;
  });

export const updateHarvest = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateHarvestSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: currentHarvest, error: currentHarvestError } = await supabase
      .from("harvests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();

    if (currentHarvestError) throw currentHarvestError;
    if (!currentHarvest) throw new Error("Récolte introuvable.");

    const values = {
      id: currentHarvest.id,
      farm_id: Object.hasOwn(data.values, "farm_id")
        ? data.values.farm_id
        : currentHarvest.farm_id,
      date_recolte: Object.hasOwn(data.values, "date_recolte")
        ? data.values.date_recolte
        : currentHarvest.date_recolte,
      produit: Object.hasOwn(data.values, "produit")
        ? data.values.produit
        : currentHarvest.produit,
      quantite_kg: Object.hasOwn(data.values, "quantite_kg")
        ? data.values.quantite_kg
        : currentHarvest.quantite_kg,
      prix_kg: Object.hasOwn(data.values, "prix_kg")
        ? data.values.prix_kg
        : currentHarvest.prix_kg,
      acheteur: Object.hasOwn(data.values, "acheteur")
        ? data.values.acheteur
        : currentHarvest.acheteur,
      observations: Object.hasOwn(data.values, "observations")
        ? data.values.observations
        : currentHarvest.observations,
      sale_wallet_id: Object.hasOwn(data.values, "sale_wallet_id")
        ? data.values.sale_wallet_id
        : currentHarvest.sale_wallet_id,
    };

    const { data: harvest, error } = await supabase
      .rpc("update_harvest_with_finance", { p_harvest: values });

    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été mise à jour.");

    return harvest;
  });

export const deleteHarvest = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: harvestIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: deleted, error } = await supabase
      .rpc("delete_harvest_with_finance", { p_harvest_id: data.id });

    if (error) throw error;

    return deleted;
  });
