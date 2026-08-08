import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Tables } from "@/integrations/supabase/types";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

export type Course = Tables<"transport_missions">;
export type CourseBudgetLine = Tables<"transport_mission_budget_lines">;
export type CourseExpense = Tables<"transport_mission_expenses">;
export type CourseInvoice = Tables<"transport_invoices">;
export type CoursePayment = Tables<"transport_invoice_payments">;

export const COURSE_STATUSES = ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"] as const;
export const COURSE_EXPENSE_CATEGORIES = ["FUEL", "ROAD", "MEALS", "MISC", "EXCEPTIONAL_MAINTENANCE"] as const;
export const COURSE_EXPENSE_STATUSES = ["PLANNED", "ENGAGED", "PAID", "CANCELLED"] as const;
export const COURSE_PAYMENT_KINDS = ["ADVANCE", "PAYMENT", "SETTLEMENT"] as const;
export const COURSE_DELIVERY_STATUSES = ["DELIVERED", "PARTIAL", "INCIDENT"] as const;

export const COURSE_STATUS_LABELS: Record<(typeof COURSE_STATUSES)[number], string> = {
  DRAFT: "Brouillon",
  PLANNED: "Planifiée",
  IN_PROGRESS: "En cours",
  COMPLETED: "Terminée",
  CLOSED: "Soldée",
  CANCELLED: "Archivée",
};
export const COURSE_EXPENSE_CATEGORY_LABELS: Record<(typeof COURSE_EXPENSE_CATEGORIES)[number], string> = {
  FUEL: "Carburant", ROAD: "Route", MEALS: "Repas", MISC: "Divers", EXCEPTIONAL_MAINTENANCE: "Maintenance exceptionnelle",
};
export const COURSE_DELIVERY_STATUS_LABELS: Record<(typeof COURSE_DELIVERY_STATUSES)[number], string> = {
  DELIVERED: "Livrée",
  PARTIAL: "Livraison partielle",
  INCIDENT: "Incident signalé",
};

const idSchema = z.string().uuid();
const nullableText = z.string().trim().max(2_000).nullable();
const nullableNumber = z.number().finite().min(0).nullable();
const nullableDate = z.string().date().nullable();
const nullableDateTime = z.string().datetime({ offset: true }).nullable();

const courseValuesBaseSchema = z.object({
  client_id: idSchema,
  vehicle_id: idSchema.nullable(),
  driver_id: idSchema.nullable(),
  departure_location: nullableText,
  destination_location: nullableText,
  cargo_description: nullableText,
  cargo_quantity: nullableNumber,
  cargo_unit: z.string().trim().max(80).nullable(),
  cargo_weight_kg: nullableNumber,
  cargo_volume_m3: nullableNumber,
  distance_km: nullableNumber,
  planned_departure_at: nullableDateTime,
  planned_arrival_at: nullableDateTime,
  actual_departure_at: nullableDateTime,
  actual_arrival_at: nullableDateTime,
  start_odometer: nullableNumber,
  end_odometer: nullableNumber,
  quoted_amount: z.number().finite().min(0),
  reference: z.string().trim().max(255).nullable(),
  notes: nullableText,
  overlap_exception_reason: nullableText,
}).strict();
export const courseValuesSchema = courseValuesBaseSchema.superRefine((value, context) => {
  if (value.planned_departure_at && value.planned_arrival_at && value.planned_arrival_at <= value.planned_departure_at) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["planned_arrival_at"], message: "L'arrivée doit être postérieure au départ." });
  }
  if (value.start_odometer !== null && value.end_odometer !== null && value.end_odometer < value.start_odometer) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end_odometer"], message: "Le kilométrage d'arrivée doit être supérieur ou égal au départ." });
  }
});
export type CourseValues = z.infer<typeof courseValuesSchema>;

