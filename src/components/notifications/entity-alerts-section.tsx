import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { NotificationList } from "@/components/notifications/notification-list";
import {
  getNotificationsForEntity,
  type NotificationEntityRelation,
  updateNotificationStatus,
} from "@/lib/notifications.functions";

interface EntityAlertsSectionProps {
  entityId?: string;
  relation?: NotificationEntityRelation;
  documentIds?: string[];
  emptyMessage?: string;
}

export function EntityAlertsSection({
  entityId,
  relation,
  documentIds = [],
  emptyMessage = "Aucune alerte active ou historique liée à cette fiche.",
}: EntityAlertsSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = ["entity-notifications", relation ?? "documents", entityId ?? documentIds] as const;
  const alertsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (entityId && relation) {
        return getNotificationsForEntity({ data: { entityId, relation } });
      }
      if (documentIds.length === 0) return [];

      const groups = await Promise.all(
        documentIds.map((documentId) =>
          getNotificationsForEntity({ data: { entityId: documentId, relation: "document" } }),
        ),
      );
      return [...new Map(groups.flat().map((notification) => [notification.id, notification])).values()].sort(
        (left, right) => right.created_at.localeCompare(left.created_at),
      );
    },
  });
  const statusMutation = useMutation({
    mutationFn: updateNotificationStatus,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["notification-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      ]);
      toast.success("Notification mise à jour.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Mise à jour impossible."),
  });

  return (
    <NotificationList
      notifications={alertsQuery.data ?? []}
      loading={alertsQuery.isLoading}
      error={alertsQuery.isError}
      updatingId={statusMutation.variables?.data.id}
      emptyMessage={emptyMessage}
      onUpdateStatus={(id, status, snoozedUntil) =>
        statusMutation.mutate({
          data: { id, status, snoozed_until: snoozedUntil ?? null },
        })
      }
    />
  );
}
