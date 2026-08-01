import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";

export type Document = Tables<"documents">;

export const DOCUMENT_RELATIONS = [
  "client",
  "employee",
  "driver",
  "vehicle",
  "motorcycle",
  "farm",
  "contract",
  "mission",
  "vehicle_maintenance",
  "motorcycle_maintenance",
] as const;

export type DocumentRelation = (typeof DOCUMENT_RELATIONS)[number];

export const DOCUMENT_TYPES = [
  "ASSURANCE",
  "CARTE_GRISE",
  "PERMIS",
  "CONTRAT",
  "FACTURE",
  "CERTIFICAT",
  "AUTRE",
] as const;

export type DocumentStatus = "VALID" | "EXPIRING" | "EXPIRED";

const idSchema = z.string().uuid();
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const nullableDateSchema = z.string().date().nullable();
const documentRelationSchema = z.enum(DOCUMENT_RELATIONS);
const documentStatusSchema = z.enum(["VALID", "EXPIRING", "EXPIRED"]);

const documentValuesSchema = z
  .object({
    nom: z.string().trim().min(1).max(255),
    type: nullableTextSchema,
    url: z.string().url().nullable(),
    storage_path: z.string().trim().min(1).max(1024).nullable(),
    date_emission: nullableDateSchema,
    date_expiration: nullableDateSchema,
  })
  .strict();

const createDocumentSchema = z
  .object({
    entity_id: idSchema,
    relation: documentRelationSchema,
    document: documentValuesSchema,
  })
  .strict();

const legacyRelationByDocumentRelation: Partial<
  Record<DocumentRelation, Exclude<Document["entity_type"], null>>
> = {
  employee: "employe",
  driver: "chauffeur",
  vehicle: "vehicule",
  motorcycle: "moto",
  farm: "exploitation",
  contract: "contrat",
  vehicle_maintenance: "autre",
  motorcycle_maintenance: "autre",
};

async function withSignedDocumentUrls(
  supabase: SupabaseClient<Database>,
  documents: Document[],
): Promise<Document[]> {
  return Promise.all(
    documents.map(async (document) => {
      if (!document.storage_path) return document;
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(document.storage_path, 10 * 60);

      if (error || !data?.signedUrl) {
        // A missing object must not fall back to the legacy public URL after the
        // bucket becomes private. The record remains visible to allow repair.
        return { ...document, url: null };
      }

      return { ...document, url: data.signedUrl };
    }),
  );
}

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createDocumentSchema)
  .handler(async ({ context, data }) => {
    const { data: document, error } = await context.supabase.rpc("create_document_with_relation", {
      p_document: data.document,
      p_relation: data.relation,
      p_entity_id: data.entity_id,
    });

    if (error) throw error;
    if (!document) throw new Error("Le document n'a pas été créé.");
    return document;
  });

export const archiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: document, error } = await context.supabase.rpc("archive_document", {
      p_document_id: data.id,
    });

    if (error) throw error;
    if (!document) throw new Error("Le document n'a pas été archivé.");
    return document;
  });

export const restoreDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: document, error } = await context.supabase.rpc("restore_document", { p_document_id: data.id });
    if (error) throw error;
    if (!document) throw new Error("Le document n'a pas été restauré.");
    return document;
  });

export const replaceDocumentMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema, storage_path: z.string().trim().min(1).max(1024), nom: z.string().trim().min(1).max(255).nullable() }).strict())
  .handler(async ({ context, data }) => {
    const { data: document, error } = await context.supabase.rpc("replace_document_metadata", {
      p_document_id: data.id, p_storage_path: data.storage_path, p_nom: data.nom ?? undefined,
    });
    if (error) throw error;
    if (!document) throw new Error("Les métadonnées du document n'ont pas été remplacées.");
    return document;
  });

export const deleteDocumentMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: document, error } = await context.supabase.rpc("delete_document_metadata", { p_document_id: data.id });
    if (error) throw error;
    if (!document) throw new Error("Les métadonnées du document n'ont pas été supprimées.");
    return document;
  });

const documentLibrarySchema = z
  .object({
    page: z.number().int().min(1).default(1),
    page_size: z.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).nullable().default(null),
    type: z.enum(DOCUMENT_TYPES).nullable().default(null),
    relation: documentRelationSchema.nullable().default(null),
    status: documentStatusSchema.nullable().default(null),
    expiration_from: nullableDateSchema.default(null),
    expiration_to: nullableDateSchema.default(null),
  })
  .strict();

