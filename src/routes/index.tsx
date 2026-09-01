import { createFileRoute } from "@tanstack/react-router";
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
import { aiIntel, candles, equityCurve, overview, position, recentTrades, risk } from "@/lib/mock";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Deck — Orbital AI Futures Dashboard" },
      {
        name: "description",
        content:
          "Overview of balance, daily and total PnL, win rate, profit factor, drawdown and AI trading status.",
      },
      { property: "og:title", content: "Command Deck — Orbital AI Futures Dashboard" },
      {
        property: "og:description",
        content: "Balance, PnL, win rate, profit factor, drawdown and live AI trading status.",
      },
    ],
  }),
  component: Dashboard,
});

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Dashboard() {
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
              <div className="font-mono text-sm font-semibold text-gain glow-text">
                {overview.status}
              </div>
            </div>
            <div className="ml-3 border-l border-hairline pl-3">
              <div className="label-mono">Uptime</div>
              <div className="font-mono text-sm text-foreground">{overview.uptime}</div>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Balance" value={money(overview.balance)} sub={`Equity ${money(overview.equity)}`} icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Daily PnL" value={money(overview.dailyPnl)} sub={`+${overview.dailyPnlPct}% today`} tone="gain" icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="Total PnL" value={money(overview.totalPnl)} sub={`+${overview.totalPnlPct}% all time`} tone="gain" icon={<Activity className="h-4 w-4" />} />
        <Stat label="Win Rate" value={`${overview.winRate}%`} sub={`${overview.trades} trades`} icon={<Target className="h-4 w-4" />} />
        <Stat label="Profit Factor" value={overview.profitFactor.toFixed(2)} sub={`Sharpe ${overview.sharpe}`} icon={<Percent className="h-4 w-4" />} />
        <Stat label="Max Drawdown" value={`${overview.maxDrawdown}%`} sub={`Current ${overview.currentDrawdown}%`} tone="loss" icon={<ArrowDownRight className="h-4 w-4" />} />
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
              <span className="font-mono text-sm tabular-nums text-foreground">63,884.90</span>
            </div>
          }
        >
          <CandleChart data={candles} />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="AI Confidence" code="MODEL ORBIT-7B" glow>
            <div className="flex items-end justify-between">
              <div className="font-mono text-5xl font-semibold text-primary glow-text">
                {aiIntel.confidence}
                <span className="text-xl">%</span>
              </div>
              <BrainCircuit className="h-8 w-8 text-primary/60" />
            </div>
            <Meter value={aiIntel.confidence} className="mt-4" />
            <dl className="mt-4 space-y-2 border-t border-hairline pt-3">
              <Row k="Market Regime" v={aiIntel.regime} />
              <Row k="Decision" v={aiIntel.decision} tone="gain" />
              <Row k="Strategy" v={aiIntel.strategy} />
            </dl>
          </Panel>

          <Panel title="Signal Matrix" code="6-AXIS">
            <SignalRadar data={aiIntel.signals} />
          </Panel>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Equity Curve" code="40 SESSIONS" className="xl:col-span-2">
          <EquityChart data={equityCurve} height={230} />
        </Panel>

        <Panel title="Current Position" code={position.symbol} glow>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold text-foreground">
                {position.symbol}
              </div>
              <div className="mt-1 flex gap-2">
                <Tag tone="gain">{position.side}</Tag>
                <Tag>{position.leverage}</Tag>
                <Tag>{position.size}</Tag>
              </div>
            </div>
            <div className="text-right">
              <div className="label-mono">Unrealized</div>
              <div className="font-mono text-2xl font-semibold text-gain glow-text">
                +{money(position.pnl).replace("$", "$")}
              </div>
              <div className="font-mono text-xs text-gain">+{position.pnlPct}%</div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3">
            <Row k="Entry" v={position.entry.toLocaleString()} />
            <Row k="Mark" v={position.mark.toLocaleString()} />
            <Row k="Take Profit" v={position.takeProfit.toLocaleString()} tone="gain" />
            <Row k="Stop Loss" v={position.stopLoss.toLocaleString()} tone="loss" />
          </dl>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Recent Trades" code="LAST 5 FILLS" className="xl:col-span-2" bodyClassName="p-0">
          <TradeTable rows={recentTrades.slice(0, 5)} />
        </Panel>

        <Panel title="Risk Envelope" code="GUARDIAN" action={<Tag tone="gain">{risk.status}</Tag>}>
          <div className="space-y-4">
            <Gauge label="Daily Profit Target" used={risk.dailyProfitUsed} cap={risk.dailyProfitLimit} tone="primary" />
            <Gauge label="Daily Loss Limit" used={risk.dailyLossUsed} cap={risk.dailyLossLimit} tone="loss" />
            <Gauge label="Exposure" used={risk.exposure} cap={risk.exposureCap} tone="cyan" />
            <div className="flex items-center gap-2 rounded-sm border border-hairline bg-muted/40 px-3 py-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                {risk.emergencyStop}
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
      <dd
        className={
          tone === "gain"
            ? "font-mono text-xs text-gain"
            : tone === "loss"
              ? "font-mono text-xs text-loss"
              : "font-mono text-xs text-foreground"
        }
      >
        {v}
      </dd>
    </div>
  );
}

export function Gauge({
  label,
  used,
  cap,
  tone,
}: {
  label: string;
  used: number;
  cap: number;
  tone: "primary" | "loss" | "cyan" | "amber";
}) {
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

export function TradeTable({ rows }: { rows: typeof recentTrades }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse">
        <thead>
          <tr className="border-b border-hairline">
            {["ID", "Symbol", "Side", "Entry", "Exit", "PnL", "%", "Duration", "Strategy"].map((h) => (
              <th key={h} className="label-mono px-4 py-2 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.id}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-foreground">{t.sym}</td>
              <td className="px-4 py-2.5">
                <Tag tone={t.side === "LONG" ? "gain" : "violet"}>{t.side}</Tag>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">{t.entry.toLocaleString()}</td>
              <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">{t.exit.toLocaleString()}</td>
              <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                {t.pnl >= 0 ? "+" : ""}
                {t.pnl.toFixed(2)}
              </td>
              <td className={`px-4 py-2.5 font-mono text-xs tabular-nums ${t.pct >= 0 ? "text-gain" : "text-loss"}`}>
                {t.pct >= 0 ? "+" : ""}
                {t.pct}%
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.dur}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.strat}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
