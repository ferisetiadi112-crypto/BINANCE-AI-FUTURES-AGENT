/**
 * Agent Status — lightweight monitoring endpoint
 *
 * Single aggregate that answers everything the main monitoring screen
 * needs in ONE call:
 *   1. Is the AI online?
 *   2. What is it doing right now?
 *   3. What did it find?
 *   4. What decision did it make?
 *   5. What action did it take?
 *   6. What position is open?
 *   7. What is today's PnL?
 *   8. Is there an error requiring attention?
 *
 * HARD CONSTRAINTS:
 * - In-memory sources only (runtime singleton, orchestrator state,
 *   exchange snapshot, journal ring buffer).
 * - NO database queries, NO Binance REST calls, NO heavy computation.
 * - recentActivity is capped at 10 events — never the full journal.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  getOrchestrator,
  getRuntimeSnapshot,
  isRuntimeRunning,
  STALE_TICK_THRESHOLD_MS,
} from "../trading/runtime";
import type { TradingOrchestrator } from "../trading/orchestrator";
import type { RuntimeSnapshot } from "../trading/runtime";
import { getRecentJournalEvents } from "../journal";
import { getExchangeSnapshot } from "../exchange/unified-state";
import { isRuntimeInitialized, getRuntimeInitError } from "../../server";
import type { ApiResponse } from "../../types/api";

// reused across topbar, sidebar, and monitor so React Query serves them
// from one cache entry and dedups the network requests.
export const AGENT_STATUS_QUERY_KEY = ["agent-status"];

// ─── Payload ───────────────────────────────────────────────────────

export type AgentStatusPayload = {
  status: "RUNNING" | "STARTING" | "OFFLINE" | "ERROR";
  executionMode: string;
  tradingEnabled: boolean;
  /** What the agent is doing right now, e.g. "Analyzing BTCUSDT" */
  currentTask: string | null;
  /** Latest meaningful market finding in plain language */
  finding: string | null;
  /** LONG / SHORT / WAIT / CLOSE */
  decision: string | null;
  /** Why the decision/action happened */
  reason: string | null;
  /** What actually happened, e.g. "No trade executed" */
  action: string | null;
  confidence: number | null;
  position: {
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    leverage: number;
  } | null;
  pnlToday: number;
  tradeCountToday: number;
  lastUpdate: string | null;
  error: string | null;
  recentActivity: AgentActivityItem[];
  /** Completed meaningful AI work only — internal/system events never appear. */
  journal: JournalEntryLite[];
};

export const AGENT_ACTIVITY_LIMIT = 10;

/**
 * One real journal event as surfaced to the client. All fields come from
 * the existing in-memory JournalEvent — nothing is invented here.
 */
export type AgentActivityItem = {
  timestamp: number;
  eventType: string;
  message: string;
  symbol?: string;
  action?: string;
  pnl?: number;
  position?: {
    symbol: string;
    side: string;
    entryPrice: number;
    margin: number;
    leverage: number;
  };
};

/**
 * One completed AI activity = one journal entry. Built purely from real
 * journal events: outcome events stand alone; a TRADE_PROPOSED step is
 * collapsed into its outcome when one follows for the same symbol, so a
 * single decision cycle never produces two entries.
 */
export type JournalEntryLite = {
  timestamp: number;
  eventType: string;
  symbol: string | null;
  message: string;
  /** LONG / SHORT / WAIT — only when the real event carries a direction. */
  decision: string | null;
  /** What actually happened (real event action text). */
  action: string | null;
  pnl: number | null;
  position: AgentActivityItem["position"] | null;
};

/** Outcome events — each is a completed activity and becomes a journal entry. */
const JOURNAL_OUTCOME_EVENTS: ReadonlySet<string> = new Set([
  "TRADE_OPENED",
  "POSITION_OPENED",
  "TRADE_CLOSED",
  "POSITION_CLOSED",
  "TRADE_REJECTED",
  "POST_TRADE_REVIEW",
  "STOP_LOSS",
  "TAKE_PROFIT",
]);

export const JOURNAL_ENTRY_LIMIT = 6;

/** A proposal older than this window before its outcome is treated as separate. */
const ACTIVITY_COLLAPSE_WINDOW_MS = 10 * 60_000;

const TRADE_PROPOSED_RE = /^Trade proposed: (LONG|SHORT|NO_TRADE|NO TRADE) ([A-Z0-9]+)/;