const relationTables = {
    client: "document_transport_client_links",
    employee: "document_employee_links",
    driver: "document_driver_links",
    vehicle: "document_vehicle_links",
    motorcycle: "document_motorcycle_links",
    farm: "document_farm_links",
    contract: "document_contract_links",
    mission: "document_transport_mission_links",
    vehicle_maintenance: "document_vehicle_maintenance_links",
    motorcycle_maintenance: "document_motorcycle_maintenance_links",
  } as const;

function relationTable(relation: DocumentRelation) {
  return relationTables[relation];
}

export const getDocumentsLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(documentLibrarySchema)
  .handler(async ({ context, data }) => {
    const today = new Date().toISOString().slice(0, 10);
    const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const from = (data.page - 1) * data.page_size;
    const to = from + data.page_size - 1;

    let query = context.supabase
      .from("documents")
      .select("*", { count: "exact" })
      .is("archived_at", null)
      .order("date_expiration", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.type) query = query.eq("type", data.type);
    if (data.search) query = query.ilike("nom", `%${data.search.replace(/[%,()]/g, " ")}%`);
    if (data.expiration_from) query = query.gte("date_expiration", data.expiration_from);
    if (data.expiration_to) query = query.lte("date_expiration", data.expiration_to);
    if (data.status === "EXPIRED") query = query.lt("date_expiration", today);
    if (data.status === "EXPIRING") query = query.gte("date_expiration", today).lte("date_expiration", inThirtyDays);
    if (data.status === "VALID") query = query.or(`date_expiration.is.null,date_expiration.gt.${inThirtyDays}`);

    if (data.relation) {
      const { data: links, error: linksError } = await context.supabase
        .from(relationTable(data.relation))
        .select("document_id");
      if (linksError) throw linksError;
      const documentIds = (links ?? []).map((link) => link.document_id);
      if (documentIds.length === 0) return { documents: [] as Document[], total: 0 };
      query = query.in("id", documentIds);
    }

    const { data: documents, count, error } = await query;
    if (error) throw error;
    return { documents: await withSignedDocumentUrls(context.supabase, documents ?? []), total: count ?? 0 };
  });

export const getDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: document, error } = await context.supabase
      .from("documents")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!document) throw new Error("Document introuvable ou non autorisé.");
    return (await withSignedDocumentUrls(context.supabase, [document]))[0];
  });

export type DocumentEntityLink = { relation: DocumentRelation; entityId: string; label: string; route: string };

const relationMetadata: Record<DocumentRelation, Omit<DocumentEntityLink, "entityId">> = {
  client: { relation: "client", label: "Client", route: "/clients/$clientId" },
  employee: { relation: "employee", label: "Employé", route: "/employees/$employeeId" },
  driver: { relation: "driver", label: "Chauffeur", route: "/drivers/$driverId" },
  vehicle: { relation: "vehicle", label: "Véhicule", route: "/vehicles/$vehicleId" },
  motorcycle: { relation: "motorcycle", label: "Moto", route: "/motorcycles/$motorcycleId" },
  farm: { relation: "farm", label: "Exploitation", route: "/farms/$farmId" },
  contract: { relation: "contract", label: "Contrat", route: "/contracts/$contractId" },
  mission: { relation: "mission", label: "Course", route: "/courses/$courseId" },
  vehicle_maintenance: { relation: "vehicle_maintenance", label: "Entretien véhicule", route: "/maintenance" },
  motorcycle_maintenance: { relation: "motorcycle_maintenance", label: "Entretien moto", route: "/motorcycles" },
};

export const getDocumentRelations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const sourceQueries = [
      ["client", "document_transport_client_links", "client_id"],
      ["employee", "document_employee_links", "employee_id"], ["driver", "document_driver_links", "driver_id"],
      ["vehicle", "document_vehicle_links", "vehicle_id"], ["motorcycle", "document_motorcycle_links", "motorcycle_id"],
      ["farm", "document_farm_links", "farm_id"], ["contract", "document_contract_links", "contract_id"],
      ["mission", "document_transport_mission_links", "mission_id"],
    ] as const;
    const results = await Promise.all(sourceQueries.map(async ([relation, table, key]) => {
      const { data: links, error } = await context.supabase.from(table).select(key).eq("document_id", data.id);
      if (error) throw error;
      return (links ?? []).flatMap((link) => {
        const entityId = Object.values(link).find((value): value is string => typeof value === "string");
        return entityId ? [{ ...relationMetadata[relation], entityId }] : [];
      });
    }));
    return results.flat();
  });

