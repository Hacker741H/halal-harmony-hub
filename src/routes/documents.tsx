import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/documents")({
  head: () => ({ meta: [{ title: "Documents — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Documents"
      description="Central library for contracts, licenses, insurance and IDs."
      icon={<FileText className="h-6 w-6" />}
      features={[
        "Upload PDF, image, spreadsheet",
        "Link to any entity (employee, vehicle, farm…)",
        "Expiration date tracking with alerts",
        "Version history",
      ]}
      notionMapping="Notion DB: Documents · polymorphic relation to any entity"
    />
  ),
});