/** Extract the real direction/symbol embedded by recordTradeProposed(). */
export function parseTradeProposed(
  message: string,
): { direction: string; symbol: string } | null {
  const m = TRADE_PROPOSED_RE.exec(message);
  if (!m) return null;
  const direction = m[1] === "NO_TRADE" || m[1] === "NO TRADE" ? "WAIT" : m[1]!;
  return { direction, symbol: m[2]! };
}

function toJournalEntry(a: AgentActivityItem): JournalEntryLite {
  const proposed = parseTradeProposed(a.message);
  return {
    timestamp: a.timestamp,
    eventType: a.eventType,
    symbol: a.symbol ?? proposed?.symbol ?? null,
    message: a.message,
    decision: proposed?.direction ?? null,
    action: a.action ?? null,
    pnl: typeof a.pnl === "number" ? a.pnl : null,
    position: a.position ?? null,
  };
}

/**
 * Derive journal entries (completed work only) from the capped in-memory
 * activity buffer. Pure function — exported for tests.
 */
export function buildJournalEntries(activity: AgentActivityItem[]): JournalEntryLite[] {
  const lastOutcomeAt = new Map<string, number>();
  const entries: JournalEntryLite[] = [];

  const newestFirst = [...activity].sort((a, b) => b.timestamp - a.timestamp);
  for (const a of newestFirst) {
    if (JOURNAL_OUTCOME_EVENTS.has(a.eventType)) {
      const sym = a.symbol ?? null;
      if (sym) {
        const prev = lastOutcomeAt.get(sym) ?? 0;
        if (a.timestamp > prev) lastOutcomeAt.set(sym, a.timestamp);
      }
      entries.push(toJournalEntry(a));
      continue;
    }
    if (a.eventType === "TRADE_PROPOSED") {
      // Collapsed when its outcome (opened/rejected) already appears newer
      // for the same symbol — one activity, one entry.
      const sym = a.symbol ?? parseTradeProposed(a.message)?.symbol ?? null;
      const outcomeAt = sym ? (lastOutcomeAt.get(sym) ?? 0) : 0;
      const superseded =
        outcomeAt > a.timestamp && outcomeAt - a.timestamp <= ACTIVITY_COLLAPSE_WINDOW_MS;
      if (!superseded) entries.push(toJournalEntry(a));
      continue;
    }
    // MARKET_SCAN, RISK_CHECK, TRADE_APPROVED, ORDER_SUBMITTED, monitors,
    // PnL updates and other internal/system events never become entries.
  }

  return entries.slice(0, JOURNAL_ENTRY_LIMIT);
}

// ─── Pure builder (exported for tests) ─────────────────────────────

