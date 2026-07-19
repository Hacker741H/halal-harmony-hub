import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finances — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Finances"
      description="Trésorerie consolidée : recettes, dépenses et versements."
      icon={<Wallet className="h-6 w-6" />}
      primaryAction="Nouvelle opération"
      features={[
        "Bilan par période (jour, mois, année)",
        "Compte de résultat et marge",
        "Devise principale : XOF (FCFA)",
        "Export Excel / PDF",
        "Intégration future avec Wave et Orange Money",
      ]}
      notionMapping="Agrégation des Recettes, Dépenses et Versements"
    />
  ),
});
