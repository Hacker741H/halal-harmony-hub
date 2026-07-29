import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/integrations/supabase/types";

type SecurityTestCase = {
  role: string;
  required: readonly string[];
  forbidden?: readonly string[];
};

const TEST_CASES: readonly SecurityTestCase[] = [
  { role: "super_admin", required: ["roles.manage", "security.audit.read", "finance.read"] },
  { role: "admin", required: ["users.roles.assign", "finance.read", "reports.share"] },
  { role: "comptable", required: ["finance.read", "wallets.manage", "reports.finance"], forbidden: ["documents.sensitive.read"] },
  { role: "rh", required: ["employees.update", "contracts.manage", "salaries.read"], forbidden: ["wallets.manage"] },
  { role: "operations", required: ["vehicles.update", "motorcycles.maintenance.manage", "drivers.assign"], forbidden: ["salaries.read", "finance.export"] },
  { role: "stocks", required: ["stocks.manage", "reports.stocks"], forbidden: ["wallets.manage", "salaries.read"] },
  { role: "exploitations", required: ["farms.manage", "harvests.manage"], forbidden: ["wallets.manage", "salaries.read"] },
  { role: "gestionnaire", required: ["vehicles.update", "farms.manage"], forbidden: ["finance.read", "salaries.read"] },
  { role: "lecture_seule", required: ["vehicles.read", "stocks.read"], forbidden: ["vehicles.update", "reports.export", "finance.read"] },
  { role: "sans_role", required: [], forbidden: ["dashboard.read", "vehicles.read", "finance.read", "roles.read"] },
] as const;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d’environnement manquante : ${name}`);
  return value;
}

async function expectPermission(
  client: ReturnType<typeof createClient<Database>>,
  permission: string,
  expected: boolean,
  role: string,
) {
  const { data, error } = await client.rpc("user_has_permission", { p_permission_code: permission });
  if (error) throw error;
  if (data !== expected) throw new Error(`${role} : permission ${permission} attendue à ${expected}, reçue ${data}.`);
}

async function main() {
  if (process.env.ALLOW_SECURITY_TEST_USERS !== "true") {
    throw new Error("Refus de sécurité : définissez ALLOW_SECURITY_TEST_USERS=true pour exécuter la recette multi-rôles.");
  }
  const url = requiredEnvironment("SUPABASE_URL");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || requiredEnvironment("SUPABASE_ANON_KEY");
  const password = requiredEnvironment("SECURITY_TEST_PASSWORD");
  const domain = process.env.SECURITY_TEST_EMAIL_DOMAIN?.trim() || "erp-security-test.invalid";

  const fixtureName = `SECURITY_TEST_WALLET_${crypto.randomUUID()}`;
  const accountant = createClient<Database>(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: accountantSignInError } = await accountant.auth.signInWithPassword({
    email: `security-test-comptable@${domain}`,
    password,
  });
  if (accountantSignInError) throw new Error(`comptable : connexion impossible (${accountantSignInError.message}).`);
  const { data: fixtureWallet, error: fixtureError } = await accountant.rpc("wallet_create", {
    p_wallet: { name: fixtureName, type: "SECURITY_TEST", initial_balance: 0, color: "#000000", icon: "shield", is_default: false },
  });
  if (fixtureError || !fixtureWallet) throw new Error(fixtureError?.message ?? "Création du wallet de recette impossible.");

  try {
    for (const testCase of TEST_CASES) {
    const email = `security-test-${testCase.role}@${domain}`;
    const client = createClient<Database>(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`${testCase.role} : connexion impossible (${signInError.message}).`);

    for (const permission of testCase.required) await expectPermission(client, permission, true, testCase.role);
    for (const permission of testCase.forbidden ?? []) await expectPermission(client, permission, false, testCase.role);

    const { error: directFinanceError } = await client.from("finance_operations").select("id", { count: "exact", head: true });
    if (directFinanceError) throw new Error(`${testCase.role} : lecture directe Finance en erreur (${directFinanceError.message}).`);

    const { count: walletCount, error: walletReadError } = await client
      .from("wallets")
      .select("id", { count: "exact", head: true })
      .eq("id", fixtureWallet.id);
    if (walletReadError) throw new Error(`${testCase.role} : lecture Wallet en erreur (${walletReadError.message}).`);
    const walletsAllowed = testCase.required.some((permission) => permission === "wallets.manage") || testCase.role === "super_admin" || testCase.role === "admin";
    if (walletsAllowed !== (walletCount === 1)) throw new Error(`${testCase.role} : résultat RLS Wallet inattendu.`);

    const { error: directFinanceWriteError } = await client.from("finance_operations").insert({
      wallet_id: "00000000-0000-0000-0000-000000000000",
      amount: 1,
      operation_date: "2026-01-01",
      type: "EXPENSE",
    });
    if (!directFinanceWriteError) throw new Error(`${testCase.role} : écriture directe dans finance_operations acceptée.`);

    await client.auth.signOut();
    console.log(`Recette validée : ${testCase.role}.`);
  }
  } finally {
    const { error: deleteFixtureError } = await accountant.rpc("wallet_delete", { p_wallet_id: fixtureWallet.id });
    await accountant.auth.signOut();
    if (deleteFixtureError) throw deleteFixtureError;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recette multi-rôles impossible.");
  process.exitCode = 1;
});
