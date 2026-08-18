import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

export type Contract = Tables<"contracts">;
export const CONTRACT_RELATIONS = ["employee", "driver", "vehicle", "motorcycle", "farm"] as const;
export type ContractRelation = (typeof CONTRACT_RELATIONS)[number];

const idArraySchema = z.array(z.string().uuid()).default([]);
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const nullableDateSchema = z.string().date().nullable();

const contractValuesSchema = z
  .object({
    reference: nullableTextSchema,
    type: nullableTextSchema,
    partie: nullableTextSchema,
    date_debut: nullableDateSchema,
    date_fin: nullableDateSchema,
    montant: z.number().finite().min(0).nullable(),
    statut: nullableTextSchema,
    description: nullableTextSchema,
  })
  .strict();

const createContractSchema = z
  .object({
    contract: contractValuesSchema,
    relations: z
      .object({
        employee_ids: idArraySchema,
        driver_ids: idArraySchema,
        vehicle_ids: idArraySchema,
        motorcycle_ids: idArraySchema,
        farm_ids: idArraySchema,
      })
      .strict(),
  })
  .strict();

export const CONTRACT_STATUSES = ["ACTIF", "TERMINE", "RESILIE"] as const;

const updateContractStatusSchema = z
  .object({
    id: z.string().uuid(),
    statut: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const getContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contracts")
      .select("*")
      .order("date_debut", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getContract = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.string().uuid())
  .handler(async ({ context, data }) => {
    const { data: contract, error } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("id", data)
      .maybeSingle();
    if (error) throw error;
    return contract;
  });

export const createContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createContractSchema)
  .handler(async ({ context, data }) => {
    const { data: contract, error } = await context.supabase.rpc("create_contract_with_relations", {
      p_contract: data.contract,
      p_relations: data.relations,
    });
    if (error) throw error;
    if (!contract) throw new Error("Le contrat n'a pas été créé.");
    return contract;
  });

export const updateContractStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateContractStatusSchema)
  .handler(async ({ context, data }) => {
    const { data: contract, error } = await context.supabase
      .from("contracts")
      .update({ statut: data.statut })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    return contract as Contract;
  });

export const getContractsForRelation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({ entity_id: z.string().uuid(), relation: z.enum(CONTRACT_RELATIONS) }).strict(),
  )
  .handler(async ({ context, data }) => {
    const relationQueries = {
      employee: context.supabase
        .from("contract_employee_links")
        .select("contract_id")
        .eq("employee_id", data.entity_id),
      driver: context.supabase
        .from("contract_driver_links")
        .select("contract_id")
        .eq("driver_id", data.entity_id),
      vehicle: context.supabase
        .from("contract_vehicle_links")
        .select("contract_id")
        .eq("vehicle_id", data.entity_id),
      motorcycle: context.supabase
        .from("contract_motorcycle_links")
        .select("contract_id")
        .eq("motorcycle_id", data.entity_id),
      farm: context.supabase
        .from("contract_farm_links")
        .select("contract_id")
        .eq("farm_id", data.entity_id),
    };
    const linksResult = await relationQueries[data.relation];
    if (linksResult.error) throw linksResult.error;
    const contractIds = (linksResult.data ?? []).map((link) => link.contract_id);
    const legacyKind = {
      employee: "employe",
      driver: "chauffeur",
      vehicle: "vehicule",
      motorcycle: "moto",
      farm: "exploitation",
    } as const;
    const [linkedResult, legacyResult] = await Promise.all([
      contractIds.length > 0
        ? context.supabase.from("contracts").select("*").in("id", contractIds)
        : Promise.resolve({ data: [] as Contract[], error: null }),
      context.supabase
        .from("contracts")
        .select("*")
        .eq("entity_type", legacyKind[data.relation])
        .eq("entity_id", data.entity_id),
    ]);
    if (linkedResult.error) throw linkedResult.error;
    if (legacyResult.error) throw legacyResult.error;
    return [
      ...new Map(
        [...(linkedResult.data ?? []), ...(legacyResult.data ?? [])].map((contract) => [
          contract.id,
          contract,
        ]),
      ).values(),
    ].sort((left, right) => right.created_at.localeCompare(left.created_at));
  });
