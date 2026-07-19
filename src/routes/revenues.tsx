import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/revenues")({
  head: () => ({ meta: [{ title: "Revenues — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Revenues"
      description="All incoming cash by source and period."
      icon={<TrendingUp className="h-6 w-6" />}
      features={[
        "Source: farm, transport, other",
        "Amount, date, method",
        "Attach receipts",
        "Group by category / entity",
      ]}
      notionMapping="Notion DB: Revenues · relates Farms, Vehicles, Motorcycles"
    />
  ),
});
