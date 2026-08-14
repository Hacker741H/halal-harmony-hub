import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Ancienne URL du module Stock. Le module complet vit désormais sur /stocks
 * (articles, mouvements, seuils d'alerte). On redirige pour ne pas casser
 * les liens existants.
 */
export const Route = createFileRoute("/_authenticated/inventory")({
  beforeLoad: () => {
    throw redirect({ to: "/stocks", replace: true });
  },
});
