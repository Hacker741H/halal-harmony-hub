#!/usr/bin/env bun
/**
 * HALAL ERP - Script de validation pré-déploiement
 *
 * Vérifie avant tout déploiement :
 *   1. Variables d'environnement Supabase requises
 *   2. Connexion à l'API REST Supabase (Data API)
 *   3. Présence et cohérence des migrations SQL locales
 *   4. Santé RLS : les tables sensibles rejettent bien un accès anonyme
 *
 * Usage :
 *   bun run validate:deploy
 *   bun run scripts/validate-deploy.ts
 *
 * Sortie : code 0 si tout est OK, code 1 si un contrôle critique échoue.
 */

import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type CheckStatus = "ok" | "warn" | "fail";
interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
}

const results: CheckResult[] = [];
const record = (r: CheckResult) => {
  results.push(r);
  const icon = r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️ " : "❌";
  console.log(`${icon}  ${r.name}${r.detail ? `  —  ${r.detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// Chargement des variables .env (sans dépendance externe)
// ---------------------------------------------------------------------------
function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const content = Bun.file(envPath).text();
  return content.then((raw) => {
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  });
}

// ---------------------------------------------------------------------------
// Tables métier attendues avec RLS activée
// ---------------------------------------------------------------------------
const RLS_PROTECTED_TABLES = [
  "profiles",
  "user_roles",
  "employees",
  "drivers",
  "motorcycles",
  "vehicles",
  "farms",
  "contracts",
  "expenses",
  "revenues",
  "payments",
  "inventory_items",
  "inventory_movements",
  "documents",
  "maintenances",
  "notifications",
  "company_settings",
  "notion_database_mappings",
];

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------
async function checkEnv(): Promise<{ url: string; key: string } | null> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_PUBLISHABLE_KEY");

  if (missing.length) {
    record({
      name: "Variables d'environnement Supabase",
      status: "fail",
      detail: `Manquantes : ${missing.join(", ")}`,
    });
    return null;
  }
  record({
    name: "Variables d'environnement Supabase",
    status: "ok",
    detail: url!,
  });
  return { url: url!, key: key! };
}

async function checkConnection(url: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key },
    });
    if (res.ok || res.status === 401 || res.status === 404) {
      record({
        name: "Connexion à l'API Supabase (Data API)",
        status: "ok",
        detail: `HTTP ${res.status}`,
      });
      return true;
    }
    record({
      name: "Connexion à l'API Supabase (Data API)",
      status: "fail",
      detail: `HTTP ${res.status} ${res.statusText}`,
    });
    return false;
  } catch (err) {
    record({
      name: "Connexion à l'API Supabase (Data API)",
      status: "fail",
      detail: (err as Error).message,
    });
    return false;
  }
}

function checkMigrations(): boolean {
  const dir = resolve(process.cwd(), "supabase/migrations");
  if (!existsSync(dir)) {
    record({
      name: "Migrations SQL locales",
      status: "fail",
      detail: "Dossier supabase/migrations introuvable",
    });
    return false;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  if (files.length === 0) {
    record({
      name: "Migrations SQL locales",
      status: "warn",
      detail: "Aucune migration détectée",
    });
    return true;
  }
  const sorted = [...files].sort();
  const badlyNamed = files.filter((f) => !/^\d{14}[_-]/.test(f));
  if (badlyNamed.length) {
    record({
      name: "Migrations SQL locales",
      status: "warn",
      detail: `${files.length} fichier(s) — nommage non standard : ${badlyNamed.join(", ")}`,
    });
  } else {
    record({
      name: "Migrations SQL locales",
      status: "ok",
      detail: `${files.length} migration(s), dernière : ${sorted[sorted.length - 1]}`,
    });
  }
  return true;
}

/**
 * Santé RLS : avec la clé publishable (rôle `anon`), toute lecture d'une table
 * sensible doit être vide OU refusée. Si l'API renvoie des lignes, cela
 * signifie soit qu'une policy expose la table à `anon`, soit que RLS est
 * désactivée — dans les deux cas, on bloque le déploiement.
 */
async function checkRlsHealth(url: string, key: string): Promise<boolean> {
  let allOk = true;
  const exposed: string[] = [];
  const unreachable: string[] = [];

  for (const table of RLS_PROTECTED_TABLES) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${table}?select=*&limit=1`,
        {
          headers: {
            apikey: key,
            // Pas de Authorization -> rôle anon
            Prefer: "count=none",
          },
        },
      );
      if (res.status === 401 || res.status === 403) continue; // RLS/Grant OK
      if (res.ok) {
        const rows = (await res.json()) as unknown[];
        if (Array.isArray(rows) && rows.length > 0) {
          exposed.push(table);
          allOk = false;
        }
      } else if (res.status === 404) {
        unreachable.push(table);
        allOk = false;
      }
    } catch (err) {
      unreachable.push(`${table} (${(err as Error).message})`);
      allOk = false;
    }
  }

  if (exposed.length) {
    record({
      name: "Santé RLS (accès anonyme)",
      status: "fail",
      detail: `Tables exposées à anon : ${exposed.join(", ")}`,
    });
  } else if (unreachable.length) {
    record({
      name: "Santé RLS (accès anonyme)",
      status: "warn",
      detail: `Tables inaccessibles : ${unreachable.join(", ")}`,
    });
  } else {
    record({
      name: "Santé RLS (accès anonyme)",
      status: "ok",
      detail: `${RLS_PROTECTED_TABLES.length} tables vérifiées`,
    });
  }
  return allOk;
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------
async function main() {
  console.log("\n🛡️   HALAL ERP — Validation pré-déploiement\n");
  await loadDotEnv();

  const env = await checkEnv();
  const migrationsOk = checkMigrations();

  let connectionOk = false;
  let rlsOk = false;
  if (env) {
    connectionOk = await checkConnection(env.url, env.key);
    if (connectionOk) rlsOk = await checkRlsHealth(env.url, env.key);
  }

  console.log("\n──────────────────────────────────────────────");
  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");

  if (failed.length === 0) {
    console.log(
      `✅  Déploiement autorisé (${results.length - warned.length} OK, ${warned.length} avertissement(s))\n`,
    );
    process.exit(0);
  } else {
    console.log(
      `❌  Déploiement bloqué : ${failed.length} contrôle(s) critique(s) en échec\n`,
    );
    process.exit(1);
  }
  // Utilisé pour éviter le tree-shaking des vars ci-dessus
  void migrationsOk;
  void rlsOk;
}

main().catch((err) => {
  console.error("💥  Erreur inattendue :", err);
  process.exit(1);
});
