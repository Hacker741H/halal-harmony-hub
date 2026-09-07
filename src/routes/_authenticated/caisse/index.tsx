import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CommerceCashierWorkspace } from "@/components/commerce/commerce-pos-workspace";
import { usePermissions } from "@/hooks/use-permissions";

/**
 * La caisse (vente) est sa propre route, séparée de /commerce (magasins,
 * administration) -- jamais le même écran en fonction d'un paramètre.
 * Un caissier n'a et ne doit avoir accès qu'ici. Quelqu'un qui gère aussi
 * les magasins peut ouvrir une caisse depuis cette route et revenir à
 * l'administration ensuite (onBackToManagement) -- mais un pur caissier ne
 * voit jamais ce bouton, il n'a nulle part où "revenir".
 *
 * CHANTIER CAISSE : `location` vit dans l'URL (même principe que `report`
 * sur /commerce) -- pour la même raison exacte : survivre à un refresh.
 * C'est ce qui manquait, la cause du bug "MAGASIN MARIAM -> Ouvrir la
 * caisse -> atterrit sur ACCESSOIRES ET DIVERS" -- la navigation ne
 * transportait jusqu'ici aucun contexte, /caisse retombait donc sur son
 * inférence locale (brouillon existant, sinon le premier magasin de
 * getCommercePosLocations, trié par nom -- "ACCESSOIRES" avant "MAGASIN").
 */
export type CaisseSearch = {
  location?: string;
};

export const Route = createFileRoute("/_authenticated/caisse/")({
  validateSearch: (search: Record<string, unknown>): CaisseSearch => ({
    location:
      typeof search.location === "string" && search.location.trim() ? search.location : undefined,
  }),
  component: CaissePage,
});

const MANAGEMENT_PERMISSIONS = [
  "locations.manage",
  "commerce.stock.receive",
  "sales.finance.read",
  "store.financial.read",
  "store.stock_valuation.read",
  "store.expenses.read",
] as const;

function CaissePage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { canAny, isPending } = usePermissions();
  const canReturnToManagement = canAny(MANAGEMENT_PERMISSIONS);

  return (
    <main className="p-2 sm:p-3 lg:overflow-hidden">
      {isPending ? null : (
        <CommerceCashierWorkspace
          onBackToManagement={
            canReturnToManagement ? () => void navigate({ to: "/commerce" }) : undefined
          }
          requestedLocationId={search.location}
          onLocationResolved={(locationId) => {
            if (locationId === search.location) return;
            void navigate({ to: "/caisse", search: { location: locationId }, replace: true });
          }}
        />
      )}
    </main>
  );
}
