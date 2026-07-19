import { createFileRoute } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({ meta: [{ title: "Payments — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Payments"
      description="All outgoing and incoming payments across the ERP."
      icon={<CreditCard className="h-6 w-6" />}
      features={[
        "Beneficiary: farm, employee, vehicle, supplier",
        "Method: cash, bank transfer, Wave, mobile money",
        "Status: pending, paid, failed",
        "Receipt PDF generation",
      ]}
      notionMapping="Notion DB: Payments · relates Farms, Employees, Vehicles"
    />
  ),
});
