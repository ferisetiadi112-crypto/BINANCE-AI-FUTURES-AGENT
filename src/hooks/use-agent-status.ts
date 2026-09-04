/**
 * useAgentStatus — shared lightweight agent-status subscription.
 *
 * Every consumer (monitor route, Topbar, AppSidebar) uses the SAME
 * query key, so React Query serves them all from one cache entry and
 * dedupes network requests. No new polling system — the existing
 * React Query cache is the single source.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchAgentStatus } from "@/api/client";
import { MAX_AUTO_RETRIES } from "@/lib/fetch-timeout";

export function useAgentStatus(refetchInterval = 5_000) {
  return useQuery({
    queryKey: ["agent-status"],
    queryFn: fetchAgentStatus,
    refetchInterval,
    retry: MAX_AUTO_RETRIES,
  });
}
