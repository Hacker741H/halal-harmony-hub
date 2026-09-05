import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { routeTree } from "./routeTree.gen";
import { classifyError } from "@/lib/error-classification";

// P1-2 (audit de stabilisation) : la classification réseau-vs-le-reste qui
// vivait ici seule (isLikelyNetworkError) est maintenant dans
// src/lib/error-classification.ts, partagée avec commerce-pos-sync.ts (qui
// en avait besoin pour corriger P1-1 -- une erreur POS hors-ligne
// définitive ne doit plus être réessayée indéfiniment). Comportement
// inchangé ici : même test réseau, même texte, même "vérifiez votre
// connexion" réservé aux cas où il y a une vraie raison de le croire.

export const getRouter = () => {
  // No global staleTime meant every query defaulted to 0 -- refetching on
  // every mount/focus/reconnect regardless of how volatile its data is.
  // 10s is short enough to stay unnoticeable for genuinely live data
  // (screens needing tighter freshness already set their own staleTime)
  // while stopping the refetch storm on ordinary navigation and tab
  // refocus that hit close to every screen in the app.
  //
  // onError only fires once retries are exhausted, so a transient blip
  // that recovers within the default retry window stays silent. Without
  // this, a failed query (Supabase 5xx, network drop) rendered as an
  // empty list on any screen that doesn't check query.isError itself
  // (most don't) -- indistinguishable from "there's genuinely nothing
  // here". A stable toast id collapses a simultaneous multi-query
  // failure (e.g. the whole network dropping) into one message instead
  // of a stack of duplicates.
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // getRouter() runs on both the SSR request and the client -- a
        // query that fails during the server render has no DOM/Toaster to
        // render into, and sonner's toast() call in that context was
        // corrupting the HTML this handler was added in, sending every
        // route into a React #418 hydration-mismatch crash on first load.
        // SSR failures don't need a toast: the page's own loading/error
        // state already covers that render, and a retry after hydration
        // (where window exists) surfaces normally.
        if (typeof window === "undefined") return;

        // Every server function in this app rejects an expired/missing
        // session through the same requireSupabaseAuth middleware, which
        // always throws Error("Unauthorized: ...") -- see
        // src/integrations/supabase/auth-middleware.ts. Sign-out clears the
        // query cache and any query still in flight at that exact moment
        // can settle afterwards with this same error; surfacing it as a
        // toast would read as a false "something broke" right as the user
        // is intentionally logging out, or during a normal token refresh.
        if (error instanceof Error && error.message.startsWith("Unauthorized")) return;
        // A query cancelled by navigation or a superseding refetch isn't a
        // failure the user needs to hear about.
        if (error instanceof Error && error.name === "AbortError") return;

        if (!(error instanceof Error)) {
          toast.error("Certaines données n'ont pas pu être chargées.", {
            id: "query-error",
            description: "Vérifiez votre connexion et réessayez.",
          });
          return;
        }

        toast.error(error.message, {
          id: "query-error",
          description: classifyError(error) === "network"
            ? "Vérifiez votre connexion et réessayez."
            : undefined,
        });
      },
    }),
    // Section 3 (chantier de stabilisation) : QueryCache a un filtrage
    // "Unauthorized:"/AbortError partagé depuis le début (ci-dessus) ;
    // MutationCache n'en avait aucun -- chacune des ~108 mutations de
    // l'app affiche son propre toast.error(error.message) local, donc au
    // moment exact d'une expiration de session, l'utilisateur pouvait voir
    // ce message brut technique empilé sur le toast clair "Votre session a
    // expiré" (P0-1). Impossible de supprimer un onError local depuis un
    // hook global (les deux s'exécutent toujours), donc cette correction
    // partagée cible ce qu'un seul point PEUT réellement faire : un id
    // sonner partagé absorbe le cas commun (le toast local, exécuté juste
    // après, écrase silencieusement celui-ci -- aucun changement visible
    // pour les mutations qui gèrent déjà leur erreur), et sert de filet
    // pour toute mutation qui n'a AUCUN onError local (3 cas réels trouvés
    // -- vehicles/$vehicleId.tsx, motorcycles/$motorcycleId.tsx -- où rien
    // n'était montré du tout) sans modifier ces fichiers un par un.
    mutationCache: new MutationCache({
      onError: (error) => {
        if (typeof window === "undefined") return;
        if (error instanceof Error && error.message.startsWith("Unauthorized")) return;
        if (error instanceof Error && error.name === "AbortError") return;
        toast.error(error instanceof Error ? error.message : "Une erreur est survenue.", {
          id: "mutation-error",
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
