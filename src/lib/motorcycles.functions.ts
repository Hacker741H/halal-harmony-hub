import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type Motorcycle = Tables<"motorcycles">;

const motorcycleIdSchema = z.string().uuid();
const nullableTextSchema = z.string().nullable();
const nullableDateSchema = z.string().date().nullable();
const motorcycleStatusSchema = z.enum([
  "actif",
  "inactif",
  "archive",
  "en_service",
  "en_reparation",
]);

export const MOTORCYCLE_STATUS_LABELS: Record<string, string> = {
  actif: "Actif",
  inactif: "Inactif",
  archive: "Archivée",
  en_service: "En service",
  en_reparation: "En réparation",
};

const motorcycleValuesSchema = z
  .object({
    immatriculation: z.string().trim().min(1),
    marque: nullableTextSchema,
    modele: nullableTextSchema,
    couleur: nullableTextSchema,
    annee: z.number().int().min(0).nullable(),
    kilometrage: z.number().finite().min(0).nullable(),
    prix_achat: z.number().finite().min(0).nullable(),
    date_achat: nullableDateSchema,
    assurance_expiration: nullableDateSchema,
    visite_expiration: nullableDateSchema,
    derniere_revision: nullableDateSchema,
    prochaine_revision: nullableDateSchema,
    observations: nullableTextSchema,
    statut: motorcycleStatusSchema,
    purchase_wallet_id: motorcycleIdSchema.nullable(),
  })
  .strict();

const createMotorcycleSchema = motorcycleValuesSchema;
const updateMotorcycleSchema = motorcycleValuesSchema
  .omit({ statut: true })
  .partial()
  .extend({ id: motorcycleIdSchema })
  .strict()
  .refine(
    ({ id: _id, ...values }) => Object.keys(values).length > 0,
    "Au moins une propriÃ©tÃ© doit Ãªtre mise Ã  jour.",
  );

export const getMotorcycles = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("motorcycles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getMotorcycle = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(motorcycleIdSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: motorcycle, error } = await supabase
      .from("motorcycles")
      .select("*")
      .eq("id", data)
      .single();

    if (error) throw error;

    return motorcycle;
  });

export const createMotorcycle = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(createMotorcycleSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: created, error } = await supabase.rpc(
      "create_motorcycle_with_purchase",
      { p_motorcycle: data },
    );

    if (error) throw error;
    if (!created) throw new Error("La moto n'a pas été créée.");

    return created;
  });

export const updateMotorcycle = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateMotorcycleSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: currentMotorcycle, error: currentMotorcycleError } =
      await supabase
        .from("motorcycles")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();

    if (currentMotorcycleError) throw currentMotorcycleError;
    if (!currentMotorcycle) throw new Error("Moto introuvable.");

    const values = {
      id: currentMotorcycle.id,
      immatriculation: Object.hasOwn(data, "immatriculation")
        ? data.immatriculation
        : currentMotorcycle.immatriculation,
      marque: Object.hasOwn(data, "marque")
        ? data.marque
        : currentMotorcycle.marque,
      modele: Object.hasOwn(data, "modele")
        ? data.modele
        : currentMotorcycle.modele,
      couleur: Object.hasOwn(data, "couleur")
        ? data.couleur
        : currentMotorcycle.couleur,
      annee: Object.hasOwn(data, "annee") ? data.annee : currentMotorcycle.annee,
      kilometrage: Object.hasOwn(data, "kilometrage")
        ? data.kilometrage
        : currentMotorcycle.kilometrage,
      prix_achat: Object.hasOwn(data, "prix_achat")
        ? data.prix_achat
        : currentMotorcycle.prix_achat,
      date_achat: Object.hasOwn(data, "date_achat")
        ? data.date_achat
        : currentMotorcycle.date_achat,
      assurance_expiration: Object.hasOwn(data, "assurance_expiration")
        ? data.assurance_expiration
        : currentMotorcycle.assurance_expiration,
      visite_expiration: Object.hasOwn(data, "visite_expiration")
        ? data.visite_expiration
        : currentMotorcycle.visite_expiration,
      derniere_revision: Object.hasOwn(data, "derniere_revision")
        ? data.derniere_revision
        : currentMotorcycle.derniere_revision,
      prochaine_revision: Object.hasOwn(data, "prochaine_revision")
        ? data.prochaine_revision
        : currentMotorcycle.prochaine_revision,
      observations: Object.hasOwn(data, "observations")
        ? data.observations
        : currentMotorcycle.observations,
      statut: currentMotorcycle.statut,
      driver_id: currentMotorcycle.driver_id,
      purchase_wallet_id: Object.hasOwn(data, "purchase_wallet_id")
        ? data.purchase_wallet_id
        : currentMotorcycle.purchase_wallet_id,
    };

    const { data: updated, error } = await supabase.rpc(
      "update_motorcycle_with_purchase",
      { p_motorcycle: values },
    );

    if (error) throw error;
    if (!updated) throw new Error("La moto n'a pas été mise à jour.");

    return updated;
  });

export const deleteMotorcycle = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: motorcycleIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: deleted, error } = await supabase.rpc(
      "delete_motorcycle_with_purchase",
      { p_motorcycle_id: data.id },
    );

    if (error) throw error;

    return deleted;
  });

export const getMotorcycleFinanceOperations = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(motorcycleIdSchema)
  .handler(async ({ context, data }) => {
    const { data: operations, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("motorcycle_id", data)
      .order("operation_date", { ascending: false });

    if (error) throw error;

    return operations ?? [];
  });
