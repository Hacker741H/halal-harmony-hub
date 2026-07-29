import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/integrations/supabase/types";

type StorageObject = { name: string; id: string | null; created_at: string | null };
type CleanupPhase = "configuration" | "lecture des métadonnées documents" | "lecture du bucket Storage" | "suppression Storage" | "journalisation";

let currentPhase: CleanupPhase = "configuration";

function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization|apikey|api_key|token|service_role|password)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_JWT]");
}

function errorProperty(error: unknown, property: string): unknown {
  if (typeof error !== "object" || error === null || !(property in error)) return undefined;
  return error[property as keyof object];
}

function safeCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: redactSensitiveText(cause.message),
      code: errorProperty(cause, "code"),
    };
  }
  if (typeof cause === "string") return redactSensitiveText(cause);
  return cause === undefined ? undefined : "[cause non textuel masqué]";
}

function httpStatus(error: unknown): number | undefined {
  for (const property of ["statusCode", "status"]) {
    const value = errorProperty(error, property);
    if (typeof value === "number") return value;
  }
  return undefined;
}

function classifyFailure(phase: CleanupPhase, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const causeCode = errorProperty(errorProperty(error, "cause"), "code");
  const status = httpStatus(error);
  if (phase === "configuration") return "CONFIGURATION : variable manquante ou URL Supabase invalide.";
  if (status === 401 || status === 403) return "AUTHENTIFICATION / AUTORISATION : la clé serveur est absente, invalide ou non autorisée.";
  if (message.toLowerCase().includes("invalid url") || causeCode === "ERR_INVALID_URL") return "URL : l'URL Supabase est invalide.";
  if (message.toLowerCase().includes("fetch failed")) {
    return "RÉSEAU / URL : la requête n'a pas atteint Supabase ; vérifier SUPABASE_URL, DNS, proxy, connexion et certificat.";
  }
  if (phase === "lecture du bucket Storage" || phase === "suppression Storage") return "STORAGE : échec de l'appel au bucket documents.";
  return "SUPABASE : échec lors de l'accès aux métadonnées ou à l'audit.";
}

function reportSafeFailure(phase: CleanupPhase, error: unknown): void {
  const details = {
    phase,
    classification: classifyFailure(phase, error),
    name: error instanceof Error ? error.name : typeof error,
    message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    cause: safeCause(errorProperty(error, "cause")),
    httpStatus: httpStatus(error) ?? null,
  };
  console.error("Diagnostic sécurisé cleanup-orphan-documents:", JSON.stringify(details));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d’environnement manquante : ${name}`);
  return value;
}

async function listObjectsRecursively(
  client: ReturnType<typeof createClient<Database>>,
  prefix = "",
): Promise<StorageObject[]> {
  const { data, error } = await client.storage.from("documents").list(prefix, { limit: 1_000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  const objects: StorageObject[] = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) objects.push({ name: path, id: item.id, created_at: item.created_at ?? null });
    else objects.push(...await listObjectsRecursively(client, path));
  }
  return objects;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const minAgeArgument = process.argv.find((argument) => argument.startsWith("--min-age-minutes="));
  const minAgeMinutes = Number(minAgeArgument?.split("=", 2)[1] ?? "60");
  if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) throw new Error("--min-age-minutes doit être positif.");
  if (apply && process.env.ALLOW_DOCUMENT_ORPHAN_CLEANUP !== "true") {
    throw new Error("Refus de sécurité : définissez ALLOW_DOCUMENT_ORPHAN_CLEANUP=true avant --apply.");
  }

  const supabaseUrl = requiredEnvironment("SUPABASE_URL");
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("SUPABASE_URL doit utiliser HTTP ou HTTPS.");
  }
  const client = createClient<Database>(supabaseUrl, requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  currentPhase = "lecture des métadonnées documents";
  const { data: documents, error: documentsError } = await client
    .from("documents")
    .select("storage_path")
    .not("storage_path", "is", null);
  if (documentsError) throw documentsError;

  currentPhase = "lecture du bucket Storage";
  const objects = await listObjectsRecursively(client);

  const referenced = new Set((documents ?? []).map((document) => document.storage_path).filter((path): path is string => path !== null));
  const threshold = Date.now() - minAgeMinutes * 60_000;
  const orphans = objects.filter((object) => !referenced.has(object.name) && (!object.created_at || Date.parse(object.created_at) <= threshold));
  console.log(`${orphans.length} objet(s) orphelin(s) détecté(s), mode ${apply ? "suppression" : "aperçu"}.`);
  for (const orphan of orphans) console.log(orphan.name);
  if (!apply || orphans.length === 0) return;

  currentPhase = "suppression Storage";
  const { error: removeError } = await client.storage.from("documents").remove(orphans.map((orphan) => orphan.name));
  if (removeError) throw removeError;
  currentPhase = "journalisation";
  const { error: auditError } = await client.from("security_audit_log").insert(
    orphans.map((orphan) => ({
      event_type: "DOCUMENT_ORPHAN_CLEANUP",
      resource_type: "DOCUMENT_STORAGE",
      metadata: { storage_path: orphan.name, result: "DEFERRED_ORPHAN_REMOVED" },
    })),
  );
  if (auditError) throw auditError;
  console.log(`${orphans.length} objet(s) supprimé(s) et journalisé(s).`);
}

main().catch((error: unknown) => {
  reportSafeFailure(currentPhase, error);
  console.error(error instanceof Error ? error.message : "Nettoyage des documents orphelins impossible.");
  process.exitCode = 1;
});
