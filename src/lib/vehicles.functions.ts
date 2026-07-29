import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FinanceService } from "@/lib/finance.service";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Vehicle = Tables<"vehicles">;
export type VehicleInsert = TablesInsert<"vehicles">;
export type VehicleUpdate = TablesUpdate<"vehicles">;
export type VehicleMaintenance = Tables<"maintenances">;
export type VehicleFinanceOperation = Tables<"finance_operations">;
export type VehicleDocument = Tables<"documents">;

export const VEHICLE_STATUSES = [
  "EN_SERVICE",
  "EN_REPARATION",
  "EN_PANNE",
  "HORS_SERVICE",
  "VENDU",
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  EN_SERVICE: "En service",
  EN_REPARATION: "En réparation",
  EN_PANNE: "En panne",
  HORS_SERVICE: "Hors service",
  VENDU: "Vendu",
};

export type VehicleDriver = Pick<
  Tables<"drivers">,
  "id" | "numero_permis" | "categorie_permis" | "date_expiration_permis"
> & {
  employees: Pick<Tables<"employees">, "nom" | "prenom" | "telephone"> | null;
};

const vehicleIdSchema = z.string().uuid();
const nullableTextSchema = z.string().trim().min(1).nullable();
const nullableDateSchema = z.string().date().nullable();
const vehicleStatusSchema = z.enum(VEHICLE_STATUSES);

const vehicleValuesSchema = z
  .object({
    registration: z.string().trim().min(1),
    brand: nullableTextSchema,
    chassis_number: nullableTextSchema,
    model: nullableTextSchema,
    type: nullableTextSchema,
    color: nullableTextSchema,
    year: z.number().int().min(1886).max(9999).nullable(),
    kilometrage: z.number().int().min(0).nullable(),
    status: vehicleStatusSchema,
    purchase_price: z.number().finite().min(0).nullable(),
    purchase_date: nullableDateSchema,
    purchase_wallet_id: vehicleIdSchema.nullable(),
    supplier: nullableTextSchema,
    description: nullableTextSchema,
    driver_id: vehicleIdSchema.nullable(),
    engine_number: nullableTextSchema,
    photo_url: z.string().url().nullable(),
  })
  .strict();

export type VehicleValues = z.infer<typeof vehicleValuesSchema>;

const updateVehicleSchema = z
  .object({
    id: vehicleIdSchema,
    values: vehicleValuesSchema
      .partial()
      .refine(
        (values) => Object.keys(values).length > 0,
        "Au moins une propriété doit être mise à jour.",
      ),
  })
  .strict();

const updateVehicleStatusSchema = z
  .object({
    id: vehicleIdSchema,
    status: vehicleStatusSchema,
  })
  .strict();

const vehicleMaintenanceValuesSchema = z
  .object({
    vehicle_id: vehicleIdSchema,
    date: z.string().date(),
    type: z.string().trim().min(1).nullable(),
    cout: z.number().finite().min(0),
    kilometrage: z.number().int().min(0).nullable(),
    prestataire: z.string().trim().nullable(),
    notes: z.string().trim().nullable(),
    wallet_id: vehicleIdSchema.nullable(),
  })
  .strict();

const updateVehicleMaintenanceSchema = vehicleMaintenanceValuesSchema
  .extend({ id: vehicleIdSchema })
  .strict();

const PURCHASE_LINK_MODULE = "VEHICLE";
const PURCHASE_CATEGORY = "ACHAT DE VEHICULE";

type Supabase = SupabaseClient<Database>;
type PurchaseLink = Tables<"finance_links">;
type PurchaseOperation = Pick<
  Tables<"finance_operations">,
  "id" | "wallet_id" | "destination_wallet_id"
>;

function isPurchaseRecorded(vehicle: Vehicle) {
  return Number(vehicle.purchase_price ?? 0) > 0;
}

function getPurchaseDate(vehicle: Vehicle) {
  return vehicle.purchase_date ?? new Date().toISOString().slice(0, 10);
}

function getPurchaseDescription(vehicle: Vehicle) {
  return `Achat du véhicule ${vehicle.registration}`;
}

