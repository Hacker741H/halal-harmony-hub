import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Bike,
  Car,
  Users,
  UserCog,
  Sprout,
  FileWarning,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Leaf,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { formatXOFCompact, formatXOF, formatDate, formatNumber, relativeFromNow } from "@/lib/format";
import { getDashboardStats, type DashboardStats } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — HALAL ERP" },
      { name: "description", content: "Vue d'ensemble des recettes, dépenses, flotte, exploitations et documents à échéance." },
    ],
  }),
  component: Dashboard,
});

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down";
  icon: LucideIcon;
  tone: "primary" | "emerald" | "gold" | "destructive";
}

const toneStyles: Record<Kpi["tone"], string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald/10 text-emerald",
  gold: "bg-gold/15 text-gold-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <Card className="p-5 transition-shadow hover:shadow-elegant">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {kpi.label}
          </p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{kpi.value}</p>
          {kpi.hint && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              {kpi.trend === "up" && <ArrowUpRight className="h-3 w-3 text-emerald" />}
              {kpi.trend === "down" && <ArrowDownRight className="h-3 w-3 text-destructive" />}
              <span>{kpi.hint}</span>
            </div>
          )}
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${toneStyles[kpi.tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function buildKpis(stats: DashboardStats) {
  const financial: Kpi[] = [
    { label: "Recettes du jour", value: formatXOF(stats.recettesJour), icon: TrendingUp, tone: "emerald" },
    { label: "Recettes du mois", value: formatXOFCompact(stats.recettesMois), icon: Wallet, tone: "primary" },
    { label: "Dépenses du mois", value: formatXOFCompact(stats.depensesMois), icon: TrendingDown, tone: "destructive" },
    {
      label: "Bénéfice du mois",
      value: formatXOFCompact(stats.benefice),
      icon: ArrowUpRight,
      tone: "gold",
      trend: stats.benefice >= 0 ? "up" : "down",
      hint: stats.benefice >= 0 ? "En positif" : "En négatif",
    },
  ];
  const operational: Kpi[] = [
    { label: "Motos", value: formatNumber(stats.motos), icon: Bike, tone: "primary" },
    { label: "Véhicules", value: formatNumber(stats.vehicules), icon: Car, tone: "primary" },
    { label: "Employés", value: formatNumber(stats.employes), icon: Users, tone: "emerald" },
    { label: "Chauffeurs actifs", value: formatNumber(stats.chauffeursActifs), icon: UserCog, tone: "emerald" },
    { label: "Exploitations", value: formatNumber(stats.exploitations), icon: Sprout, tone: "emerald" },
    { label: "Alertes documents", value: formatNumber(stats.alertesDocuments), icon: AlertCircle, tone: stats.alertesDocuments > 0 ? "destructive" : "gold" },
  ];
  return { financial, operational };
}

function Dashboard() {
  const fetchStats = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 60_000,
  });

  const stats: DashboardStats = data ?? {
    recettesJour: 0, recettesMois: 0, depensesMois: 0, benefice: 0,
    motos: 0, vehicules: 0, employes: 0, chauffeursActifs: 0, exploitations: 0,
    alertesDocuments: 0, documentsExpirant: [], activiteRecente: [],
  };
  const { financial, operational } = buildKpis(stats);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-primary p-6 text-primary-foreground shadow-elegant sm:p-8">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-emerald/30 blur-3xl" />
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary-foreground/70">
              <Leaf className="h-3.5 w-3.5" />
              <span>HALAL ERP · Vue d'ensemble</span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Bonjour — voici votre entreprise en un coup d'œil
            </h1>
            <p className="mt-2 max-w-xl text-sm text-primary-foreground/80">
              Transport, exploitations, personnel et finances réunis dans une seule interface.
              Le modèle de données reste compatible avec votre espace Notion.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge className="border-none bg-gold text-gold-foreground">Synchronisation Notion prête</Badge>
            <Button variant="secondary" className="bg-background/10 text-primary-foreground hover:bg-background/20">
              Synchroniser
            </Button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Finances</h2>
          <Badge variant="outline">Ce mois-ci</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {financial.map((k) => <KpiCard key={k.label} kpi={k} />)}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Opérations</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {operational.map((k) => <KpiCard key={k.label} kpi={k} />)}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-gold-foreground" />
              <h3 className="font-display text-base font-semibold">Documents à échéance</h3>
            </div>
            <Button variant="ghost" size="sm">Tout voir</Button>
          </div>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : stats.documentsExpirant.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucun document arrivant à échéance dans les 30 prochains jours.</p>
          ) : (
            <ul className="divide-y divide-border">
              {stats.documentsExpirant.map((d) => (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{d.nom}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(d.date_expiration)}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 border-gold/40 bg-gold/10 text-gold-foreground">
                    {relativeFromNow(d.date_expiration)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald" />
              <h3 className="font-display text-base font-semibold">Activité récente</h3>
            </div>
            <Button variant="ghost" size="sm">Historique</Button>
          </div>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : stats.activiteRecente.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucune activité pour le moment. Les enregistrements créés dans les modules apparaîtront ici.
            </p>
          ) : (
            <ul className="space-y-3">
              {stats.activiteRecente.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">
                    HE
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{a.label}</p>
                    <p className="text-xs text-muted-foreground">{relativeFromNow(a.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
