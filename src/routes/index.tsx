import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Database,
  Gauge,
  Lock,
  Radio,
  Search,
  Shield,
  Target,
  TrendingUp,
  Zap,
  XCircle,
  AlertTriangle,
  Timer,
  X,
} from "lucide-react";
import { PageHeader, Panel, Tag } from "@/components/space/Panel";
import {
  fetchTestnetStatus,
  fetchRuntime,
  fetchSystem,
  fetchHealth,
  fetchJournal,
  fetchReviews,
  fetchOrchestratorData,
} from "@/api/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Futures Trading Observatory — Orbital AI Command Center" },
      {
        name: "description",
        content:
          "AI futures trading observatory — Binance Futures Testnet command center with real-time positions, risk state, and AI intelligence.",
      },
      { property: "og:title", content: "AI Futures Trading Observatory — Orbital AI Command Center" },
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

// ─── Position State Type ────────────────────────────────────────────

type PositionState = "LOADING" | "NO_POSITION" | "LONG" | "SHORT" | "ERROR";

// ─── Dashboard ──────────────────────────────────────────────────────

function Dashboard() {
  const { data: testnetResp, isError: testnetError } = useQuery({
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
  const health = healthResp?.data;
  const journal = journalResp?.data;
  const reviews = reviewsResp?.data;
  const orch = orchResp?.data;
  const riskState = orch?.account?.riskState;
  const account = orch?.account?.binanceAccount;
  const positions = orch?.account?.openPositions || [];
  const events: JournalEvent[] = journal?.events || [];
  const aiReviews = reviews?.reviews || [];

  const isConnected = testnet?.connected;
  const executionMode = orch?.executionMode || "PAPER";
  const aiRunning = !!orch?.running;

  // ── Determine position state ──
  let positionState: PositionState = "LOADING";
  if (testnetError || (testnetResp && !testnet)) {
    positionState = "ERROR";
  } else if (testnetResp) {
    // We have testnet data — check positions
    if (positions.length > 0) {
      positionState = positions[0].side === "LONG" ? "LONG" : "SHORT";
    } else if (testnet.connected) {
      positionState = "NO_POSITION";
    } else {
      positionState = "NO_POSITION";
    }
  }

  const firstPosition = positions[0] || null;

  // ── Loading state ──
  if (!orch && !runtime) {
    return (
      <div className="mx-auto max-w-[110rem]">
        <PageHeader eyebrow="System · Observatory" title="Loading..." desc="Connecting to trading system..." />
        <div className="flex items-center justify-center py-20">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
          <span className="ml-3 font-mono text-sm text-muted-foreground">Initializing systems...</span>
        </div>
      </div>
    );
  }

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
        eyebrow="ORBITAL ·AI"
        title="AI Futures Trading Observatory"
        desc="BINANCE FUTURES TESTNET — AI COMMAND CENTER"
      />

      {/* ═══ A. CORE SYSTEM STATUS — Top priority ═══════════════════ */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Binance Futures Testnet */}
        <div className={`panel corner-ticks px-4 py-3 ${isConnected ? "panel-glow" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border ${
                isConnected
                  ? "border-gain/50 bg-gain/10"
                  : "border-loss/50 bg-loss/10"
              }`}>
                <Gauge className={`h-5 w-5 ${isConnected ? "text-gain" : "text-loss"}`} />
                {isConnected && <span className="pulse-dot absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-gain" />}
              </div>
              <div>
                <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                  BINANCE FUTURES TESTNET
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-gain shadow-[0_0_6px_oklch(0.8_0.18_158_/_60%)]" : "bg-loss"}`} />
                  <span className={`font-mono text-sm font-bold uppercase tracking-wider ${isConnected ? "text-gain glow-text" : "text-loss"}`}>
                    {isConnected ? "CONNECTED" : "OFFLINE"}
                  </span>
                </div>
              </div>
            </div>
            <Tag tone={isConnected ? "gain" : "loss"}>
              {executionMode}
            </Tag>
          </div>
        </div>

        {/* AI Engine */}
        <div className={`panel corner-ticks px-4 py-3 ${aiRunning ? "panel-glow" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border ${
                aiRunning
                  ? "border-primary/50 bg-primary/10"
                  : "border-loss/50 bg-loss/10"
              }`}>
                <BrainCircuit className={`h-5 w-5 ${aiRunning ? "text-primary" : "text-loss"}`} />
                {aiRunning && <span className="pulse-dot absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
              </div>
              <div>
                <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                  AI ENGINE
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${aiRunning ? "bg-gain shadow-[0_0_6px_oklch(0.8_0.18_158_/_60%)]" : "bg-loss"}`} />
                  <span className={`font-mono text-sm font-bold uppercase tracking-wider ${aiRunning ? "text-gain glow-text" : "text-loss"}`}>
                    {aiRunning ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
              </div>
            </div>
            <Tag tone={aiRunning ? "gain" : "loss"}>
              {aiActivity}
            </Tag>
          </div>
        </div>
      </div>

      {/* Risk Lock Banner */}
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

      {/* ═══ B. ACCOUNT / TRADING STATE ═════════════════════════════ */}
      <div className="mt-3">
        <Panel title="Account" code="BINANCE FUTURES" glow>
          {account ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Balance" value={money(account.balance)} />
                <MiniStat label="Available" value={money(account.availableBalance)} />
                <MiniStat label="Margin Used" value={money(account.marginBalance)} />
                <MiniStat
                  label="Unrealized PnL"
                  value={money(account.unrealizedPnl)}
                  tone={account.unrealizedPnl >= 0 ? "gain" : "loss"}
                />
              </div>
              <div className="flex items-center gap-3 border-t border-hairline pt-2">
                <Tag tone="gain">TESTNET</Tag>
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  Trading Mode: {executionMode} — AI has restricted allocation
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Database className="mb-2 h-6 w-6 text-muted-foreground/40" />
              <div className="font-mono text-xs text-muted-foreground">
                {isConnected ? "Account data loading..." : "BINANCE TESTNET OFFLINE"}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ═══ C. RISK STATE ═══════════════════════════════════════════ */}
      <div className="mt-3">
        <Panel title="Risk State" code="GUARDIAN" action={<Tag tone={riskState?.isLocked ? "loss" : "gain"}>{riskState?.isLocked ? "LOCKED" : "PROTECTED"}</Tag>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label="Risk Status" value={riskState?.isLocked ? "LOCKED" : "NOMINAL"} tone={riskState?.isLocked ? "loss" : "gain"} />
            <MiniStat label="Max Loss/Trade" value="$1.00" />
            <MiniStat label="Daily Loss Limit" value="-$2.00" />
            <MiniStat label="Max Leverage" value="20x" />
            <MiniStat label="Max Positions" value="1" />
            <MiniStat
              label="Daily PnL"
              value={money(riskState?.dailyPnl || 0)}
              tone={(riskState?.dailyPnl || 0) >= 0 ? "gain" : "loss"}
            />
          </div>
          {riskState?.cooldownActive && (
            <div className="mt-3 flex items-center gap-2 rounded-sm border border-amber-signal/40 bg-amber-signal/5 px-3 py-2">
              <Timer className="h-3.5 w-3.5 text-amber-signal" />
              <span className="font-mono text-xs font-semibold text-amber-signal">COOLDOWN ACTIVE</span>
              {riskState.cooldownEndsAt && (
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  Expires: {new Date(riskState.cooldownEndsAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ═══ D. ACTIVE POSITION ══════════════════════════════════════ */}
      <div className="mt-3">
        <ActivePositionPanel
          state={positionState}
          position={firstPosition}
          positionCount={positions.length}
          isConnected={isConnected}
          totalUnrealizedPnl={positions.reduce((a: number, p: any) => a + p.unrealizedPnl, 0)}
        />
      </div>

      {/* ═══ E. LAST AI DECISION ═════════════════════════════════════ */}
      <div className="mt-3">
        <Panel title="Last AI Decision" code="DECISION">
          {runtimeEvents.length > 0 ? (
            <div className="space-y-2">
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
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center font-mono text-sm text-muted-foreground">No decisions yet</div>
          )}
        </Panel>
      </div>

      {/* ═══ F. POST-TRADE REVIEWS ═══════════════════════════════════ */}
      <div className="mt-3">
        <Panel title="Post-Trade Reviews" code="REVIEWS">
          {aiReviews.length > 0 ? (
            <div className="max-h-[220px] space-y-2 overflow-y-auto">
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
                  <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{r.potentialLesson}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center font-mono text-sm text-muted-foreground">No reviews yet</div>
          )}
        </Panel>
      </div>

      {/* ═══ F. JOURNAL — Secondary lower section ═══════════════════ */}
      <div className="mt-3 mb-6">
        <JournalPanel events={events} />
      </div>
    </div>
  );
}

// ─── Active Position Panel ──────────────────────────────────────────

function ActivePositionPanel({
  state,
  position,
  positionCount,
  isConnected,
  totalUnrealizedPnl,
}: {
  state: PositionState;
  position: any | null;
  positionCount: number;
  isConnected: boolean | undefined;
  totalUnrealizedPnl: number;
}) {
  const isActive = state === "LONG" || state === "SHORT";

  return (
    <Panel
      title="Active Position"
      code={state === "LOADING" ? "LOADING" : state === "ERROR" ? "ERROR" : isActive ? "OPEN" : "NONE"}
      glow={isActive}
      action={
        state === "LOADING" ? (
          <Tag tone="cyan">LOADING</Tag>
        ) : isActive ? (
          <Tag tone="gain">OPEN</Tag>
        ) : state === "ERROR" ? (
          <Tag tone="loss">ERROR</Tag>
        ) : undefined
      }
    >
      {state === "LOADING" && (
        <div className="flex items-center justify-center py-6">
          <div className="pulse-dot h-4 w-4 rounded-full bg-primary" />
          <span className="ml-3 font-mono text-sm text-muted-foreground">Fetching Binance position data...</span>
        </div>
      )}

      {state === "ERROR" && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <AlertTriangle className="mb-2 h-6 w-6 text-loss" />
          <div className="font-mono text-sm font-semibold text-loss">DATA UNAVAILABLE</div>
          <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
            Unable to fetch position data from Binance Futures Testnet.
          </div>
        </div>
      )}

      {state === "NO_POSITION" && (
        <div className="flex items-center justify-center py-6 text-center">
          <div>
            <div className="font-mono text-sm font-semibold text-muted-foreground">NONE</div>
            <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
              No active position — AI is monitoring market conditions.
            </div>
          </div>
        </div>
      )}

      {isActive && position && (
        <div>
          {/* Position Header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`flex h-8 items-center justify-center rounded-sm px-3 font-mono text-sm font-bold ${
                state === "LONG"
                  ? "border border-gain/40 bg-gain/10 text-gain"
                  : "border border-violet-signal/40 bg-violet-signal/10 text-violet-signal"
              }`}>
                {state}
              </span>
              <span className="font-display text-lg font-bold text-foreground">{position.symbol}</span>
            </div>
            <div className={`font-mono text-lg font-bold tabular-nums ${totalUnrealizedPnl >= 0 ? "text-gain glow-text" : "text-loss"}`}>
              {money(totalUnrealizedPnl)}
            </div>
          </div>

          {/* Position Details */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label="Entry Price" value={money(position.entryPrice)} />
            <MiniStat label="Mark Price" value={money(position.markPrice)} />
            <MiniStat label="Size" value={String(position.size)} />
            <MiniStat label="Leverage" value={`${position.leverage}x`} />
            <MiniStat label="Margin" value={money(position.margin)} />
            <MiniStat
              label="Unrealized PnL"
              value={money(position.unrealizedPnl)}
              tone={position.unrealizedPnl >= 0 ? "gain" : "loss"}
            />
          </div>
          {positionCount > 1 && (
            <div className="mt-2 font-mono text-[0.65rem] text-muted-foreground">
              +{positionCount - 1} more position{positionCount > 2 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </Panel>
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
      code="LOGBOOK"
      action={
        <div className="flex items-center gap-2">
          <Tag tone="cyan">LIVE FEED</Tag>
          <Tag>{events.length} events</Tag>
        </div>
      }
    >
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-hairline pb-3">
        <div className="relative min-w-[180px] flex-1">
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
        className="max-h-[400px] space-y-1 overflow-y-auto"
      >
        {filteredEvents.length > 0 ? (
          filteredEvents.map((event) => <JournalEntry key={event.id} event={event} />)
        ) : (
          <div className="py-6 text-center">
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

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
      <div className="label-mono text-[0.55rem]">{label}</div>
      <div className={`font-mono text-xs font-semibold ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground"}`}>{value}</div>
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
