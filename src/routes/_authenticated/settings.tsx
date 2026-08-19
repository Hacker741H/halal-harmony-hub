import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";

import { AlertSettingsPanel } from "@/components/settings/alert-settings-panel";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Paramètres — HALAL ERP" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-7">
      <PageHeader
        title="Paramètres"
        description="Configurez les règles opérationnelles déjà disponibles dans l’ERP, sans disperser les réglages dans les modules."
      />
      <AlertSettingsPanel />
    </div>
  );
}
