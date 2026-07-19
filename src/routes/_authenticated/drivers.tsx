import { createFileRoute } from "@tanstack/react-router";
import { UserCog } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/drivers")({
  head: () => ({ meta: [{ title: "Drivers — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Drivers"
      description="License tracking and vehicle assignments for all drivers."
      icon={<UserCog className="h-6 w-6" />}
      features={[
        "License number, category and expiration",
        "Assigned motorcycle or vehicle",
        "Trip history and mileage",
        "Incident reports",
      ]}
      notionMapping="Notion DB: Drivers · linked to Employees, Motorcycles, Vehicles"
    />
  ),
});
