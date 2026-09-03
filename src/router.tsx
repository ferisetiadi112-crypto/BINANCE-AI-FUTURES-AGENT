import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // P7D-4.4: Set sane defaults to prevent aggressive refetching and infinite retries
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,          // Data is fresh for 10s (was 0 = always stale)
        gcTime: 5 * 60_000,         // Keep unused data in cache for 5min
        retry: 2,                    // Max 2 retries (was default 3)
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000), // Exponential backoff, max 10s
        refetchOnWindowFocus: false,  // Don't refetch on every tab switch
        refetchOnReconnect: false,   // Don't refetch on reconnect storm
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
