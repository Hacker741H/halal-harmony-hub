import { createClient } from "npm:@supabase/supabase-js@2";

function secureEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405 });
  }

  const schedulerSecret = Deno.env.get("NOTIFICATION_SCHEDULER_SECRET");
  const suppliedSecret = request.headers.get("x-notification-scheduler-secret");
  if (!schedulerSecret || !suppliedSecret || !secureEquals(suppliedSecret, schedulerSecret)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Configuration Edge Function incomplète.");
    return Response.json({ error: "Configuration serveur indisponible." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: run, error } = await supabase.rpc("run_notification_generation", {
    p_trigger_type: "SCHEDULED",
  });

  if (error || !run || run.status === "FAILED") {
    console.error("Échec de la génération planifiée.", {
      runId: run?.id ?? null,
      message: error?.message ?? run?.error_message ?? "résultat absent",
    });
    return Response.json({ error: "La génération des alertes a échoué." }, { status: 500 });
  }

  console.info("Génération planifiée terminée.", {
    runId: run.id,
    created: run.created_count,
    updated: run.updated_count,
    resolved: run.resolved_count,
  });
  return Response.json({
    id: run.id,
    status: run.status,
    createdCount: run.created_count,
    updatedCount: run.updated_count,
    resolvedCount: run.resolved_count,
    completedAt: run.completed_at,
  });
});
