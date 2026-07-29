import { createFileRoute } from "@tanstack/react-router";
import { Landmark } from "lucide-react";

import { FinanceOperationPage } from "@/components/finance/finance-operation-page";
import { DepositForm } from "@/components/finance/forms/DepositForm";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Versements — HALAL ERP" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  return (
    <FinanceOperationPage
      title="Versements"
      description="Fonds ajoutés à un wallet dans le journal financier."
      type="DEPOSIT"
      icon={<Landmark className="h-8 w-8 text-primary" />}
      createLabel="Nouveau versement"
      Form={DepositForm}
    />
  );
}