async function createPurchaseOperation(supabase: Supabase, vehicle: Vehicle) {
  if (!vehicle.purchase_wallet_id) {
    throw new Error("Un wallet d'achat est obligatoire pour enregistrer la dépense du véhicule.");
  }

  const service = new FinanceService(supabase);
  const operation = await service.createExpense(
    {
      wallet_id: vehicle.purchase_wallet_id,
      vehicle_id: vehicle.id,
      amount: vehicle.purchase_price ?? 0,
      category: PURCHASE_CATEGORY,
      supplier: vehicle.supplier,
      description: getPurchaseDescription(vehicle),
      operation_date: getPurchaseDate(vehicle),
      module: PURCHASE_LINK_MODULE,
      module_id: vehicle.id,
    },
    {
      module: PURCHASE_LINK_MODULE,
      module_record_id: vehicle.id,
    },
  );

  return operation;
}

async function findPurchaseLink(supabase: Supabase, vehicleId: string) {
  const { data, error } = await supabase
    .from("finance_links")
    .select("*")
    .eq("module", PURCHASE_LINK_MODULE)
    .eq("module_record_id", vehicleId)
    .limit(2);

  if (error) throw error;

  if ((data ?? []).length > 1) {
    throw new Error(
      "Plusieurs écritures financières sont liées à cet achat véhicule. Corrigez les doublons avant de poursuivre.",
    );
  }

  return (data?.[0] ?? null) as PurchaseLink | null;
}

async function resolvePurchaseOperation(supabase: Supabase, vehicleId: string) {
  let link = await findPurchaseLink(supabase, vehicleId);

  if (link) {
    const { data: operation, error } = await supabase
      .from("finance_operations")
      .select("id, wallet_id, destination_wallet_id")
      .eq("id", link.finance_operation_id)
      .maybeSingle();

    if (error) throw error;

    if (!operation) {
      throw new Error(
        "Le lien financier de l'achat véhicule pointe vers une opération introuvable.",
      );
    }

    return {
      link,
      operation: operation as PurchaseOperation,
    };
  }

  const { data: candidateOperations, error: candidateError } = await supabase
    .from("finance_operations")
    .select("id, wallet_id, destination_wallet_id")
    .eq("vehicle_id", vehicleId)
    .eq("type", "EXPENSE")
    .eq("category", PURCHASE_CATEGORY)
    .limit(2);

  if (candidateError) throw candidateError;

  if ((candidateOperations ?? []).length > 1) {
    throw new Error(
      "Plusieurs dépenses d'achat véhicule existent sans lien financier. Corrigez les doublons avant de poursuivre.",
    );
  }

  const operation = candidateOperations?.[0];

  if (!operation) return null;

  const { data: repairedLink, error: linkError } = await supabase
    .from("finance_links")
    .insert({
      finance_operation_id: operation.id,
      module: PURCHASE_LINK_MODULE,
      module_record_id: vehicleId,
    })
    .select()
    .single();

  if (linkError) throw linkError;

  link = repairedLink as PurchaseLink;

  return {
    link,
    operation: operation as PurchaseOperation,
  };
}

async function getStoredVehicle(supabase: Supabase, id: string) {
  const { data: vehicle, error } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  if (!vehicle) throw new Error("Véhicule introuvable.");

  return vehicle as Vehicle;
}

export const getVehicles = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data ?? []) as Vehicle[];
  });

export const getVehicle = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleIdSchema)
  .handler(async ({ context, data }) => getStoredVehicle(context.supabase, data));

export const getVehicleMaintenances = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleIdSchema)
  .handler(async ({ context, data }) => {
    const { data: maintenances, error } = await context.supabase
      .from("maintenances")
      .select("*")
      .eq("entity_type", "vehicule")
      .eq("entity_id", data)
      .order("date", { ascending: false });

    if (error) throw error;

    return (maintenances ?? []) as VehicleMaintenance[];
  });

export const getAllVehicleMaintenances = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: maintenances, error } = await context.supabase
      .from("maintenances")
      .select("*")
      .eq("entity_type", "vehicule")
      .order("date", { ascending: false });

    if (error) throw error;

    return (maintenances ?? []) as VehicleMaintenance[];
  });

export const getVehicleMaintenanceFinanceOperation = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleIdSchema)
  .handler(async ({ context, data }) => {
    const { data: operation, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("maintenance_id", data)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return operation;
  });

export const createVehicleMaintenance = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleMaintenanceValuesSchema)
  .handler(async ({ context, data }) => {
    const { data: maintenance, error } = await context.supabase.rpc(
      "create_vehicle_maintenance_with_finance",
      { p_maintenance: data },
    );

    if (error) throw error;
    if (!maintenance) throw new Error("L'entretien véhicule n'a pas été créé.");

    return maintenance;
  });

