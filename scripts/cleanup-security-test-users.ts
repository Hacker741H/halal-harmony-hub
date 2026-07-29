import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/integrations/supabase/types";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d’environnement manquante : ${name}`);
  return value;
}

async function main() {
  if (process.env.ALLOW_SECURITY_TEST_USERS !== "true") {
    throw new Error("Refus de sécurité : définissez ALLOW_SECURITY_TEST_USERS=true pour nettoyer les comptes de test.");
  }

  const url = requiredEnvironment("SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const domain = process.env.SECURITY_TEST_EMAIL_DOMAIN?.trim() || "erp-security-test.invalid";
  const prefix = "security-test-";
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;

  const users = data.users.filter((user) => user.email?.startsWith(prefix) && user.email.endsWith(`@${domain}`));
  for (const user of users) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    console.log(`Compte de test supprimé : ${user.email}`);
  }
  console.log(`${users.length} compte(s) de test supprimé(s).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Nettoyage des comptes de test impossible.");
  process.exitCode = 1;
});
