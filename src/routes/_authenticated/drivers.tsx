import { createFileRoute } from "@tanstack/react-router";
import { UserCog } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/drivers")({
  head: () => ({ meta: [{ title: "Chauffeurs — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Chauffeurs"
      description="Suivi des permis et affectations aux véhicules et motos."
      icon={<UserCog className="h-6 w-6" />}
      primaryAction="Nouveau chauffeur"
      features={[
        "Numéro et catégorie de permis, date d'expiration",
        "Moto ou véhicule affecté",
        "Historique des courses et kilométrage",
        "Rapports d'incidents",
      ]}
      notionMapping="Base Notion : Chauffeurs · liée aux Employés, Motos, Véhicules"
    />
  ),
});
