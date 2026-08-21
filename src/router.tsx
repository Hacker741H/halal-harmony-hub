import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { routeTree } from "./routeTree.gen";

// Server functions only reliably forward `error.message` to the client (see
// requireSupabaseAuth in auth-middleware.ts, and every "if (error) throw
// error" call site) -- structured Postgres codes don't survive the trip, so
// classification has to work from message shape rather than a status code.
// This intentionally stays narrow: pair a specific, human-written message
// (a validation error, an RPC's own RAISE EXCEPTION text, a permission
// check) with itself alone, and reserve the "check your connection" advice
// for when there is actual reason to believe it's a connectivity problem.
// Saying "vérifiez votre connexion" under "Solde insuffisant : 15 000 FCFA
// disponible" is actively wrong, regardless of exactly which HTTP status
// produced it.
function isLikelyNetworkError(error: Error): boolean {
  return error instanceof TypeError || /fetch|network|ECONNRESET|ETIMEDOUT/i.test(error.message);
}

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
      onError: (error) => {
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
          description: isLikelyNetworkError(error)
            ? "Vérifiez votre connexion et réessayez."
            : undefined,
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
