import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/_authenticated/roles")({
  head: () => ({ meta: [{ title: "Rôles & permissions — HALAL ERP" }] }),
  component: () => (
    <ModulePlaceholder
      title="Rôles & permissions"
      description="Gestion fine des accès à chaque module de l'ERP."
      icon={<ShieldCheck className="h-6 w-6" />}
      primaryAction="Attribuer un rôle"
      features={[
        "Super Admin, Administrateur, Manager, Comptable, Opérateur, Lecture seule",
        "Permissions par module (lecture / écriture / validation)",
        "Journal d'audit par utilisateur",
        "Attribution multi-rôles",
      ]}
      notionMapping="Sécurité côté serveur — non stockée dans Notion"
    />
  ),
});
