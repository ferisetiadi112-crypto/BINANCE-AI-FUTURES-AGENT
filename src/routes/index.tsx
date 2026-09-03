import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  CircleAlert,
  Clock,
  Cpu,
  Database,
  Gauge,
  Radio,
  Search,
  Shield,
  Target,
  TrendingUp,
  Wallet,
  Zap,
  Filter,
  ArrowRight,
  Lock,
  Unlock,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Timer,
  X,
} from "lucide-react";
import { PageHeader, Panel, Stat, Tag } from "@/components/space/Panel";
import {
  fetchTestnetStatus,
  fetchRuntime,
  fetchSystem,
  fetchHealth,
  fetchJournal,
  fetchReviews,
  fetchOrchestratorData,
} from "@/api/client";
import type { JournalEventType, JournalImportance } from "@/backend/journal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Deck — Orbital AI Futures Dashboard" },
      {
        name: "description",
        content:
          "Real-time AI trading agent monitoring — Binance Testnet account, positions, orders, PnL, risk state, and AI Decision Journal.",
      },
      { property: "og:title", content: "Command Deck — Orbital AI Futures Dashboard" },
    ],
  }),
  component: Dashboard,
});

// ─── Helpers ────────────────────────────────────────────────────────

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const JOURNAL_CATEGORIES: Record<string, string[]> = {
  AI: ["SYSTEM_STARTED", "SYSTEM_STOPPED", "PERIODIC_REPORT"],
  MARKET: ["MARKET_SCAN", "RESEARCH", "ANALYSIS"],
  RISK: ["RISK_CHECK", "RISK_LOCKED", "COOLDOWN_STARTED", "DAILY_LOSS_LIMIT", "PROFIT_TARGET_REACHED", "HARD_PROFIT_CAP"],
  TRADE: ["TRADE_PROPOSED", "TRADE_APPROVED", "TRADE_REJECTED", "TRADE_OPENED", "TRADE_CLOSED", "POST_TRADE_REVIEW"],
  POSITION: ["POSITION_OPENED", "POSITION_CLOSED", "POSITION_MONITOR", "STOP_LOSS", "TAKE_PROFIT", "ORDER_SUBMITTED", "ORDER_CONFIRMED"],
  SYSTEM: ["STARTUP_RECONCILIATION", "PNL_UPDATED"],
  ERROR: [],
};

const EVENT_ICONS: Record<string, typeof Shield> = {
  SYSTEM_STARTED: Zap,
  SYSTEM_STOPPED: XCircle,
  MARKET_SCAN: Target,
  RISK_CHECK: Shield,
  RISK_LOCKED: Lock,
  TRADE_PROPOSED: ArrowRight,
  TRADE_APPROVED: CheckCircle2,
  TRADE_REJECTED: XCircle,
  TRADE_OPENED: TrendingUp,
  TRADE_CLOSED: TrendingUp,
  ORDER_SUBMITTED: ArrowRight,
  ORDER_CONFIRMED: CheckCircle2,
  POSITION_OPENED: TrendingUp,
  POSITION_CLOSED: TrendingUp,
  POSITION_MONITOR: Activity,
  STOP_LOSS: AlertTriangle,
  TAKE_PROFIT: Target,
  COOLDOWN_STARTED: Timer,
  DAILY_LOSS_LIMIT: Lock,
  HARD_PROFIT_CAP: Lock,
  PERIODIC_REPORT: Radio,
  STARTUP_RECONCILIATION: Database,
  PNL_UPDATED: Activity,
  POST_TRADE_REVIEW: BrainCircuit,
};

const IMPORTANCE_TONE: Record<string, "gain" | "loss" | "warn" | "cyan" | "default"> = {
  LOW: "default",
  MEDIUM: "cyan",
  HIGH: "warn",
  CRITICAL: "loss",
};

// ─── Dashboard ──────────────────────────────────────────────────────

