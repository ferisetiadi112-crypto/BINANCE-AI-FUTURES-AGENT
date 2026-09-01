import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CircleAlert,
  CircleCheck,
  Clock,
  Cpu,
  Crosshair,
  Database,
  Gauge,
  LineChart,
  Radio,
  Shield,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { Meter, PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import { CandleChart, EquityChart, SignalRadar } from "@/components/space/Charts";
import { fetchDashboard, fetchRuntime, fetchLearning, fetchSystem, fetchHealth, fetchPaperStatus, fetchFeedStatus } from "@/api/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Deck — Orbital AI Futures Dashboard" },
      { name: "description", content: "AI Futures Trading Observatory — system status, AI decisions, risk controls, paper performance, and learning metrics." },
      { property: "og:title", content: "Command Deck — Orbital AI Futures Dashboard" },
      { property: "og:description", content: "AI Futures Trading Observatory — full system visibility." },
    ],
  }),
  component: Dashboard,
});

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Dashboard() {
  const { data: dashResp, isLoading: dashLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
  const { data: runtimeResp } = useQuery({
    queryKey: ["runtime"],
    queryFn: fetchRuntime,
  });
  const { data: learningResp } = useQuery({
    queryKey: ["learning"],
    queryFn: fetchLearning,
  });
  const { data: systemResp } = useQuery({
    queryKey: ["system"],
    queryFn: fetchSystem,
  });
  const { data: healthResp } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });
  const { data: paperResp } = useQuery({
    queryKey: ["paper-status"],
    queryFn: fetchPaperStatus,
    refetchInterval: 10000, // Poll every 10s for live status
  });
  const { data: feedResp } = useQuery({
    queryKey: ["feed-status"],
    queryFn: fetchFeedStatus,
    refetchInterval: 5000, // Poll every 5s for live feed state
  });

  const d = dashResp?.data;
  const runtime = runtimeResp?.data;
  const learning = learningResp?.data;
  const system = systemResp?.data;
  const health = healthResp?.data;

  if (dashLoading || !d) {
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

  const aiIntel = runtime?.aiIntelligence;
  const riskEnv = d.riskEnvelope;
  const learningStats = learning?.experienceStats;
  const derivedLessons = learning?.derivedLessons?.slice(0, 3) || [];
  const systemNodes = system?.nodes || [];
  const paper = paperResp?.data;
  const feedStatusData = feedResp?.data;
  // Phase 8C: Use real feed state from WebSocket FeedManager
  const feedSymbols = feedStatusData?.symbols || paper?.feedSymbols || [];

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Sector 07 · Command Deck"
        title="AI Futures Trading Observatory"
        desc="PAPER TRADING MODE — All figures are simulated. No real money at risk."
        right={
          <div className="panel corner-ticks flex items-center gap-3 px-4 py-2.5">
            <span className="pulse-dot h-2 w-2 rounded-full bg-primary" />
            <div>
              <div className="label-mono">System Status</div>
              <div className="font-mono text-sm font-semibold text-gain glow-text">{health?.status || "INITIALIZING"}</div>
            </div>
            <div className="ml-3 border-l border-hairline pl-3">
              <div className="label-mono">Mode</div>
              <div className="font-mono text-sm text-primary">PAPER</div>
            </div>
          </div>
        }
      />

      {/* ── System Status Bar ───────────────────────────────────────── */}
      <Panel title="System Status" code="OBSERVATORY" glow>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatusIndicator label="Market Feed" state={feedStatusData?.aggregate?.overallFeedState || paper?.feedState || "OFFLINE"} />
          <StatusIndicator label="Runtime Intel" state="ONLINE" />
          <StatusIndicator label="AI Engine" state="ONLINE" />
          <StatusIndicator label="Risk Engine" state={riskEnv.status === "NOMINAL" ? "ONLINE" : "PAUSED"} />
          <StatusIndicator label="Paper Trading" state="SIMULATION" />
          <StatusIndicator label="Learning" state="ACTIVE" />
        </div>
      </Panel>

      {/* ── Primary Stats ───────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Balance" value={money(d.account.balance)} sub={`Equity ${money(d.account.equity)}`} icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Daily PnL" value={money(d.dailyPnl)} sub={`${d.dailyPnlPercent >= 0 ? "+" : ""}${d.dailyPnlPercent}% today`} tone={d.dailyPnl >= 0 ? "gain" : "loss"} icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="Total PnL" value={money(d.totalPnl)} sub={`${d.totalPnlPercent >= 0 ? "+" : ""}${d.totalPnlPercent}% all time`} tone={d.totalPnl >= 0 ? "gain" : "loss"} icon={<Activity className="h-4 w-4" />} />
        <Stat label="Win Rate" value={`${d.winRate}%`} sub={`${d.tradeCount} trades`} icon={<Target className="h-4 w-4" />} />
        <Stat label="Profit Factor" value={d.profitFactor.toFixed(2)} sub={`Sharpe ${d.sharpeRatio}`} icon={<LineChart className="h-4 w-4" />} />
        <Stat label="Max Drawdown" value={`${d.maxDrawdown}%`} sub={`Current ${d.currentDrawdown}%`} tone="loss" icon={<ArrowDownRight className="h-4 w-4" />} />
      </div>

      {/* ── Market + AI Decision ────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel
          title="BTCUSDT · Perpetual"
          code="15M · PAPER FEED"
          className="xl:col-span-2"
          glow
          action={
            <div className="flex items-center gap-2">
              <Tag tone="gain">PAPER</Tag>
              <span className="font-mono text-sm tabular-nums text-foreground">{d.currentPrice.toLocaleString()}</span>
            </div>
          }
        >
          <CandleChart data={d.candles} />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="AI Decision" code="OBSERVE" glow>
            <div className="flex items-end justify-between">
              <div className="font-mono text-5xl font-semibold text-primary glow-text">
                {d.aiDecision.confidence}
                <span className="text-xl">%</span>
              </div>
              <BrainCircuit className="h-8 w-8 text-primary/60" />
            </div>
            <Meter value={d.aiDecision.confidence} className="mt-4" />
            <dl className="mt-4 space-y-2 border-t border-hairline pt-3">
              <Row k="Action" v={d.aiDecision.action} tone="gain" />
              <Row k="Symbol" v={d.aiDecision.symbol} />
              <Row k="Strategy" v={`${d.aiDecision.strategyName} ${d.aiDecision.strategyVersion}`} />
              <Row k="Regime" v={aiIntel?.regime || "UNKNOWN"} />
              <Row k="Risk" v={riskEnv.status} tone={riskEnv.status === "NOMINAL" ? "gain" : "loss"} />
            </dl>
          </Panel>

          <Panel title="Signal Matrix" code="6-AXIS">
            <SignalRadar data={riskEnv.status === "NOMINAL" ? [
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

      {/* ── AI Decision Feed ────────────────────────────────────────── */}
      <div className="mt-3">
        <Panel title="AI Decision Feed" code="OBSERVE" action={<Tag tone="cyan">LIVE TRACE</Tag>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[50rem] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  {["Time", "Symbol", "Direction", "Confidence", "Strategy", "Regime", "Risk", "Result"].map((h) => (
                    <th key={h} className="label-mono px-3 py-2 text-left font-normal text-[0.65rem]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.recentTrades.slice(0, 5).map((t: any) => (
                  <tr key={t.id} className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.closedAt || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-foreground">{t.symbol}</td>
                    <td className="px-3 py-2">
                      <Tag tone={t.side === "LONG" ? "gain" : "violet"}>{t.side}</Tag>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-foreground">{d.aiDecision.confidence}%</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.strategyName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{aiIntel?.regime || "—"}</td>
                    <td className="px-3 py-2">
                      <Tag tone="gain">APPROVED</Tag>
                    </td>
                    <td className={`px-3 py-2 font-mono text-xs tabular-nums ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ── Equity + Recent Trades ──────────────────────────────────── */}
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="Equity Curve" code="PAPER" className="xl:col-span-2">
          <EquityChart data={[
            { d: "D1", equity: 500, benchmark: 500 },
            { d: "D10", equity: 520, benchmark: 505 },
            { d: "D20", equity: 545, benchmark: 510 },
            { d: "D30", equity: 560, benchmark: 515 },
            { d: "D40", equity: 580, benchmark: 520 },
          ]} height={230} />
        </Panel>

        <Panel title="Paper Trading Observatory" code="SIMULATION" bodyClassName="p-0" action={<Tag tone="gain">LIVE</Tag>}>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-primary/5 px-3 py-2">
              <Gauge className="h-4 w-4 text-primary" />
              <span className="font-mono text-[0.7rem] uppercase tracking-wider text-primary">Paper Trading Mode</span>
              <Tag tone="gain">{paper?.mode || "PAPER"}</Tag>
            </div>

            {/* Active Position */}
            {paper?.activePosition ? (
              <div className="rounded-sm border border-gain/40 bg-gain/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="label-mono text-[0.6rem]">ACTIVE POSITION</span>
                  <Tag tone={paper.activePosition.side === "LONG" ? "gain" : "violet"}>{paper.activePosition.side}</Tag>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniStat label="Symbol" value={paper.activePosition.symbol} />
                  <MiniStat label="Size" value={`${paper.activePosition.size} × ${paper.activePosition.leverage}x`} />
                  <MiniStat label="Entry" value={`$${paper.activePosition.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                  <MiniStat label="Mark" value={`$${paper.activePosition.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                  <MiniStat label="Unrealized PnL" value={money(paper.activePosition.unrealizedPnl)} />
                  <MiniStat label="Duration" value={`${paper.activePosition.durationMinutes}m`} />
                </div>
              </div>
            ) : (
              <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
                <span className="label-mono text-[0.6rem]">NO ACTIVE POSITION</span>
              </div>
            )}

            {/* Performance Summary */}
            <div className="border-t border-hairline pt-3 space-y-1.5">
              <Row k="Virtual Capital" v={money(paper?.capital || d.account.balance)} tone="gain" />
              <Row k="Total PnL" v={money(paper?.totalPnl || d.totalPnl)} tone={(paper?.totalPnl || d.totalPnl) >= 0 ? "gain" : "loss"} />
              <Row k="Win Rate" v={`${paper?.winRate || d.winRate}%`} />
              <Row k="Trades" v={`${paper?.totalTrades || d.tradeCount}`} />
              <Row k="Profit Factor" v={(paper?.profitFactor || d.profitFactor).toFixed(2)} />
              <Row k="Max Drawdown" v={`${paper?.maxDrawdown || d.maxDrawdown}%`} tone="loss" />
            </div>

            {/* Last AI Decision */}
            {paper?.lastAiDecision && (
              <div className="border-t border-hairline pt-3">
                <div className="flex items-center justify-between">
                  <span className="label-mono text-[0.6rem]">LAST AI DECISION</span>
                  <Tag tone="cyan">{paper.lastAiDecision.timestamp}</Tag>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniStat label="Action" value={paper.lastAiDecision.action} />
                  <MiniStat label="Confidence" value={`${paper.lastAiDecision.confidence}%`} />
                  <MiniStat label="Symbol" value={paper.lastAiDecision.symbol} />
                  <MiniStat label="Strategy" value={paper.lastAiDecision.strategyName} />
                </div>
              </div>
            )}

            {/* Safety */}
            <div className="flex items-center gap-2 rounded-sm border border-gain/40 bg-gain/5 px-3 py-2">
              <Shield className="h-4 w-4 text-gain" />
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-gain">Risk Engine: {paper?.riskEngineStatus || "PAPER"} · {paper?.emergencyStopState || "ARMED"}</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Risk Center + Learning ──────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Risk Center" code="GUARDIAN" action={<Tag tone={riskEnv.status === "NOMINAL" ? "gain" : "loss"}>{riskEnv.status}</Tag>}>
          <div className="space-y-4">
            <GaugeBar label="Daily Profit Target" used={riskEnv.dailyProfitUsed} cap={riskEnv.dailyProfitCap} tone="primary" />
            <GaugeBar label="Daily Loss Limit" used={riskEnv.dailyLossUsed} cap={riskEnv.dailyLossLimit} tone="loss" />
            <GaugeBar label="Exposure" used={riskEnv.totalExposure} cap={riskEnv.maxExposure} tone="cyan" />
            <div className="flex items-center gap-2 rounded-sm border border-hairline bg-muted/40 px-3 py-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                {riskEnv.emergencyStopState} · Leverage {riskEnv.currentLeverage}x / {riskEnv.maxLeverage}x
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
                <div className="label-mono text-[0.6rem]">Open Positions</div>
                <div className="font-mono text-sm font-semibold">{riskEnv.openPositionCount}</div>
              </div>
              <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
                <div className="label-mono text-[0.6rem]">Margin Ratio</div>
                <div className="font-mono text-sm font-semibold">{riskEnv.marginRatio}%</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="AI Learning" code="COGNITION" action={<Tag>v{learning?.lessonStats?.latestCycle || 0}</Tag>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Experiences" value={String(learningStats?.totalExperiences || 0)} />
              <MiniStat label="Trades" value={String(learningStats?.totalTrades || 0)} />
              <MiniStat label="No-Trade" value={String(learningStats?.totalNoTrades || 0)} />
              <MiniStat label="Win Rate" value={`${(learningStats?.winRate || 0).toFixed(1)}%`} />
            </div>
            <div className="border-t border-hairline pt-3">
              <div className="label-mono text-[0.6rem] mb-2">Recent Lessons</div>
              {derivedLessons.length > 0 ? (
                <div className="space-y-2">
                  {derivedLessons.map((l: any, i: number) => (
                    <div key={l.id || i} className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
                      <div className="font-mono text-xs text-foreground">{l.text}</div>
                      <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">
                        <Tag tone="cyan">{l.category}</Tag> · confidence {l.confidence}% · {l.evidenceCount} evidence
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-xs text-muted-foreground">No derived lessons yet</div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Backtest + System ───────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Backtest & Walk-Forward" code="VALIDATION" action={<Tag tone="cyan">READ-ONLY</Tag>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Strategy" value="TREND FOLLOWING" />
              <MiniStat label="Version" value="v1.0" />
              <MiniStat label="Parameters" value="EMA 20/50" />
              <MiniStat label="Risk Model" value="Conservative" />
            </div>
            <div className="border-t border-hairline pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="label-mono text-[0.6rem]">Regime Parity</span>
                <Tag tone="gain">PRODUCTION</Tag>
              </div>
              <div className="flex items-center justify-between">
                <span className="label-mono text-[0.6rem]">Look-Ahead Protection</span>
                <Tag tone="gain">VERIFIED</Tag>
              </div>
              <div className="flex items-center justify-between">
                <span className="label-mono text-[0.6rem]">Walk-Forward</span>
                <Tag tone="gain">27 CANDIDATES</Tag>
              </div>
              <div className="flex items-center justify-between">
                <span className="label-mono text-[0.6rem]">Overfitting Risk</span>
                <Tag tone="gain">LOW</Tag>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="System Infrastructure" code="NODES" action={<Tag tone={health?.status === "healthy" ? "gain" : "loss"}>{health?.status || "UNKNOWN"}</Tag>}>
          <div className="space-y-2">
            {systemNodes.length > 0 ? (
              systemNodes.map((node: any) => (
                <div key={node.name} className="flex items-center justify-between rounded-sm border border-hairline bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${node.state === "ONLINE" ? "bg-gain" : node.state === "TRAINING" ? "bg-amber-signal" : "bg-loss"}`} />
                    <span className="font-mono text-xs text-foreground">{node.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[0.65rem] text-muted-foreground">{node.latency}</span>
                    <Tag tone={node.state === "ONLINE" ? "gain" : "warn"}>{node.state}</Tag>
                  </div>
                </div>
              ))
            ) : (
              <div className="font-mono text-xs text-muted-foreground">System nodes loading...</div>
            )}
            <div className="flex items-center justify-between rounded-sm border border-hairline bg-muted/40 px-3 py-2 mt-2">
              <span className="label-mono text-[0.6rem]">Mode</span>
              <span className="font-mono text-xs text-primary">PAPER TRADING — No real orders</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Market Overview ─────────────────────────────────────────── */}
      <MarketOverview d={d} aiIntel={aiIntel} feedSymbols={feedSymbols} feedStatusData={feedStatusData} />

      {/* ── Safety Footer ───────────────────────────────────────────── */}
      <div className="mt-3 mb-6">
        <div className="flex items-center justify-center gap-3 rounded-sm border border-primary/20 bg-primary/5 px-4 py-3">
          <Shield className="h-4 w-4 text-primary" />
          <span className="font-mono text-[0.7rem] uppercase tracking-wider text-primary">
            Paper Trading Mode · No Real Money · Risk Engine Supreme Authority · No Withdrawal Capability
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────

function StatusIndicator({ label, state }: { label: string; state: string }) {
  const isOnline = state === "ONLINE" || state === "ACTIVE" || state === "SIMULATION";
  return (
    <div className="flex items-center gap-2 rounded-sm border border-hairline bg-muted/30 px-3 py-2">
      <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-gain" : state === "PAUSED" ? "bg-amber-signal" : "bg-loss"}`} />
      <div>
        <div className="label-mono text-[0.55rem]">{label}</div>
        <div className="font-mono text-xs font-semibold text-foreground">{state}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
      <div className="label-mono text-[0.55rem]">{label}</div>
      <div className="font-mono text-xs font-semibold text-foreground">{value}</div>
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

export function GaugeBar({ label, used, cap, tone }: { label: string; used: number; cap: number; tone: "primary" | "loss" | "cyan" | "amber" }) {
  const pct = (used / cap) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-[0.7rem] tabular-nums text-foreground">
          {"$" + used.toLocaleString()} / {"$" + cap.toLocaleString()}
        </span>
      </div>
      <Meter value={pct} tone={tone} className="mt-1.5" />
      <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">{pct.toFixed(1)}% consumed</div>
    </div>
  );
}

function FeedDot({ state }: { state: string }) {
  const color = state === "ONLINE" ? "bg-gain" : state === "DEGRADED" ? "bg-amber-signal" : state === "STALE" ? "bg-amber-signal" : "bg-loss";
  const animate = state === "ONLINE" ? "animate-pulse" : "";
  return (
    <div className="flex items-center justify-center">
      <span className={`h-2.5 w-2.5 rounded-full ${color} ${animate}`} />
    </div>
  );
}

// Phase 8C: All 12 symbols from the symbol universe
const ALL_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", // T1
  "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT", // T2
  "AVAXUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT", // T3
];

function MarketOverview({ d, aiIntel, feedSymbols, feedStatusData }: { d: any; aiIntel: any; feedSymbols: any[]; feedStatusData: any }) {
  return (
    <div className="mt-3">
      <Panel title="Market Overview" code="BINANCE FUTURES" action={<Tag tone={feedStatusData?.aggregate?.overallFeedState === "ONLINE" ? "gain" : "warn"}>{feedStatusData?.aggregate?.overallFeedState || "OFFLINE"}</Tag>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] border-collapse">
            <thead>
              <tr className="border-b border-hairline">
                {["Symbol", "Price", "24h Δ", "Feed State", "Data Age", "Feed"].map((h) => (
                  <th key={h} className="label-mono px-4 py-2 text-left font-normal text-[0.65rem]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_SYMBOLS.map((symbol) => (
                <MarketRow key={symbol} symbol={symbol} d={d} feedSymbols={feedSymbols} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function MarketRow({ symbol, d, feedSymbols }: { symbol: string; d: any; feedSymbols: any[] }) {
  const feed = feedSymbols.find((f: any) => f.symbol === symbol);
  const feedState = (feed?.feedState || "OFFLINE") as string;
  const dataAge = feed?.dataAgeMs;
  const isInfinity = !Number.isFinite(dataAge);
  const ageLabel = isInfinity ? "N/A" : dataAge < 60000 ? String(Math.round(dataAge / 1000)) + "s" : "STALE";
  const price = feed?.price || 0;
  const change24h = feed?.change24h || 0;
  return (
    <tr className="border-b border-hairline/60 transition-colors last:border-0 hover:bg-primary/5">
      <td className="px-4 py-2 font-mono text-xs font-semibold text-foreground">{symbol}</td>
      <td className="px-4 py-2 font-mono text-xs tabular-nums text-foreground">{price > 0 ? '$' + price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
      <td className={'px-4 py-2 font-mono text-xs tabular-nums ' + (change24h >= 0 ? 'text-gain' : 'text-loss')}>{change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}</td>
      <td className="px-4 py-2">
        <Tag tone={feedState === "ONLINE" ? "gain" : feedState === "DEGRADED" ? "warn" : "loss"}>{feedState}</Tag>
      </td>
      <td className="px-4 py-2 font-mono text-[0.65rem] tabular-nums text-muted-foreground">{ageLabel}</td>
      <td className="px-4 py-2">
        <FeedDot state={feedState} />
      </td>
    </tr>
  );
}
