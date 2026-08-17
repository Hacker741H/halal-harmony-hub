import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Loader2,
  Radar,
  Store,
  Target,
} from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ModuleHero } from "@/components/ui/module-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getGlobalControlCenter,
  getGlobalControlCenterLocations,
  getGlobalControlCenterSeverityCounts,
  GLOBAL_CONTROL_CENTER_MODULES,
  GLOBAL_CONTROL_CENTER_SEVERITIES,
  type GlobalControlCenterItem,
  type GlobalControlCenterModule,
  type GlobalControlCenterSeverity,
} from "@/lib/global-control-center.functions";
import { formatXOF, relativeFromNow } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/control-center")({
  head: () => ({ meta: [{ title: "Centre de contrôle — HALAL ERP" }] }),
  validateSearch: z.object({
    view: z.enum(["overview", "triage"]).optional(),
    module: z.enum(GLOBAL_CONTROL_CENTER_MODULES).optional(),
    severity: z.enum(GLOBAL_CONTROL_CENTER_SEVERITIES).optional(),
  }),
  component: ControlCenterPage,
});

const severityLabels: Record<string, string> = {
  CRITICAL: "Critique",
  WARNING: "À surveiller",
  INFO: "Information",
};

const moduleLabels: Record<string, string> = {
  NOTIFICATIONS: "Notifications",
  COMMERCE_CASH: "Caisse",
  COMMERCE_CREDIT: "Créances & dettes",
  COMMERCE_STOCK: "Stock",
  FIELD: "Terrain",
  TRANSPORT: "Transport",
  HALAL_FIELD: "Fermes & récoltes",
};

function severityClass(severity: string): string {
  if (severity === "CRITICAL") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (severity === "WARNING") return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  return "border-sky-500/30 bg-sky-500/10 text-sky-700";
}

const pageSize = 25;

