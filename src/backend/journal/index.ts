/**
 * AI Journal — BINANCE AI FUTURES AGENT v0.1
 *
 * Records real system events for the future dashboard.
 * Every event represents actual system activity.
 * NO fabricated data, NO fake trades, NO mock events.
 *
 * Journal events map to real system actions:
 * - SYSTEM_STARTED / SYSTEM_STOPPED
 * - MARKET_SCAN / RESEARCH / ANALYSIS
 * - RISK_CHECK
 * - TRADE_PROPOSED / TRADE_APPROVED / TRADE_REJECTED
 * - TRADE_OPENED / TRADE_CLOSED
 * - POST_TRADE_REVIEW
 * - COOLDOWN_STARTED / DAILY_LOSS_LIMIT / PROFIT_TARGET_REACHED / HARD_PROFIT_CAP
 * - PERIODIC_REPORT
 *
 * Supports future dashboard showing "What is the AI actually doing?"
 */

import { logger } from "../logger";
import { publishAgentEvent, subscribeToAgentEvents } from "./event-bus";
import {
  appendJournalEvent,
  getRecentJournalEventsFromDB,
  getJournalEventById,
  countJournalEvents,
  getJournalEventsInRange as getJournalEventsInRangeDB,
} from "./repository";

// ─── Journal Event Types ─────────────────────────────────────────────

export type JournalEventType =
  | "SYSTEM_STARTED"
  | "SYSTEM_STOPPED"
  | "MARKET_SCAN"
  | "RESEARCH"
  | "ANALYSIS"
  | "RISK_CHECK"
  | "TRADE_PROPOSED"
  | "TRADE_APPROVED"
  | "TRADE_REJECTED"
  | "TRADE_OPENED"
  | "TRADE_CLOSED"
  | "POST_TRADE_REVIEW"
  | "COOLDOWN_STARTED"
  | "DAILY_LOSS_LIMIT"
  | "PROFIT_TARGET_REACHED"
  | "HARD_PROFIT_CAP"
  | "PERIODIC_REPORT"
  | "POSITION_OPENED"
  | "POSITION_CLOSED"
  | "ORDER_SUBMITTED"
  | "ORDER_CONFIRMED"
  | "POSITION_MONITOR"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "PNL_UPDATED"
  | "RISK_LOCKED"
  | "STARTUP_RECONCILIATION"
  | "LEARNING";

export type JournalImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type JournalEvent = {
  id: string;
  timestamp: number;
  eventType: JournalEventType;
  importance: JournalImportance;
  symbol?: string;
  message: string;
  /** Current AI/risk state snapshot */
  aiState?: {
    dailyPnl: number;
    sessionPnl: number;
    isLocked: boolean;
    lockReason: string;
    openPositions: number;
    cooldownActive: boolean;
  };
  /** Action taken or recommended */
  action?: string;
  /** PnL if applicable */
  pnl?: number;
  /** Position information */
  position?: {
    symbol: string;
    side: "LONG" | "SHORT";
    entryPrice: number;
    margin: number;
    leverage: number;
  };
  /** Risk decision details */
  riskDecision?: {
    approved: boolean;
    reason: string;
    checks?: Array<{ name: string; passed: boolean; message: string }>;
  };
  /** Reasoning summary */
  reasoning?: string;
  /** Associated trade ID */
  tradeId?: string;
  /** Associated decision ID */
  decisionId?: string;
  /** Additional structured details */
  details?: Record<string, unknown>;
};

// ─── Journal State ───────────────────────────────────────────────────

// Journal persistence listener — attached once so every published event is
// written to the database, independent of any session/connection state.
subscribeToAgentEvents((event) => {
  appendJournalEvent(event).catch(() => {
    // Error already logged inside appendJournalEvent
  });
});

let _events: JournalEvent[] = [];
let _eventCounter = 0;
const MAX_JOURNAL_EVENTS = 1000;

