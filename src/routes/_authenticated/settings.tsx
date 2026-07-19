import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Company Settings — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Company Settings"
      description="Company profile, currency, Notion integration and preferences."
      icon={<Settings className="h-6 w-6" />}
      features={[
        "Company info, logo, legal identifiers",
        "Currency, timezone, language",
        "Notion API token and database mapping",
        "Wave payment API keys",
        "Backup and export",
      ]}
    />
  ),
});
