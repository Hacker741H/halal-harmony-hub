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
 */
export const Route = createFileRoute("/_authenticated/caisse/")({
  component: CaissePage,
});

const MANAGEMENT_PERMISSIONS = ["locations.manage", "commerce.stock.receive", "sales.finance.read", "store.financial.read", "store.stock_valuation.read", "store.expenses.read"] as const;

function CaissePage() {
  const navigate = useNavigate();
  const { canAny, isPending } = usePermissions();
  const canReturnToManagement = canAny(MANAGEMENT_PERMISSIONS);

  return (
    <main className="p-2 sm:p-3 lg:overflow-hidden">
      {isPending ? null : (
        <CommerceCashierWorkspace onBackToManagement={canReturnToManagement ? () => void navigate({ to: "/commerce" }) : undefined} />
      )}
    </main>
  );
}
