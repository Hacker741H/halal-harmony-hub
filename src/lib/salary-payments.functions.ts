import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type SalaryPayment = Tables<"salary_payments">;
export type SalaryPaymentPerson = {
  driver_id: string | null;
  employee_id: string;
  nom: string;
  prenom: string | null;
};

const salaryPaymentIdSchema = z.string().uuid();
const nullableUuidSchema = z.string().uuid().nullable();
const nullableTextSchema = z.string().trim().nullable();

const salaryPaymentObjectSchema = z
  .object({
    employee_id: nullableUuidSchema,
    driver_id: nullableUuidSchema,
    contract_id: nullableUuidSchema,
    wallet_id: z.string().uuid(),
    period_start: z.string().date(),
    paid_at: z.string().date(),
    amount: z.number().finite().positive(),
    is_partial: z.boolean(),
    reference: nullableTextSchema,
    description: nullableTextSchema,
  })
  .strict();

const salaryPaymentValuesSchema = salaryPaymentObjectSchema
  .refine(
    ({ employee_id, driver_id }) => Boolean(employee_id || driver_id),
    "Un employé ou un chauffeur est obligatoire.",
  );

const updateSalaryPaymentSchema = salaryPaymentObjectSchema
  .extend({ id: salaryPaymentIdSchema })
  .strict()
  .refine(
    ({ employee_id, driver_id }) => Boolean(employee_id || driver_id),
    "Un employé ou un chauffeur est obligatoire.",
  );

export const getSalaryPaymentPeople = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SalaryPaymentPerson[]> => {
    const { data, error } = await context.supabase.rpc("get_salary_payment_people");
    if (error) throw error;
    return data ?? [];
  });

export const getSalaryPayments = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("salary_payments")
      .select("*")
      .order("paid_at", { ascending: false });

    if (error) throw error;

    return data ?? [];
  });

export const getSalaryPaymentsByEmployee = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(z.string().uuid())
  .handler(async ({ context, data }) => {
    const { data: payments, error } = await context.supabase
      .from("salary_payments")
      .select("*")
      .eq("employee_id", data)
      .order("paid_at", { ascending: false });

    if (error) throw error;

    return payments ?? [];
  });

export const getSalaryPaymentsByDriver = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(z.string().uuid())
  .handler(async ({ context, data }) => {
    const { data: payments, error } = await context.supabase
      .from("salary_payments")
      .select("*")
      .eq("driver_id", data)
      .order("paid_at", { ascending: false });

    if (error) throw error;

    return payments ?? [];
  });

export const createSalaryPayment = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(salaryPaymentValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc(
      "create_salary_payment_with_finance",
      { p_payment: data },
    );

    if (error) throw error;
    if (!payment) throw new Error("Le paiement de salaire n'a pas été créé.");

    return payment;
  });

export const updateSalaryPayment = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateSalaryPaymentSchema)
  .handler(async ({ context, data }) => {
    const { data: payment, error } = await context.supabase.rpc(
      "update_salary_payment_with_finance",
      { p_payment: data },
    );

    if (error) throw error;
    if (!payment) throw new Error("Le paiement de salaire n'a pas été mis à jour.");

    return payment;
  });

export const cancelSalaryPayment = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: salaryPaymentIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: cancelled, error } = await context.supabase.rpc(
      "cancel_salary_payment_with_finance",
      { p_payment_id: data.id },
    );

    if (error) throw error;

    return cancelled;
  });
