import { createFileRoute } from "@tanstack/react-router";
import { CommercePosWorkspace } from "@/components/commerce/commerce-pos-workspace";
import { useCurrentUserAccess } from "@/hooks/use-current-user-access";

/**
 * Bug global (retour de focus/minimisation, point 3) : quel onglet Commerce
 * (caisse vs gestion) et quel rapport de contrôle sont ouverts vivent
 * maintenant dans l'URL, pas dans un useState local -- un remount de l'app
 * (ou un reload volontaire) retrouve la même vue métier au lieu de revenir
 * silencieusement à la gestion commerciale par défaut.
 */
export type CommerceSearch = {
  view?: "caisse";
  report?: string;
};

export const Route = createFileRoute("/_authenticated/commerce/")({
  validateSearch: (search: Record<string, unknown>): CommerceSearch => ({
    view: search.view === "caisse" ? "caisse" : undefined,
    report: typeof search.report === "string" && search.report.trim() ? search.report : undefined,
  }),
  component: CommercePage,
});
function CommercePage() {
  const access = useCurrentUserAccess();
  if (access.isCashierOnly) {
    return <main className="p-2 sm:p-3 lg:overflow-hidden"><CommercePosWorkspace /></main>;
  }
  return <main className="mx-auto h-full min-h-0 max-w-(--ds-content-max-width) p-3 sm:p-4 xl:p-5"><CommercePosWorkspace /></main>;
}