export const updateVehicleMaintenance = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateVehicleMaintenanceSchema)
  .handler(async ({ context, data }) => {
    const { data: maintenance, error } = await context.supabase.rpc(
      "update_vehicle_maintenance_with_finance",
      { p_maintenance: data },
    );

    if (error) throw error;
    if (!maintenance) throw new Error("L'entretien véhicule n'a pas été mis à jour.");

    return maintenance;
  });

export const deleteVehicleMaintenance = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: vehicleIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: deleted, error } = await context.supabase.rpc(
      "delete_vehicle_maintenance_with_finance",
      { p_maintenance_id: data.id },
    );

    if (error) throw error;

    return deleted;
  });

export const getVehicleFinanceOperations = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleIdSchema)
  .handler(async ({ context, data }) => {
    const { data: operations, error } = await context.supabase
      .from("finance_operations")
      .select("*")
      .eq("vehicle_id", data)
      .order("operation_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (operations ?? []) as VehicleFinanceOperation[];
  });

export const getVehicleDocuments = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleIdSchema)
  .handler(async ({ context, data }) => {
    const { data: documents, error } = await context.supabase
      .from("documents")
      .select("*")
      .eq("entity_type", "vehicule")
      .eq("entity_id", data)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (documents ?? []) as VehicleDocument[];
  });

export const getVehicleDriver = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleIdSchema.nullable())
  .handler(async ({ context, data }) => {
    if (!data) return null;

    const { data: driver, error } = await context.supabase
      .from("drivers")
      .select(
        "id, numero_permis, categorie_permis, date_expiration_permis, employees(nom, prenom, telephone)",
      )
      .eq("id", data)
      .maybeSingle();

    if (error) throw error;

    return driver as VehicleDriver | null;
  });

export const createVehicle = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(vehicleValuesSchema)
  .handler(async ({ context, data }) => {
    if (data.purchase_price && !data.purchase_wallet_id) {
      throw new Error("Sélectionnez le wallet utilisé pour l'achat du véhicule.");
    }

    const { data: vehicle, error } = await context.supabase.rpc("create_vehicle_with_purchase", {
      p_vehicle: data,
    });

    if (error) throw error;
    if (!vehicle) throw new Error("Le véhicule n'a pas été créé.");

    return vehicle;
  });