// ─── Event Recording ─────────────────────────────────────────────────

/**
 * Record a journal event. Called from real system code paths only.
 * Every event must correspond to an actual system action.
 */
export function recordJournalEvent(
  event: Omit<JournalEvent, "id" | "timestamp">,
): JournalEvent {
  _eventCounter++;
  const record: JournalEvent = {
    id: `JEV-${Date.now()}-${_eventCounter}`,
    timestamp: Date.now(),
    ...event,
  };

  _events.push(record);

  // Trim to bounded size
  while (_events.length > MAX_JOURNAL_EVENTS) {
    _events.shift();
  }

  logger.debug(
    "journal",
    `[${record.eventType}] ${record.message}${record.symbol ? ` (${record.symbol})` : ""}`,
  );

  // Publish on the AgentEventBus — the persistence listener stores the event
  // in the database (fire-and-forget, non-blocking) and other consumers
  // (work-log stream) react to real system events only.
  publishAgentEvent(record);

  return record;
}

// ─── Convenience Recorders ───────────────────────────────────────────

export function recordSystemStarted(): JournalEvent {
  return recordJournalEvent({
    eventType: "SYSTEM_STARTED",
    importance: "HIGH",
    message: "Trading system started",
    action: "System initialization complete",
  });
}

export function recordSystemStopped(): JournalEvent {
  return recordJournalEvent({
    eventType: "SYSTEM_STOPPED",
    importance: "HIGH",
    message: "Trading system stopped",
    action: "System shutdown",
  });
}

export function recordMarketScan(
  symbol: string,
  dataQuality: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "MARKET_SCAN",
    importance: "LOW",
    symbol,
    message: `Market scan: ${symbol} (quality: ${dataQuality})`,
  });
}

export function recordRiskCheck(
  symbol: string,
  direction: string,
  approved: boolean,
  reason: string,
  checks?: Array<{ name: string; passed: boolean; message: string }>,
): JournalEvent {
  return recordJournalEvent({
    eventType: "RISK_CHECK",
    importance: approved ? "LOW" : "MEDIUM",
    symbol,
    message: `Risk check: ${direction} ${symbol} — ${approved ? "APPROVED" : "REJECTED"}: ${reason}`,
    riskDecision: checks ? { approved, reason, checks } : { approved, reason },
  });
}

export function recordTradeProposed(
  symbol: string,
  direction: string,
  confidence: number,
  strategy: string,
  decisionId: string,
  /** Phase 3.8-B: honest reasoning provenance, e.g. "llm-openai" or "safe-fallback". */
  modelVersion?: string,
): JournalEvent {
  const origin =
    modelVersion === undefined
      ? ""
      : modelVersion === "safe_fallback"
        ? " — safe fallback (no LLM response)"
        : ` — LLM provider: ${modelVersion.replace(/^llm-/, "")}`;
  return recordJournalEvent({
    eventType: "TRADE_PROPOSED",
    importance: "MEDIUM",
    symbol,
    message: `Trade proposed: ${direction} ${symbol} (${(confidence * 100).toFixed(1)}% confidence, ${strategy})${origin}`,
    decisionId,
    reasoning: `AI decision: ${direction} via ${strategy}${origin}`,
  });
}

export function recordTradeApproved(
  symbol: string,
  direction: string,
  decisionId: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "TRADE_APPROVED",
    importance: "HIGH",
    symbol,
    message: `Trade approved: ${direction} ${symbol}`,
    decisionId,
    action: "Trade approved by risk engine — proceeding to execution",
  });
}

export function recordTradeRejected(
  symbol: string,
  direction: string,
  reason: string,
  decisionId: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "TRADE_REJECTED",
    importance: "MEDIUM",
    symbol,
    message: `Trade rejected: ${direction} ${symbol} — ${reason}`,
    decisionId,
    riskDecision: { approved: false, reason },
  });
}

