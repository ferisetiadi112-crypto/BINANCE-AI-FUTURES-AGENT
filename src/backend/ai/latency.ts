/**
 * Latency Telemetry — P7D-5.4
 *
 * Measures actual latency from Binance event → system → AI decision.
 * Uses high-resolution timestamps (performance.now()) for accurate duration measurement.
 *
 * Pipeline stages:
 *   BINANCE_EVENT → MARKET_RECEIVED → STATE_UPDATED → DECISION_EVENT →
 *   CONTEXT_BUILT → LLM_START → LLM_RESPONSE → DECISION_COMPLETED
 *
 * SAFETY:
 * - Purely read-only telemetry — never modifies any state
 * - No secrets in telemetry data
 * - Bounded memory (ring buffer of recent latencies)
 * - No network calls
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

/** Single pipeline stage measurement */
export type LatencyStage = {
  name: string;
  timestamp: number; // performance.now() high-resolution
  wallTime: number;  // Date.now() wall clock
};

/** Latency measurement for one complete pipeline run */
export type LatencyMeasurement = {
  id: string;
  symbol: string;
  startedAt: number;      // wall clock
  startedHr: number;      // high-resolution
  stages: LatencyStage[];
  completedAt: number | null;
  completedHr: number | null;
  error: string | null;
  /** Computed durations (ms) */
  durations: {
    eventToState: number | null;
    stateToContext: number | null;
    contextToLLMStart: number | null;
    llmDuration: number | null;
    totalPipeline: number | null;
  };
};

/** Snapshot of current latency metrics */
export type LatencySnapshot = {
  /** Current pipeline */
  current: LatencyMeasurement | null;
  /** Last completed measurement */
  lastCompleted: LatencyMeasurement | null;
  /** Aggregate metrics */
  aggregate: {
    totalMeasurements: number;
    totalErrors: number;
    avgEventToStateMs: number;
    avgStateToContextMs: number;
    avgContextToLLMStartMs: number;
    avgLLMLatencyMs: number;
    avgTotalPipelineMs: number;
    p95LLMLatencyMs: number;
    p95TotalPipelineMs: number;
    maxLLMLatencyMs: number;
    maxTotalPipelineMs: number;
  };
  /** Recent measurements (bounded ring buffer) */
  recentMeasurements: LatencyMeasurement[];
  /** Event counts */
  counts: {
    marketEvents: number;
    decisionTriggers: number;
    llmRequests: number;
    llmErrors: number;
    coalesced: number;      // events that were coalesced (not triggering new decision)
    inFlightRejected: number; // decisions rejected because one was already in-flight
  };
};

// ─── Constants ──────────────────────────────────────────────────────

const MAX_RECENT = 50; // bounded ring buffer
const MAX_COMPLETED_DURATIONS = 200; // for aggregate calculations

// ─── Singleton State ────────────────────────────────────────────────

let _current: LatencyMeasurement | null = null;
let _lastCompleted: LatencyMeasurement | null = null;
let _recentCompleted: LatencyMeasurement[] = [];
let _completedDurations: {
  eventToState: number[];
  stateToContext: number[];
  contextToLLMStart: number[];
  llmDuration: number[];
  totalPipeline: number[];
} = {
  eventToState: [],
  stateToContext: [],
  contextToLLMStart: [],
  llmDuration: [],
  totalPipeline: [],
};

let _counts = {
  marketEvents: 0,
  decisionTriggers: 0,
  llmRequests: 0,
  llmErrors: 0,
  coalesced: 0,
  inFlightRejected: 0,
};

// ─── High-Resolution Helpers ────────────────────────────────────────