function Dashboard() {
  const { data: testnetResp } = useQuery({
    queryKey: ["testnet-status"],
    queryFn: fetchTestnetStatus,
    refetchInterval: 10_000,
  });
  const { data: runtimeResp } = useQuery({
    queryKey: ["runtime"],
    queryFn: fetchRuntime,
    refetchInterval: 15_000,
  });
  const { data: systemResp } = useQuery({
    queryKey: ["system"],
    queryFn: fetchSystem,
  });
  const { data: healthResp } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });
  const { data: journalResp } = useQuery({
    queryKey: ["journal"],
    queryFn: fetchJournal,
    refetchInterval: 5_000,
  });
  const { data: reviewsResp } = useQuery({
    queryKey: ["reviews"],
    queryFn: fetchReviews,
    refetchInterval: 30_000,
  });
  const { data: orchResp } = useQuery({
    queryKey: ["orchestrator"],
    queryFn: fetchOrchestratorData,
    refetchInterval: 10_000,
  });

  const testnet = testnetResp?.data;
  const runtime = runtimeResp?.data;
  const system = systemResp?.data;
  const health = healthResp?.data;
  const journal = journalResp?.data;
  const reviews = reviewsResp?.data;
  const orch = orchResp?.data;
  const riskState = orch?.account?.riskState;
  const account = orch?.account?.binanceAccount;
  const aiAllocation = orch?.account?.aiAllocation;
  const positions = orch?.account?.openPositions || [];
  const events: JournalEvent[] = journal?.events || [];
  const aiReviews = reviews?.reviews || [];

  const isConnected = testnet?.connected;
  const executionMode = orch?.executionMode || "PAPER";

  // ── Loading state ──
  if (!orch && !runtime) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="Sector 07 · Command Deck" title="Loading..." desc="Connecting to trading system..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
          <span className="ml-3 font-mono text-sm text-muted-foreground">Initializing systems...</span>
        </div>
      </div>
    );
  }

  const systemStatus = riskState?.isLocked
    ? riskState.hardCapReached
      ? "LOCKED"
      : riskState.cooldownActive
        ? "COOLDOWN"
        : "LOCKED"
    : orch?.running
      ? "AI ACTIVE"
      : "OFFLINE";

  const runtimeEvents = runtime?.recentEvents || [];
  const lastEvent = runtimeEvents[runtimeEvents.length - 1];
  const aiActivity = lastEvent?.executionResult === "TESTNET_EXECUTED"
    ? "TRADING"
    : lastEvent?.executionResult === "REJECTED"
      ? "RISK REJECTED"
      : lastEvent?.executionResult === "NO_TRADE"
        ? "MONITORING"
        : orch?.running
          ? "ANALYZING"
          : "IDLE";

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="Sector 07 · Command Deck"
        title="AI Futures Trading Observatory"
        desc={
          executionMode === "TESTNET"
            ? "BINANCE FUTURES TESTNET — Real account data from Binance Testnet"
            : "PAPER TRADING MODE — Simulated data"
        }
        right={
          <div className="panel corner-ticks flex items-center gap-3 px-4 py-2.5">
            <span className={`pulse-dot h-2 w-2 rounded-full ${isConnected ? "bg-gain" : "bg-loss"}`} />
            <div>
              <div className="label-mono">System Status</div>
              <div className={`font-mono text-sm font-semibold ${systemStatus === "AI ACTIVE" ? "text-gain glow-text" : systemStatus === "COOLDOWN" ? "text-amber-signal" : systemStatus === "LOCKED" ? "text-loss" : "text-muted-foreground"}`}>
                {systemStatus}
              </div>
            </div>
            <div className="ml-3 border-l border-hairline pl-3">
              <div className="label-mono">Mode</div>
              <div className={`font-mono text-sm ${executionMode === "TESTNET" ? "text-gain" : "text-primary"}`}>
                {executionMode}
              </div>
            </div>
          </div>
        }
      />

      {/* ── System Status Bar ───────────────────────────────────────── */}
      <Panel title="System Status" code="OBSERVATORY" glow>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatusIndicator label="Binance Testnet" state={isConnected ? "CONNECTED" : "OFFLINE"} />
          <StatusIndicator label="Database" state={health?.status === "healthy" ? "NEON POSTGRESQL" : "OFFLINE"} />
          <StatusIndicator label="AI Engine" state={orch?.running ? "ACTIVE" : "INACTIVE"} />
          <StatusIndicator label="Risk Engine" state={riskState?.isLocked ? "LOCKED" : "PROTECTED"} />
          <StatusIndicator label="Journal" state="ACTIVE" />
          <StatusIndicator label="Execution" state={executionMode} />
        </div>
        {riskState?.isLocked && (
          <div className="mt-3 flex items-center gap-3 rounded-sm border border-loss/40 bg-loss/5 px-4 py-2">
            <Lock className="h-4 w-4 text-loss" />
            <div>
              <span className="font-mono text-xs font-semibold text-loss">
                {riskState.hardCapReached ? "HARD PROFIT CAP REACHED" : riskState.cooldownActive ? "COOLDOWN ACTIVE" : "TRADING LOCKED"}
              </span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {riskState.lockReason || "Unknown reason"}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Account Overview + AI Allocation ────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Testnet Account" code="BINANCE FUTURES" glow action={<Tag tone={isConnected ? "gain" : "loss"}>{isConnected ? "CONNECTED" : "OFFLINE"}</Tag>}>
          {account ? (
            <div className="space-y-3">
              <Stat label="Wallet Balance" value={money(account.balance)} icon={<Wallet className="h-4 w-4" />} />
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Available Balance" value={money(account.availableBalance)} />
                <MiniStat label="Margin Balance" value={money(account.marginBalance)} />
                <MiniStat label="Unrealized PnL" value={money(account.unrealizedPnl)} tone={account.unrealizedPnl >= 0 ? "gain" : "loss"} />
                {account?.realizedPnl != null ? (
                  <MiniStat label="Realized PnL" value={money(account.realizedPnl)} tone={account.realizedPnl >= 0 ? "gain" : "loss"} />
                ) : (
                  <MiniStat label="Realized PnL" value="—" />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Database className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <div className="font-mono text-sm text-muted-foreground">
                {isConnected ? "Account data loading..." : "BINANCE TESTNET OFFLINE"}
              </div>
              <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
                {isConnected ? "Waiting for first data fetch" : "Configure Testnet credentials in Settings"}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="AI Capital Allocation" code="$10 USDT MAX" glow>
          {aiAllocation ? (
            aiAllocation.accountAvailable ? (
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="label-mono">AI Allocation Limit (hard max)</div>
                    <div className="mt-1 font-mono text-3xl font-semibold text-primary glow-text">
                      {money(aiAllocation.limit)}
                    </div>
                  </div>
                  <BrainCircuit className="h-6 w-6 text-primary/60" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Effective Allocation" value={money(aiAllocation.effectiveAllocation)} tone="gain" />
                  <MiniStat label="Allocated" value={money(aiAllocation.allocated)} />
                  <MiniStat label="Remaining" value={money(aiAllocation.available)} tone="gain" />
                  <MiniStat label="Account Source" value="BINANCE TESTNET" />
                </div>
                <GaugeBar
                  label="Allocated"
                  used={aiAllocation.allocated}
                  cap={aiAllocation.effectiveAllocation}
                  tone="primary"
                />
                <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
                  <span className="font-mono text-[0.65rem] text-muted-foreground">
                    Effective allocation = min(Binance Futures available balance, ${aiAllocation.limit}). This is the AI trading limit, NOT the wallet balance.
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BrainCircuit className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <div className="font-mono text-sm text-muted-foreground">ALLOCATION DATA UNAVAILABLE</div>
                <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
                  Binance Futures Testnet account state unavailable — effective allocation is $0.00 (fail closed). No simulated balance is substituted.
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <BrainCircuit className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <div className="font-mono text-sm text-muted-foreground">Allocation data loading...</div>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Active Position ─────────────────────────────────────────── */}
      <div className="mt-3">
        <Panel
          title="Active Position"
          code={positions.length > 0 ? "OPEN" : "NONE"}
          action={positions.length > 0 ? <Tag tone="gain">OPEN</Tag> : undefined}
          glow={positions.length > 0}
        >
          {positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-hairline">
                    {["Symbol", "Side", "Size", "Entry", "Mark", "Margin", "Leverage", "Margin Mode", "Unrealized PnL"].map((h) => (
                      <th key={h} className="label-mono px-3 py-2 text-left font-normal text-[0.65rem]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p: any, i: number) => (
                    <tr key={`${p.symbol}-${i}`} className="border-b border-hairline/60 hover:bg-primary/5">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-foreground">{p.symbol}</td>
                      <td className="px-3 py-2">
                        <Tag tone={p.side === "LONG" ? "gain" : "violet"}>{p.side}</Tag>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{p.size}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-foreground">{money(p.entryPrice)}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-foreground">{money(p.markPrice)}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-foreground">{money(p.margin)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{p.leverage}x</td>
                      <td className="px-3 py-2">
                        <Tag tone={p.marginType === "isolated" ? "gain" : p.marginType === "cross" ? "loss" : "violet"}>
                          {p.marginType === "isolated" ? "ISOLATED" : p.marginType === "cross" ? "CROSS" : "—"}
                        </Tag>
                      </td>
                      <td className={`px-3 py-2 font-mono text-xs tabular-nums font-semibold ${p.unrealizedPnl >= 0 ? "text-gain" : "text-loss"}`}>
                        {money(p.unrealizedPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-6 text-center">
              <div>
                <div className="font-mono text-sm text-muted-foreground">NO ACTIVE POSITION</div>
                <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">AI is monitoring market conditions</div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Risk State + AI Activity ────────────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Risk State" code="GUARDIAN" action={<Tag tone={riskState?.isLocked ? "loss" : "gain"}>{riskState?.isLocked ? "LOCKED" : "PROTECTED"}</Tag>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Session PnL" value={money(riskState?.sessionPnl || 0)} tone={(riskState?.sessionPnl || 0) >= 0 ? "gain" : "loss"} />
              <MiniStat label="Daily PnL" value={money(riskState?.dailyPnl || 0)} tone={(riskState?.dailyPnl || 0) >= 0 ? "gain" : "loss"} />
              <MiniStat label="Session Target" value="+$0.50" />
              <MiniStat label="Hard Cap" value="+$2.00" />
              <MiniStat label="Max Loss/Trade" value="$1.00" />
              <MiniStat label="Max Leverage" value="20x" />
              <MiniStat label="Max Positions" value="1" />
              <MiniStat label="Daily Loss Limit" value="-$2.00" />
            </div>
            {riskState?.cooldownActive && (
              <div className="rounded-sm border border-amber-signal/40 bg-amber-signal/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-amber-signal" />
                  <div>
                    <div className="font-mono text-xs font-semibold text-amber-signal">COOLDOWN ACTIVE</div>
                    {riskState.cooldownEndsAt && (
                      <div className="font-mono text-[0.65rem] text-muted-foreground">
                        Expires: {new Date(riskState.cooldownEndsAt).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="AI Current Activity" code="LIVE" glow action={<Tag tone="cyan">{aiActivity}</Tag>}>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-sm border border-primary/30 bg-primary/5 px-4 py-3">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <div>
                <div className="font-mono text-sm font-semibold text-primary">{aiActivity}</div>
                <div className="font-mono text-[0.65rem] text-muted-foreground">
                  {lastEvent
                    ? `Last event: ${lastEvent.symbol} (${fmtTime(lastEvent.timestamp)})`
                    : "Waiting for events..."}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Execution Mode" value={executionMode} />
              <MiniStat label="Testnet Ready" value={orch?.testnetReady ? "YES" : "NO"} />
              <MiniStat label="Runtime Tick" value={String(runtime?.stats?.tickCount || 0)} />
              <MiniStat label="Processed" value={String(runtime?.stats?.totalProcessed || 0)} />
            </div>
          </div>
        </Panel>
      </div>

      {/* ── AI Decision Journal ──────────────────────────────────────── */}
      <div className="mt-3">
        <JournalPanel events={events} />
      </div>

      {/* ── Last AI Decision + Last Trade ─────────────────────────── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Last AI Decision" code="DECISION">
          {runtimeEvents.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-sm border border-hairline bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <Tag tone={lastEvent?.executionResult === "TESTNET_EXECUTED" ? "gain" : lastEvent?.executionResult === "REJECTED" ? "loss" : "default"}>
                    {lastEvent?.executionResult || "PENDING"}
                  </Tag>
                  <span className="font-mono text-[0.65rem] text-muted-foreground">{fmtTime(lastEvent?.timestamp || 0)}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniStat label="Symbol" value={lastEvent?.symbol || "—"} />
                  <MiniStat label="Decision" value={lastEvent?.decision || "—"} />
                  <MiniStat label="Confidence" value={lastEvent?.confidence ? `${(lastEvent.confidence * 100).toFixed(1)}%` : "—"} />
                  <MiniStat label="Strategy" value={lastEvent?.strategy || "—"} />
                  <MiniStat label="Risk" value={lastEvent?.riskApproved ? "APPROVED" : "REJECTED"} tone={lastEvent?.riskApproved ? "gain" : "loss"} />
                  <MiniStat label="Reason" value={lastEvent?.riskReason || "—"} />
                </div>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center font-mono text-sm text-muted-foreground">No decisions yet</div>
          )}
        </Panel>

        <Panel title="Post-Trade Reviews" code="REVIEWS">
          {aiReviews.length > 0 ? (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {aiReviews.slice(-5).reverse().map((r: any, i: number) => (
                <div key={r.tradeId || i} className="rounded-sm border border-hairline bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tag tone={r.side === "LONG" ? "gain" : "violet"}>{r.side}</Tag>
                      <span className="font-mono text-xs font-semibold text-foreground">{r.symbol}</span>
                    </div>
                    <span className={`font-mono text-xs tabular-nums font-semibold ${r.realizedPnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {money(r.realizedPnl)}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[0.65rem] text-muted-foreground">{r.potentialLesson}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center font-mono text-sm text-muted-foreground">No reviews yet</div>
          )}
        </Panel>
      </div>

      {/* ── Connection Status ────────────────────────────────────────── */}
      <div className="mt-3 mb-6">
        <div className="flex flex-wrap items-center justify-center gap-4 rounded-sm border border-primary/20 bg-primary/5 px-4 py-3">
          <ConnectionDot label="Binance Testnet" connected={!!isConnected} />
          <ConnectionDot label="Database" connected={health?.status === "healthy"} />
          <ConnectionDot label="AI Engine" connected={!!orch?.running} />
          <ConnectionDot label="Risk Engine" connected={!riskState?.isLocked || true} />
          <ConnectionDot label="Journal" connected={true} />
        </div>
      </div>
    </div>
  );
}

// ─── Journal Panel ──────────────────────────────────────────────────

function JournalPanel({ events }: { events: JournalEvent[] }) {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [importanceFilter, setImportanceFilter] = useState<string>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(events.length);

  useEffect(() => {
    if (events.length > prevLenRef.current) {
      if (!autoScroll) {
        setNewCount((c) => c + (events.length - prevLenRef.current));
      }
    }
    prevLenRef.current = events.length;
  }, [events.length, autoScroll]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setNewCount(0);
    }
  }, [events.length, autoScroll]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filter !== "ALL") {
        const categoryEvents = JOURNAL_CATEGORIES[filter] || [];
        if (categoryEvents.length > 0 && !categoryEvents.includes(e.eventType)) return false;
      }
      if (importanceFilter !== "ALL" && e.importance !== importanceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = `${e.eventType} ${e.message} ${e.symbol || ""} ${e.tradeId || ""}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [events, filter, search, importanceFilter]);

  return (
    <Panel
      title="AI Decision Journal"
      code="LIVE"
      glow
      action={
        <div className="flex items-center gap-2">
          <Tag tone="cyan">LIVE FEED</Tag>
          <Tag>{events.length} events</Tag>
        </div>
      }
    >
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-hairline pb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search journal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-sm border border-hairline bg-muted/30 py-1.5 pl-8 pr-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {["ALL", "AI", "MARKET", "RISK", "TRADE", "POSITION", "SYSTEM", "ERROR"].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded-sm px-2 py-1 font-mono text-[0.6rem] uppercase tracking-wider transition-colors ${
                filter === cat
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <select
          value={importanceFilter}
          onChange={(e) => setImportanceFilter(e.target.value)}
          className="rounded-sm border border-hairline bg-muted/30 px-2 py-1 font-mono text-[0.6rem] text-foreground"
        >
          <option value="ALL">All importance</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
      </div>

      {/* New events indicator */}
      {newCount > 0 && !autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            setNewCount(0);
          }}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/10 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20"
        >
          <ArrowDownRight className="h-3 w-3" />
          {newCount} new event{newCount > 1 ? "s" : ""} — click to scroll to latest
        </button>
      )}

      {/* Events */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          setAutoScroll(atBottom);
        }}
        className="max-h-[500px] space-y-1 overflow-y-auto"
      >
        {filteredEvents.length > 0 ? (
          filteredEvents.map((event) => <JournalEntry key={event.id} event={event} />)
        ) : (
          <div className="py-8 text-center">
            <div className="font-mono text-sm text-muted-foreground">
              {events.length === 0 ? "No journal events yet" : "No events match filters"}
            </div>
            <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
              {events.length === 0 ? "Events will appear as the AI processes market data" : "Try adjusting filters"}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function JournalEntry({ event }: { event: JournalEvent }) {
  const Icon = EVENT_ICONS[event.eventType] || Activity;
  const tone = IMPORTANCE_TONE[event.importance] || "default";
  return (
    <div className="flex gap-3 rounded-sm border border-hairline/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-primary/5">
      <div className="flex-shrink-0 pt-0.5">
        <Icon className={`h-4 w-4 ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "warn" ? "text-amber-signal" : tone === "cyan" ? "text-cyan-400" : "text-muted-foreground"
        }`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.6rem] text-muted-foreground">{fmtTime(event.timestamp)}</span>
          <Tag tone={tone}>{event.importance}</Tag>
          <span className="font-mono text-[0.6rem] text-primary">{event.eventType}</span>
          {event.symbol && <span className="font-mono text-[0.6rem] text-foreground">{event.symbol}</span>}
        </div>
        <div className="mt-0.5 font-mono text-xs text-foreground leading-relaxed">{event.message}</div>
        {event.riskDecision && (
          <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">
            Risk: {event.riskDecision.approved ? "APPROVED" : "REJECTED"} — {event.riskDecision.reason}
          </div>
        )}
        {event.details && (
          <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground/70">
            {JSON.stringify(event.details).slice(0, 120)}
            {JSON.stringify(event.details).length > 120 ? "..." : ""}
          </div>
        )}
      </div>
      {event.tradeId && (
        <div className="flex-shrink-0">
          <span className="font-mono text-[0.55rem] text-muted-foreground/50">{event.tradeId}</span>
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────────

function StatusIndicator({ label, state }: { label: string; state: string }) {
  const isOk = state === "CONNECTED" || state === "ACTIVE" || state === "NEON POSTGRESQL" || state === "PROTECTED" || state === "PAPER" || state === "TESTNET";
  return (
    <div className="flex items-center gap-2 rounded-sm border border-hairline bg-muted/30 px-3 py-2">
      <span className={`h-2 w-2 rounded-full ${isOk ? "bg-gain" : state === "LOCKED" || state === "COOLDOWN" ? "bg-amber-signal" : state === "INACTIVE" || state === "OFFLINE" ? "bg-loss" : "bg-gain"}`} />
      <div>
        <div className="label-mono text-[0.55rem]">{label}</div>
        <div className="font-mono text-xs font-semibold text-foreground">{state}</div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
      <div className="label-mono text-[0.55rem]">{label}</div>
      <div className={`font-mono text-xs font-semibold ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function GaugeBar({ label, used, cap, tone }: { label: string; used: number; cap: number; tone: "primary" | "loss" | "cyan" }) {
  const pct = cap > 0 ? Math.min((used / cap) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-[0.7rem] tabular-nums text-foreground">
          {money(used)} / {money(cap)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div
          className={`h-full rounded-full transition-all ${
            tone === "primary" ? "bg-primary" : tone === "loss" ? "bg-loss" : "bg-cyan-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 font-mono text-[0.6rem] text-muted-foreground">{pct.toFixed(1)}% consumed</div>
    </div>
  );
}

function ConnectionDot({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-gain animate-pulse" : "bg-loss"}`} />
      <span className="font-mono text-[0.65rem] text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── Local Journal Event type (matches backend) ────────────────────

type JournalEvent = {
  id: string;
  timestamp: number;
  eventType: string;
  importance: string;
  symbol?: string;
  message: string;
  action?: string;
  pnl?: number;
  position?: { symbol: string; side: string; entryPrice: number; margin: number; leverage: number };
  riskDecision?: { approved: boolean; reason: string; checks?: Array<{ name: string; passed: boolean; message: string }> };
  reasoning?: string;
  tradeId?: string;
  decisionId?: string;
  details?: Record<string, unknown>;
};
