import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Landmark } from "lucide-react";
import { z } from "zod";

import { FinanceOperationPage } from "@/components/finance/finance-operation-page";
import { DepositForm } from "@/components/finance/forms/DepositForm";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Versements — HALAL ERP" }] }),
  validateSearch: z.object({ create: z.literal("true").optional() }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <FinanceOperationPage
      title="Versements"
      description="Des mouvements propres pour une trésorerie qui respire."
      type="DEPOSIT"
      icon={Landmark}
      createLabel="Nouveau versement"
      Form={DepositForm}
      quickCreate={create === "true"}
      onQuickCreateHandled={() => {
        if (create === "true") {
          void navigate({ search: {}, replace: true });
        }
      }}
    />
  );
}
