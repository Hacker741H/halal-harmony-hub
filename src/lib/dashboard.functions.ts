import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  documentsExpirant: Array<{ id: string; nom: string; date_expiration: string | null }>;
  activiteRecente: Array<{ id: string; label: string; at: string }>;
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
  documentsExpirant: [],
  activiteRecente: [],
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase } = context;
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startNext = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);

    const [
      revToday, revMonth, expMonth,
      cntMotos, cntVeh, cntEmp, cntDriversActifs, cntFarms,
      docsExp, actExp, actRev,
    ] = await Promise.all([
      supabase.from("revenues").select("montant").eq("date", iso(today)),
      supabase.from("revenues").select("montant").gte("date", iso(startOfMonth)).lt("date", iso(startNext)),
      supabase.from("expenses").select("montant").gte("date", iso(startOfMonth)).lt("date", iso(startNext)),
      supabase.from("motorcycles").select("id", { count: "exact", head: true }),
      supabase.from("vehicles").select("id", { count: "exact", head: true }),
      supabase.from("employees").select("id", { count: "exact", head: true }),
      supabase.from("drivers").select("id", { count: "exact", head: true }).eq("statut", "actif"),
      supabase.from("farms").select("id", { count: "exact", head: true }),
      supabase.from("documents")
        .select("id, nom, date_expiration")
        .gte("date_expiration", iso(today))
        .lte("date_expiration", iso(in30))
        .order("date_expiration", { ascending: true })
        .limit(6),
      supabase.from("expenses").select("id, categorie, montant, created_at").order("created_at", { ascending: false }).limit(5),
      supabase.from("revenues").select("id, source, montant, created_at").order("created_at", { ascending: false }).limit(5),
    ]);

    const sum = (rows: { montant: number | string | null }[] | null | undefined) =>
      (rows ?? []).reduce((acc, r) => acc + Number(r.montant ?? 0), 0);

    const recettesJour = sum(revToday.data);
    const recettesMois = sum(revMonth.data);
    const depensesMois = sum(expMonth.data);

    const docs = (docsExp.data ?? []).map((d) => ({
      id: d.id, nom: d.nom, date_expiration: d.date_expiration,
    }));

    const activite = [
      ...((actExp.data ?? []).map((r) => ({
        id: `exp-${r.id}`,
        label: `Dépense enregistrée : ${r.categorie ?? "—"} (${r.montant} FCFA)`,
        at: r.created_at,
      }))),
      ...((actRev.data ?? []).map((r) => ({
        id: `rev-${r.id}`,
        label: `Recette enregistrée : ${r.source ?? "—"} (${r.montant} FCFA)`,
        at: r.created_at,
      }))),
    ]
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, 8);

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
      documentsExpirant: docs,
      activiteRecente: activite,
    };
  });
