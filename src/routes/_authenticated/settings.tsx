import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";

import { AlertSettingsPanel } from "@/components/settings/alert-settings-panel";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Paramètres — HALAL ERP" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Settings className="h-7 w-7" /> Paramètres</h1>
        <p className="mt-1 text-muted-foreground">Configuration métier, alertes internes et état de la génération serveur.</p>
      </header>
      <AlertSettingsPanel />
    </div>
  );
}