export function recordTradeOpened(
  symbol: string,
  side: "LONG" | "SHORT",
  entryPrice: number,
  margin: number,
  leverage: number,
  tradeId: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "TRADE_OPENED",
    importance: "HIGH",
    symbol,
    message: `Position opened: ${side} ${symbol} @ $${entryPrice.toFixed(2)} (margin: $${margin.toFixed(2)}, leverage: ${leverage}x)`,
    tradeId,
    position: { symbol, side, entryPrice, margin, leverage },
    action: "Position opened via paper engine",
  });
}

export function recordTradeClosed(
  symbol: string,
  side: "LONG" | "SHORT",
  pnl: number,
  tradeId: string,
  exitReason: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "TRADE_CLOSED",
    importance: pnl >= 0 ? "MEDIUM" : "HIGH",
    symbol,
    message: `Position closed: ${side} ${symbol} | PnL: $${pnl.toFixed(4)} (${exitReason})`,
    tradeId,
    pnl,
    action: `Position closed: ${exitReason}`,
  });
}

export function recordPostTradeReview(
  tradeId: string,
  symbol: string,
  summary: string,
  details: Record<string, unknown>,
): JournalEvent {
  return recordJournalEvent({
    eventType: "POST_TRADE_REVIEW",
    importance: "MEDIUM",
    symbol,
    message: `Post-trade review: ${symbol} — ${summary}`,
    tradeId,
    details,
    reasoning: summary,
  });
}

export function recordCooldownStarted(
  sessionPnl: number,
  cooldownEndsAt: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "COOLDOWN_STARTED",
    importance: "HIGH",
    message: `12-hour cooldown started: session PnL +$${sessionPnl.toFixed(2)} reached target. Trading locked until ${new Date(cooldownEndsAt).toISOString()}`,
    pnl: sessionPnl,
    action: "Trading locked for 12-hour cooldown",
  });
}

export function recordDailyLossLimit(dailyPnl: number): JournalEvent {
  return recordJournalEvent({
    eventType: "DAILY_LOSS_LIMIT",
    importance: "CRITICAL",
    message: `Daily loss limit reached: $${dailyPnl.toFixed(2)}`,
    pnl: dailyPnl,
    action: "Trading locked for the day",
  });
}

export function recordProfitTargetReached(sessionPnl: number): JournalEvent {
  return recordJournalEvent({
    eventType: "PROFIT_TARGET_REACHED",
    importance: "HIGH",
    message: `Session profit target reached: +$${sessionPnl.toFixed(2)}`,
    pnl: sessionPnl,
    action: "12-hour cooldown initiated",
  });
}

export function recordHardProfitCap(sessionPnl: number): JournalEvent {
  return recordJournalEvent({
    eventType: "HARD_PROFIT_CAP",
    importance: "CRITICAL",
    message: `Hard session profit cap reached: +$${sessionPnl.toFixed(2)}`,
    pnl: sessionPnl,
    action: "Trading permanently locked for session",
  });
}

export function recordPeriodicReport(
  reportContent: string,
  state: {
    dailyPnl: number;
    sessionPnl: number;
    isLocked: boolean;
    openPositions: number;
    cooldownActive: boolean;
  },
): JournalEvent {
  return recordJournalEvent({
    eventType: "PERIODIC_REPORT",
    importance: "LOW",
    message: reportContent,
    aiState: {
      dailyPnl: state.dailyPnl,
      sessionPnl: state.sessionPnl,
      isLocked: state.isLocked,
      lockReason: "",
      openPositions: state.openPositions,
      cooldownActive: state.cooldownActive,
    },
  });
}

export function recordPositionOpened(
  symbol: string,
  side: "LONG" | "SHORT",
  margin: number,
  leverage: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "POSITION_OPENED",
    importance: "HIGH",
    symbol,
    message: `Position opened: ${side} ${symbol} (margin: $${margin.toFixed(2)}, ${leverage}x leverage)`,
    position: {
      symbol,
      side,
      entryPrice: 0,
      margin,
      leverage,
    },
  });
}

