/** Dashboard Shell — Binance AI Futures Agent */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { QueryClient } from "@tanstack/react-query";
import { useAgentStatus } from "@/hooks/use-agent-status";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "AI Futures Agent — Dashboard" },
      {
        name: "description",
        content:
          "Real-time AI futures agent dashboard: live status, current work, latest result, position, and today's PnL.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const query = useAgentStatus(5_000);

  return <DashboardView status={query.data?.data ?? null} connecting={query.isPending} error={query.isError} />;
}

export async function clientLoader({ queryClient }: { queryClient: QueryClient }) {
  return { initialData: null };
}
