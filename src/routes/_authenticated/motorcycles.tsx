import { createFileRoute } from "@tanstack/react-router";
import { Bike } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/motorcycles")({
  head: () => ({ meta: [{ title: "Motorcycles — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Motorcycles"
      description="Fleet register, status and assigned drivers."
      icon={<Bike className="h-6 w-6" />}
      features={[
        "Plate, model, purchase date and value",
        "Status: active / maintenance / retired",
        "Assigned driver (Employee)",
        "Linked documents and expirations",
        "Maintenance and expense history",
      ]}
      notionMapping="Notion DB: Motorcycles · relates Drivers, Documents, Expenses"
    />
  ),
});
