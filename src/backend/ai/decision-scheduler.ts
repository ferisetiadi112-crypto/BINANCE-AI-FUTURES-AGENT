/**
 * Decision Scheduler — P7D-5.4
 *
 * Event-driven layer between MarketDataState and AI Decision Engine.
 * Ensures AI reasoning runs on the LATEST market state with controlled frequency.
 *
 * Architecture:
 *   Market Tick → State Update → markDirty() → Scheduler → AI Analysis
 *
 * Key properties:
 * - Event coalescing: multiple rapid ticks → single decision trigger
 * - In-flight protection: no duplicate concurrent LLM requests
 * - Throttle: minimum interval between decisions
 * - Latest-snapshot-wins: AI always reads current state, not queued ticks
 *
 * SAFETY:
 * - Purely READ-ONLY — never places orders or modifies exchange state
 * - Does not bypass existing runtime tick mechanism
 * - Existing 15s tick remains as safety baseline
 * - TRADING_ENABLED unchanged
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

export type SchedulerState = {
  /** Whether a decision is currently being processed */
  inFlight: boolean;
  /** Whether a new decision is pending (state changed while in-flight) */
  dirty: boolean;
  /** Timestamp of last decision trigger */
  lastDecisionAt: number;
  /** Timestamp of last market event received */
  lastEventAt: number;
  /** Number of events coalesced since last decision */
  coalescedCount: number;
  /** Total decisions triggered */
  totalDecisions: number;
  /** Total events received */
  totalEvents: number;
  /** Total coalesced events */
  totalCoalesced: number;
  /** Total in-flight rejections */
  totalInFlightRejected: number;
  /** Scheduler throttle interval (ms) */
  throttleMs: number;
  /** Whether scheduler is active */
  active: boolean;
};

export type SchedulerSnapshot = {
  state: SchedulerState;
  /** Whether scheduler would trigger a decision on next check */
  wouldTrigger: boolean;
  /** Time since last decision (ms) */
  timeSinceLastDecisionMs: number;
  /** Time since last event (ms) */
  timeSinceLastEventMs: number;
};

export type DecisionTriggerReason =
  | "THROTTLE_INTERVAL"
  | "POSITION_CHANGE"
  | "ACCOUNT_UPDATE"
  | "MANUAL"
  | "STARTUP";

export type DecisionTrigger = {
  reason: DecisionTriggerReason;
  timestamp: number;
  symbol: string | undefined;
};

/** Callback type for when scheduler decides to run AI analysis */
export type SchedulerDecisionCallback = (trigger: DecisionTrigger) => Promise<void>;

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_THROTTLE_MS = 30_000; // 30 seconds minimum between decisions
const COALESCE_WINDOW_MS = 5_000;   // Events within 5s are coalesced
const POSITION_CHANGE_THROTTLE_MS = 10_000; // 10s for position changes (faster response)

// ─── Singleton State ────────────────────────────────────────────────

let _inFlight = false;
let _dirty = false;
let _lastDecisionAt = 0;
let _lastEventAt = 0;
let _lastCoalesceAt = 0;
let _coalescedSinceLastDecision = 0;
let _totalDecisions = 0;
let _totalEvents = 0;
let _totalCoalesced = 0;
let _totalInFlightRejected = 0;
let _throttleMs = DEFAULT_THROTTLE_MS;
let _active = false;
let _callback: SchedulerDecisionCallback | null = null;
let _throttleTimer: ReturnType<typeof setTimeout> | null = null;
let _coalesceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Initialize the decision scheduler.
 *
 * @param callback - Function to call when scheduler decides to run AI analysis
 * @param throttleMs - Minimum interval between decisions (default: 30s)
 */
