/**
 * DashboardView — AI Futures Trading Observatory (P7D-5.5)
 *
 * Pure, prop-driven presentation layer of the observatory dashboard.
 * Every card receives an explicit UiPhase (LOADING/READY/DEGRADED/OFFLINE/
 * ERROR/EMPTY) so a slow or failing backend only degrades its own card —
 * the shell always renders instantly.
 *
 * No data fetching here: the route feeds this view a fully derived model.
 */

import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  Gauge,
  Lock,
  Radio,
  Search,
  Shield,
  Target,
  Timer,
  TrendingUp,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { PageHeader, Panel, Tag } from "@/components/space/Panel";
import { useNow } from "@/hooks/use-now";
import type {
  AccountCard,
  AiCard,
  BinanceCard,
  DecisionCard,
  FeedCard,
  Freshness,
  MarketCard,
  PositionCard,
  RiskCard,
  UiPhase,
} from "@/lib/ui-state";

// ─── Public types ────────────────────────────────────────────────────

export type JournalEvent = {
  id: string;
  timestamp: number;
  eventType: string;
  importance: string;
  symbol?: string;
  message: string;
  action?: string;
  pnl?: number;
  position?: {
    symbol: string;
    side: string;
    entryPrice: number;
    margin: number;
    leverage: number;
  };
  riskDecision?: { approved: boolean; reason: string; checks?: Array<{ name: string; passed: boolean; message: string }> };
  reasoning?: string;
  tradeId?: string;
  decisionId?: string;
  details?: Record<string, unknown>;
};

export type ReviewItem = {
  tradeId?: string | null;
  symbol?: string | null;
  side?: string | null;
  realizedPnl?: number | null;
  potentialLesson?: string | null;
};

export type DashboardModel = {
  binance: BinanceCard;
  ai: AiCard;
  market: MarketCard;
  account: AccountCard;
  risk: RiskCard;
  position: PositionCard;
  decision: DecisionCard;
  reviews: FeedCard;
  journal: FeedCard;
  journalEvents: JournalEvent[];
  reviewsItems: ReviewItem[];
  tradingEnabled: boolean | null;
  executionMode: string;
};

// ─── Shared presentational helpers (exported for tests) ──────────────

export const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const phaseDotClass: Record<UiPhase, string> = {
  LOADING: "bg-cyan-signal animate-pulse",
  READY: "bg-gain",
  DEGRADED: "bg-amber-signal",
  OFFLINE: "bg-loss",
  ERROR: "bg-loss",
  EMPTY: "bg-muted-foreground/60",
};

const phaseTextClass: Record<UiPhase, string> = {
  LOADING: "text-cyan-signal/90",
  READY: "text-gain glow-text",
  DEGRADED: "text-amber-signal",
  OFFLINE: "text-loss",
  ERROR: "text-loss",
  EMPTY: "text-muted-foreground",
};

const freshnessTone: Record<Freshness, "gain" | "warn" | "loss" | "cyan"> = {
  FRESH: "gain",
  STALE: "warn",
  UNAVAILABLE: "loss",
};

export function FreshnessBadge({ freshness, prefix = "" }: { freshness: Freshness; prefix?: string }) {
  return (
    <Tag tone={freshnessTone[freshness]}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {prefix}● {freshness}
    </Tag>
  );
}

