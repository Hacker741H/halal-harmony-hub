import { createFileRoute } from "@tanstack/react-router";
import { Sprout } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/farms")({
  head: () => ({ meta: [{ title: "Farms & Plantations — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Farms & Plantations"
      description="Land, crops, harvests and contracts."
      icon={<Sprout className="h-6 w-6" />}
      features={[
        "Location, area (ha), owner or lease",
        "Crops and seasonal calendar",
        "Linked contracts and payments",
        "Yield and expense tracking",
      ]}
      notionMapping="Notion DB: Farms · relates Contracts, Payments, Documents"
    />
  ),
});
