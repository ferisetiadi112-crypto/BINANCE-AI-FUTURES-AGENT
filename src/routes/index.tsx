import { createFileRoute } from "@tanstack/react-router";
import { useAgentStatus } from "@/hooks/use-agent-status";
import { AgentMonitor } from "@/components/observatory/AgentMonitor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Futures Agent — Monitor" },
      {
        name: "description",
        content:
          "Lightweight AI futures agent monitor: status, current task, latest decision, position, and today's PnL at a glance.",
      },
    ],
  }),
  component: Monitor,
});

/**
 * Main monitoring screen — a lightweight window into the AI.
 *
 * ONE query (agent-status, every 5s) replaces the previous six-query
 * dashboard. The endpoint reads in-memory runtime state only: no
 * database queries, no Binance REST calls, no full journal history.
 *
 * All advanced panels (account detail, risk internals, full journal,
 * reviews, market tickers) remain available on their dedicated pages.
 */
function Monitor() {
  const query = useAgentStatus(5_000);

  return (
    <AgentMonitor
      status={query.data?.data ?? null}
      connecting={query.isPending}
      unreachable={query.isError}
    />
  );
}
