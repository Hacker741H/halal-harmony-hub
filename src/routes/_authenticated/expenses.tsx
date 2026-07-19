import { createFileRoute } from "@tanstack/react-router";
import { TrendingDown } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Expenses — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Expenses"
      description="Track spending by category, entity and supplier."
      icon={<TrendingDown className="h-6 w-6" />}
      features={[
        "Category: fuel, maintenance, salary, farm inputs, other",
        "Linked entity (vehicle, motorcycle, farm, employee)",
        "Attach invoices",
        "Recurring expense support",
      ]}
      notionMapping="Notion DB: Expenses · relates Vehicles, Motorcycles, Farms, Employees"
    />
  ),
});