const courseUpdateSchema = z.object({ id: idSchema, values: courseValuesBaseSchema.partial() }).strict();
const courseListSchema = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20), search: z.string().trim().max(200).default(""), status: z.enum(COURSE_STATUSES).nullable().default(null), clientId: idSchema.nullable().default(null), driverId: idSchema.nullable().default(null), vehicleId: idSchema.nullable().default(null), from: nullableDate.default(null), to: nullableDate.default(null), operationScope: z.enum(["planning", "assignments", "departures", "deliveries"]).nullable().default(null) }).strict();
const expenseValuesSchema = z.object({ wallet_id: idSchema, category: z.enum(COURSE_EXPENSE_CATEGORIES), amount: z.number().finite().positive(), expense_date: z.string().date(), status: z.enum(["PLANNED", "ENGAGED"]).default("ENGAGED"), description: nullableText, receipt_document_id: idSchema.nullable() }).strict();
const invoiceValuesSchema = z.object({ subtotal_amount: z.number().finite().min(0).nullable(), tax_rate: z.number().finite().min(0).max(100).nullable(), due_date: nullableDate, notes: nullableText }).strict();
const paymentValuesSchema = z.object({ wallet_id: idSchema, amount: z.number().finite().positive(), payment_date: z.string().date(), payment_kind: z.enum(COURSE_PAYMENT_KINDS), reference: z.string().trim().max(255).nullable(), notes: nullableText }).strict();
const assignmentValuesSchema = z.object({ vehicle_id: idSchema, driver_id: idSchema, override_reason: nullableText }).strict();
const departureValuesSchema = z.object({ actual_departure_at: nullableDateTime.nullable(), start_odometer: z.number().finite().min(0) }).strict();
const deliveryValuesSchema = z.object({
  delivery_status: z.enum(COURSE_DELIVERY_STATUSES),
  actual_arrival_at: nullableDateTime.nullable(),
  end_odometer: nullableNumber,
  recipient_name: z.string().trim().max(255).nullable(),
  notes: nullableText,
  reservations: nullableText,
  delivery_document_id: idSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (["DELIVERED", "PARTIAL"].includes(value.delivery_status) && !value.actual_arrival_at) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["actual_arrival_at"], message: "L’arrivée réelle est obligatoire." });
  }
  if (["DELIVERED", "PARTIAL"].includes(value.delivery_status) && value.end_odometer === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end_odometer"], message: "Le kilométrage d’arrivée est obligatoire." });
  }
});
const deliveryCorrectionSchema = z.object({ missionId: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict();

export type CourseFinancialSummary = {
  quoted_amount: number; budget_amount: number; actual_expenses: number; invoiced_amount: number; received_amount: number; amount_due: number; gross_result: number; cash_result: number; cost_per_km: number | null;
};
export type CourseHistoryEntry = { id: string; source_type: string; source_id: string; action: string; created_at: string; performed_by: string | null; before_value: Json | null; after_value: Json | null };
export type CourseListItem = Course & { clientName: string | null; vehicleLabel: string | null; vehicleStatus: string | null; driverName: string | null; driverStatus: string | null; actualExpenses: number | null; amountDue: number | null; grossResult: number | null; invoiceStatus: string | null };
export type CourseDetail = { course: Course; clientName: string | null; vehicle: { id: string; registration: string; brand: string | null; model: string | null; kilometrage: number | null; status: string | null } | null; driver: { id: string; name: string; telephone: string | null; licenseExpiry: string | null } | null; budgets: CourseBudgetLine[]; expenses: CourseExpense[]; invoices: CourseInvoice[]; payments: CoursePayment[]; financial: CourseFinancialSummary | null };

function valuesPayload(values: Partial<CourseValues>): Json {
  return {
    ...(values.client_id !== undefined ? { client_id: values.client_id } : {}), ...(values.vehicle_id !== undefined ? { vehicle_id: values.vehicle_id } : {}), ...(values.driver_id !== undefined ? { driver_id: values.driver_id } : {}), ...(values.departure_location !== undefined ? { departure_location: values.departure_location } : {}), ...(values.destination_location !== undefined ? { destination_location: values.destination_location } : {}), ...(values.cargo_description !== undefined ? { cargo_description: values.cargo_description } : {}), ...(values.cargo_quantity !== undefined ? { cargo_quantity: values.cargo_quantity } : {}), ...(values.cargo_unit !== undefined ? { cargo_unit: values.cargo_unit } : {}), ...(values.cargo_weight_kg !== undefined ? { cargo_weight_kg: values.cargo_weight_kg } : {}), ...(values.cargo_volume_m3 !== undefined ? { cargo_volume_m3: values.cargo_volume_m3 } : {}), ...(values.distance_km !== undefined ? { distance_km: values.distance_km } : {}), ...(values.planned_departure_at !== undefined ? { planned_departure_at: values.planned_departure_at } : {}), ...(values.planned_arrival_at !== undefined ? { planned_arrival_at: values.planned_arrival_at } : {}), ...(values.actual_departure_at !== undefined ? { actual_departure_at: values.actual_departure_at } : {}), ...(values.actual_arrival_at !== undefined ? { actual_arrival_at: values.actual_arrival_at } : {}), ...(values.start_odometer !== undefined ? { start_odometer: values.start_odometer } : {}), ...(values.end_odometer !== undefined ? { end_odometer: values.end_odometer } : {}), ...(values.quoted_amount !== undefined ? { quoted_amount: values.quoted_amount } : {}), ...(values.reference !== undefined ? { reference: values.reference } : {}), ...(values.notes !== undefined ? { notes: values.notes } : {}), ...(values.overlap_exception_reason !== undefined ? { overlap_exception_reason: values.overlap_exception_reason } : {}),
  };
}

function mapRows<T extends { mission_id: string }>(rows: T[], missionIds: string[]) { return new Map(missionIds.map((id) => [id, rows.filter((row) => row.mission_id === id)])); }

export const getCourses = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).validator(courseListSchema).handler(async ({ context, data }): Promise<{ courses: CourseListItem[]; total: number }> => {
  if (data.operationScope) {
    const { error } = await context.supabase.rpc("get_transport_operations_read_access", { p_scope: data.operationScope });
    if (error) throw error;
  }
  const from = (data.page - 1) * data.pageSize;
  let query = context.supabase.from("transport_missions").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, from + data.pageSize - 1);
  if (data.status) query = query.eq("status", data.status);
  if (data.clientId) query = query.eq("client_id", data.clientId);
  if (data.driverId) query = query.eq("driver_id", data.driverId);
  if (data.vehicleId) query = query.eq("vehicle_id", data.vehicleId);
  if (data.from) query = query.gte("planned_departure_at", `${data.from}T00:00:00+00:00`);
  if (data.to) query = query.lte("planned_departure_at", `${data.to}T23:59:59+00:00`);
  if (data.search) {
    const term = data.search.replace(/[%,()]/g, " ");
    query = query.or(`mission_number.ilike.%${term}%,departure_location.ilike.%${term}%,destination_location.ilike.%${term}%,cargo_description.ilike.%${term}%,reference.ilike.%${term}%`);
  }
  const { data: courses, count, error } = await query;
  if (error) throw error;
  const rows = courses ?? [];
  const ids = rows.map((course) => course.id);
  const permissionCodes = new Set(await getPermissionCodesForClient(context.supabase));
  const canReadFinance = permissionCodes.has("missions.finance.read");
  const [clientsResult, vehiclesResult, driversResult, expensesResult, invoicesResult, paymentsResult] = await Promise.all([
    rows.length ? context.supabase.from("transport_clients").select("id, display_name").in("id", rows.map((course) => course.client_id)) : Promise.resolve({ data: [], error: null }),
    rows.some((course) => course.vehicle_id) ? context.supabase.from("vehicles").select("id, registration, status").in("id", rows.flatMap((course) => course.vehicle_id ? [course.vehicle_id] : [])) : Promise.resolve({ data: [], error: null }),
    rows.some((course) => course.driver_id) ? context.supabase.from("drivers").select("id, statut, employees(nom, prenom)").in("id", rows.flatMap((course) => course.driver_id ? [course.driver_id] : [])) : Promise.resolve({ data: [], error: null }),
    canReadFinance && ids.length ? context.supabase.from("transport_mission_expenses").select("mission_id, amount, status").in("mission_id", ids) : Promise.resolve({ data: [], error: null }),
    canReadFinance && ids.length ? context.supabase.from("transport_invoices").select("mission_id, total_amount, status").in("mission_id", ids) : Promise.resolve({ data: [], error: null }),
    canReadFinance && ids.length ? context.supabase.from("transport_invoice_payments").select("mission_id, amount, status").in("mission_id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [clientsResult, vehiclesResult, driversResult, expensesResult, invoicesResult, paymentsResult]) if (result.error) throw result.error;
  const clients = new Map((clientsResult.data ?? []).map((client) => [client.id, client.display_name]));
  const vehicles = new Map((vehiclesResult.data ?? []).map((vehicle) => [vehicle.id, { registration: vehicle.registration, status: vehicle.status }]));
  const drivers = new Map((driversResult.data ?? []).map((driver) => [driver.id, { name: [driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || null, status: driver.statut }]));
  const expenses = mapRows(expensesResult.data ?? [], ids); const invoices = mapRows(invoicesResult.data ?? [], ids); const payments = mapRows(paymentsResult.data ?? [], ids);
  return { courses: rows.map((course) => {
    const expenseTotal = (expenses.get(course.id) ?? []).filter((row) => row.status === "PAID").reduce((sum, row) => sum + Number(row.amount), 0);
    const invoiceRows = (invoices.get(course.id) ?? []).filter((row) => row.status !== "CANCELLED");
    const paid = (payments.get(course.id) ?? []).filter((row) => row.status === "CONFIRMED").reduce((sum, row) => sum + Number(row.amount), 0);
    const billed = invoiceRows.reduce((sum, row) => sum + Number(row.total_amount), 0);
    const vehicle = course.vehicle_id ? vehicles.get(course.vehicle_id) ?? null : null;
    const driver = course.driver_id ? drivers.get(course.driver_id) ?? null : null;
    return { ...course, clientName: clients.get(course.client_id) ?? null, vehicleLabel: vehicle?.registration ?? null, vehicleStatus: vehicle?.status ?? null, driverName: driver?.name ?? null, driverStatus: driver?.status ?? null, actualExpenses: canReadFinance ? expenseTotal : null, amountDue: canReadFinance ? billed - paid : null, grossResult: canReadFinance ? Number(course.quoted_amount) - expenseTotal : null, invoiceStatus: invoiceRows[0]?.status ?? null };
  }), total: count ?? 0 };
});

export const getCourse = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).validator(idSchema).handler(async ({ context, data }): Promise<CourseDetail> => {
  const { data: course, error } = await context.supabase.from("transport_missions").select("*").eq("id", data).maybeSingle();
  if (error) throw error; if (!course) throw new Error("Course introuvable ou non autorisée.");
  const permissionCodes = new Set(await getPermissionCodesForClient(context.supabase)); const canReadFinance = permissionCodes.has("missions.finance.read");
  const [clientResult, vehicleResult, driverResult, budgetsResult, expensesResult, invoiceResult, paymentsResult, financialResult] = await Promise.all([
    context.supabase.from("transport_clients").select("display_name").eq("id", course.client_id).maybeSingle(),
    course.vehicle_id ? context.supabase.from("vehicles").select("id, registration, brand, model, kilometrage, status").eq("id", course.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    course.driver_id ? context.supabase.from("drivers").select("id, numero_permis, date_expiration_permis, employees(nom, prenom, telephone)").eq("id", course.driver_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    context.supabase.from("transport_mission_budget_lines").select("*").eq("mission_id", data).order("category"),
    canReadFinance ? context.supabase.from("transport_mission_expenses").select("*").eq("mission_id", data).order("expense_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canReadFinance ? context.supabase.from("transport_invoices").select("*").eq("mission_id", data).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canReadFinance ? context.supabase.from("transport_invoice_payments").select("*").eq("mission_id", data).order("payment_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canReadFinance ? context.supabase.rpc("get_transport_mission_financial_summary", { p_mission_id: data }) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [clientResult, vehicleResult, driverResult, budgetsResult, expensesResult, invoiceResult, paymentsResult, financialResult]) if (result.error) throw result.error;
  const driver = driverResult.data;
  return { course, clientName: clientResult.data?.display_name ?? null, vehicle: vehicleResult.data, driver: driver ? { id: driver.id, name: [driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur", telephone: driver.employees?.telephone ?? null, licenseExpiry: driver.date_expiration_permis } : null, budgets: budgetsResult.data ?? [], expenses: expensesResult.data ?? [], invoices: invoiceResult.data ?? [], payments: paymentsResult.data ?? [], financial: financialResult.data?.[0] ?? null };
});

export const createCourse = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(courseValuesSchema).handler(async ({ context, data }) => { const { data: course, error } = await context.supabase.rpc("create_transport_mission", { p_mission: valuesPayload(data) }); if (error) throw error; if (!course) throw new Error("La Course n’a pas été créée."); return course; });
export const deleteCourse = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema }).strict()).handler(async ({ context, data }) => { const { data: deleted, error } = await context.supabase.rpc("delete_transport_mission", { p_mission_id: data.id }); if (error) throw error; if (!deleted) throw new Error("La Course n’a pas été supprimée."); return deleted; });
export const updateCourse = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(courseUpdateSchema).handler(async ({ context, data }) => { const { data: course, error } = await context.supabase.rpc("update_transport_mission", { p_mission_id: data.id, p_values: valuesPayload(data.values) }); if (error) throw error; if (!course) throw new Error("La Course n’a pas été mise à jour."); return course; });
export const setCourseStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema, status: z.enum(COURSE_STATUSES), reason: z.string().trim().max(2_000).nullable().default(null) }).strict()).handler(async ({ context, data }) => { const { data: course, error } = await context.supabase.rpc("set_transport_mission_status", { p_mission_id: data.id, p_status: data.status, p_reason: data.reason ?? undefined }); if (error) throw error; if (!course) throw new Error("Le statut de la Course n’a pas été mis à jour."); return course; });
export const saveCourseBudgetLine = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ missionId: idSchema, category: z.enum(COURSE_EXPENSE_CATEGORIES), plannedAmount: z.number().finite().min(0), notes: nullableText }).strict()).handler(async ({ context, data }) => { const { data: line, error } = await context.supabase.rpc("create_transport_mission_budget_line", { p_mission_id: data.missionId, p_line: { category: data.category, planned_amount: data.plannedAmount, notes: data.notes } }); if (error) throw error; return line; });
export const createCourseExpense = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ missionId: idSchema, expense: expenseValuesSchema }).strict()).handler(async ({ context, data }) => { const { data: expense, error } = await context.supabase.rpc("create_transport_mission_expense", { p_mission_id: data.missionId, p_expense: data.expense }); if (error) throw error; return expense; });
export const updateCourseExpense = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema, expense: expenseValuesSchema.partial() }).strict()).handler(async ({ context, data }) => { const { data: expense, error } = await context.supabase.rpc("update_transport_mission_expense", { p_expense_id: data.id, p_values: data.expense }); if (error) throw error; return expense; });
export const confirmCourseExpense = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema }).strict()).handler(async ({ context, data }) => { const { data: expense, error } = await context.supabase.rpc("confirm_transport_mission_expense", { p_expense_id: data.id }); if (error) throw error; return expense; });
export const cancelCourseExpense = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict()).handler(async ({ context, data }) => { const { data: expense, error } = await context.supabase.rpc("cancel_transport_mission_expense", { p_expense_id: data.id, p_reason: data.reason }); if (error) throw error; return expense; });
export const createCourseInvoice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ missionId: idSchema, invoice: invoiceValuesSchema }).strict()).handler(async ({ context, data }) => { const { data: invoice, error } = await context.supabase.rpc("create_transport_invoice", { p_mission_id: data.missionId, p_invoice: data.invoice }); if (error) throw error; return invoice; });
export const issueCourseInvoice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema }).strict()).handler(async ({ context, data }) => { const { data: invoice, error } = await context.supabase.rpc("issue_transport_invoice", { p_invoice_id: data.id }); if (error) throw error; return invoice; });
export const createCoursePayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ invoiceId: idSchema, payment: paymentValuesSchema }).strict()).handler(async ({ context, data }) => { const { data: payment, error } = await context.supabase.rpc("create_transport_invoice_payment", { p_invoice_id: data.invoiceId, p_payment: data.payment }); if (error) throw error; return payment; });
export const confirmCoursePayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema }).strict()).handler(async ({ context, data }) => { const { data: payment, error } = await context.supabase.rpc("confirm_transport_invoice_payment", { p_payment_id: data.id }); if (error) throw error; return payment; });
export const cancelCoursePayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ id: idSchema, reason: z.string().trim().min(3).max(2_000) }).strict()).handler(async ({ context, data }) => { const { data: payment, error } = await context.supabase.rpc("cancel_transport_invoice_payment", { p_payment_id: data.id, p_reason: data.reason }); if (error) throw error; return payment; });
export const assignCourse = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ missionId: idSchema, assignment: assignmentValuesSchema }).strict()).handler(async ({ context, data }) => {
  const { data: course, error } = await context.supabase.rpc("assign_transport_mission", { p_mission_id: data.missionId, p_assignment: data.assignment });
  if (error) throw error;
  if (!course) throw new Error("L’affectation de la Course a échoué.");
  return course;
});
export const confirmCourseDeparture = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ missionId: idSchema, departure: departureValuesSchema }).strict()).handler(async ({ context, data }) => {
  const { data: course, error } = await context.supabase.rpc("confirm_transport_departure", { p_mission_id: data.missionId, p_departure: data.departure });
  if (error) throw error;
  if (!course) throw new Error("La confirmation du départ a échoué.");
  return course;
});
export const confirmCourseDelivery = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(z.object({ missionId: idSchema, delivery: deliveryValuesSchema }).strict()).handler(async ({ context, data }) => {
  const { data: course, error } = await context.supabase.rpc("confirm_transport_delivery", { p_mission_id: data.missionId, p_delivery: data.delivery });
  if (error) throw error;
  if (!course) throw new Error("La confirmation de livraison a échoué.");
  return course;
});
export const correctCourseDelivery = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator(deliveryCorrectionSchema).handler(async ({ context, data }) => {
  const { data: course, error } = await context.supabase.rpc("correct_transport_delivery", { p_mission_id: data.missionId, p_correction: { reason: data.reason } });
  if (error) throw error;
  if (!course) throw new Error("La correction de livraison a échoué.");
  return course;
});
export const getCourseDepartureReadiness = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).validator(idSchema).handler(async ({ context, data }) => {
  const { data: readiness, error } = await context.supabase.rpc("get_transport_departure_readiness", { p_mission_id: data });
  if (error) throw error;
  return readiness ?? [];
});
export const getCourseHistory = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).validator(idSchema).handler(async ({ context, data }): Promise<CourseHistoryEntry[]> => { const { data: history, error } = await context.supabase.rpc("get_transport_mission_history", { p_mission_id: data }); if (error) throw error; return history ?? []; });
