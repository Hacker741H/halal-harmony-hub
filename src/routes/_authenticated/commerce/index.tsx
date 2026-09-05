import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CommerceManagementWorkspace } from "@/components/commerce/commerce-pos-workspace";

/**
 * /commerce est désormais purement administratif -- la caisse (vente) vit
 * sur sa propre route, /caisse, jamais mélangée ici. Un caissier sans droit
 * d'administration n'atterrit jamais sur cette route du tout (voir la
 * redirection globale dans _authenticated/route.tsx).
 *
 * `report` reste dans l'URL (pas un useState local) pour la même raison que
 * documentée à l'origine : quel rapport de contrôle est ouvert doit survivre
 * à un remount de l'app ou un reload volontaire.
 */
export type CommerceSearch = {
  report?: string;
};

export const Route = createFileRoute("/_authenticated/commerce/")({
  validateSearch: (search: Record<string, unknown>): CommerceSearch => ({
    report: typeof search.report === "string" && search.report.trim() ? search.report : undefined,
  }),
  component: CommercePage,
});

function CommercePage() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto h-full min-h-0 max-w-(--ds-content-max-width) p-3 sm:p-4 xl:p-5">
      <CommerceManagementWorkspace onOpenCashier={() => void navigate({ to: "/caisse" })} />
    </main>
  );
}
