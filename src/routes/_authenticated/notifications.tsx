import { createFileRoute } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Notifications"
      description="Alertes documents, seuils de stock, échéances de contrats."
      icon={<Bell className="h-6 w-6" />}
      primaryAction="Marquer tout comme lu"
      features={[
        "Alertes automatiques 30 / 15 / 7 jours avant échéance",
        "Notifications par rôle et par module",
        "Historique complet des alertes",
        "Envoi par e-mail (option)",
      ]}
      notionMapping="Générées côté ERP — non stockées dans Notion"
    />
  ),
});
