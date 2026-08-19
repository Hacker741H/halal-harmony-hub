import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type Driver = Tables<"drivers">;
export type DriverInsert = TablesInsert<"drivers">;
export type DriverUpdate = TablesUpdate<"drivers">;
export type DriverWithEmployee = Driver & {
  employees: Pick<
    Tables<"employees">,
    "id" | "nom" | "prenom" | "telephone" | "poste"
  > | null;
};

const driverIdSchema = z.string().uuid();
const nullableTextSchema = z.string().nullable();
const nullableDateSchema = z.string().date().nullable();
const driverStatusSchema = z.enum([
  "actif",
  "inactif",
  "archive",
  "en_service",
  "en_reparation",
]);

export const DRIVER_STATUS_LABELS: Record<string, string> = {
  actif: "Actif",
  inactif: "Inactif",
  archive: "Archivé",
  en_service: "En service",
  en_reparation: "En réparation",
};

const driverValuesSchema = z
  .object({
    employee_id: driverIdSchema,
    numero_permis: nullableTextSchema,
    categorie_permis: nullableTextSchema,
    date_expiration_permis: nullableDateSchema,
    notes: nullableTextSchema,
    statut: driverStatusSchema,
  })
  .strict();

const updateDriverSchema = z
  .object({
    id: driverIdSchema,
    values: driverValuesSchema.partial(),
  })
  .strict();

export const getDrivers = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("drivers")
      .select(`
        *,
        employees (
          id,
          nom,
          prenom,
          telephone,
          poste
        )
      `)
      .order("created_at", {
        ascending: false,
      });

    if (error) throw error;

    return data ?? [];
  });

export const getDriver = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(driverIdSchema)
  .handler(async ({ context, data }) => {
    const { data: driver, error } = await context.supabase
      .from("drivers")
      .select(`
        *,
        employees (
          id,
          nom,
          prenom,
          telephone,
          poste
        )
      `)
      .eq("id", data)
      .maybeSingle();

    if (error) throw error;
    return driver as DriverWithEmployee | null;
  });

export const getDriverFinanceOperations = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(driverIdSchema)
  .handler(async ({ context, data }) => {
    const { data: operations, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("driver_id", data)
      .order("operation_date", { ascending: false });
    if (error) throw error;
    return operations ?? [];
  });

export const createDriver = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(driverValuesSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("drivers")
      .insert(data)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const updateDriver = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateDriverSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("drivers")
      .update(data.values)
      .eq("id", data.id)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const deleteDriver = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: driverIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { error } = await supabase
      .from("drivers")
      .delete()
      .eq("id", data.id);

    if (error) throw error;

    return true;
  });
