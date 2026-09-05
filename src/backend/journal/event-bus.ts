/**
 * AgentEventBus — central typed event mechanism for agent/trading activity.
 *
 * Architecture (per spec):
 *   Agent services → recordJournalEvent() → AgentEventBus
 *     ├── JournalPersistence (repository.appendJournalEvent)
 *     └── LiveWorkLogStream (Dashboard reads via getAgentJournal)
 *
 * The bus is a plain in-process pub/sub over REAL system events. The
 * Dashboard never invents events; it only reads what the agent emitted.
 * Journal persistence is attached as a listener so every emitted event is
 * stored independently of AI memory, chat state, React state, or
 * connection state.
 */

import { logger } from "../logger";
import type { JournalEvent } from "./index";

// ─── Work-log categories (observable agent work, not chain-of-thought) ──

export type WorkLogCategory =
  | "MARKET"
  | "ANALYSIS"
  | "SIGNAL"
  | "RISK"
  | "DECISION"
  | "ACTION"
  | "MONITOR"
  | "SYSTEM"
  | "ERROR";

/**
 * Map real journal event types to high-level work categories.
 *
 * These map the ACTUAL decision pipeline of the orchestrator:
 *   MARKET_SCAN        -> MARKET    (real market data received/scan)
 *   TRADE_PROPOSED     -> SIGNAL    (real signal: direction + confidence)
 *   TRADE_APPROVED     -> DECISION  (real decision: proceed to execution)
 *   TRADE_REJECTED     -> DECISION  (real decision: do not trade)
 *   RISK_CHECK / RISK_*  -> RISK      (real risk gate checks)
 *   ORDER_* and POSITION_* -> ACTION  (real execution events)
 *   MONITOR / PNL / REPORT -> MONITOR (real monitoring events)
 * Only events that really occur in the backend are mapped; nothing is
 * synthesized to fill a category.
 */
export function categorizeEvent(eventType: string): WorkLogCategory {
  switch (eventType) {
    case "MARKET_SCAN":
      return "MARKET";
    case "RESEARCH":
    case "ANALYSIS":
      return "ANALYSIS";
    case "TRADE_PROPOSED":
      return "SIGNAL";
    case "TRADE_APPROVED":
    case "TRADE_REJECTED":
      return "DECISION";
    case "RISK_CHECK":
    case "RISK_LOCKED":
    case "COOLDOWN_STARTED":
    case "DAILY_LOSS_LIMIT":
    case "PROFIT_TARGET_REACHED":
    case "HARD_PROFIT_CAP":
      return "RISK";
    case "TRADE_OPENED":
    case "POSITION_OPENED":
    case "ORDER_SUBMITTED":
    case "ORDER_CONFIRMED":
    case "STOP_LOSS":
    case "TAKE_PROFIT":
    case "TRADE_CLOSED":
    case "POSITION_CLOSED":
      return "ACTION";
    case "POSITION_MONITOR":
    case "PNL_UPDATED":
    case "PERIODIC_REPORT":
    case "POST_TRADE_REVIEW":
      return "MONITOR";
    case "SYSTEM_STARTED":
    case "SYSTEM_STOPPED":
    case "STARTUP_RECONCILIATION":
    case "LEARNING":
      return "SYSTEM";
    default:
      return "SYSTEM";
  }
}

// ─── Event bus ───────────────────────────────────────────────────────

type Listener = (event: JournalEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to real agent events. Returns an unsubscribe function. */
export function subscribeToAgentEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish an event to all listeners. Listener errors are isolated —
 * a failing subscriber must never break the trading runtime.
 */
export function publishAgentEvent(event: JournalEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn(
        "event-bus",
        `Listener failed for ${event.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** Remove all listeners (for tests). */
export function clearAgentEventBus(): void {
  listeners.clear();
}