/** Get high-resolution timestamp (performance.now() if available, fallback to Date.now()) */
function hrNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** Safe duration calculation — never returns negative */
function safeDuration(startHr: number, endHr: number): number {
  const d = endHr - startHr;
  return d >= 0 ? d : 0;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Start a new latency measurement for a decision pipeline.
 * Call this when a market event triggers a decision cycle.
 *
 * @param symbol - The trading symbol being analyzed
 * @returns The measurement ID (for endLatencyMeasurement)
 */
export function startLatencyMeasurement(symbol: string): string {
  const id = `LAT-${Date.now()}-${symbol}`;
  const now = Date.now();
  const hr = hrNow();

  _current = {
    id,
    symbol,
    startedAt: now,
    startedHr: hr,
    stages: [{ name: "MARKET_RECEIVED", timestamp: hr, wallTime: now }],
    completedAt: null,
    completedHr: null,
    error: null,
    durations: {
      eventToState: null,
      stateToContext: null,
      contextToLLMStart: null,
      llmDuration: null,
      totalPipeline: null,
    },
  };

  _counts.marketEvents++;
  return id;
}

/**
 * Record a pipeline stage timestamp.
 * Call this at each stage transition.
 *
 * @param stageName - Name of the stage (e.g., "STATE_UPDATED", "CONTEXT_BUILT")
 */
export function recordLatencyStage(stageName: string): void {
  if (!_current) return;

  const now = Date.now();
  const hr = hrNow();
  _current.stages.push({ name: stageName, timestamp: hr, wallTime: now });
}

/**
 * Complete the current latency measurement.
 * Calculates all durations and stores the result.
 *
 * @param error - Optional error message if the pipeline failed
 */
export function completeLatencyMeasurement(error?: string): void {
  if (!_current) return;

  const now = Date.now();
  const hr = hrNow();
  _current.completedAt = now;
  _current.completedHr = hr;
  _current.error = error || null;

  // Calculate durations from stage timestamps
  const stages = _current.stages;
  const findStage = (name: string) => stages.find((s) => s.name === name);

  const marketReceived = findStage("MARKET_RECEIVED");
  const stateUpdated = findStage("STATE_UPDATED");
  const contextBuilt = findStage("CONTEXT_BUILT");
  const llmStart = findStage("LLM_START");
  const llmResponse = findStage("LLM_RESPONSE");
  const decisionCompleted = findStage("DECISION_COMPLETED");

  if (marketReceived && stateUpdated) {
    _current.durations.eventToState = safeDuration(marketReceived.timestamp, stateUpdated.timestamp);
  }
  if (stateUpdated && contextBuilt) {
    _current.durations.stateToContext = safeDuration(stateUpdated.timestamp, contextBuilt.timestamp);
  }
  if (contextBuilt && llmStart) {
    _current.durations.contextToLLMStart = safeDuration(contextBuilt.timestamp, llmStart.timestamp);
  }
  if (llmStart && llmResponse) {
    _current.durations.llmDuration = safeDuration(llmStart.timestamp, llmResponse.timestamp);
  }
  if (marketReceived && decisionCompleted) {
    _current.durations.totalPipeline = safeDuration(marketReceived.timestamp, decisionCompleted.timestamp);
  }

  // Store completed measurement
  _lastCompleted = _current;
  _recentCompleted.push({ ..._current });
  if (_recentCompleted.length > MAX_RECENT) {
    _recentCompleted.shift();
  }

  // Store durations for aggregate calculation
  const d = _current.durations;
  if (d.eventToState !== null) pushBounded(_completedDurations.eventToState, d.eventToState);
  if (d.stateToContext !== null) pushBounded(_completedDurations.stateToContext, d.stateToContext);
  if (d.contextToLLMStart !== null) pushBounded(_completedDurations.contextToLLMStart, d.contextToLLMStart);
  if (d.llmDuration !== null) pushBounded(_completedDurations.llmDuration, d.llmDuration);
  if (d.totalPipeline !== null) pushBounded(_completedDurations.totalPipeline, d.totalPipeline);

  if (error) {
    _counts.llmErrors++;
  }
  _counts.llmRequests++;

  _current = null;
}

/**
 * Get a snapshot of current latency metrics.
 * Primary read method — consistent snapshot at one point in time.
 */
export function getLatencySnapshot(): LatencySnapshot {
  return {
    current: _current ? { ..._current } : null,
    lastCompleted: _lastCompleted ? { ..._lastCompleted } : null,
    aggregate: {
      totalMeasurements: _counts.llmRequests,
      totalErrors: _counts.llmErrors,
      avgEventToStateMs: avg(_completedDurations.eventToState),
      avgStateToContextMs: avg(_completedDurations.stateToContext),
      avgContextToLLMStartMs: avg(_completedDurations.contextToLLMStart),
      avgLLMLatencyMs: avg(_completedDurations.llmDuration),
      avgTotalPipelineMs: avg(_completedDurations.totalPipeline),
      p95LLMLatencyMs: percentile(_completedDurations.llmDuration, 95),
      p95TotalPipelineMs: percentile(_completedDurations.totalPipeline, 95),
      maxLLMLatencyMs: max(_completedDurations.llmDuration),
      maxTotalPipelineMs: max(_completedDurations.totalPipeline),
    },
    recentMeasurements: _recentCompleted.map((m) => ({ ...m })),
    counts: { ..._counts },
  };
}

/**
 * Record a market event (for counting).
 */
export function recordMarketEvent(): void {
  _counts.marketEvents++;
}

/**
 * Record a decision trigger.
 */
export function recordDecisionTrigger(): void {
  _counts.decisionTriggers++;
}

/**
 * Record a coalesced event (event that was absorbed, not triggering new decision).
 */
export function recordCoalesced(): void {
  _counts.coalesced++;
}

/**
 * Record an in-flight rejection (decision rejected because one was already running).
 */
export function recordInFlightRejected(): void {
  _counts.inFlightRejected++;
}

/**
 * Reset all telemetry (for testing).
 */
export function resetLatencyTelemetry(): void {
  _current = null;
  _lastCompleted = null;
  _recentCompleted = [];
  _completedDurations = {
    eventToState: [],
    stateToContext: [],
    contextToLLMStart: [],
    llmDuration: [],
    totalPipeline: [],
  };
  _counts = {
    marketEvents: 0,
    decisionTriggers: 0,
    llmRequests: 0,
    llmErrors: 0,
    coalesced: 0,
    inFlightRejected: 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function pushBounded(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > MAX_COMPLETED_DURATIONS) {
    arr.shift();
  }
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function max(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.max(...arr);
}
