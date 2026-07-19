import { createFileRoute } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/contracts")({
  head: () => ({ meta: [{ title: "Contracts — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Contracts"
      description="Agreements across farms, suppliers, employees and partners."
      icon={<FileSignature className="h-6 w-6" />}
      features={[
        "Parties, subject, amount and duration",
        "Linked entity (farm, vehicle, employee)",
        "Renewal alerts",
        "Attached PDF documents",
      ]}
      notionMapping="Notion DB: Contracts · relates Farms, Employees, Payments"
    />
  ),
});
