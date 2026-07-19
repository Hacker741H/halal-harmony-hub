import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Paramètres — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Paramètres de l'entreprise"
      description="Profil, devise, intégration Notion et préférences globales."
      icon={<Settings className="h-6 w-6" />}
      primaryAction="Enregistrer les paramètres"
      features={[
        "Informations légales, logo, identifiants fiscaux",
        "Devise (XOF), fuseau horaire, langue",
        "Jeton d'API Notion et correspondance des bases",
        "Clés API Wave / Orange Money",
        "Sauvegardes et exports",
      ]}
      notionMapping="Table company_settings — un seul enregistrement"
    />
  ),
});
