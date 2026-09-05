import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type MotorcycleMaintenance = Tables<"motorcycle_maintenances">;

const motorcycleIdSchema = z.string().uuid();
const maintenanceIdSchema = z.string().uuid();
const nullableTextSchema = z.string().nullable();
const nullableDateSchema = z.string().date().nullable();

const motorcycleMaintenanceValuesSchema = z
  .object({
    motorcycle_id: motorcycleIdSchema,
    type: z.string().trim().min(1),
    maintenance_date: z.string().date(),
    kilometrage: z.number().finite().min(0).nullable(),
    cost: z.number().finite().min(0).nullable(),
    garage: nullableTextSchema,
    next_date: nullableDateSchema,
    next_kilometrage: z.number().finite().min(0).nullable(),
    description: nullableTextSchema,
    wallet_id: z.string().uuid().nullable(),
  })
  .strict();

const updateMotorcycleMaintenanceSchema = motorcycleMaintenanceValuesSchema
  .partial()
  .extend({ id: maintenanceIdSchema })
  .strict()
  .refine(
    ({ id: _id, ...values }) => Object.keys(values).length > 0,
    "Au moins une propriÃ©tÃ© doit Ãªtre mise Ã  jour.",
  );

export const getAllMotorcycleMaintenances = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("motorcycle_maintenances")
      .select(
        `
        *,
        motorcycles (
          id,
          immatriculation,
          marque,
          modele
        )
      `,
      )
      .order("maintenance_date", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getMotorcycleMaintenances = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(motorcycleIdSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: maintenances, error } = await supabase
      .from("motorcycle_maintenances")
      .select("*")
      .eq("motorcycle_id", data)
      .order("maintenance_date", { ascending: false });

    if (error) throw error;

    return maintenances ?? [];
  });

export const createMotorcycleMaintenance = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(motorcycleMaintenanceValuesSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: created, error } = await supabase.rpc(
      "create_motorcycle_maintenance_with_finance",
      { p_maintenance: data },
    );

    if (error) throw error;
    if (!created) throw new Error("L'entretien moto n'a pas été créé.");

    return created;
  });

export const updateMotorcycleMaintenance = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateMotorcycleMaintenanceSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: currentMaintenance, error: currentMaintenanceError } =
      await supabase
        .from("motorcycle_maintenances")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();

    if (currentMaintenanceError) throw currentMaintenanceError;
    if (!currentMaintenance) throw new Error("Entretien moto introuvable.");

    const values = {
      id: currentMaintenance.id,
      motorcycle_id: Object.hasOwn(data, "motorcycle_id")
        ? data.motorcycle_id
        : currentMaintenance.motorcycle_id,
      type: Object.hasOwn(data, "type") ? data.type : currentMaintenance.type,
      maintenance_date: Object.hasOwn(data, "maintenance_date")
        ? data.maintenance_date
        : currentMaintenance.maintenance_date,
      kilometrage: Object.hasOwn(data, "kilometrage")
        ? data.kilometrage
        : currentMaintenance.kilometrage,
      cost: Object.hasOwn(data, "cost") ? data.cost : currentMaintenance.cost,
      garage: Object.hasOwn(data, "garage")
        ? data.garage
        : currentMaintenance.garage,
      next_date: Object.hasOwn(data, "next_date")
        ? data.next_date
        : currentMaintenance.next_date,
      next_kilometrage: Object.hasOwn(data, "next_kilometrage")
        ? data.next_kilometrage
        : currentMaintenance.next_kilometrage,
      description: Object.hasOwn(data, "description")
        ? data.description
        : currentMaintenance.description,
      wallet_id: Object.hasOwn(data, "wallet_id") ? data.wallet_id : null,
    };

    const { data: updated, error } = await supabase.rpc(
      "update_motorcycle_maintenance_with_finance",
      { p_maintenance: values },
    );

    if (error) throw error;
    if (!updated) throw new Error("L'entretien moto n'a pas été mis à jour.");

    return updated;
  });

export const deleteMotorcycleMaintenance = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: maintenanceIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: deleted, error } = await supabase.rpc(
      "delete_motorcycle_maintenance_with_finance",
      { p_maintenance_id: data.id },
    );

    if (error) throw error;

    return deleted;
  });

export const getMotorcycleMaintenanceFinanceOperation = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(maintenanceIdSchema)
  .handler(async ({ context, data }) => {
    const { data: operation, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("motorcycle_maintenance_id", data)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return operation;
  });