export function initializeScheduler(
  callback: SchedulerDecisionCallback,
  throttleMs: number = DEFAULT_THROTTLE_MS,
): void {
  if (_active) {
    logger.warn("decision-scheduler", "Scheduler already active — ignoring re-init");
    return;
  }

  _callback = callback;
  _throttleMs = throttleMs;
  _active = true;
  _lastDecisionAt = Date.now() - _throttleMs; // Allow first event to trigger immediately

  logger.info(
    "decision-scheduler",
    `Initialized: throttle=${throttleMs}ms`,
  );
}

/**
 * Shutdown the scheduler.
 */
export function shutdownScheduler(): void {
  _active = false;
  _callback = null;

  if (_throttleTimer) {
    clearTimeout(_throttleTimer);
    _throttleTimer = null;
  }
  if (_coalesceTimer) {
    clearTimeout(_coalesceTimer);
    _coalesceTimer = null;
  }

  logger.info("decision-scheduler", "Shut down");
}

/**
 * Notify the scheduler that a market event occurred.
 *
 * This is the primary entry point from MarketDataState.
 * Events are coalesced — multiple rapid events result in at most one decision trigger.
 *
 * @param symbol - Optional symbol that changed
 */
export function onMarketEvent(symbol?: string): void {
  if (!_active) return;

  const now = Date.now();
  _lastEventAt = now;
  _totalEvents++;

  // Check if we're within the coalesce window of the last processed event
  const timeSinceLastCoalesce = now - _lastCoalesceAt;
  if (timeSinceLastCoalesce < COALESCE_WINDOW_MS && _coalescedSinceLastDecision > 0) {
    // This event is within coalesce window — just mark dirty
    _dirty = true;
    _coalescedSinceLastDecision++;
    _totalCoalesced++;
    return;
  }

  _lastCoalesceAt = now;

  // Mark state as dirty
  _dirty = true;

  // Try to schedule a decision
  scheduleDecisionIfNeeded("THROTTLE_INTERVAL", symbol);
}

/**
 * Notify the scheduler that an account or position changed.
 * Position changes get priority (shorter throttle).
 *
 * @param reason - Why the change occurred
 * @param symbol - Optional symbol that changed
 */
export function onAccountChange(
  reason: DecisionTriggerReason,
  symbol?: string,
): void {
  if (!_active) return;

  _dirty = true;
  _lastEventAt = Date.now();
  _totalEvents++;

  scheduleDecisionIfNeeded(reason, symbol);
}

/**
 * Mark the scheduler as dirty without a specific event.
 * Used when external state changes warrant a re-evaluation.
 */
export function markDirty(): void {
  _dirty = true;
}

/**
 * Called when the AI decision pipeline completes.
 * Clears in-flight flag and checks if another decision is needed.
 */
export function onDecisionComplete(): void {
  _inFlight = false;
  _totalDecisions++;
  _lastDecisionAt = Date.now();
  _coalescedSinceLastDecision = 0;

  // If state changed while we were processing, schedule follow-up if past throttle
  if (_dirty) {
    logger.debug("decision-scheduler", "State dirty after decision — scheduling follow-up");
    // Force the follow-up by bypassing throttle since we just completed
    _lastDecisionAt = 0;
    scheduleDecisionIfNeeded("THROTTLE_INTERVAL");
  }
}

/**
 * Called when the AI decision pipeline fails.
 * Clears in-flight flag without counting as a decision.
 */
export function onDecisionError(): void {
  _inFlight = false;
  _coalescedSinceLastDecision = 0;

  // Don't update _lastDecisionAt on error — allow retry sooner
}

/**
 * Get a snapshot of the scheduler state.
 */
