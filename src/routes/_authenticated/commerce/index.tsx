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
 *
 * AUDIT TOTAL (symptôme 1) : `location` vit maintenant dans l'URL pour la
 * même raison exacte -- avant ce correctif, CommerceManagementWorkspace
 * gérait le magasin courant en useState local pur, remis à zéro à chaque
 * refresh, retombant alors sur locationsQuery.data[0] (get_commerce_pos_
 * locations trie par nom : "ACCESSOIRES ET DIVERS" passe avant "MAGASIN
 * MARIAM"). Même mécanisme déjà validé sur /caisse -- pas une nouvelle
 * logique, une seule logique cohérente entre les deux écrans.
 */
export type CommerceSearch = {
  report?: string;
  location?: string;
};

export const Route = createFileRoute("/_authenticated/commerce/")({
  validateSearch: (search: Record<string, unknown>): CommerceSearch => ({
    report: typeof search.report === "string" && search.report.trim() ? search.report : undefined,
    location:
      typeof search.location === "string" && search.location.trim() ? search.location : undefined,
  }),
  component: CommercePage,
});

function CommercePage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  return (
    <main className="mx-auto h-full min-h-0 max-w-(--ds-content-max-width) p-3 sm:p-4 xl:p-5">
      <CommerceManagementWorkspace
        onOpenCashier={(locationId) =>
          void navigate({ to: "/caisse", search: { location: locationId } })
        }
        requestedLocationId={search.location}
        onLocationResolved={(locationId) => {
          if (locationId === search.location) return;
          // `report` (s'il est ouvert) doit survivre à un changement de
          // magasin -- forme fonctionnelle, jamais un remplacement complet
          // de l'objet search.
          void navigate({
            to: "/commerce",
            search: (prev) => ({ ...prev, location: locationId }),
            replace: true,
          });
        }}
      />
    </main>
  );
}
