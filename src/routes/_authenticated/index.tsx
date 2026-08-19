import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { LucideIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bike,
  Car,
  ChevronRight,
  CircleAlert,
  FileWarning,
  Landmark,
  LayoutDashboard,
  Sparkles,
  Sprout,
  TrendingDown,
  TrendingUp,
  Truck,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { ModuleHero } from "@/components/ui/module-hero";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardStats, type DashboardStats } from "@/lib/dashboard.functions";
import {
  formatNumber,
  formatXOF,
  formatXOFCompact,
  relativeFromNow,
} from "@/lib/format";
import { getCurrentUserIdentity } from "@/lib/permissions.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Centre de pilotage — HALAL ERP" }] }),
  component: Dashboard,
});

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

type DashboardRoute =
  | "/employees"
  | "/drivers"
  | "/vehicles"
  | "/motorcycles"
  | "/maintenance"
  | "/farms"
  | "/contracts"
  | "/wallets"
  | "/finance"
  | "/revenues"
  | "/expenses"
  | "/payments"
  | "/documents"
  | "/notifications"
  | "/courses";

function getGreetingName(fullName: string | null | undefined, username: string | undefined) {
  return (fullName ?? username ?? "").trim().split(/\s+/)[0] || "";
}

function getDashboardGreeting(fullName: string | null | undefined, username: string | undefined) {
  const greetingName = getGreetingName(fullName, username);
  return greetingName ? `Bonjour ${greetingName}.` : "Bonjour.";
}

