import { createFileRoute } from "@tanstack/react-router";
import { Bike } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/motorcycles")({
  head: () => ({ meta: [{ title: "Motos — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Motos"
      description="Parc de motos : immatriculation, chauffeur, entretiens et documents."
      icon={<Bike className="h-6 w-6" />}
      primaryAction="Nouvelle moto"
      features={[
        "Immatriculation, marque, modèle, année",
        "Kilométrage et statut opérationnel",
        "Chauffeur affecté",
        "Historique des entretiens et assurances",
      ]}
      notionMapping="Base Notion : Motos · liée aux Chauffeurs, Entretiens, Documents"
    />
  ),
});