export function getSchedulerSnapshot(): SchedulerSnapshot {
  const now = Date.now();
  const timeSinceLastDecision = now - _lastDecisionAt;
  const timeSinceLastEvent = now - _lastEventAt;

  return {
    state: {
      inFlight: _inFlight,
      dirty: _dirty,
      lastDecisionAt: _lastDecisionAt,
      lastEventAt: _lastEventAt,
      coalescedCount: _coalescedSinceLastDecision,
      totalDecisions: _totalDecisions,
      totalEvents: _totalEvents,
      totalCoalesced: _totalCoalesced,
      totalInFlightRejected: _totalInFlightRejected,
      throttleMs: _throttleMs,
      active: _active,
    },
    wouldTrigger: _dirty && !_inFlight && timeSinceLastDecision >= _throttleMs,
    timeSinceLastDecisionMs: timeSinceLastDecision,
    timeSinceLastEventMs: timeSinceLastEvent,
  };
}

/**
 * Reset scheduler state (for testing).
 */
export function resetScheduler(): void {
  _inFlight = false;
  _dirty = false;
  _lastDecisionAt = 0;
  _lastEventAt = 0;
  _lastCoalesceAt = 0;
  _coalescedSinceLastDecision = 0;
  _totalDecisions = 0;
  _totalEvents = 0;
  _totalCoalesced = 0;
  _totalInFlightRejected = 0;
  _active = false;
  _callback = null;

  if (_throttleTimer) {
    clearTimeout(_throttleTimer);
    _throttleTimer = null;
  }
  if (_coalesceTimer) {
    clearTimeout(_coalesceTimer);
    _coalesceTimer = null;
  }
}

// ─── Internal ───────────────────────────────────────────────────────

function scheduleDecisionIfNeeded(
  reason: DecisionTriggerReason,
  symbol?: string,
): void {
  if (!_active || !_callback) return;

  const now = Date.now();
  const timeSinceLastDecision = now - _lastDecisionAt;

  // In-flight protection: don't trigger if already processing
  if (_inFlight) {
    _totalInFlightRejected++;
    _dirty = true; // remember that we need to re-evaluate
    logger.debug(
      "decision-scheduler",
      `In-flight rejection (total: ${_totalInFlightRejected})`,
    );
    return;
  }

  // Throttle: don't trigger if too soon since last decision
  if (timeSinceLastDecision < _throttleMs && reason !== "POSITION_CHANGE" && reason !== "MANUAL") {
    _dirty = true;
    scheduleThrottledCheck(_throttleMs - timeSinceLastDecision);
    return;
  }

  // Position changes use shorter throttle
  if (reason === "POSITION_CHANGE" && timeSinceLastDecision < POSITION_CHANGE_THROTTLE_MS) {
    _dirty = true;
    scheduleThrottledCheck(POSITION_CHANGE_THROTTLE_MS - timeSinceLastDecision);
    return;
  }

  // Trigger decision
  triggerDecision(reason, symbol);
}

function triggerDecision(reason: DecisionTriggerReason, symbol?: string): void {
  if (!_active || !_callback || _inFlight) return;

  _inFlight = true;
  _dirty = false;

  const trigger: DecisionTrigger = {
    reason,
    timestamp: Date.now(),
    symbol: symbol ?? undefined,
  };

  logger.info(
    "decision-scheduler",
    `Decision triggered: ${reason}${symbol ? ` (${symbol})` : ""}`,
  );

  // Fire-and-forget with error handling
  Promise.resolve()
    .then(() => _callback!(trigger))
    .catch((err) => {
      logger.error("decision-scheduler", `Decision callback error: ${err}`);
      onDecisionError();
    });
}

function scheduleThrottledCheck(delayMs: number): void {
  if (_throttleTimer) return; // already scheduled

  _throttleTimer = setTimeout(() => {
    _throttleTimer = null;

    if (!_active || !_dirty || _inFlight) return;

    const now = Date.now();
    const timeSinceLastDecision = now - _lastDecisionAt;

    if (timeSinceLastDecision >= _throttleMs) {
      triggerDecision("THROTTLE_INTERVAL");
    } else {
      // Still within throttle — reschedule
      scheduleThrottledCheck(_throttleMs - timeSinceLastDecision);
    }
  }, delayMs);
}
