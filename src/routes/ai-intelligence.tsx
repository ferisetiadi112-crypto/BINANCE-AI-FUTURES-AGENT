import { createFileRoute } from "@tanstack/react-router";
import { BrainCircuit, Cpu, Radio, Sparkles } from "lucide-react";
import { Meter, PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { SignalRadar } from "@/components/space/Charts";
import { aiIntel } from "@/lib/mock";

export const Route = createFileRoute("/ai-intelligence")({
  head: () => ({
    meta: [
      { title: "AI Intelligence — Orbital AI Command Center" },
      {
        name: "description",
        content:
          "AI confidence, market regime detection, current decision, selected strategy and technical analysis readouts.",
      },
      { property: "og:title", content: "AI Intelligence — Orbital AI Command Center" },
      {
        property: "og:description",
        content: "Regime detection, decision reasoning and technical indicator matrix.",
      },
    ],
  }),
  component: AIIntelligence,
});

function AIIntelligence() {
  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Cognition · Inference Core"
        title="AI Intelligence"
        desc="What the agent believes about the market right now, and why it chose its current course."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="AI Confidence" value={`${aiIntel.confidence}%`} sub="High conviction" tone="gain" icon={<BrainCircuit className="h-4 w-4" />} />
        <Stat label="Regime Confidence" value={`${aiIntel.regimeConfidence}%`} sub={aiIntel.regime} icon={<Radio className="h-4 w-4" />} />
        <Stat label="Decision" value={aiIntel.decision} sub={aiIntel.decisionSize} tone="gain" icon={<Sparkles className="h-4 w-4" />} />
        <Stat label="Strategy Edge" value={`${aiIntel.strategyEdge}R`} sub={aiIntel.strategy} icon={<Cpu className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Current Market Regime" code="CLASSIFIER V3" glow className="xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-display text-2xl font-semibold tracking-tight text-primary glow-text">
                {aiIntel.regime}
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Expansion phase detected across the 15m–4h horizon. Trend-following allocations
                favored; mean-reversion sleeves throttled to 40% size.
              </p>
            </div>
            <Tag tone="gain">Stable · 6h</Tag>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              { k: "Trending", v: aiIntel.regimeConfidence },
              { k: "Ranging", v: 14 },
              { k: "Volatile", v: 9 },
              { k: "Illiquid", v: 3 },
            ].map((r) => (
              <div key={r.k} className="rounded-sm border border-hairline bg-muted/30 p-3">
                <div className="label-mono">{r.k}</div>
                <div className="mt-1 font-mono text-lg text-foreground">{r.v}%</div>
                <Meter value={r.v} className="mt-2" tone={r.v > 50 ? "primary" : "cyan"} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Signal Matrix" code="6-AXIS">
          <SignalRadar data={aiIntel.signals} />
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="AI Decision" code="REASONING TRACE" glow>
          <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
            <div className="label-mono">Action</div>
            <div className="font-mono text-xl font-semibold text-primary glow-text">
              {aiIntel.decision}
            </div>
            <div className="mt-1 font-mono text-xs text-foreground/80">{aiIntel.decisionSize}</div>
          </div>
          <ol className="mt-4 space-y-3">
            {[
              "Regime classifier returns TRENDING at 74% — trend sleeve enabled.",
              "Momentum Breakout v4.2 ranked first by expected R (1.42).",
              "Risk guardian approved: exposure 41% of cap, leverage under limit.",
              "Entry staged on retest of breakout level with 1.4 ATR trailing stop.",
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 font-mono text-[0.65rem] text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Market Analysis" code="ORDER FLOW">
          <ul className="space-y-3">
            {aiIntel.marketAnalysis.map((m) => (
              <li key={m} className="flex gap-3 border-b border-hairline/50 pb-3 last:border-0 last:pb-0">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                <span className="text-sm text-muted-foreground">{m}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Technical Analysis" code="8 INDICATORS">
          <div className="grid grid-cols-2 gap-2">
            {aiIntel.technical.map((t) => (
              <div key={t.name} className="rounded-sm border border-hairline bg-muted/30 p-2.5">
                <div className="label-mono truncate">{t.name}</div>
                <div
                  className={`mt-1 font-mono text-sm ${
                    t.state === "bull"
                      ? "text-gain"
                      : t.state === "bear"
                        ? "text-loss"
                        : t.state === "warn"
                          ? "text-amber-signal"
                          : "text-foreground"
                  }`}
                >
                  {t.value}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
