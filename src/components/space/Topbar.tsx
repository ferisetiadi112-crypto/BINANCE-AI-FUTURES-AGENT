import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tag } from "./Panel";
import {
  fetchTestnetStatus,
  fetchMarketStatus,
  fetchRuntimeStatus,
} from "@/api/client";
import { MAX_AUTO_RETRIES } from "@/lib/fetch-timeout";
import { buildBinanceCard, buildAiCard, buildMarketCard } from "@/lib/ui-state";

function useLiveStatus() {
  const testnetQ = useQuery({
    queryKey: ["testnet-status"],
    queryFn: fetchTestnetStatus,
    refetchInterval: 15_000,
    retry: MAX_AUTO_RETRIES,
  });
  const marketQ = useQuery({
    queryKey: ["market-status"],
    queryFn: fetchMarketStatus,
    refetchInterval: 15_000,
    retry: MAX_AUTO_RETRIES,
  });
  const runtimeQ = useQuery({
    queryKey: ["runtime-status"],
    queryFn: fetchRuntimeStatus,
    refetchInterval: 15_000,
    retry: MAX_AUTO_RETRIES,
  });

  const binance = buildBinanceCard(
    { pending: testnetQ.isPending, failed: testnetQ.isError },
    testnetQ.data?.data,
  );
  const market = buildMarketCard(
    { pending: marketQ.isPending, failed: marketQ.isError },
    marketQ.data?.data,
  );
  const ai = buildAiCard(
    { pending: runtimeQ.isPending, failed: runtimeQ.isError },
    runtimeQ.data?.data,
  );

  return { binance, market, ai };
}

const chipTone = {
  gain: "text-gain",
  loss: "text-loss",
  warn: "text-amber-signal",
  cyan: "text-cyan-signal",
  muted: "text-muted-foreground",
} as const;

function StatusChip({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: keyof typeof chipTone;
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[0.65rem] uppercase tracking-[0.14em]">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          tone === "gain"
            ? "bg-gain"
            : tone === "loss"
              ? "bg-loss"
              : tone === "warn"
                ? "bg-amber-signal"
                : tone === "cyan"
                  ? "bg-cyan-signal animate-pulse"
                  : "bg-muted-foreground/60"
        }`}
      />
      <span className="text-muted-foreground/80">{label}</span>
      <span className={chipTone[tone]}>{text}</span>
    </span>
  );
}

export function Topbar() {
  const { binance, market, ai } = useLiveStatus();

  const binanceTone =
    binance.phase === "READY"
      ? ("gain" as const)
      : binance.phase === "LOADING"
        ? ("cyan" as const)
        : binance.phase === "DEGRADED"
          ? ("warn" as const)
          : binance.phase === "OFFLINE"
            ? ("loss" as const)
            : ("muted" as const);

  const marketTone =
    market.freshness === "FRESH"
      ? ("gain" as const)
      : market.freshness === "STALE"
        ? ("warn" as const)
        : market.phase === "LOADING"
          ? ("cyan" as const)
          : market.phase === "READY"
            ? ("gain" as const)
            : ("muted" as const);

  const aiTone =
    ai.phase === "READY"
      ? ("gain" as const)
      : ai.phase === "LOADING"
        ? ("cyan" as const)
        : ai.phase === "DEGRADED"
          ? ("warn" as const)
          : ai.phase === "OFFLINE" || ai.phase === "ERROR"
            ? ("loss" as const)
            : ("muted" as const);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-background/80 px-3 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-primary" />

      {/* Live system strip — hidden on the smallest screens to keep the shell compact */}
      <div className="hidden min-w-0 flex-1 items-center justify-start gap-4 overflow-hidden md:flex">
        <StatusChip label="BINANCE" text={binance.headline} tone={binanceTone} />
        <StatusChip label="AI" text={ai.headline} tone={aiTone} />
        <StatusChip label="MARKET" text={market.freshness} tone={marketTone} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tag tone="cyan">{binance.mode === "—" ? "PAPER" : binance.mode}</Tag>
        <Tag tone={binance.phase === "READY" ? "gain" : binance.phase === "LOADING" ? "cyan" : binance.phase === "DEGRADED" ? "warn" : "loss"}>
          {binance.phase === "LOADING"
            ? "CONNECTING"
            : binance.phase === "READY"
              ? "LIVE"
              : binance.phase === "DEGRADED"
                ? "DEGRADED"
                : binance.phase === "OFFLINE"
                  ? "OFFLINE"
                  : "STATUS?"}
        </Tag>
      </div>
    </header>
  );
}
