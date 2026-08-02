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
      description="On dépense avec la tête, car le futur ne se gaspille pas."
      type="EXPENSE"
      icon={TrendingDown}
      createLabel="Nouvelle dépense"
      Form={ExpenseForm}
    />
  );
}
