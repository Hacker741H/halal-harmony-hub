import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Reports"
      description="Generate financial and operational reports."
      icon={<BarChart3 className="h-6 w-6" />}
      features={[
        "Monthly P&L",
        "Fleet utilization",
        "Farm yield vs cost",
        "PDF and Excel export",
      ]}
      notionMapping="Aggregates all Notion databases"
    />
  ),
});
