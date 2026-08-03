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
  ShieldCheck,
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

function isMariamKeita(fullName: string | null | undefined, username: string | undefined) {
  const identity = `${fullName ?? ""} ${username ?? ""}`.trim().toLocaleLowerCase("fr-FR");
  return identity.includes("mariam") && identity.includes("keita");
}

function isFabiola(fullName: string | null | undefined, username: string | undefined) {
  const identity = `${fullName ?? ""} ${username ?? ""}`.trim().toLocaleLowerCase("fr-FR");
  return identity.includes("fabiola");
}

function getDashboardGreeting(fullName: string | null | undefined, username: string | undefined) {
  if (isMariamKeita(fullName, username)) return "Bonjour Mme Keita.";
  if (isFabiola(fullName, username)) return "おかえりなさい、ファビオラさん。";

  const name = (fullName ?? username ?? "").trim().split(/\s+/)[0] || "";
  return name ? `Bonjour ${name}.` : "Bonjour.";
}

function Dashboard() {
  const fetchStats = useServerFn(getDashboardStats);
  const fetchIdentity = useServerFn(getCurrentUserIdentity);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 60_000,
  });
  const { data: identity } = useQuery({
    queryKey: ["current-user-identity"],
    queryFn: () => fetchIdentity(),
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
  const showMariamWelcome = isMariamKeita(identity?.fullName, identity?.username);
  const showFabiolaWelcome = isFabiola(identity?.fullName, identity?.username);
  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const dailySummary = getDailySummary(stats, totalBalance, isLoading);
  const financialCeiling = Math.max(stats.recettesMois, stats.depensesMois, 1);
  const companyHealthSignals = getCompanyHealthSignals(stats, totalBalance);

  if (isError) {
    return <DashboardErrorState onRetry={() => void refetch()} />;
  }

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-(--ds-content-max-width) space-y-7 px-4 py-5 sm:px-6 sm:py-7 lg:space-y-8 xl:px-8">
        <section className="relative isolate overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.13] via-surface-elevated to-surface px-5 py-6 shadow-md sm:px-7 sm:py-8 lg:px-8 lg:py-9">
          <div className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-primary/14 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-32 left-[38%] size-72 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] border-l border-primary/10 bg-gradient-to-l from-surface/45 to-transparent lg:block" aria-hidden="true" />

          <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-center xl:gap-10">
            <div className="max-w-3xl animate-slide-in motion-reduce:animate-none">
              <div className="flex flex-wrap items-center gap-2 text-caption">
                <span className="text-overline text-primary">Centre de pilotage</span>
                <span aria-hidden="true">•</span>
                <time dateTime={new Date().toISOString().slice(0, 10)}>{today}</time>
              </div>
              <h1 className="mt-4 max-w-2xl text-display text-foreground">
                {showMariamWelcome ? (
                  <>
                    Bonjour{" "}
                    <span
                      className="relative inline-block text-primary animate-welcome-name motion-reduce:animate-none"
                      style={{ animationDelay: "70ms" }}
                    >
                      Mme Keita
                      <span
                        className="absolute inset-x-1 -bottom-1 h-px bg-primary/45"
                        aria-hidden="true"
                      />
                    </span>
                    .
                  </>
                ) : showFabiolaWelcome ? (
                  <>
                    <span className="animate-fabiola-title motion-reduce:animate-none">おかえりなさい、</span>{" "}
                    <span className="relative inline-block text-primary animate-welcome-name motion-reduce:animate-none">
                      ファビオラさん
                      <span
                        className="absolute inset-x-1 -bottom-1 h-px bg-primary/45"
                        aria-hidden="true"
                      />
                    </span>
                    。
                  </>
                ) : (
                  greeting
                )}
              </h1>
              {showMariamWelcome ? (
                <div
                  className="relative mt-5 max-w-xl overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.12] via-surface-elevated to-surface p-4 shadow-md animate-welcome-reveal motion-reduce:animate-none"
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-primary/20 to-transparent animate-welcome-sweep motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <div className="relative flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm animate-scale-in motion-reduce:animate-none">
                      <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-overline text-primary">Bienvenue dans HALAL ERP</p>
                      <p className="mt-1 text-h4 text-foreground">Votre espace de pilotage est prêt.</p>
                      <p className="mt-1 text-body-sm text-muted-foreground">
                        Retrouvez l’essentiel de votre activité en un regard, Mme Keita.
                      </p>
                    </div>
                  </div>
                </div>
              ) : showFabiolaWelcome ? (
                <div
                  className="relative mt-5 max-w-xl overflow-hidden rounded-2xl border border-primary/25 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_12%,var(--surface)),var(--surface-elevated)_52%,color-mix(in_oklab,var(--accent)_9%,var(--surface)))] p-4 shadow-md animate-welcome-reveal motion-reduce:animate-none"
                  role="status"
                  aria-live="polite"
                >
                  <span className="pointer-events-none absolute right-7 top-3 size-2 rounded-full bg-primary/50 animate-fabiola-petal-one motion-reduce:animate-none" aria-hidden="true" />
                  <span className="pointer-events-none absolute right-20 top-7 size-1.5 rounded-full bg-accent/65 animate-fabiola-petal-two motion-reduce:animate-none" aria-hidden="true" />
                  <span className="pointer-events-none absolute bottom-4 right-12 size-2 rounded-full bg-primary/35 animate-fabiola-petal-three motion-reduce:animate-none" aria-hidden="true" />
                  <div className="relative flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm animate-scale-in motion-reduce:animate-none">
                      <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-overline text-primary">ようこそ · HALAL ERP</p>
                      <p className="mt-1 text-h4 text-foreground">Votre espace est prêt, Fabiola.</p>
                      <p className="mt-1 text-body-sm text-muted-foreground">
                        Une vue calme et claire pour commencer votre journée avec précision.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              {isLoading ? (
                <div className="mt-5 max-w-2xl space-y-2" aria-label="Chargement du résumé du jour">
                  <Skeleton className="h-4 w-full max-w-xl" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              ) : (
                <p className="mt-5 max-w-2xl text-body-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {dailySummary}
                </p>
              )}

              {isLoading ? (
                <div className="mt-6 flex flex-wrap gap-2" aria-label="Chargement de l'état global">
                  <Skeleton className="h-8 w-32 rounded-full" />
                  <Skeleton className="h-8 w-36 rounded-full" />
                </div>
              ) : (
                <div className="mt-6 flex flex-wrap gap-2">
                  <StatusPill
                    icon={CircleAlert}
                    label={stats.alertesERP.critiques > 0 ? "Action requise" : "Situation suivie"}
                    tone={stats.alertesERP.critiques > 0 ? "critical" : "calm"}
                  />
                  <StatusPill
                    icon={WalletCards}
                    label={`${formatNumber(stats.wallets.length)} wallet${stats.wallets.length > 1 ? "s" : ""} suivi${stats.wallets.length > 1 ? "s" : ""}`}
                    tone="calm"
                  />
                </div>
              )}
            </div>

            <CompanyHealthCard signals={companyHealthSignals} loading={isLoading} />
          </div>

          <div className="relative mt-7 flex items-center gap-3 border-t border-primary/10 pt-4 text-caption text-muted-foreground">
            <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-3.5" aria-hidden="true" />
            </div>
            <p>Lecture fondée sur les indicateurs financiers et opérationnels disponibles à cet instant.</p>
          </div>
        </section>

        <section aria-labelledby="dashboard-kpis-title">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-overline text-primary">Vue essentielle</p>
              <h2 id="dashboard-kpis-title" className="mt-1 text-h3 text-foreground">
                Les indicateurs à lire maintenant
              </h2>
            </div>
            <p className="hidden text-caption sm:block">Période en cours</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <KpiCard
              label="Trésorerie"
              value={isLoading ? null : formatXOFCompact(totalBalance)}
              accessibleValue={isLoading ? undefined : formatXOF(totalBalance)}
              detail={`${stats.wallets.length} wallet${stats.wallets.length > 1 ? "s" : ""} suivi${stats.wallets.length > 1 ? "s" : ""}`}
              icon={WalletCards}
              tone={totalBalance < 0 ? "danger" : "primary"}
              to="/wallets"
              animationDelay="0ms"
            />
            <KpiCard
              label="Recettes du mois"
              value={isLoading ? null : formatXOFCompact(stats.recettesMois)}
              detail="Encaissements enregistrés"
              icon={ArrowUpRight}
              tone="success"
              to="/revenues"
              animationDelay="40ms"
            />
            <KpiCard
              label="Dépenses du mois"
              value={isLoading ? null : formatXOFCompact(stats.depensesMois)}
              detail="Décaissements enregistrés"
              icon={ArrowDownRight}
              tone="danger"
              to="/expenses"
              animationDelay="80ms"
            />
            <KpiCard
              label="Résultat du mois"
              value={isLoading ? null : formatXOFCompact(stats.benefice)}
              detail={positiveResult ? "Solde positif sur la période" : "À surveiller sur la période"}
              icon={positiveResult ? TrendingUp : TrendingDown}
              tone={positiveResult ? "success" : "warning"}
              to="/finance"
              animationDelay="120ms"
            />
            <KpiCard
              label="Véhicules"
              value={isLoading ? null : formatNumber(stats.vehicules)}
              detail="Parc enregistré"
              icon={Car}
              tone="info"
              to="/vehicles"
              animationDelay="160ms"
            />
            <KpiCard
              label="Employés"
              value={isLoading ? null : formatNumber(stats.employes)}
              detail={`${formatNumber(stats.chauffeursActifs)} chauffeur${stats.chauffeursActifs > 1 ? "s" : ""} actif${stats.chauffeursActifs > 1 ? "s" : ""}`}
              icon={Users}
              tone="primary"
              to="/employees"
              animationDelay="180ms"
            />
            <KpiCard
              label="Courses actives"
              value={isLoading ? null : formatNumber(stats.courses.active)}
              detail={`${formatNumber(stats.courses.completed)} terminée${stats.courses.completed > 1 ? "s" : ""}`}
              icon={Truck}
              tone={stats.courses.late > 0 ? "warning" : "info"}
              to="/courses"
              animationDelay="180ms"
            />
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)]">
          <Card variant="analytics" className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Performance"
              title="Flux du mois"
              description="Lecture immédiate des encaissements, décaissements et du résultat courant."
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 focus-visible:outline-none" to="/finance">Voir le journal <ChevronRight aria-hidden="true" /></Link>}
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
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 focus-visible:outline-none" to="/finance">Tout voir <ChevronRight aria-hidden="true" /></Link>}
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
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 focus-visible:outline-none" to="/notifications">Ouvrir les alertes <ChevronRight aria-hidden="true" /></Link>}
              headingId="dashboard-alerts-title"
            />

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <PriorityCard
                icon={CircleAlert}
                label="Alertes critiques"
                value={stats.alertesERP.critiques}
                level="Critique"
                tone="critical"
                href="/notifications?severity=CRITICAL"
                loading={isLoading}
              />
              <PriorityCard
                icon={FileWarning}
                label="Échéances à 7 jours"
                value={stats.alertesERP.echeances7Jours}
                level="Important"
                tone="warning"
                href="/notifications?due=7"
                loading={isLoading}
              />
              <PriorityCard
                icon={FileWarning}
                label="Échéances à 30 jours"
                value={stats.alertesERP.echeances30Jours}
                level="Information"
                tone="info"
                href="/notifications?due=30"
                loading={isLoading}
              />
              <PriorityCard
                icon={FileWarning}
                label="Documents à suivre"
                value={stats.alertesDocuments}
                level="Important"
                tone="warning"
                href="/documents"
                loading={isLoading}
              />
              <PriorityCard
                icon={Activity}
                label="Entretiens motos en retard"
                value={stats.alertesERP.entretiensEnRetard}
                level="À planifier"
                tone="info"
                href="/notifications?type=MOTORCYCLE_MAINTENANCE"
                loading={isLoading}
              />
              <PriorityCard
                icon={Sprout}
                label="Stocks faibles"
                value={stats.alertesERP.stocksFaibles}
                level="Information"
                tone="info"
                href="/notifications?type=LOW_STOCK"
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
              action={<Link className="inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-colors transition-ui-fast hover:text-primary/80 focus-visible:outline-none" to="/courses">Ouvrir les Courses <ChevronRight aria-hidden="true" /></Link>}
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

function StatusPill({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tone: "calm" | "critical";
}) {
  return (
    <Badge variant={tone === "critical" ? "danger" : "success"} appearance="soft" className="h-8 px-3">
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}

type CompanyHealthSignal = {
  label: string;
  value: string;
  detail: string;
  accessibleValue?: string;
  icon: LucideIcon;
  tone: "positive" | "attention" | "critical";
};

function getCompanyHealthSignals(stats: DashboardStats, totalBalance: number): CompanyHealthSignal[] {
  const criticalAlerts = stats.alertesERP.critiques;

  return [
    {
      label: "Trésorerie",
      value: formatXOFCompact(totalBalance),
      accessibleValue: formatXOF(totalBalance),
      detail: totalBalance >= 0 ? "Solde consolidé positif" : "Solde consolidé à régulariser",
      icon: WalletCards,
      tone: totalBalance >= 0 ? "positive" : "attention",
    },
    {
      label: "Résultat du mois",
      value: formatXOFCompact(stats.benefice),
      accessibleValue: formatXOF(stats.benefice),
      detail: stats.benefice >= 0 ? "Solde positif sur la période" : "Solde à surveiller sur la période",
      icon: stats.benefice >= 0 ? TrendingUp : TrendingDown,
      tone: stats.benefice >= 0 ? "positive" : "attention",
    },
    {
      label: "Alertes critiques",
      value: formatNumber(criticalAlerts),
      detail: criticalAlerts > 0 ? "À traiter sans attendre" : "Aucune alerte critique",
      icon: CircleAlert,
      tone: criticalAlerts > 0 ? "critical" : "positive",
    },
  ];
}

function CompanyHealthCard({
  signals,
  loading,
}: {
  signals: CompanyHealthSignal[];
  loading: boolean;
}) {
  const toneClasses: Record<CompanyHealthSignal["tone"], string> = {
    positive: "bg-success/10 text-success",
    attention: "bg-warning/15 text-warning-foreground",
    critical: "bg-destructive/10 text-destructive",
  };

  return (
    <Card
      variant="glass"
      className="relative overflow-hidden border-primary/15 bg-surface/80 p-4 shadow-sm animate-scale-in motion-reduce:animate-none sm:p-5"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-overline text-primary">Santé de l’entreprise</p>
          <h2 className="mt-1 text-h4 text-foreground">Trois signaux essentiels</h2>
          <p className="mt-1 text-caption">Trésorerie, résultat et alertes critiques.</p>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {loading
          ? [0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-border/70 bg-surface/65 px-3 py-2.5">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="mt-2 h-4 w-3/5" />
              </div>
            ))
          : signals.map((signal) => {
              const Icon = signal.icon;
              return (
                <div key={signal.label} className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/65 px-3 py-2.5">
                  <div className={`grid size-7 shrink-0 place-items-center rounded-md ${toneClasses[signal.tone]}`}>
                    <Icon className="size-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-caption font-medium text-foreground">{signal.label}</p>
                    <p className="truncate text-caption">{signal.detail}</p>
                  </div>
                  <p className="max-w-24 shrink-0 truncate text-right text-body-sm font-semibold tabular-nums text-foreground" title={signal.accessibleValue}>
                    {signal.accessibleValue ? <span aria-hidden="true">{signal.value}</span> : signal.value}
                    {signal.accessibleValue ? <span className="sr-only">{signal.accessibleValue}</span> : null}
                  </p>
                </div>
              );
            })}
      </div>
    </Card>
  );
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

function KpiCard({
  label,
  value,
  accessibleValue,
  detail,
  icon: Icon,
  tone,
  to,
  animationDelay,
}: {
  label: string;
  value: string | null;
  accessibleValue?: string;
  detail: string;
  icon: LucideIcon;
  tone: "primary" | "success" | "danger" | "warning" | "info";
  to: DashboardRoute;
  animationDelay: string;
}) {
  const iconClasses: Record<typeof tone, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
    warning: "bg-warning/15 text-warning-foreground",
    info: "bg-info/10 text-info",
  };
  const accentClasses: Record<typeof tone, string> = {
    primary: "from-primary/70 via-primary/20 to-transparent",
    success: "from-success/75 via-success/20 to-transparent",
    danger: "from-destructive/75 via-destructive/20 to-transparent",
    warning: "from-warning/80 via-warning/20 to-transparent",
    info: "from-info/75 via-info/20 to-transparent",
  };

  return (
    <Link
      to={to}
      className="group block rounded-xl animate-fade-in motion-reduce:animate-none focus-visible:outline-none"
      style={{ animationDelay }}
    >
      <Card variant="kpi" className="relative h-full overflow-hidden border-border/80 p-4 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
        <div className={`pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r ${accentClasses[tone]}`} aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <p className="pt-1 text-label text-muted-foreground">{label}</p>
          <div className={`grid size-9 place-items-center rounded-xl ${iconClasses[tone]}`}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
        </div>
        {value === null ? <Skeleton className="mt-5 h-8 w-3/4" /> : (
          <p className="mt-5 min-w-0 truncate text-[clamp(1.25rem,1.7vw,1.75rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground" title={accessibleValue}>
            {accessibleValue ? <span aria-hidden="true">{value}</span> : value}
            {accessibleValue ? <span className="sr-only">{accessibleValue}</span> : null}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-caption">{detail}</p>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform transition-ui-fast group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
        </div>
      </Card>
    </Link>
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
  href,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  level: string;
  tone: "critical" | "warning" | "info";
  href: string;
  loading: boolean;
}) {
  const badgeVariant = tone === "critical" ? "danger" : tone === "warning" ? "warning" : "info";

  return (
    <a href={href} className="group rounded-xl border bg-surface p-4 transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm focus-visible:outline-none">
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></div>
        <Badge variant={badgeVariant} appearance="soft">{level}</Badge>
      </div>
      {loading ? <Skeleton className="mt-4 h-7 w-12" /> : <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{formatNumber(value)}</p>}
      <p className="mt-1 text-body-sm text-muted-foreground">{label}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-primary">Consulter <ChevronRight className="size-3.5 transition-transform transition-ui-fast group-hover:translate-x-0.5" aria-hidden="true" /></span>
    </a>
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
    <Link to={to} className="group flex items-center gap-3 rounded-xl border bg-surface px-3.5 py-3 transition-[border-color,background-color,transform] transition-ui hover:-translate-y-0.5 hover:border-primary/30 hover:bg-surface-hover focus-visible:outline-none">
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
    <Link to={to} className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors transition-ui-fast hover:bg-surface-hover focus-visible:outline-none">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <span className="flex-1 text-body-sm text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="h-5 w-10" /> : <span className="font-semibold tabular-nums text-foreground">{formatNumber(value)}</span>}
      <ChevronRight className="size-4 text-muted-foreground transition-transform transition-ui-fast group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