function Dashboard() {
  const fetchStats = useServerFn(getDashboardStats);
  const fetchIdentity = useServerFn(getCurrentUserIdentity);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: identity } = useQuery({
    queryKey: ["current-user-identity"],
    queryFn: () => fetchIdentity(),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (isError) {
      console.error("Impossible de récupérer les indicateurs du Centre de pilotage.", error);
    }
  }, [error, isError]);

  const stats = data ?? emptyStats;
  const totalBalance = stats.wallets.reduce((total, wallet) => total + wallet.balance, 0);
  const positiveResult = stats.benefice >= 0;
  const greeting = getDashboardGreeting(identity?.fullName, identity?.username);
  const greetingName = getGreetingName(identity?.fullName, identity?.username);
  const dailySummary = getDailySummary(stats, totalBalance, isLoading);
  const financialCeiling = Math.max(stats.recettesMois, stats.depensesMois, 1);

  if (isError) {
    return <DashboardErrorState onRetry={() => void refetch()} />;
  }

  const heroStats = isLoading ? undefined : [
    { label: "Trésorerie", value: formatXOFCompact(totalBalance) },
    { label: "Résultat du mois", value: formatXOFCompact(stats.benefice) },
    { label: "Alertes critiques", value: formatNumber(stats.alertesERP.critiques) },
  ];

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-(--ds-content-max-width) space-y-5 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <ModuleHero
          icon={LayoutDashboard}
          eyebrow="Centre de pilotage"
          title={greetingName ? `Bonjour ${greetingName}.` : greeting}
          description={isLoading ? undefined : dailySummary}
          stats={heroStats}
        />

        <section aria-labelledby="dashboard-kpis-title">
          <h2 id="dashboard-kpis-title" className="sr-only">Les indicateurs à lire maintenant</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Link to="/wallets" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Trésorerie" value={isLoading ? "…" : formatXOFCompact(totalBalance)} description={`${formatNumber(stats.wallets.length)} wallet${stats.wallets.length > 1 ? "s" : ""} suivi${stats.wallets.length > 1 ? "s" : ""}`} icon={WalletCards} tone={totalBalance < 0 ? "danger" : "primary"} />
            </Link>
            <Link to="/revenues" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Recettes du mois" value={isLoading ? "…" : formatXOFCompact(stats.recettesMois)} description="Encaissements enregistrés" icon={ArrowUpRight} tone="success" />
            </Link>
            <Link to="/expenses" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Dépenses du mois" value={isLoading ? "…" : formatXOFCompact(stats.depensesMois)} description="Décaissements enregistrés" icon={ArrowDownRight} tone="danger" />
            </Link>
            <Link to="/finance" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Résultat du mois" value={isLoading ? "…" : formatXOFCompact(stats.benefice)} description={positiveResult ? "Solde positif sur la période" : "À surveiller sur la période"} icon={positiveResult ? TrendingUp : TrendingDown} tone={positiveResult ? "success" : "warning"} />
            </Link>
            <Link to="/vehicles" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Véhicules" value={isLoading ? "…" : formatNumber(stats.vehicules)} description="Parc enregistré" icon={Car} tone="info" />
            </Link>
            <Link to="/employees" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Employés" value={isLoading ? "…" : formatNumber(stats.employes)} description={`${formatNumber(stats.chauffeursActifs)} chauffeur${stats.chauffeursActifs > 1 ? "s" : ""} actif${stats.chauffeursActifs > 1 ? "s" : ""}`} icon={Users} tone="primary" />
            </Link>
            <Link to="/courses" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <MetricCard label="Courses actives" value={isLoading ? "…" : formatNumber(stats.courses.active)} description={`${formatNumber(stats.courses.completed)} terminée${stats.courses.completed > 1 ? "s" : ""}`} icon={Truck} tone={stats.courses.late > 0 ? "warning" : "info"} />
            </Link>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)]">
          <Card variant="analytics" className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Performance"
              title="Flux du mois"
              description="Lecture immédiate des encaissements, décaissements et du résultat courant."
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" to="/finance">Voir le journal <ChevronRight aria-hidden="true" /></Link>}
            />

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <PerformanceTotal label="Recettes" value={isLoading ? null : formatXOF(stats.recettesMois)} tone="success" />
              <PerformanceTotal label="Dépenses" value={isLoading ? null : formatXOF(stats.depensesMois)} tone="danger" />
              <PerformanceTotal label="Résultat" value={isLoading ? null : formatXOF(stats.benefice)} tone={positiveResult ? "success" : "warning"} />
            </div>

            <div className="mt-7 space-y-5" aria-label="Comparaison des recettes et dépenses du mois">
              <MetricBar
                label="Recettes"
                value={stats.recettesMois}
                ceiling={financialCeiling}
                tone="success"
                loading={isLoading}
              />
              <MetricBar
                label="Dépenses"
                value={stats.depensesMois}
                ceiling={financialCeiling}
                tone="danger"
                loading={isLoading}
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4 text-caption">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <span>Comparaison en temps réel sur la période en cours.</span>
              <span aria-hidden="true">•</span>
              <span>L’évolution historique sera affichée dès qu’une série dédiée sera disponible.</span>
            </div>
          </Card>

          <Card variant="section" className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Centre d’activité"
              title="Dernières opérations"
              description="Les dernières écritures disponibles dans le journal financier."
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" to="/finance">Tout voir <ChevronRight aria-hidden="true" /></Link>}
            />

            <div className="mt-5 space-y-2">
              {isLoading ? (
                <ActivitySkeleton />
              ) : stats.activiteRecente.length === 0 ? (
                <EmptyActivity />
              ) : (
                stats.activiteRecente.slice(0, 5).map((activity) => (
                  <article key={activity.id} className="flex gap-3 rounded-xl border border-border/70 px-3 py-3 transition-ui-fast hover:bg-surface-hover/60">
                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Activity className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-foreground">{activity.label}</p>
                      <p className="mt-1 text-caption">{relativeFromNow(activity.at)}</p>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="mt-5 rounded-lg bg-muted/55 px-3 py-2.5 text-caption">
              Documents, maintenances et mouvements RH seront regroupés ici lorsqu’une activité unifiée sera disponible.
            </div>
          </Card>
        </section>

        <section aria-labelledby="dashboard-alerts-title">
          <Card variant="information" className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Priorités"
              title="Ce qui mérite votre attention"
              description="Les alertes sont hiérarchisées par urgence, avec un accès direct à leur traitement."
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" to="/notifications">Ouvrir les alertes <ChevronRight aria-hidden="true" /></Link>}
              headingId="dashboard-alerts-title"
            />

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <PriorityCard
                icon={CircleAlert}
                label="Alertes critiques"
                value={stats.alertesERP.critiques}
                level="Critique"
                tone="critical"
                to="/notifications"
                search={{ severity: "CRITICAL" }}
                loading={isLoading}
              />
              <PriorityCard
                icon={FileWarning}
                label="Échéances à 7 jours"
                value={stats.alertesERP.echeances7Jours}
                level="Important"
                tone="warning"
                to="/notifications"
                search={{ due: "7" }}
                loading={isLoading}
              />
              <PriorityCard
                icon={FileWarning}
                label="Échéances à 30 jours"
                value={stats.alertesERP.echeances30Jours}
                level="Information"
                tone="info"
                to="/notifications"
                search={{ due: "30" }}
                loading={isLoading}
              />
              <PriorityCard
                icon={FileWarning}
                label="Documents à suivre"
                value={stats.alertesDocuments}
                level="Important"
                tone="warning"
                to="/documents"
                loading={isLoading}
              />
              <PriorityCard
                icon={Activity}
                label="Entretiens motos en retard"
                value={stats.alertesERP.entretiensEnRetard}
                level="À planifier"
                tone="info"
                to="/notifications"
                search={{ type: "MOTORCYCLE_MAINTENANCE" }}
                loading={isLoading}
              />
              <PriorityCard
                icon={Sprout}
                label="Stocks faibles"
                value={stats.alertesERP.stocksFaibles}
                level="Information"
                tone="info"
                to="/notifications"
                search={{ type: "LOW_STOCK" }}
                loading={isLoading}
              />
            </div>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
          <Card variant="section" className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Exploitation"
              title="Courses de transport"
              description="Lecture consolidée des Courses actives, de leur encaissement et du résultat disponible."
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" to="/courses">Ouvrir les Courses <ChevronRight aria-hidden="true" /></Link>}
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PerformanceTotal label="Actives" value={isLoading ? null : formatNumber(stats.courses.active)} tone={stats.courses.late > 0 ? "warning" : "success"} />
              <PerformanceTotal label="Terminées" value={isLoading ? null : formatNumber(stats.courses.completed)} tone="success" />
              <PerformanceTotal label="À encaisser" value={isLoading ? null : stats.courses.receivable === null ? "Accès limité" : formatXOF(stats.courses.receivable)} tone="warning" />
              <PerformanceTotal label="Résultat encaissé" value={isLoading ? null : stats.courses.totalResult === null ? "Accès limité" : formatXOF(stats.courses.totalResult)} tone={stats.courses.totalResult !== null && stats.courses.totalResult < 0 ? "danger" : "success"} />
            </div>
            {stats.courses.late > 0 ? <p className="mt-5 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-caption text-warning-foreground">{formatNumber(stats.courses.late)} Course{stats.courses.late > 1 ? "s" : ""} active{stats.courses.late > 1 ? "s" : ""} dépasse{stats.courses.late > 1 ? "nt" : ""} l’arrivée prévue.</p> : null}
          </Card>
          <Card variant="compact" className="p-5 sm:p-6">
            <SectionHeading eyebrow="Classements" title="Le transport en un regard" />
            {isLoading ? <ActivitySkeleton /> : stats.courses.topClients.length ? <div className="mt-5 space-y-3"><RankedCourseEntities title="Top clients" entries={stats.courses.topClients} /><RankedCourseEntities title="Top véhicules" entries={stats.courses.topVehicles} /><RankedCourseEntities title="Top chauffeurs" entries={stats.courses.topDrivers} /></div> : <div className="mt-5"><EmptyActivity /></div>}
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <Card variant="section" className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Actions rapides"
              title="Passez à l’action"
              description="Accédez directement aux espaces où les nouvelles opérations sont enregistrées."
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <QuickAction to="/vehicles" icon={Car} label="Nouveau véhicule" description="Ouvrir la gestion du parc" />
              <QuickAction to="/courses" icon={Truck} label="Nouvelle Course" description="Planifier un transport" />
              <QuickAction to="/contracts" icon={UserRoundCheck} label="Nouveau contrat" description="Ouvrir les contrats" />
              <QuickAction to="/payments" icon={Landmark} label="Nouveau paiement" description="Ouvrir les versements" />
              <QuickAction to="/maintenance" icon={Activity} label="Nouvelle maintenance" description="Ouvrir les entretiens" />
              <QuickAction to="/employees" icon={Users} label="Nouvel employé" description="Ouvrir les employés" />
              <QuickAction to="/documents" icon={FileWarning} label="Ajouter un document" description="Ouvrir la bibliothèque" />
            </div>
          </Card>

          <Card variant="compact" className="p-5 sm:p-6">
            <SectionHeading eyebrow="Situation opérationnelle" title="Le terrain en un regard" />
            <div className="mt-5 space-y-3">
              <OperationalRow icon={Car} label="Véhicules enregistrés" value={stats.vehicules} to="/vehicles" loading={isLoading} />
              <OperationalRow icon={Bike} label="Motos enregistrées" value={stats.motos} to="/motorcycles" loading={isLoading} />
              <OperationalRow icon={Users} label="Chauffeurs actifs" value={stats.chauffeursActifs} to="/drivers" loading={isLoading} />
              <OperationalRow icon={Sprout} label="Exploitations" value={stats.exploitations} to="/farms" loading={isLoading} />
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

function DashboardErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-(--ds-content-max-width) px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <Card variant="information" className="max-w-2xl p-6" role="alert">
          <div className="flex items-start gap-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <CircleAlert className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-overline text-destructive">Indicateurs indisponibles</p>
              <h1 className="mt-1 text-h2 text-foreground">Le Centre de pilotage ne peut pas être chargé.</h1>
              <p className="mt-2 text-body-sm text-muted-foreground">
                Vérifiez votre connexion puis réessayez. Aucun indicateur n’est affiché tant que les données ne sont pas confirmées.
              </p>
              <Button type="button" className="mt-5" onClick={onRetry}>
                Réessayer
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function getDailySummary(stats: DashboardStats, totalBalance: number, loading: boolean) {
  if (loading) return "";

  const priorities: string[] = [];
  if (stats.alertesERP.critiques > 0) {
    priorities.push(`${formatNumber(stats.alertesERP.critiques)} alerte${stats.alertesERP.critiques > 1 ? "s critiques requièrent une action" : " critique requiert une action"}`);
  } else {
    priorities.push("aucune alerte critique n’est en attente");
  }

  if (stats.alertesDocuments > 0) {
    priorities.push(`${formatNumber(stats.alertesDocuments)} document${stats.alertesDocuments > 1 ? "s arrivent" : " arrive"} à échéance`);
  }

  priorities.push(totalBalance >= 0 ? "la trésorerie consolidée est positive" : "la trésorerie consolidée est à régulariser");
  return `Aujourd’hui, ${priorities.join(", ")}.`;
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  headingId,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  headingId?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-overline text-primary">{eyebrow}</p>
        <h2 id={headingId} className="mt-1 text-h3 text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PerformanceTotal({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone: "success" | "danger" | "warning";
}) {
  const toneClasses = {
    success: "border-success/20 bg-success/5",
    danger: "border-destructive/20 bg-destructive/5",
    warning: "border-warning/25 bg-warning/10",
  };

  return (
    <div className={`rounded-xl border p-4 ${toneClasses[tone]}`}>
      <p className="text-label text-muted-foreground">{label}</p>
      {value === null ? <Skeleton className="mt-3 h-6 w-2/3" /> : <p className="mt-3 text-h3 text-foreground">{value}</p>}
    </div>
  );
}

function MetricBar({
  label,
  value,
  ceiling,
  tone,
  loading,
}: {
  label: string;
  value: number;
  ceiling: number;
  tone: "success" | "danger";
  loading: boolean;
}) {
  const width = `${Math.max(0, Math.min(100, (value / ceiling) * 100))}%`;
  const barClasses = tone === "success" ? "bg-success" : "bg-destructive";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-body-sm">
        <span className="font-medium text-foreground">{label}</span>
        {loading ? <Skeleton className="h-4 w-24" /> : <span className="text-muted-foreground">{formatXOF(value)}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={ceiling} aria-valuenow={value}>
        {loading ? <Skeleton className="h-full w-2/5 rounded-none" /> : <div className={`h-full rounded-full ${barClasses} transition-[width] transition-ui-slow`} style={{ width }} />}
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-2" aria-label="Chargement des dernières opérations">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-xl border border-border/70 p-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-1/3" /></div>
        </div>
      ))}
    </div>
  );
}

