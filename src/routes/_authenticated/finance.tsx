import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Finance — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Finance"
      description="Consolidated cash flow across revenues, expenses and payments."
      icon={<Wallet className="h-6 w-6" />}
      features={[
        "Balance sheet by period",
        "Profit and loss overview",
        "Multi-currency support (XOF primary)",
        "Export to Excel / PDF",
        "Future Wave payment integration",
      ]}
      notionMapping="Aggregates Revenues, Expenses, Payments"
    />
  ),
});
