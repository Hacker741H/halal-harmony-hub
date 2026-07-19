import { createFileRoute } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/contracts")({
  head: () => ({ meta: [{ title: "Contrats — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Contrats"
      description="Accords avec exploitations, fournisseurs, employés et partenaires."
      icon={<FileSignature className="h-6 w-6" />}
      primaryAction="Nouveau contrat"
      features={[
        "Parties, objet, montant et durée",
        "Entité liée (exploitation, véhicule, employé)",
        "Alertes de renouvellement",
        "Documents PDF joints",
      ]}
      notionMapping="Base Notion : Contrats · liée aux Exploitations, Employés, Versements"
    />
  ),
});
