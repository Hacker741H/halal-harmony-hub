import { createFileRoute } from "@tanstack/react-router";
import { TrendingDown } from "lucide-react";

import { FinanceOperationPage } from "@/components/finance/finance-operation-page";
import { ExpenseForm } from "@/components/finance/forms/ExpenseForm";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Dépenses — HALAL ERP" }] }),
  component: ExpensesPage,
});

function ExpensesPage() {
  return (
    <FinanceOperationPage
      title="Dépenses"
      description="Sorties d'argent enregistrées dans le journal financier."
      type="EXPENSE"
      icon={<TrendingDown className="h-8 w-8 text-primary" />}
      createLabel="Nouvelle dépense"
      Form={ExpenseForm}
    />
  );
}
