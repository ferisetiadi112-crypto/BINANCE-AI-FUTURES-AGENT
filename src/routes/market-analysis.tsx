import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel, Stat, Tag, Meter } from "@/components/space/Panel";
import { CandleChart } from "@/components/space/Charts";
import { fetchMarket } from "@/api/client";

export const Route = createFileRoute("/market-analysis")({
  head: () => ({
    meta: [
      { title: "Market Analysis — Orbital AI Command Center" },
      { name: "description", content: "Order flow, liquidity map, correlation grid and multi-timeframe bias for the AI futures agent." },
      { property: "og:title", content: "Market Analysis — Orbital AI Command Center" },
      { property: "og:description", content: "Order book imbalance, liquidity zones, correlations and timeframe bias." },
    ],
  }),
  component: MarketAnalysis,
});

const timeframes = [
  { tf: "5m", bias: "LONG", strength: 68 },
  { tf: "15m", bias: "LONG", strength: 81 },
  { tf: "1h", bias: "LONG", strength: 74 },
  { tf: "4h", bias: "NEUTRAL", strength: 46 },
  { tf: "1D", bias: "LONG", strength: 62 },
];

function MarketAnalysis() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["market"],
    queryFn: fetchMarket,
  });

  const m = response?.data;

  if (isLoading || !m) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Sensors · Deep Scan" title="Market Analysis" desc="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
          <span className="ml-3 font-mono text-sm text-muted-foreground">Scanning markets...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Sensors · Deep Scan"
        title="Market Analysis"
        desc="Order flow, liquidity structure and cross-asset context feeding the inference core."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Book Imbalance" value={`${m.bookImbalance.bid} / ${m.bookImbalance.ask}`} sub="Bids favored" tone="gain" />
        <Stat label="Open Interest" value={`+${m.openInterestChange}%`} sub="8h change" tone="gain" />
        <Stat label="Funding Rate" value={`${m.fundingRate}%`} sub="Next in 3h 12m" />
        <Stat label="Realized Vol" value={`${m.realizedVolatility}%`} sub="Annualized · 24h" tone="warn" />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="BTCUSDT · Structure" code="15M · LIVE" className="xl:col-span-2" glow>
          <CandleChart data={m.candles} height={320} />
        </Panel>

        <Panel title="Multi-Timeframe Bias" code="5 HORIZONS">
          <div className="space-y-4">
            {timeframes.map((t) => (
              <div key={t.tf}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-foreground">{t.tf}</span>
                  <Tag tone={t.bias === "LONG" ? "gain" : t.bias === "NEUTRAL" ? "warn" : "loss"}>{t.bias}</Tag>
                </div>
                <Meter value={t.strength} className="mt-2" tone={t.bias === "NEUTRAL" ? "amber" : "primary"} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Liquidity Ladder" code="DEPTH ±0.8%">
          <div className="space-y-2">
            {(m.orderBook || []).map((r: any) => (
              <div key={r.price} className="flex items-center gap-2">
                <div className="flex flex-1 justify-end">
                  <div className="h-4 rounded-l-sm bg-gain/25 ring-1 ring-inset ring-gain/40" style={{ width: `${r.bid}%` }} />
                </div>
                <span className="w-16 shrink-0 text-center font-mono text-[0.65rem] tabular-nums text-muted-foreground">{r.price.toLocaleString()}</span>
                <div className="flex flex-1">
                  <div className="h-4 rounded-r-sm bg-loss/25 ring-1 ring-inset ring-loss/40" style={{ width: `${r.ask}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-hairline pt-2">
            <span className="label-mono text-gain">Bids</span>
            <span className="label-mono text-loss">Asks</span>
          </div>
        </Panel>

        <Panel title="Correlation Grid" code="30D ROLLING">
          <div className="space-y-3">
            {(m.correlations || []).map((c: any) => (
              <div key={c.symbol}>
                <div className="flex justify-between">
                  <span className="font-mono text-xs text-foreground">{c.symbol}</span>
                  <span className={`font-mono text-xs tabular-nums ${c.correlation < 0 ? "text-loss" : "text-gain"}`}>{c.correlation.toFixed(2)}</span>
                </div>
                <Meter value={Math.abs(c.correlation) * 100} tone={c.correlation < 0 ? "loss" : "primary"} className="mt-1.5" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Narrative Read" code="LLM SUMMARY">
          <ul className="space-y-3">
            {["Spot CVD diverging positive against perp funding — accumulation bias.", "Order book imbalance 61/39 favoring bids within 0.4% band.", "Open interest +12.4% over 8h with stable funding at 0.011%.", "Correlated majors (ETH, SOL) confirming directional agreement."].map((m, i) => (
              <li key={i} className="flex gap-3 border-b border-hairline/50 pb-3 last:border-0 last:pb-0">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span className="text-sm text-muted-foreground">{m}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
