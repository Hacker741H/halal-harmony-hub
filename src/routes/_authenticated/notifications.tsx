import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Boxes, CalendarDays, CheckCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { NotificationList } from "@/components/notifications/notification-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runNotificationsManually } from "@/lib/alert-settings.functions";
import {
  getNotificationSummary,
  getNotifications,
  markAllNotificationsRead,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SEVERITY_LABELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_STATUS_LABELS,
  type NotificationSeverity,
  type NotificationStatus,
  updateNotificationStatus,
} from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — HALAL ERP" }] }),
  validateSearch: z.object({
    severity: z.enum(NOTIFICATION_SEVERITIES).optional(),
    status: z.enum(NOTIFICATION_STATUSES).optional(),
    type: z.string().trim().min(1).max(120).optional(),
    due: z.union([z.literal("7"), z.literal("30")]).optional(),
  }),
  component: NotificationsPage,
});

const pageSize = 30;

function NotificationsPage() {
  const routeSearch = Route.useSearch();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NotificationStatus | "ALL">(routeSearch.status ?? "ALL");
  const [severity, setSeverity] = useState<NotificationSeverity | "ALL">(routeSearch.severity ?? "ALL");
  const [type, setType] = useState(routeSearch.type ?? "");
  const [dueDays, setDueDays] = useState<7 | 30 | undefined>(routeSearch.due === "7" ? 7 : routeSearch.due === "30" ? 30 : undefined);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const notificationsQuery = useQuery({
    queryKey: ["notifications", { status, severity, type, dueDays, search, page }],
    queryFn: () => getNotifications({
      data: {
        status: status === "ALL" ? undefined : status,
        severity: severity === "ALL" ? undefined : severity,
        type: type || undefined,
        dueDays,
        search: search.trim() || undefined,
        page,
        pageSize,
      },
    }),
  });
  const summaryQuery = useQuery({ queryKey: ["notification-summary"], queryFn: () => getNotificationSummary() });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["notification-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
    ]);
  };
  const generateMutation = useMutation({
    mutationFn: runNotificationsManually,
    onSuccess: async (run) => {
      await invalidate();
      toast.success(`${run.created_count} créée(s), ${run.updated_count} mise(s) à jour et ${run.resolved_count} résolue(s).`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Actualisation impossible."),
  });
  const statusMutation = useMutation({
    mutationFn: updateNotificationStatus,
    onSuccess: async () => {
      await invalidate();
      toast.success("Notification mise à jour.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Mise à jour impossible."),
  });
  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async (count) => {
      await invalidate();
      toast.success(count > 0 ? `${count} notification(s) marquée(s) comme lues.` : "Aucune notification non lue.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Mise à jour impossible."),
  });

  const result = notificationsQuery.data;
  const summary = summaryQuery.data;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));

  function updateFilters(nextStatus: NotificationStatus | "ALL", nextSeverity: NotificationSeverity | "ALL") {
    setStatus(nextStatus);
    setSeverity(nextSeverity);
    setPage(0);
  }

  return (
    <div className="space-y-7">
      <PageHeader
        title="Centre de notifications"
        description="Priorisez les échéances et anomalies détectées par l’ERP, puis ouvrez directement la donnée qui demande une action."
        actions={
          <>
            <Button variant="outline" disabled={readAllMutation.isPending} onClick={() => readAllMutation.mutate({ data: undefined })}>
              <CheckCheck className="h-4 w-4" />
              Tout marquer comme lu
            </Button>
            {summary?.canGenerate ? (
              <Button disabled={generateMutation.isPending} onClick={() => generateMutation.mutate({ data: undefined })}>
                <RefreshCw className={`h-4 w-4 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                Actualiser les alertes
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Non lues" value={summary?.unread ?? 0} description="Demandent une lecture" icon={Bell} tone="info" />
        <MetricCard label="Critiques" value={summary?.critical ?? 0} description="À traiter en priorité" icon={AlertTriangle} tone={(summary?.critical ?? 0) > 0 ? "danger" : "primary"} />
        <MetricCard label="À 7 jours" value={summary?.dueInSevenDays ?? 0} description="Échéances proches" icon={CalendarDays} tone="warning" />
        <MetricCard label="À 30 jours" value={summary?.dueInThirtyDays ?? 0} description="Échéances à anticiper" icon={CalendarDays} tone="primary" />
        <MetricCard label="Stocks faibles" value={summary?.lowStock ?? 0} description="Articles sous le seuil" icon={Boxes} tone={(summary?.lowStock ?? 0) > 0 ? "warning" : "success"} />
      </div>

      <Card variant="section" className="overflow-hidden">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recherche et filtres</p>
              <CardTitle className="mt-1 text-xl">Alertes visibles</CardTitle>
            </div>
            <Badge variant="neutral" appearance="soft">{result?.total ?? 0} alerte(s)</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:flex-wrap md:items-center sm:p-6">
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Rechercher une alerte…" className="md:max-w-sm" />
          <Input value={type} onChange={(event) => { setType(event.target.value); setPage(0); }} placeholder="Type (ex. LOW_STOCK)" className="md:max-w-56" />
          <Select value={status} onValueChange={(value) => updateFilters(value as NotificationStatus | "ALL", severity)}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {NOTIFICATION_STATUSES.map((item) => <SelectItem key={item} value={item}>{NOTIFICATION_STATUS_LABELS[item]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(value) => updateFilters(status, value as NotificationSeverity | "ALL")}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes les gravités</SelectItem>
              {NOTIFICATION_SEVERITIES.map((item) => <SelectItem key={item} value={item}>{NOTIFICATION_SEVERITY_LABELS[item]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={dueDays ? String(dueDays) : "ALL"} onValueChange={(value) => { setDueDays(value === "7" ? 7 : value === "30" ? 30 : undefined); setPage(0); }}>
            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes les échéances</SelectItem>
              <SelectItem value="7">À 7 jours</SelectItem>
              <SelectItem value="30">À 30 jours</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <NotificationList
        notifications={result?.notifications ?? []}
        loading={notificationsQuery.isLoading}
        error={notificationsQuery.isError}
        updatingId={statusMutation.variables?.data.id}
        onUpdateStatus={(id, nextStatus, snoozedUntil) => statusMutation.mutate({ data: { id, status: nextStatus, snoozed_until: snoozedUntil ?? null } })}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Page {page + 1} sur {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Précédent</Button>
          <Button variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>Suivant</Button>
        </div>
      </div>
    </div>
  );
}
