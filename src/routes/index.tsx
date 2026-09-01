import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  Percent,
  Shield,
  Target,
  Wallet,
} from "lucide-react";
import { Meter, PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { CandleChart, EquityChart, SignalRadar } from "@/components/space/Charts";
import { fetchDashboard } from "@/api/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Deck — Orbital AI Futures Dashboard" },
      { name: "description", content: "Overview of balance, daily and total PnL, win rate, profit factor, drawdown and AI trading status." },
      { property: "og:title", content: "Command Deck — Orbital AI Futures Dashboard" },
      { property: "og:description", content: "Balance, PnL, win rate, profit factor, drawdown and live AI trading status." },
    ],
  }),
  component: Dashboard,
});

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Dashboard() {
  const { data: response, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  const d = response?.data;

  if (isLoading || !d) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Sector 07 · Command Deck" title="Trading Command Center" desc="Loading..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
          <span className="ml-3 font-mono text-sm text-muted-foreground">Initializing systems...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Sector 07 · Command Deck"
        title="Trading Command Center"
        desc="Autonomous futures agent operating in simulation. All figures are demonstrative."
        right={
          <div className="panel corner-ticks flex items-center gap-3 px-4 py-2.5">
            <span className="pulse-dot h-2 w-2 rounded-full bg-primary" />
            <div>
              <div className="label-mono">Trading Status</div>
              <div className="font-mono text-sm font-semibold text-gain glow-text">{d.status}</div>
            </div>
            <div className="ml-3 border-l border-hairline pl-3">
              <div className="label-mono">Uptime</div>
              <div className="font-mono text-sm text-foreground">{d.uptime}</div>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Balance" value={money(d.account.balance)} sub={`Equity ${money(d.account.equity)}`} icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Daily PnL" value={money(d.dailyPnl)} sub={`+${d.dailyPnlPercent}% today`} tone="gain" icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="Total PnL" value={money(d.totalPnl)} sub={`+${d.totalPnlPercent}% all time`} tone="gain" icon={<Activity className="h-4 w-4" />} />
        <Stat label="Win Rate" value={`${d.winRate}%`} sub={`${d.tradeCount} trades`} icon={<Target className="h-4 w-4" />} />
        <Stat label="Profit Factor" value={d.profitFactor.toFixed(2)} sub={`Sharpe ${d.sharpeRatio}`} icon={<Percent className="h-4 w-4" />} />
        <Stat label="Max Drawdown" value={`${d.maxDrawdown}%`} sub={`Current ${d.currentDrawdown}%`} tone="loss" icon={<ArrowDownRight className="h-4 w-4" />} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel
          title="BTCUSDT · Perpetual"
          code="15M · SIM FEED"
          className="xl:col-span-2"
          glow
          action={
            <div className="flex items-center gap-2">
              <Tag tone="gain">Long Bias</Tag>
              <span className="font-mono text-sm tabular-nums text-foreground">{d.currentPrice.toLocaleString()}</span>
            </div>
          }
        >
          <CandleChart data={d.candles} />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="AI Confidence" code="MODEL ORBIT-7B" glow>
            <div className="flex items-end justify-between">
              <div className="font-mono text-5xl font-semibold text-primary glow-text">
                {d.aiDecision.confidence}
                <span className="text-xl">%</span>
              </div>
              <BrainCircuit className="h-8 w-8 text-primary/60" />
            </div>
            <Meter value={d.aiDecision.confidence} className="mt-4" />
            <dl className="mt-4 space-y-2 border-t border-hairline pt-3">
              <Row k="Decision" v={d.aiDecision.action} tone="gain" />
              <Row k="Strategy" v={`${d.aiDecision.strategyName} ${d.aiDecision.strategyVersion}`} />
            </dl>
          </Panel>

          <Panel title="Signal Matrix" code="6-AXIS">
            <SignalRadar data={d.riskEnvelope.status === "NOMINAL" ? [
              { label: "Momentum", v: 82 },
              { label: "Trend", v: 74 },
              { label: "Volatility", v: 46 },
              { label: "Liquidity", v: 68 },
              { label: "Sentiment", v: 59 },
              { label: "Risk", v: 31 },
            ] : []} />
          </Panel>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Equity Curve" code="40 SESSIONS" className="xl:col-span-2">
          <EquityChart data={[
            { d: "D1", equity: 500, benchmark: 500 },
            { d: "D10", equity: 520, benchmark: 505 },
            { d: "D20", equity: 545, benchmark: 510 },
            { d: "D30", equity: 560, benchmark: 515 },
            { d: "D40", equity: 580, benchmark: 520 },
          ]} height={230} />
        </Panel>

        <Panel title="Recent Trades" code="LAST 5 FILLS" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  {["ID", "Symbol", "Side", "PnL", "%", "Strategy"].map((h) => (
                    <th key={h} className="label-mono px-4 py-2 text-left font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.recentTrades.slice(0, 5).map((t: any) => (
                  <tr key={t.id} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.id}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{t.symbol}</td>
                    <td className="px-4 py-2.5">
                      <Tag tone={t.side === "LONG" ? "gain" : "violet"}>{t.side}</Tag>
                    </td>
                    <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${t.pnlPercent >= 0 ? "text-gain" : "text-loss"}`}>
                      {t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent}%
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.strategyName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-3">
        <Panel title="Risk Envelope" code="GUARDIAN" action={<Tag tone="gain">{d.riskEnvelope.status}</Tag>}>
          <div className="space-y-4">
            <Gauge label="Daily Profit Target" used={d.riskEnvelope.dailyProfitUsed} cap={d.riskEnvelope.dailyProfitCap} tone="primary" />
            <Gauge label="Daily Loss Limit" used={d.riskEnvelope.dailyLossUsed} cap={d.riskEnvelope.dailyLossLimit} tone="loss" />
            <Gauge label="Exposure" used={d.riskEnvelope.totalExposure} cap={d.riskEnvelope.maxExposure} tone="cyan" />
            <div className="flex items-center gap-2 rounded-sm border border-hairline bg-muted/40 px-3 py-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                {d.riskEnvelope.emergencyStopState}
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function Row({ k, v, tone }: { k: string; v: string; tone?: "gain" | "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-mono">{k}</dt>
      <dd className={`font-mono text-xs ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground"}`}>{v}</dd>
    </div>
  );
}

export function Gauge({ label, used, cap, tone }: { label: string; used: number; cap: number; tone: "primary" | "loss" | "cyan" | "amber" }) {
  const pct = (used / cap) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-[0.7rem] tabular-nums text-foreground">
          ${used.toLocaleString()} / ${cap.toLocaleString()}
        </span>
      </div>
      <Meter value={pct} tone={tone} className="mt-1.5" />
      <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">{pct.toFixed(1)}% consumed</div>
    </div>
  );
}
