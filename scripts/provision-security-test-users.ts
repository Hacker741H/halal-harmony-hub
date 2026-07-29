import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/integrations/supabase/types";

const TEST_ACCOUNTS = [
  { key: "super_admin", role: "super_admin" },
  { key: "admin", role: "admin" },
  { key: "comptable", role: "comptable" },
  { key: "rh", role: "rh" },
  { key: "operations", role: "operations" },
  { key: "stocks", role: "stocks" },
  { key: "exploitations", role: "exploitations" },
  { key: "gestionnaire", role: "gestionnaire" },
  { key: "lecture_seule", role: "lecture_seule" },
  { key: "sans_role", role: null },
] as const satisfies readonly { key: string; role: Database["public"]["Enums"]["app_role"] | null }[];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d’environnement manquante : ${name}`);
  return value;
}

async function findUserId(
  admin: ReturnType<typeof createClient<Database>>,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;
  return data.users.find((user) => user.email?.toLocaleLowerCase() === email.toLocaleLowerCase())?.id ?? null;
}

async function main() {
  if (process.env.ALLOW_SECURITY_TEST_USERS !== "true") {
    throw new Error("Refus de sécurité : définissez ALLOW_SECURITY_TEST_USERS=true pour provisionner les comptes de test.");
  }

  const url = requiredEnvironment("SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const password = requiredEnvironment("SECURITY_TEST_PASSWORD");
  const domain = process.env.SECURITY_TEST_EMAIL_DOMAIN?.trim() || "erp-security-test.invalid";
  if (password.length < 16) throw new Error("SECURITY_TEST_PASSWORD doit contenir au moins 16 caractères.");

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const account of TEST_ACCOUNTS) {
    const email = `security-test-${account.key}@${domain}`;
    let userId = await findUserId(admin, email);
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { security_test: true, security_test_role: account.role },
      });
      if (error) throw error;
      if (!data.user) throw new Error(`Création du compte ${account.key} non confirmée.`);
      userId = data.user.id;
    }

    const { error: deleteRolesError } = await admin.from("user_roles").delete().eq("user_id", userId);
    if (deleteRolesError) throw deleteRolesError;
    if (account.role) {
      const { error: insertRoleError } = await admin.from("user_roles").insert({ user_id: userId, role: account.role });
      if (insertRoleError) throw insertRoleError;
    }
    console.log(`Compte de test prêt : ${account.key} (${email}).`);
  }

  console.log("Provisionnement terminé. Aucun mot de passe n’a été écrit sur disque.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Provisionnement des comptes de test impossible.");
  process.exitCode = 1;
});