/**
 * Phase 3.7: A remote-only Binance position discovered during startup
 * reconciliation is a synchronization fact, NOT an AI trade. Recorded under
 * the existing STARTUP_RECONCILIATION event type so the journal never
 * presents it as "Position opened" by the agent.
 */
export function recordRemotePositionDiscovered(
  symbol: string,
  side: "LONG" | "SHORT",
  margin: number,
  leverage: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "STARTUP_RECONCILIATION",
    importance: "HIGH",
    symbol,
    message: `Remote position discovered during startup reconciliation: ${side} ${symbol} (margin: $${margin.toFixed(2)}, ${leverage}x leverage) — synchronized to local state, not an AI order`,
    position: {
      symbol,
      side,
      entryPrice: 0,
      margin,
      leverage,
    },
  });
}

export function recordPositionClosed(
  symbol: string,
  side: "LONG" | "SHORT",
  exitPrice: number,
  realizedPnl: number,
  orderId: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "POSITION_CLOSED",
    importance: realizedPnl >= 0 ? "MEDIUM" : "HIGH",
    symbol,
    message: `Position closed: ${side} ${symbol} @ $${exitPrice.toFixed(2)} | Realized PnL: $${realizedPnl.toFixed(4)} (orderId: ${orderId})`,
    pnl: realizedPnl,
    position: {
      symbol,
      side,
      entryPrice: 0,
      margin: 0,
      leverage: 0,
    },
    details: { orderId, exitPrice },
  });
}

export function recordOrderSubmitted(
  symbol: string,
  direction: string,
  quantity: number,
  leverage: number,
  decisionId: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "ORDER_SUBMITTED",
    importance: "HIGH",
    symbol,
    message: `Order submitted: ${direction} ${quantity} ${symbol} (${leverage}x leverage)`,
    decisionId,
    action: "Order submitted to Binance Testnet",
  });
}

export function recordOrderConfirmed(
  symbol: string,
  direction: string,
  orderId: number,
  confirmed: boolean,
  details: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "ORDER_CONFIRMED",
    importance: confirmed ? "HIGH" : "CRITICAL",
    symbol,
    message: `Order ${confirmed ? "confirmed" : "NOT confirmed"}: ${direction} ${symbol} (orderId: ${orderId}) — ${details}`,
    details: { orderId, confirmed },
  });
}

export function recordStopLoss(
  symbol: string,
  direction: string,
  stopPrice: number,
  orderId: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "STOP_LOSS",
    importance: "MEDIUM",
    symbol,
    message: `Stop-loss placed: ${direction} ${symbol} @ $${stopPrice} (orderId: ${orderId})`,
    details: { stopPrice, orderId },
  });
}

export function recordTakeProfit(
  symbol: string,
  direction: string,
  targetPrice: number,
  orderId: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "TAKE_PROFIT",
    importance: "MEDIUM",
    symbol,
    message: `Take-profit placed: ${direction} ${symbol} @ $${targetPrice} (orderId: ${orderId})`,
    details: { targetPrice, orderId },
  });
}

export function recordPositionMonitor(
  symbol: string,
  localPresent: boolean,
  remotePresent: boolean,
  details: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "POSITION_MONITOR",
    importance: localPresent !== remotePresent ? "CRITICAL" : "LOW",
    symbol,
    message: `Position monitor: ${symbol} local=${localPresent} remote=${remotePresent} — ${details}`,
    details: { localPresent, remotePresent },
  });
}

export function recordPnlUpdated(
  dailyPnl: number,
  sessionPnl: number,
  source: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "PNL_UPDATED",
    importance: "MEDIUM",
    message: `PnL updated: daily=$${dailyPnl.toFixed(4)}, session=$${sessionPnl.toFixed(4)} (${source})`,
    pnl: sessionPnl,
    details: { dailyPnl, sessionPnl, source },
  });
}

