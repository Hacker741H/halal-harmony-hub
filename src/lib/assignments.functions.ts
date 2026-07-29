import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";

export type DriverVehicleAssignment = Tables<"driver_vehicle_assignments">;
export type DriverMotorcycleAssignment = Tables<"driver_motorcycle_assignments">;

export type AssignmentDriver = Pick<
  Tables<"drivers">,
  "id" | "numero_permis" | "categorie_permis" | "date_expiration_permis" | "statut"
> & {
  employee: Pick<Tables<"employees">, "id" | "nom" | "prenom" | "telephone" | "poste"> | null;
};

export type VehicleAssignmentWithRelations = DriverVehicleAssignment & {
  driver: AssignmentDriver | null;
  vehicle: Pick<Tables<"vehicles">, "id" | "registration" | "brand" | "model" | "status"> | null;
};

export type MotorcycleAssignmentWithRelations = DriverMotorcycleAssignment & {
  driver: AssignmentDriver | null;
  motorcycle: Pick<
    Tables<"motorcycles">,
    "id" | "immatriculation" | "marque" | "modele" | "statut"
  > | null;
};

const idSchema = z.string().uuid();
const nullableDateSchema = z.string().date().nullable();
const nullableTextSchema = z.string().trim().max(2_000).nullable();

const assignVehicleSchema = z
  .object({
    driver_id: idSchema,
    vehicle_id: idSchema,
    start_date: nullableDateSchema,
    notes: nullableTextSchema,
  })
  .strict();

const assignMotorcycleSchema = z
  .object({
    driver_id: idSchema,
    motorcycle_id: idSchema,
    start_date: nullableDateSchema,
    notes: nullableTextSchema,
  })
  .strict();

const closeAssignmentSchema = z
  .object({
    id: idSchema,
    end_date: nullableDateSchema,
    notes: nullableTextSchema,
  })
  .strict();

type Supabase = SupabaseClient<Database>;

async function loadDriverSummaries(supabase: Supabase, driverIds: string[]) {
  if (driverIds.length === 0) return new Map<string, AssignmentDriver>();

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id, numero_permis, categorie_permis, date_expiration_permis, statut, employee_id")
    .in("id", driverIds);

  if (driversError) throw driversError;

  const employeeIds = (drivers ?? [])
    .map((driver) => driver.employee_id)
    .filter((employeeId): employeeId is string => Boolean(employeeId));

  const employeesById = new Map<
    string,
    Pick<Tables<"employees">, "id" | "nom" | "prenom" | "telephone" | "poste">
  >();

  if (employeeIds.length > 0) {
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, nom, prenom, telephone, poste")
      .in("id", employeeIds);

    if (employeesError) throw employeesError;

    for (const employee of employees ?? []) {
      employeesById.set(employee.id, employee);
    }
  }

  return new Map(
    (drivers ?? []).map((driver) => [
      driver.id,
      {
        id: driver.id,
        numero_permis: driver.numero_permis,
        categorie_permis: driver.categorie_permis,
        date_expiration_permis: driver.date_expiration_permis,
        statut: driver.statut,
        employee: driver.employee_id ? employeesById.get(driver.employee_id) ?? null : null,
      },
    ]),
  );
}

async function withVehicleRelations(
  supabase: Supabase,
  assignments: DriverVehicleAssignment[],
): Promise<VehicleAssignmentWithRelations[]> {
  const driversById = await loadDriverSummaries(
    supabase,
    [...new Set(assignments.map((assignment) => assignment.driver_id))],
  );
  const vehicleIds = [...new Set(assignments.map((assignment) => assignment.vehicle_id))];
  const vehiclesById = new Map<
    string,
    Pick<Tables<"vehicles">, "id" | "registration" | "brand" | "model" | "status">
  >();

  if (vehicleIds.length > 0) {
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("id, registration, brand, model, status")
      .in("id", vehicleIds);
    if (error) throw error;
    for (const vehicle of vehicles ?? []) vehiclesById.set(vehicle.id, vehicle);
  }

  return assignments.map((assignment) => ({
    ...assignment,
    driver: driversById.get(assignment.driver_id) ?? null,
    vehicle: vehiclesById.get(assignment.vehicle_id) ?? null,
  }));
}

