import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { NotificationList } from "@/components/notifications/notification-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getNotificationSummary,
  getNotifications,
  markAllNotificationsRead,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_STATUSES,
  type NotificationSeverity,
  type NotificationStatus,
  updateNotificationStatus,
} from "@/lib/notifications.functions";
import { runNotificationsManually } from "@/lib/alert-settings.functions";

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
  const [dueDays, setDueDays] = useState<7 | 30 | undefined>(
    routeSearch.due === "7" ? 7 : routeSearch.due === "30" ? 30 : undefined,
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const notificationsQuery = useQuery({
    queryKey: ["notifications", { status, severity, type, dueDays, search, page }],
    queryFn: () =>
      getNotifications({
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
  const summaryQuery = useQuery({
    queryKey: ["notification-summary"],
    queryFn: () => getNotificationSummary(),
  });

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
      toast.success(
        `${run.created_count} créée(s), ${run.updated_count} mise(s) à jour et ${run.resolved_count} résolue(s).`,
      );
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
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Bell className="h-7 w-7" /> Centre de notifications
          </h1>
          <p className="mt-1 text-muted-foreground">
            Une alerte à temps vaut mieux qu’un problème trop tard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={readAllMutation.isPending}
            onClick={() => readAllMutation.mutate({ data: undefined })}
          >
            <CheckCheck className="mr-2 h-4 w-4" /> Tout marquer comme lu
          </Button>
          {summary?.canGenerate && (
            <Button disabled={generateMutation.isPending} onClick={() => generateMutation.mutate({ data: undefined })}>
              <RefreshCw className={"mr-2 h-4 w-4 " + (generateMutation.isPending ? "animate-spin" : "")} />
              Actualiser les alertes
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Non lues" value={summary?.unread ?? 0} />
        <SummaryCard label="Critiques" value={summary?.critical ?? 0} critical />
        <SummaryCard label="Échéances à 7 jours" value={summary?.dueInSevenDays ?? 0} />
        <SummaryCard label="Échéances à 30 jours" value={summary?.dueInThirtyDays ?? 0} />
        <SummaryCard label="Stocks faibles" value={summary?.lowStock ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Rechercher une alerte…"
            className="md:max-w-sm"
          />
          <Input
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(0);
            }}
            placeholder="Type (ex. LOW_STOCK)"
            className="md:max-w-56"
          />
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) => updateFilters(event.target.value as NotificationStatus | "ALL", severity)}
          >
            <option value="ALL">Tous les statuts</option>
            {NOTIFICATION_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={severity}
            onChange={(event) => updateFilters(status, event.target.value as NotificationSeverity | "ALL")}
          >
            <option value="ALL">Toutes les gravités</option>
            {NOTIFICATION_SEVERITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={dueDays ?? "ALL"}
            onChange={(event) => {
              const value = event.target.value;
              setDueDays(value === "7" ? 7 : value === "30" ? 30 : undefined);
              setPage(0);
            }}
          >
            <option value="ALL">Toutes les échéances</option>
            <option value="7">À 7 jours</option>
            <option value="30">À 30 jours</option>
          </select>
          <Badge variant="secondary">{result?.total ?? 0} alerte(s)</Badge>
        </CardContent>
      </Card>

      <NotificationList
        notifications={result?.notifications ?? []}
        loading={notificationsQuery.isLoading}
        updatingId={statusMutation.variables?.data.id}
        onUpdateStatus={(id, nextStatus, snoozedUntil) =>
          statusMutation.mutate({
            data: { id, status: nextStatus, snoozed_until: snoozedUntil ?? null },
          })
        }
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Page {page + 1} sur {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
            Précédent
          </Button>
          <Button
            variant="outline"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Suivant
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, critical = false }: { label: string; value: number; critical?: boolean }) {
  return (
    <Card className={critical && value > 0 ? "border-destructive/40" : undefined}>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={"mt-1 text-3xl font-bold " + (critical && value > 0 ? "text-destructive" : "")}>{value}</p>
      </CardContent>
    </Card>
  );
}