export const updateVehicle = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateVehicleSchema)
  .handler(async ({ context, data }) => {
    const previousVehicle = await getStoredVehicle(context.supabase, data.id);

    const nextPurchasePrice = Object.hasOwn(data.values, "purchase_price")
      ? data.values.purchase_price
      : previousVehicle.purchase_price;
    const nextPurchaseWalletId = Object.hasOwn(data.values, "purchase_wallet_id")
      ? data.values.purchase_wallet_id
      : previousVehicle.purchase_wallet_id;

    if (Number(nextPurchasePrice ?? 0) > 0 && !nextPurchaseWalletId) {
      throw new Error("Sélectionnez le wallet utilisé pour l'achat du véhicule.");
    }

    const values = {
      id: previousVehicle.id,
      registration: Object.hasOwn(data.values, "registration")
        ? data.values.registration
        : previousVehicle.registration,
      brand: Object.hasOwn(data.values, "brand") ? data.values.brand : previousVehicle.brand,
      chassis_number: Object.hasOwn(data.values, "chassis_number")
        ? data.values.chassis_number
        : previousVehicle.chassis_number,
      model: Object.hasOwn(data.values, "model") ? data.values.model : previousVehicle.model,
      type: Object.hasOwn(data.values, "type") ? data.values.type : previousVehicle.type,
      color: Object.hasOwn(data.values, "color") ? data.values.color : previousVehicle.color,
      year: Object.hasOwn(data.values, "year") ? data.values.year : previousVehicle.year,
      kilometrage: Object.hasOwn(data.values, "kilometrage")
        ? data.values.kilometrage
        : previousVehicle.kilometrage,
      status: Object.hasOwn(data.values, "status") ? data.values.status : previousVehicle.status,
      purchase_price: nextPurchasePrice,
      purchase_date: Object.hasOwn(data.values, "purchase_date")
        ? data.values.purchase_date
        : previousVehicle.purchase_date,
      purchase_wallet_id: nextPurchaseWalletId,
      supplier: Object.hasOwn(data.values, "supplier")
        ? data.values.supplier
        : previousVehicle.supplier,
      description: Object.hasOwn(data.values, "description")
        ? data.values.description
        : previousVehicle.description,
      driver_id: Object.hasOwn(data.values, "driver_id")
        ? data.values.driver_id
        : previousVehicle.driver_id,
      engine_number: Object.hasOwn(data.values, "engine_number")
        ? data.values.engine_number
        : previousVehicle.engine_number,
      photo_url: Object.hasOwn(data.values, "photo_url")
        ? data.values.photo_url
        : previousVehicle.photo_url,
    };

    const { data: vehicle, error } = await context.supabase.rpc("update_vehicle_with_purchase", {
      p_vehicle: values,
    });

    if (error) throw error;
    if (!vehicle) throw new Error("Le véhicule n'a pas été mis à jour.");

    return vehicle;

    /*
    const existingPurchase = await resolvePurchaseOperation(
      context.supabase,
      previousVehicle.id,
    );

    const { data: vehicle, error } = await context.supabase
      .from("vehicles")
      .update(data.values)
      .eq("id", data.id)
      .select("*")
      .single();

    if (error) throw error;

    const updatedVehicle = vehicle as Vehicle;
    if (isPurchaseRecorded(updatedVehicle)) {
      if (!updatedVehicle.purchase_wallet_id) {
        throw new Error(
          "Sélectionnez le wallet utilisé pour l'achat du véhicule.",
        );
      }

      if (existingPurchase) {
        const service = new FinanceService(context.supabase);
        await service.updateOperation(existingPurchase.operation.id, {
            wallet_id: updatedVehicle.purchase_wallet_id,
            vehicle_id: updatedVehicle.id,
            type: "EXPENSE",
            amount: updatedVehicle.purchase_price ?? 0,
            category: PURCHASE_CATEGORY,
            supplier: updatedVehicle.supplier,
            description: getPurchaseDescription(updatedVehicle),
            operation_date: getPurchaseDate(updatedVehicle),
            module: PURCHASE_LINK_MODULE,
            module_id: updatedVehicle.id,
        });
      } else {
        await createPurchaseOperation(
          context.supabase,
          updatedVehicle,
        );
      }
    } else if (existingPurchase) {
      const service = new FinanceService(context.supabase);
      await service.deleteOperation(existingPurchase.operation.id);
    }

    return updatedVehicle;
    */
  });

export const updateVehicleStatus = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(updateVehicleStatusSchema)
  .handler(async ({ context, data }) => {
    const { data: vehicle, error } = await context.supabase
      .from("vehicles")
      .update({ status: data.status })
      .eq("id", data.id)
      .select("*")
      .single();

    if (error) throw error;

    return vehicle as Vehicle;
  });

export const deleteVehicle = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: vehicleIdSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: deleted, error } = await context.supabase.rpc("delete_vehicle_with_purchase", {
      p_vehicle_id: data.id,
    });

    if (error) throw error;

    return deleted;

    /*
    const vehicle = await getStoredVehicle(context.supabase, data.id);
    const purchase = await resolvePurchaseOperation(context.supabase, vehicle.id);

    const { data: relatedOperations, error: relatedOperationsError } =
      await context.supabase
        .from("finance_operations")
        .select("id")
        .eq("vehicle_id", vehicle.id);

    if (relatedOperationsError) throw relatedOperationsError;

    const otherOperationExists = (relatedOperations ?? []).some(
      (operation) => operation.id !== purchase?.operation.id,
    );

    if (otherOperationExists) {
      throw new Error(
        "Ce véhicule possède des opérations financières historiques. Elles doivent être réaffectées ou archivées avant sa suppression.",
      );
    }

    if (purchase) {
      const service = new FinanceService(context.supabase);
      await service.deleteOperation(purchase.operation.id);
    }

    const { error: vehicleError } = await context.supabase
      .from("vehicles")
      .delete()
      .eq("id", vehicle.id);

    if (vehicleError) throw vehicleError;

    return true;
    */
  });
