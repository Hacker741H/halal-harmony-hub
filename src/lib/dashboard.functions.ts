import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPermissionCodesForClient } from "@/lib/permissions.functions";

export interface DashboardStats {
  recettesJour: number;
  recettesMois: number;
  depensesMois: number;
  benefice: number;
  motos: number;
  vehicules: number;
  employes: number;
  chauffeursActifs: number;
  exploitations: number;
  alertesDocuments: number;
  wallets: Array<{ id: string; name: string; type: string; balance: number; color: string | null }>;
  documentsExpirant: Array<{ id: string; nom: string; date_expiration: string | null }>;
  activiteRecente: Array<{ id: string; label: string; at: string }>;
  alertesERP: {
    critiques: number;
    echeances7Jours: number;
    echeances30Jours: number;
    stocksFaibles: number;
    entretiensEnRetard: number;
  };
}

const emptyStats: DashboardStats = {
  recettesJour: 0,
  recettesMois: 0,
  depensesMois: 0,
  benefice: 0,
  motos: 0,
  vehicules: 0,
  employes: 0,
  chauffeursActifs: 0,
  exploitations: 0,
  alertesDocuments: 0,
  wallets: [],
  documentsExpirant: [],
  activiteRecente: [],
  alertesERP: {
    critiques: 0,
    echeances7Jours: 0,
    echeances30Jours: 0,
    stocksFaibles: 0,
    entretiensEnRetard: 0,
  },
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase } = context;
    const permissionCodes = new Set(await getPermissionCodesForClient(supabase));
    const mayGenerateNotifications = permissionCodes.has("notifications.manage");
    if (mayGenerateNotifications) {
      const { data: latestRun, error: latestRunError } = await supabase
        .from("notification_generation_runs")
        .select("completed_at, status")
        .eq("status", "SUCCEEDED")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRunError) throw latestRunError;

      const lastSuccessAt = latestRun?.completed_at ? Date.parse(latestRun.completed_at) : Number.NaN;
      const fallbackIsDue = !Number.isFinite(lastSuccessAt) || Date.now() - lastSuccessAt > 26 * 60 * 60 * 1000;
      if (fallbackIsDue) {
        const { data: run, error } = await supabase.rpc("generate_notifications_dashboard_fallback");
        if (error) throw error;
        if (run?.status === "FAILED") {
          throw new Error(run.error_message ?? "La génération de secours des alertes a échoué.");
        }
      }
    }

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startNext = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const in30 = new Date(today);
    in30.setDate(in30.getDate() + 30);

    const [
      revToday,
      revMonth,
      expMonth,
      cntMotos,
      cntVeh,
      cntEmp,
      cntDriversActifs,
      cntFarms,
      docsExp,
      recentFinanceOperations,
      wallets,
      notifications,
    ] = await Promise.all([
      supabase
        .from("finance_operations")
        .select("amount")
        .eq("type", "REVENUE")
        .eq("operation_date", iso(today)),
      supabase
        .from("finance_operations")
        .select("amount")
        .eq("type", "REVENUE")
        .gte("operation_date", iso(startOfMonth))
        .lt("operation_date", iso(startNext)),
      supabase
        .from("finance_operations")
        .select("amount")
        .eq("type", "EXPENSE")
        .gte("operation_date", iso(startOfMonth))
        .lt("operation_date", iso(startNext)),
      supabase.from("motorcycles").select("id", { count: "exact", head: true }),
      supabase.from("vehicles").select("id", { count: "exact", head: true }),
      supabase.from("employees").select("id", { count: "exact", head: true }),
      supabase.from("drivers").select("id", { count: "exact", head: true }).eq("statut", "actif"),
      supabase.from("farms").select("id", { count: "exact", head: true }),
      supabase
        .from("documents")
        .select("id, nom, date_expiration")
        .gte("date_expiration", iso(today))
        .lte("date_expiration", iso(in30))
        .order("date_expiration", { ascending: true })
        .limit(6),
      supabase
        .from("finance_operations")
        .select("id, type, category, amount, created_at")
        .in("type", ["REVENUE", "EXPENSE"])
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("wallets")
        .select("id, name, type, balance, color")
        .order("is_default", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("notifications")
        .select("status, severity, type, due_date")
        .in("status", ["UNREAD", "READ", "SNOOZED"]),
    ]);

    const sum = (rows: { amount: number | string | null }[] | null | undefined) =>
      (rows ?? []).reduce((acc, row) => acc + Number(row.amount ?? 0), 0);

    const recettesJour = sum(revToday.data);
    const recettesMois = sum(revMonth.data);
    const depensesMois = sum(expMonth.data);

    const docs = (docsExp.data ?? []).map((d) => ({
      id: d.id,
      nom: d.nom,
      date_expiration: d.date_expiration,
    }));

    const activite = (recentFinanceOperations.data ?? [])
      .map((operation) => ({
        id: `finance-${operation.id}`,
        label: `${operation.type === "REVENUE" ? "Recette" : "Dépense"} enregistrée : ${operation.category ?? "—"} (${operation.amount} FCFA)`,
        at: operation.created_at ?? "",
      }))
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, 8);

    const todayIso = iso(today);
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);
    const notificationsActives = notifications.data ?? [];
    const alertesERP = {
      critiques: notificationsActives.filter((notification) => notification.severity === "CRITICAL").length,
      echeances7Jours: notificationsActives.filter(
        (notification) =>
          notification.due_date !== null &&
          notification.due_date >= todayIso &&
          notification.due_date <= iso(in7),
      ).length,
      echeances30Jours: notificationsActives.filter(
        (notification) =>
          notification.due_date !== null &&
          notification.due_date >= todayIso &&
          notification.due_date <= iso(in30),
      ).length,
      stocksFaibles: notificationsActives.filter((notification) => notification.type === "LOW_STOCK").length,
      entretiensEnRetard: notificationsActives.filter(
        (notification) =>
          (notification.type ?? "").startsWith("MOTORCYCLE_MAINTENANCE") &&
          (notification.due_date === null || notification.due_date < todayIso),
      ).length,
    };

    return {
      ...emptyStats,
      recettesJour,
      recettesMois,
      depensesMois,
      benefice: recettesMois - depensesMois,
      motos: cntMotos.count ?? 0,
      vehicules: cntVeh.count ?? 0,
      employes: cntEmp.count ?? 0,
      chauffeursActifs: cntDriversActifs.count ?? 0,
      exploitations: cntFarms.count ?? 0,
      alertesDocuments: docs.length,
      wallets: (wallets.data ?? []).map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        balance: Number(wallet.balance ?? 0),
        color: wallet.color,
      })),
      documentsExpirant: docs,
      activiteRecente: activite,
      alertesERP,
    };
  });
