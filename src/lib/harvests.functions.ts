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
export type HarvestRecurrenceRule = Tables<"harvest_recurrence_rules">;

export const HARVEST_STATUSES = [
  "PLANNED",
  "STARTED",
  "HARVESTED",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
  "LEGACY",
] as const;
export type HarvestStatus = (typeof HARVEST_STATUSES)[number];

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

export const getHarvest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(harvestIdSchema)
  .handler(async ({ context, data }) => {
    const { data: harvest, error } = await context.supabase
      .from("harvests")
      .select("*, farms (id, code, nom)")
      .eq("id", data)
      .maybeSingle();
    if (error) throw error;
    if (!harvest) throw new Error("Récolte introuvable.");
    return harvest;
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

// Legacy path: creates a harvest with all commercial fields set at once and
// a conditional Finance write, exactly as before. No longer reachable from
// the planning form -- kept only so existing LEGACY rows' data shape stays
// valid and any direct caller doesn't break. New harvests go through
// planHarvest below instead.
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

// LEGACY rows only: the new workflow never deletes a harvest -- it gets
// cancelled (PLANNED only) or simply stays in its final status.
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

// ------------------------------------------------------------------
// Récoltes V1 workflow: PLANNED -> STARTED -> HARVESTED -> DELIVERED ->
// CLOSED, with CANCELLED only reachable from PLANNED, and sell_harvest as
// the sole later, optional entry point for the commercial/Finance side.
// ------------------------------------------------------------------

const planHarvestSchema = z
  .object({
    farm_id: z.string().uuid(),
    produit: z.string().trim().min(1),
    planned_date: z.string().date(),
    responsable_employee_id: z.string().uuid(),
    parcelle: z.string().trim().min(1).nullable().optional(),
    equipe: z.string().trim().min(1).nullable().optional(),
    transporteur: z.string().trim().min(1).nullable().optional(),
    vehicule: z.string().trim().min(1).nullable().optional(),
    destination_prevue: z.string().trim().min(1).nullable().optional(),
    transport_rate_per_kg: z.number().finite().nonnegative().nullable().optional(),
    planning_notes: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const planHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(planHarvestSchema)
  .handler(async ({ context, data }) => {
    const { data: harvest, error } = await context.supabase.rpc("plan_harvest", { p_harvest: data });
    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été planifiée.");
    return harvest;
  });

const startHarvestSchema = z
  .object({
    id: harvestIdSchema,
    responsable_employee_id: z.string().uuid().nullable().optional(),
    equipe: z.string().trim().min(1).nullable().optional(),
    transporteur: z.string().trim().min(1).nullable().optional(),
    vehicule: z.string().trim().min(1).nullable().optional(),
    departure_notes: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const startHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(startHarvestSchema)
  .handler(async ({ context, data }) => {
    const { id, ...payload } = data;
    const { data: harvest, error } = await context.supabase.rpc("start_harvest", { p_harvest_id: id, p_payload: payload });
    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été démarrée.");
    return harvest;
  });

const recordHarvestSchema = z
  .object({
    id: harvestIdSchema,
    poids_recolte_kg: z.number().finite().positive(),
    poids_perte_recolte_kg: z.number().finite().nonnegative().nullable().optional(),
    observations: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const recordHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(recordHarvestSchema)
  .handler(async ({ context, data }) => {
    const { id, ...payload } = data;
    const { data: harvest, error } = await context.supabase.rpc("record_harvest", { p_harvest_id: id, p_payload: payload });
    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été enregistrée.");
    return harvest;
  });

const recordHarvestDeliverySchema = z
  .object({
    id: harvestIdSchema,
    poids_livre_kg: z.number().finite().nonnegative(),
    destination_reelle: z.string().trim().min(1).nullable().optional(),
    receptionnaire: z.string().trim().min(1).nullable().optional(),
    delivery_notes: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const recordHarvestDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(recordHarvestDeliverySchema)
  .handler(async ({ context, data }) => {
    const { id, ...payload } = data;
    const { data: harvest, error } = await context.supabase.rpc("record_harvest_delivery", { p_harvest_id: id, p_payload: payload });
    if (error) throw error;
    if (!harvest) throw new Error("La livraison n'a pas été enregistrée.");
    return harvest;
  });

export const closeHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: harvestIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: harvest, error } = await context.supabase.rpc("close_harvest", { p_harvest_id: data.id });
    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été clôturée.");
    return harvest;
  });

export const rescheduleHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: harvestIdSchema, newDate: z.string().date() }).strict())
  .handler(async ({ context, data }) => {
    const { data: harvest, error } = await context.supabase.rpc("reschedule_harvest", {
      p_harvest_id: data.id,
      p_new_date: data.newDate,
    });
    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été reportée.");
    return harvest;
  });

export const cancelHarvestPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: harvestIdSchema, reason: z.string().trim().min(1).nullable().optional() }).strict())
  .handler(async ({ context, data }) => {
    const { data: harvest, error } = await context.supabase.rpc("cancel_harvest", {
      p_harvest_id: data.id,
      p_reason: data.reason ?? undefined,
    });
    if (error) throw error;
    if (!harvest) throw new Error("La récolte n'a pas été annulée.");
    return harvest;
  });

const sellHarvestSchema = z
  .object({
    id: harvestIdSchema,
    quantite_kg: z.number().finite().positive(),
    prix_kg: z.number().finite().min(0),
    acheteur: z.string().trim().min(1).nullable().optional(),
    sale_wallet_id: z.string().uuid(),
  })
  .strict();

export const sellHarvest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(sellHarvestSchema)
  .handler(async ({ context, data }) => {
    const { id, ...payload } = data;
    const { data: harvest, error } = await context.supabase.rpc("sell_harvest", { p_harvest_id: id, p_payload: payload });
    if (error) throw error;
    if (!harvest) throw new Error("La vente n'a pas été enregistrée.");
    return harvest;
  });

// ------------------------------------------------------------------
// Récurrence : proposer, sans jamais créer automatiquement, le prochain
// cycle une fois le précédent clôturé.
// ------------------------------------------------------------------

const HARVEST_RECURRENCE_FREQUENCIES = ["WEEKLY", "MONTHLY", "CUSTOM_DAYS"] as const;

const configureHarvestRecurrenceSchema = z
  .object({
    farm_id: z.string().uuid(),
    produit: z.string().trim().min(1),
    frequency: z.enum(HARVEST_RECURRENCE_FREQUENCIES),
    interval_value: z.number().int().positive(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    reminder_days_before: z.number().int().nonnegative(),
    anchor_date: z.string().date().nullable().optional(),
  })
  .strict();

export const configureHarvestRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(configureHarvestRecurrenceSchema)
  .handler(async ({ context, data }) => {
    const { data: rule, error } = await context.supabase.rpc("configure_harvest_recurrence", { p_rule: data });
    if (error) throw error;
    if (!rule) throw new Error("La récurrence n'a pas été configurée.");
    return rule;
  });

export const getHarvestRecurrenceRule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ farmId: z.string().uuid(), produit: z.string().trim().min(1) }).strict())
  .handler(async ({ context, data }) => {
    const { data: rule, error } = await context.supabase
      .from("harvest_recurrence_rules")
      .select("*")
      .eq("farm_id", data.farmId)
      .eq("produit", data.produit)
      .maybeSingle();
    if (error) throw error;
    return rule;
  });

export const confirmHarvestCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ ruleId: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    const { data: harvest, error } = await context.supabase.rpc("confirm_harvest_cycle", { p_rule_id: data.ruleId });
    if (error) throw error;
    if (!harvest) throw new Error("Le cycle n'a pas pu être confirmé.");
    return harvest;
  });

export const postponeHarvestCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ ruleId: z.string().uuid(), newDate: z.string().date() }).strict())
  .handler(async ({ context, data }) => {
    const { data: rule, error } = await context.supabase.rpc("postpone_harvest_cycle", {
      p_rule_id: data.ruleId,
      p_new_date: data.newDate,
    });
    if (error) throw error;
    if (!rule) throw new Error("Le cycle n'a pas pu être reporté.");
    return rule;
  });

export const dismissHarvestCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ ruleId: z.string().uuid() }).strict())
  .handler(async ({ context, data }) => {
    const { data: rule, error } = await context.supabase.rpc("dismiss_harvest_cycle", { p_rule_id: data.ruleId });
    if (error) throw error;
    if (!rule) throw new Error("Le cycle n'a pas pu être ignoré.");
    return rule;
  });
