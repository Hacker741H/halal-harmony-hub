import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // No global staleTime meant every query defaulted to 0 -- refetching on
  // every mount/focus/reconnect regardless of how volatile its data is.
  // 10s is short enough to stay unnoticeable for genuinely live data
  // (screens needing tighter freshness already set their own staleTime)
  // while stopping the refetch storm on ordinary navigation and tab
  // refocus that hit close to every screen in the app.
  const queryClient = new QueryClient({
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
