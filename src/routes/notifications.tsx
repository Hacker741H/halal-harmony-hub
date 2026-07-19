import { createFileRoute } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Notifications"
      description="In-app alerts, email and future push notifications."
      icon={<Bell className="h-6 w-6" />}
      features={[
        "Document expirations",
        "Payment due reminders",
        "Contract renewals",
        "System sync events",
      ]}
    />
  ),
});
