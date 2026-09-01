import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Stat, Tag, Meter } from "@/components/space/Panel";
import { CandleChart } from "@/components/space/Charts";
import { aiIntel, candles } from "@/lib/mock";

export const Route = createFileRoute("/market-analysis")({
  head: () => ({
    meta: [
      { title: "Market Analysis — Orbital AI Command Center" },
      {
        name: "description",
        content:
          "Order flow, liquidity map, correlation grid and multi-timeframe bias for the AI futures agent.",
      },
      { property: "og:title", content: "Market Analysis — Orbital AI Command Center" },
      {
        property: "og:description",
        content: "Order book imbalance, liquidity zones, correlations and timeframe bias.",
      },
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

const book = [
  { p: 64100, bid: 12, ask: 78 },
  { p: 64000, bid: 22, ask: 61 },
  { p: 63900, bid: 44, ask: 40 },
  { p: 63800, bid: 71, ask: 22 },
  { p: 63700, bid: 84, ask: 15 },
  { p: 63600, bid: 66, ask: 9 },
];

const correlations = [
  { a: "ETHUSDT", v: 0.91 },
  { a: "SOLUSDT", v: 0.84 },
  { a: "BNBUSDT", v: 0.78 },
  { a: "GOLD", v: 0.21 },
  { a: "DXY", v: -0.62 },
  { a: "NASDAQ", v: 0.57 },
];

function MarketAnalysis() {
  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Sensors · Deep Scan"
        title="Market Analysis"
        desc="Order flow, liquidity structure and cross-asset context feeding the inference core."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Book Imbalance" value="61 / 39" sub="Bids favored" tone="gain" />
        <Stat label="Open Interest" value="+12.4%" sub="8h change" tone="gain" />
        <Stat label="Funding Rate" value="0.011%" sub="Next in 3h 12m" />
        <Stat label="Realized Vol" value="42.8%" sub="Annualized · 24h" tone="warn" />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="BTCUSDT · Structure" code="15M" className="xl:col-span-2" glow>
          <CandleChart data={candles} height={320} />
        </Panel>

        <Panel title="Multi-Timeframe Bias" code="5 HORIZONS">
          <div className="space-y-4">
            {timeframes.map((t) => (
              <div key={t.tf}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-foreground">{t.tf}</span>
                  <Tag tone={t.bias === "LONG" ? "gain" : t.bias === "NEUTRAL" ? "warn" : "loss"}>
                    {t.bias}
                  </Tag>
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
            {book.map((r) => (
              <div key={r.p} className="flex items-center gap-2">
                <div className="flex flex-1 justify-end">
                  <div
                    className="h-4 rounded-l-sm bg-gain/25 ring-1 ring-inset ring-gain/40"
                    style={{ width: `${r.bid}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-center font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                  {r.p.toLocaleString()}
                </span>
                <div className="flex flex-1">
                  <div
                    className="h-4 rounded-r-sm bg-loss/25 ring-1 ring-inset ring-loss/40"
                    style={{ width: `${r.ask}%` }}
                  />
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
            {correlations.map((c) => (
              <div key={c.a}>
                <div className="flex justify-between">
                  <span className="font-mono text-xs text-foreground">{c.a}</span>
                  <span
                    className={`font-mono text-xs tabular-nums ${c.v < 0 ? "text-loss" : "text-gain"}`}
                  >
                    {c.v.toFixed(2)}
                  </span>
                </div>
                <Meter value={Math.abs(c.v) * 100} tone={c.v < 0 ? "loss" : "primary"} className="mt-1.5" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Narrative Read" code="LLM SUMMARY">
          <ul className="space-y-3">
            {aiIntel.marketAnalysis.map((m) => (
              <li key={m} className="flex gap-3 border-b border-hairline/50 pb-3 last:border-0 last:pb-0">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span className="text-sm text-muted-foreground">{m}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-sm border border-hairline bg-muted/30 p-3 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
            &gt; Conclusion: continuation favored while price holds above 63,180. Invalidation on a
            15m close under VWAP with negative delta.
          </div>
        </Panel>
      </div>
    </div>
  );
}
