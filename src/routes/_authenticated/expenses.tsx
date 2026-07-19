import { createFileRoute } from "@tanstack/react-router";
import { TrendingDown } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Dépenses — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Dépenses"
      description="Suivi des dépenses par catégorie, entité et période."
      icon={<TrendingDown className="h-6 w-6" />}
      primaryAction="Nouvelle dépense"
      features={[
        "Catégorie : carburant, entretien, salaires, fournitures…",
        "Montant en FCFA, date, mode de paiement",
        "Entité concernée (moto, véhicule, exploitation)",
        "Pièces justificatives PDF/image",
      ]}
      notionMapping="Base Notion : Dépenses · liée aux Véhicules, Motos, Exploitations"
    />
  ),
});
