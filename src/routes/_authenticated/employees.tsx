import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "Employés — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Employés"
      description="Fiches du personnel : identité, poste, contrat, salaire et documents."
      icon={<Users className="h-6 w-6" />}
      primaryAction="Nouvel employé"
      features={[
        "Matricule, nom, poste, téléphone, e-mail",
        "Contrat, date d'embauche et salaire de base",
        "Documents administratifs et pièces d'identité",
        "Historique des affectations et des versements",
      ]}
      notionMapping="Base Notion : Employés · liée aux Chauffeurs, Contrats, Versements"
    />
  ),
});
