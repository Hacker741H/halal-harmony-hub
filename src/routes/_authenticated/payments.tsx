import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Versements — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Versements"
      description="Paiements sortants : salaires, loyers, fournisseurs, partenaires."
      icon={<CreditCard className="h-6 w-6" />}
      primaryAction="Nouveau versement"
      features={[
        "Bénéficiaire (employé, fournisseur, propriétaire)",
        "Montant, date, mode (espèces, virement, Wave)",
        "Référence et pièce justificative",
        "Rapprochement avec les contrats",
      ]}
      notionMapping="Base Notion : Versements · liée aux Employés, Contrats"
    />
  ),
});