async function withMotorcycleRelations(
  supabase: Supabase,
  assignments: DriverMotorcycleAssignment[],
): Promise<MotorcycleAssignmentWithRelations[]> {
  const driversById = await loadDriverSummaries(
    supabase,
    [...new Set(assignments.map((assignment) => assignment.driver_id))],
  );
  const motorcycleIds = [...new Set(assignments.map((assignment) => assignment.motorcycle_id))];
  const motorcyclesById = new Map<
    string,
    Pick<Tables<"motorcycles">, "id" | "immatriculation" | "marque" | "modele" | "statut">
  >();

  if (motorcycleIds.length > 0) {
    const { data: motorcycles, error } = await supabase
      .from("motorcycles")
      .select("id, immatriculation, marque, modele, statut")
      .in("id", motorcycleIds);
    if (error) throw error;
    for (const motorcycle of motorcycles ?? []) motorcyclesById.set(motorcycle.id, motorcycle);
  }

  return assignments.map((assignment) => ({
    ...assignment,
    driver: driversById.get(assignment.driver_id) ?? null,
    motorcycle: motorcyclesById.get(assignment.motorcycle_id) ?? null,
  }));
}

export const getVehicleAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }) => {
    const { data: assignments, error } = await context.supabase
      .from("driver_vehicle_assignments")
      .select("*")
      .eq("vehicle_id", data)
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return withVehicleRelations(context.supabase, assignments ?? []);
  });

export const getMotorcycleAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }) => {
    const { data: assignments, error } = await context.supabase
      .from("driver_motorcycle_assignments")
      .select("*")
      .eq("motorcycle_id", data)
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    return withMotorcycleRelations(context.supabase, assignments ?? []);
  });

export const getDriverAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }) => {
    const [vehicleResult, motorcycleResult] = await Promise.all([
      context.supabase
        .from("driver_vehicle_assignments")
        .select("*")
        .eq("driver_id", data)
        .order("start_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      context.supabase
        .from("driver_motorcycle_assignments")
        .select("*")
        .eq("driver_id", data)
        .order("start_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);

    if (vehicleResult.error) throw vehicleResult.error;
    if (motorcycleResult.error) throw motorcycleResult.error;

    const [vehicles, motorcycles] = await Promise.all([
      withVehicleRelations(context.supabase, vehicleResult.data ?? []),
      withMotorcycleRelations(context.supabase, motorcycleResult.data ?? []),
    ]);

    return { vehicles, motorcycles };
  });

export const assignDriverToVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(assignVehicleSchema)
  .handler(async ({ context, data }) => {
    const { data: assignment, error } = await context.supabase.rpc("assign_driver_to_vehicle", {
      p_driver_id: data.driver_id,
      p_vehicle_id: data.vehicle_id,
      p_start_date: data.start_date ?? undefined,
      p_notes: data.notes ?? undefined,
    });

    if (error) throw error;
    if (!assignment) throw new Error("L'affectation véhicule n'a pas été créée.");
    return assignment;
  });

export const closeDriverVehicleAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(closeAssignmentSchema)
  .handler(async ({ context, data }) => {
    const { data: assignment, error } = await context.supabase.rpc(
      "close_driver_vehicle_assignment",
      {
        p_assignment_id: data.id,
        p_end_date: data.end_date ?? undefined,
        p_notes: data.notes ?? undefined,
      },
    );

    if (error) throw error;
    if (!assignment) throw new Error("L'affectation véhicule n'a pas été clôturée.");
    return assignment;
  });

export const assignDriverToMotorcycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(assignMotorcycleSchema)
  .handler(async ({ context, data }) => {
    const { data: assignment, error } = await context.supabase.rpc("assign_driver_to_motorcycle", {
      p_driver_id: data.driver_id,
      p_motorcycle_id: data.motorcycle_id,
      p_start_date: data.start_date ?? undefined,
      p_notes: data.notes ?? undefined,
    });

    if (error) throw error;
    if (!assignment) throw new Error("L'affectation moto n'a pas été créée.");
    return assignment;
  });

export const closeDriverMotorcycleAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(closeAssignmentSchema)
  .handler(async ({ context, data }) => {
    const { data: assignment, error } = await context.supabase.rpc(
      "close_driver_motorcycle_assignment",
      {
        p_assignment_id: data.id,
        p_end_date: data.end_date ?? undefined,
        p_notes: data.notes ?? undefined,
      },
    );

    if (error) throw error;
    if (!assignment) throw new Error("L'affectation moto n'a pas été clôturée.");
    return assignment;
  });
