import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/employees")({
  head: () => ({ meta: [{ title: "Employees — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Employees"
      description="Manage staff records, roles, contracts and assignments."
      icon={<Users className="h-6 w-6" />}
      features={[
        "Profiles with contact, ID and emergency info",
        "Role and department assignments",
        "Link to driver, vehicle or motorcycle assignments",
        "Contract history and salary records",
        "Document tracker (ID, permits, medical)",
      ]}
      notionMapping="Notion DB: Employees · fields: name, role, department, phone, hire_date, status, docs[]"
    />
  ),
});
