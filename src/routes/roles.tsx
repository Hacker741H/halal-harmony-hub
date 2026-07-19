import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/roles")({
  head: () => ({ meta: [{ title: "Roles & Permissions — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Roles & Permissions"
      description="Fine-grained access control across every module."
      icon={<ShieldCheck className="h-6 w-6" />}
      features={[
        "Roles: admin, manager, accountant, operator, viewer",
        "Module-level permissions (read / write / approve)",
        "Audit log per user",
      ]}
      notionMapping="Server-side only — not stored in Notion"
    />
  ),
});
