import { createFileRoute } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Inventory — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Inventory"
      description="Parts, tools and farm supplies with stock levels."
      icon={<Package className="h-6 w-6" />}
      features={[
        "Items with SKU, category, unit",
        "Stock in / out movements",
        "Low-stock alerts",
        "Supplier link",
      ]}
      notionMapping="Notion DB: Inventory · relates Suppliers, Expenses"
    />
  ),
});
