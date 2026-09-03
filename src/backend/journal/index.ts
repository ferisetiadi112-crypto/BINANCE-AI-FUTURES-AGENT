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
  | "POSITION_CLOSED";

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
): JournalEvent {
  return recordJournalEvent({
    eventType: "TRADE_PROPOSED",
    importance: "MEDIUM",
    symbol,
    message: `Trade proposed: ${direction} ${symbol} (${(confidence * 100).toFixed(1)}% confidence, ${strategy})`,
    decisionId,
    reasoning: `AI decision: ${direction} via ${strategy}`,
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

export function recordPositionClosed(
  symbol: string,
  margin: number,
): JournalEvent {
  return recordJournalEvent({
    eventType: "POSITION_CLOSED",
    importance: "MEDIUM",
    symbol,
    message: `Position closed: ${symbol} (margin $${margin.toFixed(2)} released)`,
  });
}

// ─── Query Functions ─────────────────────────────────────────────────

/**
 * Get all journal events (bounded buffer).
 */
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
 * Get recent events (last N).
 */
export function getRecentJournalEvents(count: number): JournalEvent[] {
  return _events.slice(-count);
}

/**
 * Get events in a time range.
 */
export function getJournalEventsInRange(
  from: number,
  to: number,
): JournalEvent[] {
  return _events.filter((e) => e.timestamp >= from && e.timestamp <= to);
}

/**
 * Clear all journal events (for testing).
 */
export function clearJournal(): void {
  _events = [];
  _eventCounter = 0;
}
