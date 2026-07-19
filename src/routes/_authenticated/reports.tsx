import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Rapports — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Rapports & analyses"
      description="Rapports financiers, opérationnels et rapports d'entretien."
      icon={<BarChart3 className="h-6 w-6" />}
      primaryAction="Générer un rapport"
      features={[
        "Compte de résultat mensuel et annuel",
        "Rentabilité par exploitation et par véhicule",
        "Rapports d'entretien de la flotte",
        "Export PDF / Excel",
      ]}
      notionMapping="Vue agrégée — non stockée dans Notion"
    />
  ),
});
