import { useState } from "react";
import { BellOff, CheckCheck, Clock3, ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Notification, NotificationStatus } from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";

interface NotificationListProps {
  notifications: Notification[];
  loading?: boolean;
  onUpdateStatus: (id: string, status: NotificationStatus, snoozedUntil?: string) => void;
  updatingId?: string;
  emptyMessage?: string;
}

const severityLabels: Record<string, string> = {
  INFO: "Information",
  WARNING: "À suivre",
  CRITICAL: "Critique",
};

const statusLabels: Record<string, string> = {
  UNREAD: "Non lue",
  READ: "Lue",
  RESOLVED: "Résolue",
  DISMISSED: "Ignorée",
  SNOOZED: "Reportée",
};

function severityClass(severity: string): string {
  if (severity === "CRITICAL") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (severity === "WARNING") return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  return "border-sky-500/30 bg-sky-500/10 text-sky-700";
}

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`),
  );
}

export function NotificationList({
  notifications,
  loading = false,
  onUpdateStatus,
  updatingId,
  emptyMessage = "Aucune notification pour ces critères.",
}: NotificationListProps) {
  const [snoozeValues, setSnoozeValues] = useState<Record<string, string>>({});

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement des alertes…
        </CardContent>
      </Card>
    );
  }

  if (notifications.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {notifications.map((notification) => {
        const isUpdating = updatingId === notification.id;
        const isActive = ["UNREAD", "READ", "SNOOZED"].includes(notification.status);
        const dueDate = formatDueDate(notification.due_date);
        const snoozeValue = snoozeValues[notification.id] ?? "";

        return (
          <Card
            key={notification.id}
            className={cn(notification.status === "UNREAD" && "border-primary/40 shadow-sm")}
          >
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{notification.titre}</p>
                    <Badge variant="outline" className={severityClass(notification.severity)}>
                      {severityLabels[notification.severity] ?? notification.severity}
                    </Badge>
                    <Badge variant="secondary">{statusLabels[notification.status] ?? notification.status}</Badge>
                  </div>
                  {notification.message && (
                    <p className="text-sm text-muted-foreground">{notification.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Créée le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(notification.created_at))}
                    {dueDate ? ` · Échéance : ${dueDate}` : ""}
                  </p>
                </div>
                {notification.entity_route && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={notification.entity_route}>
                      Ouvrir la fiche <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>

              {isActive && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  {notification.status === "UNREAD" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isUpdating}
                      onClick={() => onUpdateStatus(notification.id, "READ")}
                    >
                      <CheckCheck className="mr-2 h-4 w-4" /> Marquer comme lue
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(notification.id, "RESOLVED")}
                  >
                    <CheckCheck className="mr-2 h-4 w-4" /> Résoudre
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(notification.id, "DISMISSED")}
                  >
                    <BellOff className="mr-2 h-4 w-4" /> Ignorer
                  </Button>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Reporter jusqu'au"
                      className="h-8 w-48"
                      type="datetime-local"
                      value={snoozeValue}
                      onChange={(event) =>
                        setSnoozeValues((current) => ({
                          ...current,
                          [notification.id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isUpdating || !snoozeValue}
                      onClick={() => onUpdateStatus(notification.id, "SNOOZED", new Date(snoozeValue).toISOString())}
                    >
                      <Clock3 className="mr-2 h-4 w-4" /> Reporter
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
