import { createFileRoute } from "@tanstack/react-router";
import { Sprout } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/farms")({
  head: () => ({ meta: [{ title: "Exploitations — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Exploitations agricoles"
      description="Terrains, cultures, récoltes et contrats agricoles."
      icon={<Sprout className="h-6 w-6" />}
      primaryAction="Nouvelle exploitation"
      features={[
        "Localisation, superficie (ha), propriétaire ou bail",
        "Cultures et calendrier saisonnier",
        "Contrats et versements associés",
        "Suivi des rendements et des dépenses",
      ]}
      notionMapping="Base Notion : Exploitations · liée aux Contrats, Versements, Documents"
    />
  ),
});
