/**
 * useAgentJournal — persistent journal/work-log subscription.
 *
 * Reads from the database-backed getAgentJournal endpoint. Data survives
 * page refresh, reconnection and agent restart. On refetch error the
 * previously fetched data stays visible (React Query keeps the last
 * successful result); the component shows a connection banner instead of
 * clearing the journal.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchAgentJournal } from "@/api/client";

export const AGENT_JOURNAL_QUERY_KEY = ["agent-journal"] as const;

export function useAgentJournal(date?: string, refetchInterval = 5_000) {
  return useQuery({
    queryKey: date ? ([...AGENT_JOURNAL_QUERY_KEY, date] as const) : AGENT_JOURNAL_QUERY_KEY,
    queryFn: () => fetchAgentJournal(date),
    refetchInterval,
    retry: 2,
    // Keep previously fetched journal visible while refetching or offline.
    placeholderData: (previous) => previous,
    staleTime: 3_000,
  });
}
