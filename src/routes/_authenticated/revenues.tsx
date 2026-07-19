import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/revenues")({
  head: () => ({ meta: [{ title: "Recettes — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Recettes"
      description="Ensemble des entrées d'argent par source et par période."
      icon={<TrendingUp className="h-6 w-6" />}
      primaryAction="Nouvelle recette"
      features={[
        "Source : exploitation, transport, autre",
        "Montant en FCFA, date, méthode",
        "Pièces justificatives",
        "Regroupement par catégorie ou entité",
      ]}
      notionMapping="Base Notion : Recettes · liée aux Exploitations, Véhicules, Motos"
    />
  ),
});
