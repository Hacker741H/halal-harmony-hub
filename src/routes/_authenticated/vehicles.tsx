import { createFileRoute } from "@tanstack/react-router";
import { Car } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/vehicles")({
  head: () => ({ meta: [{ title: "Véhicules — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Véhicules"
      description="Voitures, pick-ups, camions : gestion complète de la flotte."
      icon={<Car className="h-6 w-6" />}
      primaryAction="Nouveau véhicule"
      features={[
        "Immatriculation, type, marque, modèle, année",
        "Kilométrage et statut opérationnel",
        "Chauffeur affecté",
        "Assurance, visite technique, entretiens",
      ]}
      notionMapping="Base Notion : Véhicules · liée aux Chauffeurs, Entretiens, Documents"
    />
  ),
});