function ControlCenterPage() {
  const routeSearch = Route.useSearch();
  const [view, setView] = useState<"overview" | "triage">(routeSearch.view ?? "overview");
  const [module, setModule] = useState<GlobalControlCenterModule | "ALL">(routeSearch.module ?? "ALL");
  const [severity, setSeverity] = useState<GlobalControlCenterSeverity | "ALL">(routeSearch.severity ?? "ALL");
  const [status, setStatus] = useState("");
  const [locationId, setLocationId] = useState<string | "ALL">("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const countsQuery = useQuery({
    queryKey: ["gcc-severity-counts"],
    queryFn: () => getGlobalControlCenterSeverityCounts(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const locationsQuery = useQuery({
    queryKey: ["gcc-locations"],
    queryFn: () => getGlobalControlCenterLocations(),
    staleTime: 5 * 60_000,
  });
  const overviewQuery = useQuery({
    queryKey: ["gcc-overview"],
    queryFn: () => getGlobalControlCenter({ data: { page: 1, pageSize: 100 } }),
    enabled: view === "overview",
    staleTime: 15_000,
  });
  const triageQuery = useQuery({
    queryKey: ["gcc-triage", { module, severity, status, locationId, from, to, page }],
    queryFn: () =>
      getGlobalControlCenter({
        data: {
          module: module === "ALL" ? undefined : module,
          severity: severity === "ALL" ? undefined : severity,
          status: status.trim() || undefined,
          businessLocationId: locationId === "ALL" ? undefined : locationId,
          from: from || undefined,
          to: to || undefined,
          page,
          pageSize,
        },
      }),
    enabled: view === "triage",
    staleTime: 15_000,
  });

  const counts = countsQuery.data;
  const topUrgent = (overviewQuery.data?.items ?? []).slice(0, 8);
  const triageResult = triageQuery.data;
  const totalPages = Math.max(1, Math.ceil((triageResult?.total ?? 0) / pageSize));

  function openTriage(nextSeverity?: GlobalControlCenterSeverity) {
    if (nextSeverity) setSeverity(nextSeverity);
    setPage(1);
    setView("triage");
  }

  return (
    <div className="space-y-7">
      <ModuleHero
        icon={Radar}
        eyebrow="Pilotage transversal"
        title="Centre de contrôle"
        description="Une seule liste, alimentée par les moteurs métier existants (caisse, créances, stock, HALAL Field, Transport, alertes), pour savoir où intervenir en priorité."
      />

      <Tabs value={view} onValueChange={(value) => setView(value as "overview" | "triage")}>
        <TabsList>
          <TabsTrigger value="overview">
            <Target className="h-4 w-4" /> Où dois-je intervenir ?
          </TabsTrigger>
          <TabsTrigger value="triage">
            <Radar className="h-4 w-4" /> Triage complet
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <SeverityCard
              label="Critiques"
              value={counts?.critical ?? 0}
              tone="danger"
              icon={AlertTriangle}
              onClick={() => openTriage("CRITICAL")}
            />
            <SeverityCard
              label="À surveiller"
              value={counts?.warning ?? 0}
              tone="warning"
              icon={AlertTriangle}
              onClick={() => openTriage("WARNING")}
            />
            <SeverityCard
              label="Informations"
              value={counts?.info ?? 0}
              tone="info"
              icon={Info}
              onClick={() => openTriage("INFO")}
            />
          </div>

          <Card variant="section">
            <CardHeader className="border-b border-border/70">
              <CardTitle className="text-xl">Ce qui demande une action maintenant</CardTitle>
              <p className="text-body-sm text-muted-foreground">
                Les éléments les plus urgents, tous modules confondus, dans l'ordre où les traiter.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {overviewQuery.isLoading ? (
                <div className="flex min-h-32 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                </div>
              ) : topUrgent.length === 0 ? (
                <div className="flex min-h-32 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  Aucun élément ne demande votre attention pour le moment.
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {topUrgent.map((item) => (
                    <ControlCenterRow key={item.itemId} item={item} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {(overviewQuery.data?.total ?? 0) > topUrgent.length ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => openTriage()}>
                Voir les {overviewQuery.data?.total} éléments <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="triage" className="mt-6 space-y-5">
          <Card variant="section" className="overflow-hidden">
            <CardHeader className="border-b border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Filtres</p>
                  <CardTitle className="mt-1 text-xl">Éléments à traiter</CardTitle>
                </div>
                <Badge variant="neutral" appearance="soft">{triageResult?.total ?? 0} élément(s)</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:flex-wrap md:items-center sm:p-6">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={module}
                onChange={(event) => { setModule(event.target.value as GlobalControlCenterModule | "ALL"); setPage(1); }}
              >
                <option value="ALL">Tous les modules</option>
                {GLOBAL_CONTROL_CENTER_MODULES.map((item) => (
                  <option key={item} value={item}>{moduleLabels[item] ?? item}</option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={severity}
                onChange={(event) => { setSeverity(event.target.value as GlobalControlCenterSeverity | "ALL"); setPage(1); }}
              >
                <option value="ALL">Toutes les gravités</option>
                {GLOBAL_CONTROL_CENTER_SEVERITIES.map((item) => (
                  <option key={item} value={item}>{severityLabels[item] ?? item}</option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={locationId}
                onChange={(event) => { setLocationId(event.target.value); setPage(1); }}
              >
                <option value="ALL">Tous les magasins</option>
                {(locationsQuery.data ?? []).map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
              <Input
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                placeholder="Statut (ex. OPEN)"
                className="md:max-w-40"
              />
              <div className="flex items-center gap-2">
                <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="md:w-40" aria-label="Depuis le" />
                <span className="text-sm text-muted-foreground">→</span>
                <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="md:w-40" aria-label="Jusqu'au" />
              </div>
            </CardContent>
          </Card>

          {triageQuery.isLoading ? (
            <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</CardContent></Card>
          ) : triageQuery.isError ? (
            <Card><CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-destructive">Impossible de charger le centre de contrôle.</CardContent></Card>
          ) : (triageResult?.items.length ?? 0) === 0 ? (
            <Card><CardContent className="flex min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">Aucun élément pour ces critères.</CardContent></Card>
          ) : (
            <Card variant="section" className="overflow-hidden">
              <div className="divide-y divide-border/70">
                {(triageResult?.items ?? []).map((item) => (
                  <ControlCenterRow key={item.itemId} item={item} />
                ))}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Page {page} sur {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Précédent</Button>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Suivant</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SeverityCard({
  label,
  value,
  tone,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "info";
  icon: typeof AlertTriangle;
  onClick: () => void;
}) {
  const toneClasses: Record<typeof tone, string> = {
    danger: "border-destructive/25 bg-destructive/5 text-destructive",
    warning: "border-amber-500/25 bg-amber-500/5 text-amber-700",
    info: "border-sky-500/25 bg-sky-500/5 text-sky-700",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-4 rounded-xl border p-5 text-left transition-[border-color,box-shadow,transform] transition-ui hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className={`grid size-11 shrink-0 place-items-center rounded-xl border ${toneClasses[tone]}`}>
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="text-body-sm text-muted-foreground">{label}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform transition-ui-fast group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
  );
}

function ControlCenterRow({ item }: { item: GlobalControlCenterItem }) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={severityClass(item.severity)}>
            {severityLabels[item.severity] ?? item.severity}
          </Badge>
          <Badge variant="secondary">{moduleLabels[item.sourceModule] ?? item.sourceModule}</Badge>
          {item.businessLocationId ? (
            <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
              <Store className="h-3 w-3" aria-hidden="true" /> Magasin
            </span>
          ) : null}
          <p className="font-semibold text-foreground">{item.title}</p>
        </div>
        {item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}
        <p className="text-xs text-muted-foreground">
          {relativeFromNow(item.occurredAt)}
          {item.amount !== null ? ` · ${formatXOF(item.amount)}` : ""}
        </p>
      </div>
      <Button variant="outline" size="sm" asChild className="shrink-0">
        <a href={item.actionRoute}>{item.actionLabel}</a>
      </Button>
    </div>
  );
}
