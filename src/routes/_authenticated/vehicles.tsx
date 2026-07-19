import { createFileRoute } from "@tanstack/react-router";
import { Car } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/vehicles")({
  head: () => ({ meta: [{ title: "Vehicles — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Vehicles"
      description="Cars and trucks with documents, drivers and maintenance."
      icon={<Car className="h-6 w-6" />}
      features={[
        "Plate, brand, model, VIN, purchase info",
        "Linked driver and documents",
        "Insurance, technical control expirations",
        "Maintenance log and cost tracking",
      ]}
      notionMapping="Notion DB: Vehicles · relates Drivers, Documents, Expenses"
    />
  ),
});
