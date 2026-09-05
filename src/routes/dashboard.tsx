/** Dashboard Shell — Binance AI Futures Agent */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { useAgentStatus } from "@/hooks/use-agent-status";
import { useAgentJournal } from "@/hooks/use-agent-journal";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "AI Futures Agent — Dashboard" },
      {
        name: "description",
        content:
          "Real-time AI futures agent dashboard: live status, persistent journal, live work log, position, and today's PnL.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const statusQuery = useAgentStatus(5_000);
  const journalQuery = useAgentJournal(selectedDate, 5_000);

  return (
    <DashboardView
      status={statusQuery.data?.data ?? null}
      connecting={statusQuery.isPending}
      error={statusQuery.isError}
      journal={journalQuery.data?.data ?? null}
      journalConnecting={journalQuery.isPending}
      journalError={journalQuery.isError}
      selectedDate={selectedDate ?? journalQuery.data?.data?.availableDates[0]?.date ?? null}
      availableDates={journalQuery.data?.data?.availableDates ?? []}
      onSelectDate={setSelectedDate}
    />
  );
}

export async function clientLoader({ queryClient }: { queryClient: QueryClient }) {
  return { initialData: null };
}
