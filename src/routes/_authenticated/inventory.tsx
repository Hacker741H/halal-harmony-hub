import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Stock — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Stock & fournitures"
      description="Pièces, outils et intrants agricoles avec suivi des niveaux."
      icon={<Package className="h-6 w-6" />}
      primaryAction="Nouvel article"
      features={[
        "SKU, catégorie, unité, prix moyen",
        "Mouvements d'entrée / sortie",
        "Alertes de seuil bas",
        "Lien fournisseur",
      ]}
      notionMapping="Base Notion : Stock · liée aux Fournisseurs, Dépenses"
    />
  ),
});
