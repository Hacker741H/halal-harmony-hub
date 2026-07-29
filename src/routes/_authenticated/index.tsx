import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bike,
  Car,
  ChevronRight,
  CircleAlert,
  CreditCard,
  FileWarning,
  Landmark,
  Leaf,
  Sparkles,
  Sprout,
  UserRoundCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  formatDate,
  formatNumber,
  formatXOF,
  formatXOFCompact,
  relativeFromNow,
} from "@/lib/format";
import { getDashboardStats, type DashboardStats } from "@/lib/dashboard.functions";
import { getCurrentUserIdentity } from "@/lib/permissions.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Tableau de bord — HALAL ERP" }] }),
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
};

function WaveMark() {
  return (
    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1cc7f2] shadow-[0_0_32px_rgba(28,199,242,.38)]">
      <img src="/wave-logo.svg" alt="Wave" className="h-9 w-9" />
    </div>
  );
}

function Dashboard() {
  const fetchStats = useServerFn(getDashboardStats);
  const fetchIdentity = useServerFn(getCurrentUserIdentity);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 60_000,
  });
  const { data: identity } = useQuery({
    queryKey: ["current-user-identity"],
    queryFn: () => fetchIdentity(),
  });
  const stats = data ?? emptyStats;
  const waveWallet = stats.wallets.find((wallet) => /wave/i.test(`${wallet.name} ${wallet.type}`));
  const totalBalance = stats.wallets.reduce((total, wallet) => total + wallet.balance, 0);
  const positiveResult = stats.benefice >= 0;
  const displayName = identity?.fullName ?? identity?.username ?? "Keita";
  const firstName = displayName.trim().split(/\s+/)[0] ?? "Keita";
  const roleLabels: Record<string, string> = {
    super_admin: "Super administrateur", admin: "Administrateur", comptable: "Comptable", rh: "Ressources humaines", operations: "Opérations", stocks: "Stocks", exploitations: "Exploitations", gestionnaire: "Gestionnaire", chauffeur: "Chauffeur", employe: "Employé", lecture_seule: "Lecture seule",
  };
  const roleNames = identity?.roles.map((role) => roleLabels[role] ?? role).join(" · ") ?? "Session en cours";

  return (
    <div className="min-h-full bg-[#061711] p-4 text-white sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-emerald-300/15 bg-[#08251b] px-6 py-7 shadow-2xl shadow-black/30 sm:px-8 sm:py-9">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(70,255,181,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(70,255,181,.12)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="absolute -right-20 -top-28 h-80 w-80 rounded-full bg-[#12c77d]/25 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-32 w-2/3 bg-gradient-to-r from-transparent via-[#1cc7f2]/20 to-transparent blur-2xl" />
          <div className="relative flex flex-col gap-7 xl:min-h-105 xl:pr-92">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.24em] text-emerald-200/80">
                <Sparkles className="h-4 w-4" />
                HALAL &amp; CO · DIRECTION KEITA
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                Bonjour {firstName}.
                <br />
                <span className="text-emerald-300">Voici le rythme de HALAL &amp; CO.</span>
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-emerald-50/70 sm:text-base">
                Le point de départ de votre journée : trésorerie, mobilité, équipes et
                exploitations, réunies pour faire avancer l'entreprise avec justesse.
              </p>
            </div>
            <div className="xl:hidden">
              <SessionCard displayName={displayName} username={identity?.username} roleNames={roleNames} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm xl:absolute xl:bottom-0 xl:right-0">
              <QuickLink to="/finance" icon={Landmark} label="Trésorerie" />
              <QuickLink to="/maintenance" icon={Activity} label="À entretenir" />
              <QuickLink to="/vehicles" icon={Car} label="Mobilité" />
              <QuickLink to="/farms" icon={Sprout} label="Production" />
            </div>
          </div>
          <div className="absolute right-8 top-8 hidden w-84 xl:block">
            <SessionCard displayName={displayName} username={identity?.username} roleNames={roleNames} />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-[#10bff0] via-[#1299df] to-[#1767cb] p-6 text-white shadow-xl shadow-sky-950/30 lg:col-span-3">
            <div className="absolute -right-14 -top-14 h-52 w-52 rounded-full border-[24px] border-white/10" />
            <div className="relative flex h-full flex-col justify-between gap-7">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <WaveMark />
                  <div>
                    <p className="text-xl font-semibold tracking-tight">wave</p>
                    <p className="text-xs text-white/70">Solde disponible</p>
                  </div>
                </div>
                <Badge className="border-0 bg-white/15 text-white">API À ACTIVER</Badge>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[.18em] text-white/70">
                  {waveWallet?.name ?? "Wallet Wave"}
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
                  {formatXOF(waveWallet?.balance ?? 0)}
                </p>
              </div>
              <div className="flex items-center justify-between border-t border-white/15 pt-4 text-sm">
                <span className="text-white/75">Wave Business · connexion en attente</span>
                <Link to="/wallets" className="inline-flex items-center gap-1 font-medium">
                  Voir le wallet <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
            <MetricCard
              label="Trésorerie globale"
              value={formatXOF(totalBalance)}
              icon={CreditCard}
              accent="sky"
              detail={`${stats.wallets.length} wallet${stats.wallets.length > 1 ? "s" : ""} configuré${stats.wallets.length > 1 ? "s" : ""}`}
            />
            <MetricCard
              label="Résultat du mois"
              value={formatXOFCompact(stats.benefice)}
              icon={positiveResult ? TrendingUp : TrendingDown}
              accent={positiveResult ? "emerald" : "rose"}
              detail={positiveResult ? "Performance positive" : "À surveiller"}
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Recettes aujourd’hui"
            value={formatXOF(stats.recettesJour)}
            icon={ArrowUpRight}
            accent="emerald"
            detail="Entrées enregistrées"
          />
          <MetricCard
            label="Recettes du mois"
            value={formatXOFCompact(stats.recettesMois)}
            icon={TrendingUp}
            accent="sky"
            detail="Cumul mensuel"
          />
          <MetricCard
            label="Dépenses du mois"
            value={formatXOFCompact(stats.depensesMois)}
            icon={ArrowDownRight}
            accent="rose"
            detail="Sorties enregistrées"
          />
          <MetricCard
            label="Documents à suivre"
            value={formatNumber(stats.alertesDocuments)}
            icon={FileWarning}
            accent={stats.alertesDocuments ? "gold" : "emerald"}
            detail={stats.alertesDocuments ? "Échéances proches" : "Aucune alerte"}
          />
        </section>

        <section className="rounded-2xl border border-amber-300/15 bg-[#0b2119] p-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[.18em] text-amber-100/60">
                Centre d’alertes
              </p>
              <h2 className="mt-1 text-xl font-semibold">Actions à anticiper</h2>
            </div>
            <Link
              to="/notifications"
              className="text-sm font-medium text-amber-200 hover:text-amber-100"
            >
              Ouvrir les notifications <ChevronRight className="inline h-4 w-4" />
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <AlertSummaryCard
              href="/notifications?severity=CRITICAL"
              label="Alertes critiques"
              value={stats.alertesERP.critiques}
              critical
            />
            <AlertSummaryCard
              href="/notifications?due=7"
              label="Échéances à 7 jours"
              value={stats.alertesERP.echeances7Jours}
            />
            <AlertSummaryCard
              href="/notifications?due=30"
              label="Échéances à 30 jours"
              value={stats.alertesERP.echeances30Jours}
            />
            <AlertSummaryCard
              href="/notifications?type=LOW_STOCK"
              label="Stocks faibles"
              value={stats.alertesERP.stocksFaibles}
            />
            <AlertSummaryCard
              href="/notifications?type=MOTORCYCLE_MAINTENANCE"
              label="Entretiens en retard"
              value={stats.alertesERP.entretiensEnRetard}
            />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="border border-white/10 bg-[#0b2119] p-5 text-white lg:col-span-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[.18em] text-emerald-200/60">
                  Radar opérationnel
                </p>
                <h2 className="mt-1 text-xl font-semibold">Votre activité terrain</h2>
              </div>
              <Badge className="border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
                Temps réel
              </Badge>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <OperationalMetric icon={Bike} label="Motos" value={stats.motos} />
              <OperationalMetric icon={Car} label="Véhicules" value={stats.vehicules} />
              <OperationalMetric icon={Users} label="Employés" value={stats.employes} />
              <OperationalMetric
                icon={Activity}
                label="Chauffeurs actifs"
                value={stats.chauffeursActifs}
              />
              <OperationalMetric icon={Sprout} label="Exploitations" value={stats.exploitations} />
              <OperationalMetric
                icon={CircleAlert}
                label="Alertes"
                value={stats.alertesERP.critiques}
                warn={stats.alertesERP.critiques > 0}
              />
            </div>
          </Card>

          <Card className="border border-white/10 bg-[#0b2119] p-5 text-white lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[.18em] text-emerald-200/60">
                  Flux live
                </p>
                <h2 className="mt-1 text-xl font-semibold">Dernières opérations</h2>
              </div>
              <Link to="/finance" className="text-sm text-emerald-300">
                Tout voir
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {isLoading ? (
                <p className="py-8 text-center text-sm text-emerald-100/50">
                  Connexion aux données…
                </p>
              ) : stats.activiteRecente.length === 0 ? (
                <p className="py-8 text-center text-sm text-emerald-100/50">
                  Aucune activité récente.
                </p>
              ) : (
                stats.activiteRecente.slice(0, 4).map((activity) => (
                  <div
                    key={activity.id}
                    className="flex gap-3 rounded-xl border border-white/5 bg-white/[.03] p-3"
                  >
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-300/10 text-emerald-300">
                      <Activity className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-emerald-50">{activity.label}</p>
                      <p className="mt-1 text-xs text-emerald-100/45">
                        {relativeFromNow(activity.at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="border border-white/10 bg-[#0b2119] p-5 text-white lg:col-span-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[.18em] text-emerald-200/60">
                  Wallets configurés
                </p>
                <h2 className="mt-1 text-xl font-semibold">Répartition de trésorerie</h2>
              </div>
              <Link to="/wallets" className="text-sm text-emerald-300">
                Gérer les wallets
              </Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {stats.wallets.slice(0, 4).map((wallet) => (
                <div
                  key={wallet.id}
                  className="rounded-2xl border border-white/10 bg-white/[.03] p-4"
                >
                  <div className="flex justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: wallet.color || "#44d7b6" }}
                      />
                      <p className="truncate text-sm font-medium">{wallet.name}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-100/45">
                      {wallet.type}
                    </span>
                  </div>
                  <p className="mt-4 text-2xl font-semibold">{formatXOF(wallet.balance)}</p>
                </div>
              ))}
              {stats.wallets.length === 0 && (
                <p className="py-8 text-sm text-emerald-100/50">
                  Ajoutez un wallet pour suivre votre trésorerie ici.
                </p>
              )}
            </div>
          </Card>
          <Card className="border border-amber-300/15 bg-gradient-to-br from-[#231c0d] to-[#101b15] p-5 text-white lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-300/15 text-amber-200">
                <Leaf className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[.16em] text-amber-100/55">
                  Priorité du jour
                </p>
                <h2 className="font-semibold">Documents & conformité</h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-amber-50/70">
              {stats.documentsExpirant.length
                ? `${stats.documentsExpirant.length} document(s) arrivent à échéance dans les 30 prochains jours.`
                : "Aucun document n’arrive à échéance dans les 30 prochains jours."}
            </p>
            {stats.documentsExpirant[0] && (
              <p className="mt-3 text-sm text-amber-100">
                Prochain : {stats.documentsExpirant[0].nom} ·{" "}
                {formatDate(stats.documentsExpirant[0].date_expiration)}
              </p>
            )}
            <Button
              asChild
              variant="outline"
              className="mt-5 border-amber-200/20 bg-transparent text-amber-100 hover:bg-amber-100/10"
            >
              <Link to="/documents">Voir les documents</Link>
            </Button>
          </Card>
        </section>
      </div>
    </div>
  );
}

function SessionCard({ displayName, username, roleNames }: { displayName: string; username?: string; roleNames: string }) {
  return <div className="rounded-2xl border border-emerald-200/15 bg-black/15 px-4 py-3 backdrop-blur-sm">
    <div className="flex items-center gap-2 text-emerald-100/65"><UserRoundCheck className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-[.14em]">Session active</span></div>
    <p className="mt-2 font-semibold text-white">{displayName}</p>
    <p className="truncate text-xs text-emerald-100/65">@{username ?? "…"} · {roleNames}</p>
  </div>;
}

function QuickLink({
  to,
  icon: Icon,
  label,
}: {
  to: "/finance" | "/maintenance" | "/vehicles" | "/farms";
  icon: typeof Landmark;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.06] px-3 py-2.5 text-sm text-emerald-50 transition hover:bg-white/[.12]"
    >
      <Icon className="h-4 w-4 text-emerald-300" />
      {label}
    </Link>
  );
}

function AlertSummaryCard({
  href,
  label,
  value,
  critical = false,
}: {
  href: string;
  label: string;
  value: number;
  critical?: boolean;
}) {
  return (
    <a
      href={href}
      className="rounded-xl border border-white/10 bg-white/[.03] p-4 transition hover:bg-white/[.07]"
    >
      <p className="text-xs text-emerald-100/60">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold " + (critical && value > 0 ? "text-rose-300" : "text-white")
        }
      >
        {formatNumber(value)}
      </p>
    </a>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  detail,
}: {
  label: string;
  value: string;
  icon: typeof Landmark;
  accent: "sky" | "emerald" | "rose" | "gold";
  detail: string;
}) {
  const accents = {
    sky: "bg-sky-400/10 text-sky-300",
    emerald: "bg-emerald-400/10 text-emerald-300",
    rose: "bg-rose-400/10 text-rose-300",
    gold: "bg-amber-300/10 text-amber-200",
  };
  return (
    <Card className="border border-white/10 bg-[#0b2119] p-5 text-white shadow-lg shadow-black/10">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[.14em] text-emerald-100/50">
            {label}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-xs text-emerald-100/45">{detail}</p>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${accents[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
function OperationalMetric({
  icon: Icon,
  label,
  value,
  warn = false,
}: {
  icon: typeof Landmark;
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[.03] p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-emerald-50/70">{label}</p>
        <Icon className={`h-4 w-4 ${warn ? "text-amber-200" : "text-emerald-300"}`} />
      </div>
      <p className="mt-3 text-3xl font-semibold">{formatNumber(value)}</p>
    </div>
  );
}