export function buildAgentStatus(input: {
  orchestrator: TradingOrchestrator | null;
  runtimeRunning: boolean;
  runtime: RuntimeSnapshot;
  runtimeInitialized: boolean;
  runtimeInitError: string | null;
  activity: Array<{ timestamp: number; eventType: string; message: string }>;
  exchangePositions: Array<{
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    leverage: number;
  }>;
}): AgentStatusPayload {
  const {
    orchestrator,
    runtimeRunning,
    runtime,
    runtimeInitialized,
    runtimeInitError,
    activity,
    exchangePositions,
  } = input;

  if (!orchestrator || !runtimeRunning) {
    return {
      status: runtimeInitError ? "ERROR" : runtimeInitialized ? "OFFLINE" : "STARTING",
      executionMode: runtime.stats.executionMode,
      tradingEnabled: false,
      currentTask: null,
      finding: null,
      decision: null,
      reason: null,
      action: null,
      confidence: null,
      position: null,
      pnlToday: 0,
      tradeCountToday: 0,
      lastUpdate: null,
      error: runtimeInitError,
      recentActivity: activity,
      journal: buildJournalEntries(activity),
    };
  }

  const state = orchestrator.getState();
  const riskStats = orchestrator.getDailyStats();
  const decision = state.lastDecision;

  // Phase 3.7: truthful status. A live orchestrator object alone is NOT proof
  // of a running loop (Vercel serverless freezes setInterval between
  // invocations). RUNNING requires a recent successful tick; otherwise the
  // instance is STALE. Market-data availability stays a separate concern:
  // a stale feed degrades currentTask/finding, never the runtime status.
  const tickAgeMs = runtime.stats.lastTickAt > 0 ? Date.now() - runtime.stats.lastTickAt : Infinity;
  const status: AgentStatusPayload["status"] =
    tickAgeMs <= STALE_TICK_THRESHOLD_MS ? "RUNNING" : "STARTING";

  // ── Current task: derived from the latest runtime event / tick ──
  let currentTask: string | null = null;
  const lastEvent =
    runtime.recentEvents.length > 0 ? runtime.recentEvents[runtime.recentEvents.length - 1]! : null;
  if (lastEvent && lastEvent.feedState === "ONLINE") {
    currentTask = `Analyzing ${lastEvent.symbol}`;
  } else if (runtime.stats.lastTickAt > 0) {
    currentTask = "Analyzing market data";
  } else {
    currentTask = "Waiting for first market update";
  }

  // ── Finding: plain-language summary of the latest decision evidence ──
  let finding: string | null = null;
  if (decision) {
    const e = decision.evidence;
    finding = `${e.trend} trend, ${e.momentum} momentum (${decision.marketRegime} regime)`;
  }

  // ── Decision: map internal direction to the monitor vocabulary ──
  let decisionLabel: string | null = null;
  if (decision) {
    decisionLabel = decision.direction === "NO_TRADE" ? "WAIT" : decision.direction;
  }

  // ── Action: what actually happened after the risk gate ──
  let action: string | null = null;
  if (decision) {
    if (decision.direction === "NO_TRADE") {
      action = "No trade executed";
    } else if (decision.executionResult === "EXECUTED") {
      action = `Trade executed (${decision.direction} ${decision.symbol})`;
    } else if (decision.executionResult === "REJECTED" || decision.riskResult === "REJECTED") {
      action = "Trade rejected by risk engine";
    } else {
      action = "No trade executed";
    }
  }

  const reason = state.lastRiskResult?.reason ?? decision?.riskReason ?? null;

  // ── Position: TESTNET reads the in-memory exchange snapshot,
  //    PAPER reads the paper engine — neither touches the network ──
  let position: AgentStatusPayload["position"] = null;
  if (state.executionMode === "TESTNET") {
    const p = exchangePositions[0];
    if (p) position = { ...p };
  } else {
    const p = orchestrator.getPaperEngine().getPosition();
    if (p && p.side !== "FLAT") {
      position = {
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unrealizedPnl: p.unrealizedPnl,
        leverage: p.leverage,
      };
    }
  }

  // ── Error: only surfaces when attention is genuinely required ──
  let error: string | null = null;
  if (runtimeInitError) {
    error = runtimeInitError;
  } else if (state.consecutiveSyncFailures > 0 && state.connectionError) {
    error = `Exchange sync failing: ${state.connectionError}`;
  } else if (riskStats.locked && riskStats.lockReason) {
    error = `Trading locked: ${riskStats.lockReason}`;
  }

  const lastUpdateMs = Math.max(
    runtime.stats.lastTickAt,
    lastEvent?.timestamp ?? 0,
    decision?.timestamp ?? 0,
  );

  return {
    status,
    executionMode: state.executionMode,
    tradingEnabled: orchestrator.getRiskEngine().isTradingEnabled(),
    currentTask,
    finding,
    decision: decisionLabel,
    reason,
    action,
    confidence: decision ? Math.round(decision.confidence * 100) : null,
    position,
    pnlToday: riskStats.pnl,
    tradeCountToday: riskStats.trades,
    lastUpdate: lastUpdateMs > 0 ? new Date(lastUpdateMs).toISOString() : null,
    error,
    recentActivity: activity,
    journal: buildJournalEntries(activity),
  };
}

// ─── Server function ───────────────────────────────────────────────

export const getAgentStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ApiResponse<AgentStatusPayload>> => {
    const orchestrator = getOrchestrator();
    // Lightweight: latest 10 in-memory events only, never the full journal.
    const latest = getRecentJournalEvents(AGENT_ACTIVITY_LIMIT);
    const activity: AgentActivityItem[] = latest.map((e) => ({
      timestamp: e.timestamp,
      eventType: e.eventType,
      message: e.message,
      ...(e.symbol ? { symbol: e.symbol } : {}),
      ...(e.action ? { action: e.action } : {}),
      ...(typeof e.pnl === "number" ? { pnl: e.pnl } : {}),
      ...(e.position
        ? {
            position: {
              symbol: e.position.symbol,
              side: e.position.side,
              entryPrice: e.position.entryPrice,
              margin: e.position.margin,
              leverage: e.position.leverage,
            },
          }
        : {}),
    }));
    const payload = buildAgentStatus({
      orchestrator,
      runtimeRunning: isRuntimeRunning(),
      runtime: getRuntimeSnapshot(),
      runtimeInitialized: isRuntimeInitialized(),
      runtimeInitError: getRuntimeInitError(),
      activity,
      exchangePositions:
        orchestrator?.getState().executionMode === "TESTNET" ? getExchangeSnapshot().positions : [],
    });
    return {
      data: payload,
      timestamp: new Date().toISOString(),
      source: "live",
    };
  },
);
