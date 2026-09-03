import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BrainCircuit, Clock, Target, Zap } from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { CandleChart } from "@/components/space/Charts";
import { fetchRuntime } from "@/api/client";

export const Route = createFileRoute("/trading")({
  head: () => ({
    meta: [
      { title: "Trading — Orbital AI Command Center" },
      { name: "description", content: "Open positions, entry/exit management, PnL tracking and recent fills." },
      { property: "og:title", content: "Trading — Orbital AI Command Center" },
    ],
  }),
  component: Trading,
});

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Trading() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["runtime"],
    queryFn: fetchRuntime,
  });

  const runtime = response?.data;
  const position = runtime?.position;

  // P7D-4.4: No full-page loading blocker

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Execution · Order Flow"
        title="Trading"
        desc="Open positions, entry management and recent trade execution."
      />

      {isLoading && !runtime && (
        <div className="flex items-center gap-3 rounded-sm border border-primary/20 bg-primary/5 px-4 py-3 mb-3">
          <div className="pulse-dot h-3 w-3 rounded-full bg-primary" />
          <span className="font-mono text-xs text-muted-foreground">Initializing execution engine...</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        <Stat label="Open Positions" value={position ? "1" : "0"} sub={position ? "1 symbol active" : "No positions"} icon={<Target className="h-4 w-4" />} />
        <Stat label="Trading Status" value={runtime.tradingStatus} sub="Simulation mode" icon={<Zap className="h-4 w-4" />} />
        <Stat label="AI Decision" value={runtime.aiIntelligence.decision.action} sub={runtime.aiIntelligence.decision.size} tone="gain" icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="AI Confidence" value={`${runtime.aiIntelligence.confidence}%`} sub="Current conviction" icon={<BrainCircuit className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Market Structure" code="15M · LIVE" className="xl:col-span-2" glow>
          <CandleChart data={[]} height={360} />
        </Panel>

        <div className="flex flex-col gap-3">
          {position ? (
            <Panel title="Current Position" code={position.symbol} glow>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-lg font-semibold text-foreground">{position.symbol}</div>
                  <div className="mt-1 flex gap-2">
                    <Tag tone="gain">{position.side}</Tag>
                    <Tag>{position.leverage}x</Tag>
                    <Tag>{position.size} BTC</Tag>
                  </div>
                </div>
                <div className="text-right">
                  <div className="label-mono">Unrealized</div>
                  <div className="font-mono text-2xl font-semibold text-gain glow-text">{money(position.unrealizedPnl)}</div>
                  <div className="font-mono text-xs text-gain">+{position.unrealizedPnlPercent.toFixed(2)}%</div>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3">
                <Row k="Entry" v={position.entryPrice.toLocaleString()} />
                <Row k="Mark" v={position.markPrice.toLocaleString()} />
                <Row k="Take Profit" v={position.takeProfitPrice.toLocaleString()} tone="gain" />
                <Row k="Stop Loss" v={position.stopLossPrice.toLocaleString()} tone="loss" />
                <Row k="Liquidation" v={position.liquidationPrice.toLocaleString()} tone="loss" />
                <Row k="Margin" v={money(position.margin)} />
              </dl>
            </Panel>
          ) : (
            <Panel title="No Open Position" code="IDLE">
              <div className="py-4 text-center text-sm text-muted-foreground">No active positions. Agent is in simulation mode.</div>
            </Panel>
          )}

          <Panel title="AI Decision" code="LATEST">
            <div className="rounded-sm border border-primary/30 bg-primary/10 p-3">
              <div className="label-mono">Action</div>
              <div className="font-mono text-xl font-semibold text-primary glow-text">{runtime.aiIntelligence.decision.action}</div>
              <div className="mt-1 font-mono text-xs text-foreground/80">{runtime.aiIntelligence.decision.size}</div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "gain" | "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-mono">{k}</dt>
      <dd className={`font-mono text-xs ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground"}`}>{v}</dd>
    </div>
  );
}
