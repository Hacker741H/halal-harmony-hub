import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { routeTree } from "./routeTree.gen";
import { classifyError, isSessionExpiredError } from "@/lib/error-classification";
import { triggerSessionRecovery } from "@/lib/notify-mutation-error";

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
        // generic "failed to load" toast would read as a false "something
        // broke" right as the user is intentionally logging out, or during
        // a normal token refresh. STABILISATION TRANSVERSALE (1/3) :
        // instead of just staying silent, actively trigger recovery -- a
        // page with only queries (no mutation) hitting a dead session used
        // to show nothing at all until some other action eventually
        // noticed; now the one correct "session expirée" toast + redirect
        // fires from here too, deduplicated by triggerSessionRecovery's
        // own shared sonner id against every other place that can also
        // call it.
        if (isSessionExpiredError(error)) {
          triggerSessionRecovery();
          return;
        }
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
    // STABILISATION TRANSVERSALE (1/3) : la vraie correction du message
    // technique brut ("Unauthorized: Invalid token") qui pouvait s'afficher
    // sur n'importe laquelle des ~110 mutations locales de l'app vit
    // maintenant dans src/lib/notify-mutation-error.ts (notifyMutationError),
    // que la quasi-totalité des onError locaux appellent désormais au lieu
    // de formater l'erreur eux-mêmes. Ce gestionnaire global reste
    // nécessaire comme filet pour ce qu'un point local ne peut pas
    // couvrir : une mutation sans AUCUN onError (cas réels trouvés --
    // vehicles/$vehicleId.tsx, motorcycles/$motorcycleId.tsx), et pour
    // déclencher la reprise de session même dans ce cas -- toujours
    // dédupliqué par le même id sonner partagé que notifyMutationError et
    // que __root.tsx, donc jamais de doublon même si plusieurs mutations
    // échouent dans le même instant.
    mutationCache: new MutationCache({
      onError: (error) => {
        if (typeof window === "undefined") return;
        if (isSessionExpiredError(error)) {
          triggerSessionRecovery();
          return;
        }
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