export function PhaseDot({ phase, className = "" }: { phase: UiPhase; className?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${phaseDotClass[phase]} ${className}`} />;
}

export function SkeletonRows({ rows = 2, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded-sm bg-muted/60" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function CardLoading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <PhaseDot phase="LOADING" />
      <span className="font-mono text-xs text-muted-foreground">{text}</span>
    </div>
  );
}

// ─── Status cards (top row) ──────────────────────────────────────────

function StatusShell({
  label,
  icon,
  phase,
  children,
  glow,
}: {
  label: string;
  icon: ReactNode;
  phase: UiPhase;
  children: ReactNode;
  glow?: boolean;
}) {
  return (
    <div className={`panel corner-ticks px-4 py-3 ${glow ? "panel-glow" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border ${
              phase === "READY"
                ? "border-gain/50 bg-gain/10"
                : phase === "OFFLINE" || phase === "ERROR"
                  ? "border-loss/50 bg-loss/10"
                  : phase === "DEGRADED"
                    ? "border-amber-signal/50 bg-amber-signal/10"
                    : phase === "LOADING"
                      ? "border-cyan-signal/50 bg-cyan-signal/10"
                      : "border-hairline bg-muted/30"
            }`}
          >
            <span
              className={
                phase === "READY"
                  ? "text-gain"
                  : phase === "OFFLINE" || phase === "ERROR"
                    ? "text-loss"
                    : phase === "DEGRADED"
                      ? "text-amber-signal"
                      : phase === "LOADING"
                        ? "text-cyan-signal"
                        : "text-muted-foreground"
              }
            >
              {icon}
            </span>
            {phase === "READY" && (
              <span className="pulse-dot absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-gain" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function BinanceStatusCard({ card, now }: { card: BinanceCard; now: number }) {
  const offline = card.phase === "OFFLINE";
  return (
    <StatusShell label="BINANCE FUTURES TESTNET" icon={<Gauge className="h-5 w-5" />} phase={card.phase} glow={card.phase === "READY"}>
      <div className="mt-0.5 flex items-center gap-2">
        <PhaseDot phase={card.phase} />
        <span className={`font-mono text-sm font-bold uppercase tracking-wider ${phaseTextClass[card.phase]}`}>
          {card.headline}
        </span>
        <Tag tone={offline ? "loss" : card.phase === "DEGRADED" ? "warn" : card.phase === "LOADING" ? "cyan" : "gain"}>{card.mode}</Tag>
      </div>
      <div className="mt-1 font-mono text-[0.65rem] leading-snug text-muted-foreground">{card.statusText}</div>
      {offline && card.banner && (
        <div className="mt-2 flex items-center gap-2 rounded-sm border border-loss/40 bg-loss/5 px-2 py-1">
          <AlertTriangle className="h-3 w-3 shrink-0 text-loss" />
          <span className="font-mono text-[0.65rem] font-semibold tracking-wider text-loss">{card.banner}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FreshnessBadge freshness={card.freshness} />
        {card.ageText && <span className="font-mono text-[0.6rem] text-muted-foreground">{card.ageText}</span>}
        {card.lastError && (
          <span className="max-w-[16rem] truncate font-mono text-[0.6rem] text-loss/80" title={card.lastError}>
            {card.lastError}
          </span>
        )}
      </div>
    </StatusShell>
  );
}

function AiStatusCard({ card }: { card: AiCard }) {
  const active = card.phase === "READY";
  const loading = card.phase === "LOADING";
  const degraded = card.phase === "DEGRADED";
  const offline = card.phase === "OFFLINE" || card.phase === "ERROR";
  return (
    <StatusShell label="AI ENGINE" icon={<BrainCircuit className="h-5 w-5" />} phase={card.phase} glow={active}>
      <div className="mt-0.5 flex items-center gap-2">
        <PhaseDot phase={card.phase} />
        <span className={`font-mono text-sm font-bold uppercase tracking-wider ${phaseTextClass[card.phase]}`}>
          {card.headline}
        </span>
        <Tag tone={offline ? "loss" : degraded ? "warn" : loading ? "cyan" : "gain"}>{card.activity}</Tag>
      </div>
      <div className="mt-1 font-mono text-[0.65rem] leading-snug text-muted-foreground">{card.statusText}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Tag tone="default">{card.mode === "—" ? "MODE —" : `MODE ${card.mode}`}</Tag>
        {card.ageText && <span className="font-mono text-[0.6rem] text-muted-foreground">{card.ageText}</span>}
      </div>
    </StatusShell>
  );
}

function MarketStatusCard({ card, now }: { card: MarketCard; now: number }) {
  const ticks = card.ticks ?? [];
  return (
    <StatusShell label="MARKET DATA" icon={<Activity className="h-5 w-5" />} phase={card.phase} glow={card.phase === "READY"}>
      <div className="mt-0.5 flex items-center gap-2">
        <PhaseDot phase={card.phase} />
        <span className={`font-mono text-sm font-bold uppercase tracking-wider ${phaseTextClass[card.phase]}`}>
          {card.headline}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <FreshnessBadge freshness={card.freshness} />
        <span className="font-mono text-[0.6rem] text-muted-foreground">
          {card.ageText ?? card.statusText}
        </span>
      </div>
      {ticks.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 overflow-hidden">
          {ticks.slice(0, 4).map((t) => {
            const up = (t.priceChangePercent24h ?? 0) >= 0;
            return (
              <div key={t.symbol} className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="label-mono">{t.symbol}</span>
                <span className="font-mono text-xs tabular-nums text-foreground">{money(t.lastPrice)}</span>
                <span className={`font-mono text-[0.62rem] tabular-nums ${up ? "text-gain" : "text-loss"}`}>
                  {up ? "+" : ""}
                  {(t.priceChangePercent24h ?? 0).toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{card.statusText}</div>
      )}
    </StatusShell>
  );
}

// ─── Account / Risk / Position panels ────────────────────────────────

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss" | null;
}) {
  return (
    <div className="rounded-sm border border-hairline bg-muted/30 px-3 py-2">
      <div className="label-mono text-[0.55rem]">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-semibold ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function AccountPanel({ card }: { card: AccountCard }) {
  const v = card.values;
  const showValues = card.phase === "READY" || card.phase === "DEGRADED";

  return (
    <Panel
      title="Account"
      code="BINANCE FUTURES"
      glow={card.phase === "READY"}
      action={<FreshnessBadge freshness={card.freshness} />}
    >
      {card.phase === "LOADING" && <SkeletonRows rows={2} />}

      {(card.phase === "OFFLINE" || card.phase === "EMPTY" || card.phase === "ERROR") && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Database className={`mb-2 h-6 w-6 ${card.phase === "ERROR" ? "text-loss/60" : "text-muted-foreground/40"}`} />
          <div className={`font-mono text-sm font-semibold ${card.phase === "ERROR" ? "text-loss" : "text-muted-foreground"}`}>
            {card.phase === "OFFLINE" ? "ACCOUNT DATA UNAVAILABLE" : card.phase === "ERROR" ? "ACCOUNT STATUS ERROR" : "NO ACCOUNT DATA"}
          </div>
          <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
            {card.message ?? "Waiting for Binance Testnet"}
          </div>
        </div>
      )}

      {showValues && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Balance" value={v.balance != null ? money(v.balance) : "—"} />
            <MiniStat label="Available" value={v.availableBalance != null ? money(v.availableBalance) : "—"} />
            <MiniStat label="Margin Used" value={v.marginBalance != null ? money(v.marginBalance) : "—"} />
            <MiniStat
              label="Unrealized PnL"
              value={v.unrealizedPnl != null ? money(v.unrealizedPnl) : "—"}
              tone={v.unrealizedPnl != null ? (v.unrealizedPnl >= 0 ? "gain" : "loss") : null}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-2">
            <Tag tone="gain">TESTNET</Tag>
            <span className="font-mono text-[0.65rem] text-muted-foreground">
              {card.message ?? "Live account feed — AI has restricted allocation"}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function RiskPanel({ card }: { card: RiskCard }) {
  const risk = card.risk;

  return (
    <Panel
      title="Risk State"
      code="GUARDIAN"
      action={
        card.phase === "READY" ? (
          <Tag tone={risk?.isLocked ? "loss" : "gain"}>{risk?.isLocked ? "LOCKED" : "PROTECTED"}</Tag>
        ) : card.phase === "LOADING" ? (
          <Tag tone="cyan">LOADING</Tag>
        ) : (
          <Tag tone="warn">UNAVAILABLE</Tag>
        )
      }
    >
      {card.phase === "LOADING" && <SkeletonRows rows={2} />}

      {(card.phase === "DEGRADED" || card.phase === "ERROR" || card.phase === "EMPTY") && (
        <div className="mb-3 flex items-start gap-2 rounded-sm border border-amber-signal/30 bg-amber-signal/5 px-3 py-2">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-signal" />
          <div>
            <div className="font-mono text-xs font-semibold text-amber-signal">RISK STATE UNAVAILABLE</div>
            <div className="mt-0.5 font-mono text-[0.65rem] text-muted-foreground">
              {card.message ?? "Risk engine has not reported state yet."}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat
          label="Risk Status"
          value={card.phase === "READY" ? (risk?.isLocked ? "LOCKED" : "NOMINAL") : "—"}
          tone={card.phase === "READY" ? (risk?.isLocked ? "loss" : "gain") : null}
        />
        <MiniStat label="Max Loss/Trade" value="$1.00" />
        <MiniStat label="Daily Loss Limit" value="-$2.00" />
        <MiniStat label="Max Leverage" value="20x" />
        <MiniStat label="Max Positions" value="1" />
        <MiniStat
          label="Daily PnL"
          value={card.phase === "READY" && risk?.dailyPnl != null ? money(risk.dailyPnl) : "—"}
          tone={card.phase === "READY" && risk?.dailyPnl != null ? (risk.dailyPnl >= 0 ? "gain" : "loss") : null}
        />
      </div>

      {card.phase === "READY" && risk?.cooldownActive && (
        <div className="mt-3 flex items-center gap-2 rounded-sm border border-amber-signal/40 bg-amber-signal/5 px-3 py-2">
          <Timer className="h-3.5 w-3.5 text-amber-signal" />
          <span className="font-mono text-xs font-semibold text-amber-signal">COOLDOWN ACTIVE</span>
          {risk.cooldownEndsAt != null && risk.cooldownEndsAt > 0 && (
            <span className="font-mono text-[0.65rem] text-muted-foreground">
              Expires: {new Date(risk.cooldownEndsAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

function PositionPanel({ card }: { card: PositionCard }) {
  const isActive = card.state === "LONG" || card.state === "SHORT";
  const positions = card.positions ?? [];
  const first = positions.length > 0 ? positions[0]! : null;
  const totalUnrealizedPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);

  const code =
    card.state === "LOADING"
      ? "LOADING"
      : card.state === "OFFLINE" || card.state === "ERROR"
        ? "UNAVAILABLE"
        : card.state === "DEGRADED"
          ? "STALE"
          : isActive
            ? "OPEN"
            : "NONE";

  const actionTag =
    card.state === "LOADING" ? (
      <Tag tone="cyan">LOADING</Tag>
    ) : card.state === "OFFLINE" || card.state === "ERROR" ? (
      <Tag tone="loss">UNAVAILABLE</Tag>
    ) : card.state === "DEGRADED" ? (
      <Tag tone="warn">STALE</Tag>
    ) : isActive ? (
      <Tag tone="gain">OPEN</Tag>
    ) : (
      <Tag>NONE</Tag>
    );

  return (
    <Panel title="Active Position" code={code} glow={isActive} action={actionTag}>
      {card.state === "LOADING" && (
        <div className="flex items-center justify-center gap-3 py-6">
          <PhaseDot phase="LOADING" className="h-3.5 w-3.5" />
          <span className="font-mono text-sm text-muted-foreground">
            {card.message ?? "Fetching Binance position data..."}
          </span>
        </div>
      )}

      {(card.state === "OFFLINE" || card.state === "ERROR") && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <AlertTriangle className={`mb-2 h-6 w-6 ${card.state === "ERROR" ? "text-loss" : "text-amber-signal"}`} />
          <div className="font-mono text-sm font-semibold text-loss">
            {card.state === "ERROR" ? "POSITION DATA ERROR" : "POSITION DATA UNAVAILABLE"}
          </div>
          <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
            {card.message ?? "Waiting for Binance Testnet"}
          </div>
        </div>
      )}

      {card.state === "DEGRADED" && !first && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <AlertTriangle className="mb-2 h-6 w-6 text-amber-signal" />
          <div className="font-mono text-sm font-semibold text-amber-signal">POSITION DATA STALE</div>
          <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
            {card.message ?? "Waiting for Binance Testnet"}
          </div>
        </div>
      )}

      {card.state === "NO_POSITION" && (
        <div className="flex items-center justify-center py-6 text-center">
          <div>
            <div className="font-mono text-sm font-semibold text-muted-foreground">NONE</div>
            <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
              No active position — AI is monitoring market conditions.
            </div>
          </div>
        </div>
      )}

      {((isActive && first) || (card.state === "DEGRADED" && first)) && (
        <div>
          {card.state === "DEGRADED" && (
            <div className="mb-2 flex items-center gap-2 rounded-sm border border-amber-signal/30 bg-amber-signal/5 px-2 py-1">
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-signal" />
              <span className="font-mono text-[0.62rem] text-amber-signal">
                {card.message ?? "Position data stale — showing last known values."}
              </span>
            </div>
          )}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-8 shrink-0 items-center justify-center rounded-sm px-3 font-mono text-sm font-bold ${
                  first.side === "LONG"
                    ? "border border-gain/40 bg-gain/10 text-gain"
                    : "border border-violet-signal/40 bg-violet-signal/10 text-violet-signal"
                }`}
              >
                {first.side}
              </span>
              <span className="truncate font-display text-lg font-bold text-foreground">{first.symbol}</span>
            </div>
            <div className={`shrink-0 font-mono text-lg font-bold tabular-nums ${totalUnrealizedPnl >= 0 ? "text-gain glow-text" : "text-loss"}`}>
              {money(totalUnrealizedPnl)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label="Entry Price" value={money(first.entryPrice)} />
            <MiniStat label="Mark Price" value={money(first.markPrice)} />
            <MiniStat label="Size" value={String(first.size)} />
            <MiniStat label="Leverage" value={`${first.leverage}x`} />
            <MiniStat label="Margin" value={money(first.margin)} />
            <MiniStat
              label="Unrealized PnL"
              value={money(first.unrealizedPnl)}
              tone={first.unrealizedPnl >= 0 ? "gain" : "loss"}
            />
          </div>
          {positions.length > 1 && (
            <div className="mt-2 font-mono text-[0.65rem] text-muted-foreground">
              +{positions.length - 1} more position{positions.length > 2 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─── Decision / Reviews / Journal ────────────────────────────────────

function DecisionPanel({ card }: { card: DecisionCard }) {
  const event = card.event;

  return (
    <Panel title="Last AI Decision" code="DECISION">
      {card.phase === "LOADING" && <SkeletonRows rows={2} />}

      {card.phase === "ERROR" && (
        <div className="flex items-center gap-2 py-4">
          <AlertTriangle className="h-4 w-4 text-loss" />
          <span className="font-mono text-xs text-muted-foreground">{card.message ?? "Decision feed unavailable."}</span>
        </div>
      )}

      {card.phase === "EMPTY" && (
        <div className="py-6 text-center">
          <BrainCircuit className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
          <div className="font-mono text-sm text-muted-foreground">No decision yet</div>
          <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
            The AI engine publishes decisions here as soon as its first cycle completes.
          </div>
        </div>
      )}

      {card.phase === "READY" && event && (
        <div className="rounded-sm border border-hairline bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tag
              tone={
                event.executionResult === "TESTNET_EXECUTED" || event.executionResult === "PAPER_EXECUTED"
                  ? "gain"
                  : event.executionResult === "REJECTED"
                    ? "loss"
                    : "default"
              }
            >
              {event.executionResult || "PENDING"}
            </Tag>
            <span className="font-mono text-[0.65rem] text-muted-foreground">{fmtTime(event.timestamp)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Symbol" value={event.symbol || "—"} />
            <MiniStat label="Decision" value={event.decision || "—"} />
            <MiniStat label="Confidence" value={event.confidence != null ? `${(event.confidence * 100).toFixed(1)}%` : "—"} />
            <MiniStat label="Strategy" value={event.strategy || "—"} />
          </div>
          {event.error && (
            <div className="mt-2 rounded-sm border border-loss/30 bg-loss/5 px-2 py-1 font-mono text-[0.62rem] text-loss">
              {event.error}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ReviewsPanel({ card, items }: { card: FeedCard; items: ReviewItem[] }) {
  return (
    <Panel title="Post-Trade Reviews" code="REVIEWS">
      {card.phase === "LOADING" && <SkeletonRows rows={2} />}
      {card.phase === "ERROR" && (
        <div className="flex items-center gap-2 py-4">
          <AlertTriangle className="h-4 w-4 text-loss" />
          <span className="font-mono text-xs text-muted-foreground">{card.message ?? "Reviews unavailable."}</span>
        </div>
      )}
      {(card.phase === "EMPTY" || (card.phase === "READY" && items.length === 0)) && (
        <div className="py-4 text-center font-mono text-sm text-muted-foreground">No reviews yet</div>
      )}
      {card.phase === "READY" && items.length > 0 && (
        <div className="max-h-[220px] space-y-2 overflow-y-auto">
          {items
            .slice(-5)
            .reverse()
            .map((r, i) => {
              const side = r.side ?? "";
              const pnl = r.realizedPnl ?? 0;
              return (
                <div key={r.tradeId || `${r.symbol}-${i}`} className="rounded-sm border border-hairline bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Tag tone={side === "LONG" ? "gain" : side === "SHORT" ? "violet" : "default"}>{side || "—"}</Tag>
                      <span className="truncate font-mono text-xs font-semibold text-foreground">{r.symbol ?? "—"}</span>
                    </div>
                    <span className={`shrink-0 font-mono text-xs tabular-nums font-semibold ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {money(pnl)}
                    </span>
                  </div>
                  {r.potentialLesson && (
                    <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{r.potentialLesson}</div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </Panel>
  );
}

// ─── Journal (interactive) ───────────────────────────────────────────

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

function JournalEntryView({ event }: { event: JournalEvent }) {
  const Icon = EVENT_ICONS[event.eventType] || Activity;
  const tone = IMPORTANCE_TONE[event.importance] || "default";
  return (
    <div className="flex gap-3 rounded-sm border border-hairline/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-primary/5">
      <div className="flex-shrink-0 pt-0.5">
        <Icon
          className={`h-4 w-4 ${
            tone === "gain"
              ? "text-gain"
              : tone === "loss"
                ? "text-loss"
                : tone === "warn"
                  ? "text-amber-signal"
                  : tone === "cyan"
                    ? "text-cyan-400"
                    : "text-muted-foreground"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.6rem] text-muted-foreground">{fmtTime(event.timestamp)}</span>
          <Tag tone={tone}>{event.importance}</Tag>
          <span className="font-mono text-[0.6rem] text-primary">{event.eventType}</span>
          {event.symbol && <span className="font-mono text-[0.6rem] text-foreground">{event.symbol}</span>}
        </div>
        <div className="mt-0.5 font-mono text-xs leading-relaxed text-foreground">{event.message}</div>
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

function JournalPanel({ card, events }: { card: FeedCard; events: JournalEvent[] }) {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [importanceFilter, setImportanceFilter] = useState<string>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(events.length);

  useEffect(() => {
    if (events.length > prevLenRef.current && !autoScroll) {
      setNewCount((c) => c + (events.length - prevLenRef.current));
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
          {card.phase === "LOADING" ? (
            <Tag tone="cyan">LOADING</Tag>
          ) : card.phase === "ERROR" ? (
            <Tag tone="loss">ERROR</Tag>
          ) : (
            <>
              <Tag tone="cyan">LIVE FEED</Tag>
              <Tag>{events.length} events</Tag>
            </>
          )}
        </div>
      }
    >
      {card.phase === "LOADING" && <SkeletonRows rows={3} />}

      {card.phase === "ERROR" && (
        <div className="flex items-center gap-2 py-4">
          <AlertTriangle className="h-4 w-4 text-loss" />
          <span className="font-mono text-xs text-muted-foreground">{card.message ?? "Journal feed unavailable."}</span>
        </div>
      )}

      {card.phase !== "LOADING" && card.phase !== "ERROR" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-hairline pb-3">
            <div className="relative min-w-[160px] flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search journal..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-sm border border-hairline bg-muted/30 py-1.5 pl-8 pr-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2" aria-label="Clear search">
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
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
              aria-label="Importance filter"
            >
              <option value="ALL">All importance</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>

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
              filteredEvents.map((event) => <JournalEntryView key={event.id} event={event} />)
            ) : (
              <div className="py-6 text-center">
                <div className="font-mono text-sm text-muted-foreground">
                  {events.length === 0 ? "No journal events yet" : "No events match filters"}
                </div>
                <div className="mt-1 font-mono text-[0.65rem] text-muted-foreground/60">
                  {events.length === 0
                    ? "Events will appear as the AI processes market data"
                    : "Try adjusting filters"}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

// ─── Root view ───────────────────────────────────────────────────────

export function DashboardView({ model }: { model: DashboardModel }) {
  const now = useNow(1_000);
  const risk = model.risk.risk;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        eyebrow="ORBITAL ·AI"
        title="AI Futures Trading Observatory"
        desc="BINANCE FUTURES TESTNET — AI COMMAND CENTER"
        right={
          <div className="flex items-center gap-2">
            {model.tradingEnabled !== null && (
              <Tag tone={model.tradingEnabled ? "warn" : "gain"}>
                {model.tradingEnabled ? "TRADING ENABLED" : "TRADING DISABLED"}
              </Tag>
            )}
            <Tag tone="cyan">P7D-5.5</Tag>
          </div>
        }
      />

      {/* ═══ A. CORE SYSTEM STATUS — always visible ═══════════════ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <BinanceStatusCard card={model.binance} now={now} />
        <AiStatusCard card={model.ai} />
        <MarketStatusCard card={model.market} now={now} />
      </div>

      {/* Risk Lock Banner */}
      {risk?.isLocked && (
        <div className="mt-3 flex items-center gap-3 rounded-sm border border-loss/40 bg-loss/5 px-4 py-2">
          <Lock className="h-4 w-4 shrink-0 text-loss" />
          <div className="min-w-0">
            <span className="font-mono text-xs font-semibold text-loss">
              {risk.hardCapReached
                ? "HARD PROFIT CAP REACHED"
                : risk.cooldownActive
                  ? "COOLDOWN ACTIVE"
                  : "TRADING LOCKED"}
            </span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {risk.lockReason || "Unknown reason"}
            </span>
          </div>
        </div>
      )}

      {/* ═══ B. ACCOUNT ═══════════════════════════════════════════ */}
      <div className="mt-3">
        <AccountPanel card={model.account} />
      </div>

      {/* ═══ C. RISK STATE ════════════════════════════════════════ */}
      <div className="mt-3">
        <RiskPanel card={model.risk} />
      </div>

      {/* ═══ D. ACTIVE POSITION ═══════════════════════════════════ */}
      <div className="mt-3">
        <PositionPanel card={model.position} />
      </div>

      {/* ═══ E. LAST AI DECISION + REVIEWS ════════════════════════ */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <DecisionPanel card={model.decision} />
        <ReviewsPanel card={model.reviews} items={model.reviewsItems} />
      </div>

      {/* ═══ F. JOURNAL ═══════════════════════════════════════════ */}
      <div className="mt-3 mb-6">
        <JournalPanel card={model.journal} events={model.journalEvents} />
      </div>

      {/* ── Status footer strip (uptime of live feeds) ─────────── */}
      <div className="mb-8 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-2">
        <span className="flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
          <Clock className="h-3 w-3" /> Last update {fmtTime(now)}
        </span>
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground/60">
          {model.executionMode} MODE — READ-ONLY OBSERVATORY
        </span>
      </div>
    </div>
  );
}