function EmptyActivity() {
  return (
    <div className="rounded-xl border border-dashed px-4 py-8 text-center">
      <Activity className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-body-sm font-medium text-foreground">Aucune opération récente</p>
      <p className="mt-1 text-caption">Les prochaines écritures apparaîtront ici automatiquement.</p>
    </div>
  );
}

function RankedCourseEntities({ title, entries }: { title: string; entries: Array<{ id: string; label: string; value: number }> }) {
  if (!entries.length) return null;
  return <div><p className="text-label text-muted-foreground">{title}</p><ol className="mt-2 space-y-1.5">{entries.map((entry, index) => <li key={entry.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-body-sm"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-caption font-semibold text-primary">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium text-foreground">{entry.label}</span><span className="shrink-0 text-caption tabular-nums text-muted-foreground">{formatXOFCompact(entry.value)}</span></li>)}</ol></div>;
}

function PriorityCard({
  icon: Icon,
  label,
  value,
  level,
  tone,
  to,
  search,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  level: string;
  tone: "critical" | "warning" | "info";
  to: DashboardRoute;
  search?: Record<string, string>;
  loading: boolean;
}) {
  const badgeVariant = tone === "critical" ? "danger" : tone === "warning" ? "warning" : "info";

  return (
    <Link
      to={to}
      search={search}
      className="group rounded-xl border bg-surface p-4 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></div>
        <Badge variant={badgeVariant} appearance="soft">{level}</Badge>
      </div>
      {loading ? <Skeleton className="mt-4 h-7 w-12" /> : <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{formatNumber(value)}</p>}
      <p className="mt-1 text-body-sm text-muted-foreground">{label}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-primary">Consulter <ChevronRight className="size-3.5 transition-transform transition-ui-fast group-hover:translate-x-0.5" aria-hidden="true" /></span>
    </Link>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: DashboardRoute;
  icon: LucideIcon;
  label: string;
  description: string;
}) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border bg-surface px-3.5 py-3 transition-[border-color,background-color,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/30 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden="true" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-semibold text-foreground">{label}</p>
        <p className="truncate text-caption">{description}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform transition-ui-fast group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

function OperationalRow({
  icon: Icon,
  label,
  value,
  to,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  to: DashboardRoute;
  loading: boolean;
}) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors transition-ui-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <span className="flex-1 text-body-sm text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="h-5 w-10" /> : <span className="font-semibold tabular-nums text-foreground">{formatNumber(value)}</span>}
      <ChevronRight className="size-4 text-muted-foreground transition-transform transition-ui-fast group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