export function recordRiskLocked(
  reason: string,
  dailyPnl: number,
  sessionPnl: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "RISK_LOCKED",
    importance: "CRITICAL",
    message: `Risk engine LOCKED: ${reason}`,
    pnl: dailyPnl,
    details: { reason, dailyPnl, sessionPnl },
    action: "Trading locked",
  });
}

export function recordStartupReconciliation(
  success: boolean,
  details: string,
): JournalEvent {
  return recordJournalEvent({
    eventType: "STARTUP_RECONCILIATION",
    importance: success ? "HIGH" : "CRITICAL",
    message: `Startup reconciliation: ${success ? "SUCCESS" : "FAILED"} — ${details}`,
    details: { success },
  });
}

// ─── Query Functions ─────────────────────────────────────────────────

/**
 * Get all journal events (bounded buffer).
 * NOTE: For persistent read, use getRecentJournalEventsFromDB() instead.
 */
/**
 * Phase 3: Record that a valuable lesson was stored in memory.
 * One concise event per derivation run that produced new lessons —
 * never per-experience journal spam. Learning details stay in the
 * learning/memory system, not in the journal feed.
 */
export function recordLessonStored(count: number, cycle: number): JournalEvent {
  return recordJournalEvent({
    eventType: "LEARNING",
    importance: "LOW",
    message: count === 1 ? "Learning: new lesson stored" : `Learning: ${count} new lessons stored`,
    action: `lesson-derivation cycle ${cycle}`,
  });
}

/**
 * Phase 3: Record that a derivation run found no reliable new lesson.
 * Honest state — recorded at LOW importance so it never clutters
 * meaningful activity, but the absence of learning is visible.
 */
export function recordNoReliableLesson(experienceCount: number): JournalEvent {
  return recordJournalEvent({
    eventType: "LEARNING",
    importance: "LOW",
    message: "Learning: no reliable lesson identified",
    action: `${experienceCount} experiences evaluated, insufficient evidence for a new lesson`,
  });
}

export function getJournalEvents(): JournalEvent[] {
  return [..._events];
}

/**
 * Get events of a specific type.
 */
export function getJournalEventsByType(
  eventType: JournalEventType,
): JournalEvent[] {
  return _events.filter((e) => e.eventType === eventType);
}

/**
 * Get recent events (last N) from in-memory buffer.
 * Kept for backward compatibility. AI Logbook should use getRecentJournalEventsAsync().
 */
export function getRecentJournalEvents(count: number): JournalEvent[] {
  return _events.slice(-count);
}

/**
 * Get recent events from PostgreSQL (persistent source of truth).
 * Falls back to in-memory buffer if DB read fails.
 */
export async function getRecentJournalEventsAsync(
  count: number = 500
): Promise<JournalEvent[]> {
  const dbEvents = await getRecentJournalEventsFromDB(count);
  if (dbEvents.length > 0) return dbEvents;
  // Fallback to in-memory if DB is empty or failed
  return _events.slice(-count);
}

/**
 * Get events in a time range (in-memory).
 */
export function getJournalEventsInRange(
  from: number,
  to: number,
): JournalEvent[] {
  return _events.filter((e) => e.timestamp >= from && e.timestamp <= to);
}

/**
 * Get events in a time range from database.
 */
export async function getJournalEventsInRangeAsync(
  from: number,
  to: number
): Promise<JournalEvent[]> {
  return getJournalEventsInRangeDB(from, to);
}

/**
 * Clear all journal events (for testing).
 */
export function clearJournal(): void {
  _events = [];
  _eventCounter = 0;
}

// ─── Async Query Exports ───────────────────────────────────────────

export { getJournalEventById, countJournalEvents, getJournalEventDates } from "./repository";
