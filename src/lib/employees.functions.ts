import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type Employee = Tables<"employees">;
export type EmployeeInsert = TablesInsert<"employees">;
export type EmployeeUpdate = TablesUpdate<"employees">;

const employeeIdSchema = z.string().uuid();
const nullableTextSchema = z.string().nullable();
const nullableDateSchema = z.string().date().nullable();
const employeeStatusSchema = z.enum([
  "actif",
  "inactif",
  "archive",
  "en_service",
  "en_reparation",
]);

const employeeValuesSchema = z
  .object({
    nom: z.string().trim().min(1),
    prenom: nullableTextSchema,
    telephone: nullableTextSchema,
    email: nullableTextSchema,
    poste: nullableTextSchema,
    matricule: nullableTextSchema,
    salaire_base: z.number().finite().nullable(),
    date_embauche: nullableDateSchema,
    statut: employeeStatusSchema,
  })
  .strict();

const updateEmployeeSchema = z
  .object({
    id: employeeIdSchema,
    values: employeeValuesSchema.partial(),
  })
  .strict();

export const getEmployees = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getEmployee = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(employeeIdSchema)
  .handler(async ({ context, data }) => {
    const { data: employee, error } = await context.supabase
      .from("employees")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (error) throw error;
    return employee;
  });

export const getEmployeeDriver = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(employeeIdSchema)
  .handler(async ({ context, data }) => {
    const { data: driver, error } = await context.supabase
      .from("drivers")
      .select("*")
      .eq("employee_id", data)
      .maybeSingle();
    if (error) throw error;
    return driver;
  });

export const getEmployeeFinanceOperations = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(employeeIdSchema)
  .handler(async ({ context, data }) => {
    const { data: operations, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("employee_id", data)
      .order("operation_date", { ascending: false });
    if (error) throw error;
    return operations ?? [];
  });

export const createEmployee = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(employeeValuesSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("employees")
      .insert(data)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const updateEmployee = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateEmployeeSchema)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { data: result, error } = await supabase
      .from("employees")
      .update(data.values)
      .eq("id", data.id)
      .select()
      .single();

    if (error) throw error;

    return result;
  });

export const deleteEmployee = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: employeeIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", data.id);

    if (error) throw error;

    return true;
  });
