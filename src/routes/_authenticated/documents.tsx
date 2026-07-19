import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Documents"
      description="Bibliothèque centralisée avec suivi des dates d'expiration."
      icon={<FileText className="h-6 w-6" />}
      primaryAction="Téléverser un document"
      features={[
        "Assurances, visites techniques, cartes grises",
        "Permis, contrats, baux, factures",
        "Alertes automatiques à 30, 15 et 7 jours",
        "Recherche plein texte",
      ]}
      notionMapping="Base Notion : Documents · liée à toutes les entités"
    />
  ),
});
