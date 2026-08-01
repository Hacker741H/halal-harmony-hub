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
  courses: {
    active: number;
    completed: number;
    late: number;
    receivable: number | null;
    totalResult: number | null;
    topClients: Array<{ id: string; label: string; value: number }>;
    topVehicles: Array<{ id: string; label: string; value: number }>;
    topDrivers: Array<{ id: string; label: string; value: number }>;
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
  courses: { active: 0, completed: 0, late: 0, receivable: null, totalResult: null, topClients: [], topVehicles: [], topDrivers: [] },
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase } = context;
    const permissionCodes = new Set(await getPermissionCodesForClient(supabase));
    const mayGenerateNotifications = permissionCodes.has("notifications.manage");
    const canReadCourseFinance = permissionCodes.has("missions.finance.read");
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
      courseRows,
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
      supabase
        .from("transport_missions")
        .select("id, status, client_id, vehicle_id, driver_id, planned_arrival_at, quoted_amount"),
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
    const courses = courseRows.data ?? [];
    const activeCourses = courses.filter((course) => course.status === "PLANNED" || course.status === "IN_PROGRESS");
    const completedCourses = courses.filter((course) => course.status === "COMPLETED" || course.status === "CLOSED");
    const lateCourses = activeCourses.filter((course) => course.planned_arrival_at !== null && course.planned_arrival_at < new Date().toISOString()).length;
    const courseIds = courses.map((course) => course.id);
    const [courseExpenses, courseInvoices, coursePayments, courseClients, courseVehicles, courseDrivers] = canReadCourseFinance && courseIds.length
      ? await Promise.all([
        supabase.from("transport_mission_expenses").select("mission_id, amount, status").in("mission_id", courseIds),
        supabase.from("transport_invoices").select("mission_id, client_id, total_amount, status").in("mission_id", courseIds),
        supabase.from("transport_invoice_payments").select("mission_id, amount, status").in("mission_id", courseIds),
        supabase.from("transport_clients").select("id, display_name").in("id", courses.map((course) => course.client_id)),
        supabase.from("vehicles").select("id, registration").in("id", courses.flatMap((course) => course.vehicle_id ? [course.vehicle_id] : [])),
        supabase.from("drivers").select("id, employees(nom, prenom)").in("id", courses.flatMap((course) => course.driver_id ? [course.driver_id] : [])),
      ])
      : [null, null, null, null, null, null];
    const courseExpenseRows = courseExpenses?.data ?? [];
    const courseInvoiceRows = courseInvoices?.data ?? [];
    const coursePaymentRows = coursePayments?.data ?? [];
    const totalCourseExpenses = courseExpenseRows.filter((row) => row.status === "PAID").reduce((total, row) => total + Number(row.amount), 0);
    const totalCourseReceived = coursePaymentRows.filter((row) => row.status === "CONFIRMED").reduce((total, row) => total + Number(row.amount), 0);
    const totalCourseBilled = courseInvoiceRows.filter((row) => row.status !== "CANCELLED").reduce((total, row) => total + Number(row.total_amount), 0);
    const aggregate = (key: "client_id" | "vehicle_id" | "driver_id", labels: Map<string, string>) => Array.from(courses.reduce((acc, course) => {
      const id = course[key]; if (!id) return acc; acc.set(id, (acc.get(id) ?? 0) + Number(course.quoted_amount)); return acc;
    }, new Map<string, number>())).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([id, value]) => ({ id, label: labels.get(id) ?? "Entité non accessible", value }));
    const clientLabels = new Map((courseClients?.data ?? []).map((client) => [client.id, client.display_name]));
    const vehicleLabels = new Map((courseVehicles?.data ?? []).map((vehicle) => [vehicle.id, vehicle.registration]));
    const driverLabels = new Map((courseDrivers?.data ?? []).map((driver) => [driver.id, [driver.employees?.nom, driver.employees?.prenom].filter(Boolean).join(" ") || "Chauffeur"]));
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
      courses: {
        active: activeCourses.length,
        completed: completedCourses.length,
        late: lateCourses,
        receivable: canReadCourseFinance ? totalCourseBilled - totalCourseReceived : null,
        totalResult: canReadCourseFinance ? totalCourseReceived - totalCourseExpenses : null,
        topClients: canReadCourseFinance ? aggregate("client_id", clientLabels) : [],
        topVehicles: canReadCourseFinance ? aggregate("vehicle_id", vehicleLabels) : [],
        topDrivers: canReadCourseFinance ? aggregate("driver_id", driverLabels) : [],
      },
    };
  });