export const getDocumentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ id: idSchema }).strict())
  .handler(async ({ context, data }) => {
    const { data: history, error } = await context.supabase.rpc("get_document_audit_history", { p_document_id: data.id });
    if (error) throw error;
    return history ?? [];
  });

export const getDocumentsForRelation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ entity_id: idSchema, relation: documentRelationSchema }).strict())
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const relationQueries = {
      client: supabase.from("document_transport_client_links").select("document_id").eq("client_id", data.entity_id),
      employee: supabase.from("document_employee_links").select("document_id").eq("employee_id", data.entity_id),
      driver: supabase.from("document_driver_links").select("document_id").eq("driver_id", data.entity_id),
      vehicle: supabase.from("document_vehicle_links").select("document_id").eq("vehicle_id", data.entity_id),
      motorcycle: supabase.from("document_motorcycle_links").select("document_id").eq("motorcycle_id", data.entity_id),
      farm: supabase.from("document_farm_links").select("document_id").eq("farm_id", data.entity_id),
      contract: supabase.from("document_contract_links").select("document_id").eq("contract_id", data.entity_id),
      mission: supabase.from("document_transport_mission_links").select("document_id").eq("mission_id", data.entity_id),
      vehicle_maintenance: supabase
        .from("document_vehicle_maintenance_links")
        .select("document_id")
        .eq("maintenance_id", data.entity_id),
      motorcycle_maintenance: supabase
        .from("document_motorcycle_maintenance_links")
        .select("document_id")
        .eq("motorcycle_maintenance_id", data.entity_id),
    };

    const explicitResult = await relationQueries[data.relation];
    if (explicitResult.error) throw explicitResult.error;

    const documentIds = (explicitResult.data ?? []).map((link) => link.document_id);
    const legacyKind = legacyRelationByDocumentRelation[data.relation];
    const [explicitDocumentsResult, legacyDocumentsResult] = await Promise.all([
      documentIds.length > 0
        ? supabase.from("documents").select("*").in("id", documentIds).is("archived_at", null)
        : Promise.resolve({ data: [] as Document[], error: null }),
      legacyKind
        ? supabase
          .from("documents")
          .select("*")
          .eq("entity_type", legacyKind)
          .eq("entity_id", data.entity_id)
          .is("archived_at", null)
        : Promise.resolve({ data: [] as Document[], error: null }),
    ]);

    if (explicitDocumentsResult.error) throw explicitDocumentsResult.error;
    if (legacyDocumentsResult.error) throw legacyDocumentsResult.error;

    const documents = [...new Map(
      [...(explicitDocumentsResult.data ?? []), ...(legacyDocumentsResult.data ?? [])].map((document) => [
        document.id,
        document,
      ]),
    ).values()].sort((left, right) => right.created_at.localeCompare(left.created_at));

    return withSignedDocumentUrls(supabase, documents);
  });

// Legacy farm callers retain their original contract while receiving explicit
// links as soon as they exist.
export const getDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idSchema)
  .handler(async ({ context, data }) => {
    const { data: links, error: linksError } = await context.supabase
      .from("document_farm_links")
      .select("document_id")
      .eq("farm_id", data);
    if (linksError) throw linksError;

    const documentIds = (links ?? []).map((link) => link.document_id);
    const [explicitDocumentsResult, legacyDocumentsResult] = await Promise.all([
      documentIds.length > 0
        ? context.supabase.from("documents").select("*").in("id", documentIds).is("archived_at", null)
        : Promise.resolve({ data: [] as Document[], error: null }),
      context.supabase
        .from("documents")
        .select("*")
        .eq("entity_type", "exploitation")
        .eq("entity_id", data)
        .is("archived_at", null),
    ]);
    if (explicitDocumentsResult.error) throw explicitDocumentsResult.error;
    if (legacyDocumentsResult.error) throw legacyDocumentsResult.error;

    const documents = [...new Map(
      [...(explicitDocumentsResult.data ?? []), ...(legacyDocumentsResult.data ?? [])].map((document) => [
        document.id,
        document,
      ]),
    ).values()].sort((left, right) => right.created_at.localeCompare(left.created_at));

    return withSignedDocumentUrls(context.supabase, documents);
  });

export const saveDocument = createDocument;
