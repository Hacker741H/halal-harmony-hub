import { createFileRoute } from "@tanstack/react-router";
import { RolesPermissionsPage } from "@/components/roles/roles-permissions-page";

export const Route = createFileRoute("/_authenticated/roles")({
  head: () => ({ meta: [{ title: "Rôles & permissions — HALAL ERP" }] }),
  component: RolesPermissionsPage,
});
