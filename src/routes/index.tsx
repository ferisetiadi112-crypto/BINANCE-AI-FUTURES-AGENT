import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTestnetStatus,
  fetchRuntimeStatus,
  fetchMarketStatus,
  fetchJournal,
  fetchReviews,
  fetchOrchestratorData,
} from "@/api/client";
import { MAX_AUTO_RETRIES } from "@/lib/fetch-timeout";
import {
  DashboardView,
  type DashboardModel,
  type JournalEvent,
  type ReviewItem,
} from "@/components/observatory/DashboardView";
import {
  buildAiCard,
  buildAccountCard,
  buildBinanceCard,
  buildDecisionCard,
  buildFeedCard,
  buildMarketCard,
  buildPositionCard,
  buildRiskCard,
  type MarketPayload,
  type RiskPayload,
  type RuntimeEventLite,
  type TestnetPayload,
} from "@/lib/ui-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Futures Trading Observatory — Orbital AI Command Center" },
      {
        name: "description",
        content:
          "AI futures trading observatory — Binance Futures Testnet command center with real-time positions, risk state, and AI intelligence.",
      },
      {
        property: "og:title",
        content: "AI Futures Trading Observatory — Orbital AI Command Center",
      },
    ],
  }),
  component: Dashboard,
});

/**
 * P7D-5.5 Dashboard
 *
 * The route NEVER gates the shell on backend responses. Each query resolves
 * independently; the pure builders in `@/lib/ui-state` turn every possible
 * query outcome (pending / error / offline / stale / ready) into an explicit
 * per-card state. Loading spinners only ever appear inside the card that is
 * waiting on data.
 */

type Q = { pending: boolean; failed: boolean };

function qOf(query: { isPending: boolean; isError: boolean }): Q {
  return { pending: query.isPending, failed: query.isError };
}

function Dashboard() {
  const testnetQ = useQuery({
    queryKey: ["testnet-status"],
    queryFn: fetchTestnetStatus,
    refetchInterval: 10_000,
    retry: MAX_AUTO_RETRIES,
  });
  const runtimeQ = useQuery({
    queryKey: ["runtime-status"],
    queryFn: fetchRuntimeStatus,
    refetchInterval: 10_000,
    retry: MAX_AUTO_RETRIES,
  });
  const marketQ = useQuery({
    queryKey: ["market-status"],
    queryFn: fetchMarketStatus,
    refetchInterval: 10_000,
    retry: MAX_AUTO_RETRIES,
  });
  const orchQ = useQuery({
    queryKey: ["orchestrator"],
    queryFn: fetchOrchestratorData,
    refetchInterval: 10_000,
    retry: MAX_AUTO_RETRIES,
  });
  const journalQ = useQuery({
    queryKey: ["journal"],
    queryFn: fetchJournal,
    refetchInterval: 5_000,
    retry: MAX_AUTO_RETRIES,
  });
  const reviewsQ = useQuery({
    queryKey: ["reviews"],
    queryFn: fetchReviews,
    refetchInterval: 30_000,
    retry: MAX_AUTO_RETRIES,
  });

  const testnet = (testnetQ.data?.data as TestnetPayload | undefined) ?? null;
  const runtime = (runtimeQ.data?.data as RuntimePayloadLite | undefined) ?? null;
  const market = (marketQ.data?.data as MarketPayload | undefined) ?? null;
  const orchData = orchQ.data?.data as
    | {
        running?: boolean;
        executionMode?: string;
        tradingEnabled?: boolean;
        account?: {
          riskState?: RiskPayload;
        } | null;
      }
    | undefined;

  const riskPayload = orchData?.account?.riskState ?? null;
  const tradingEnabled = orchData?.tradingEnabled ?? null;

  const journalEvents: JournalEvent[] = (journalQ.data?.data as { events?: JournalEvent[] } | undefined)?.events ?? [];
  const reviewsItems: ReviewItem[] =
    (reviewsQ.data?.data as { reviews?: ReviewItem[] } | undefined)?.reviews ?? [];

  // P7D-5.5: never block the shell — every card derives its own phase.
  const model: DashboardModel = {
    binance: buildBinanceCard(qOf(testnetQ), testnet),
    ai: buildAiCard(qOf(runtimeQ), runtime),
    market: buildMarketCard(qOf(marketQ), market),
    account: buildAccountCard(qOf(testnetQ), testnet),
    position: buildPositionCard(qOf(testnetQ), testnet),
    risk: buildRiskCard(qOf(orchQ), riskPayload),
    decision: buildDecisionCard(qOf(runtimeQ), runtime),
    reviews: buildFeedCard(qOf(reviewsQ), reviewsItems.length),
    journal: buildFeedCard(qOf(journalQ), journalEvents.length),
    journalEvents,
    reviewsItems,
    tradingEnabled,
    executionMode: orchData?.executionMode ?? "PAPER",
  };

  return <DashboardView model={model} />;
}

type RuntimePayloadLite = {
  running?: boolean;
  stats?: {
    lastTickAt?: number | null;
    startedAt?: number | null;
    totalErrors?: number | null;
    tickCount?: number | null;
    executionMode?: string | null;
  } | null;
  recentEvents?: RuntimeEventLite[];
};
