import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";

import { FinanceOperationPage } from "@/components/finance/finance-operation-page";
import { RevenueForm } from "@/components/finance/forms/RevenueForm";

export const Route = createFileRoute("/_authenticated/revenues")({
  head: () => ({ meta: [{ title: "Recettes — HALAL ERP" }] }),
  component: RevenuesPage,
});

function RevenuesPage() {
  return (
    <FinanceOperationPage
      title="Recettes"
      description="Entrées d'argent enregistrées dans le journal financier."
      type="REVENUE"
      icon={<TrendingUp className="h-8 w-8 text-primary" />}
      createLabel="Nouvelle recette"
      Form={RevenueForm}
    />
  );
}
