/**
 * Periodic Reporting — BINANCE AI FUTURES AGENT v0.1
 *
 * H-3: The AI must generate at least ONE journal report every 30 minutes
 * while the agent is running. This is a MAXIMUM GAP requirement.
 *
 * The report represents REAL system state:
 * - Current positions and PnL
 * - Risk engine state
 * - Latest market analysis
 * - Why no trade was made (if applicable)
 *
 * NO fabricated activity. If market is quiet, report says so honestly.
 *
 * Uses a server-side timer associated with the running agent.
 * Avoids duplicate timers when orchestrator restarts.
 */

import { logger } from "../logger";
import { recordPeriodicReport, recordSystemStarted } from "./index";

// ─── Configuration ───────────────────────────────────────────────────

/** Maximum gap between reports: 30 minutes */
const REPORT_INTERVAL_MS = 30 * 60 * 1000;

// ─── State ───────────────────────────────────────────────────────────

let _reportTimer: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _lastReportAt = 0;
let _reportCount = 0;

/**
 * Optional callback to get current system state for reports.
 * Set by the orchestrator/runtime on start.
 */
let _getStateCallback: (() => {
  dailyPnl: number;
  sessionPnl: number;
  isLocked: boolean;
  openPositions: number;
  cooldownActive: boolean;
  recentActivity: string;
}) | null = null;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Start periodic reporting.
 * Idempotent — safe to call multiple times.
 * Only one timer runs at a time.
 */
export function startPeriodicReporting(
  getState: () => {
    dailyPnl: number;
    sessionPnl: number;
    isLocked: boolean;
    openPositions: number;
    cooldownActive: boolean;
    recentActivity: string;
  },
): void {
  if (_running) {
    logger.debug("periodic-report", "Already running — skipping start");
    return;
  }

  _getStateCallback = getState;
  _running = true;
  _lastReportAt = Date.now();

  // Record system started event
  recordSystemStarted();

  // Generate initial report
  generateReport();

  // Set up interval — 30 minutes maximum gap
  _reportTimer = setInterval(() => {
    if (!_running) return;
    generateReport();
  }, REPORT_INTERVAL_MS);

  logger.info(
    "periodic-report",
    `Periodic reporting started (interval: ${REPORT_INTERVAL_MS / 1000}s)`,
  );
}

/**
 * Stop periodic reporting.
 */
export function stopPeriodicReporting(): void {
  if (_reportTimer !== null) {
    clearInterval(_reportTimer);
    _reportTimer = null;
  }
  _running = false;
  _getStateCallback = null;
  logger.info("periodic-report", "Periodic reporting stopped");
}

/**
 * Check if periodic reporting is running.
 */
export function isPeriodicReportingRunning(): boolean {
  return _running;
}

/**
 * Get time since last report in ms.
 * Returns 0 if no report has been generated.
 */
export function getTimeSinceLastReport(): number {
  return _lastReportAt > 0 ? Date.now() - _lastReportAt : 0;
}

/**
 * Get report count.
 */
export function getReportCount(): number {
  return _reportCount;
}

/**
 * Force a report generation (for testing or manual trigger).
 */
export function forceReport(): void {
  generateReport();
}

/**
 * Reset state (for testing only).
 */
export function resetReportingState(): void {
  stopPeriodicReporting();
  _lastReportAt = 0;
  _reportCount = 0;
}

// ─── Report Generation ───────────────────────────────────────────────

function generateReport(): void {
  const state = _getStateCallback?.();

  const now = Date.now();
  const gapMs = _lastReportAt > 0 ? now - _lastReportAt : 0;

  // Build report from REAL state only
  let reportContent: string;

  if (!state) {
    reportContent = "System state unavailable — periodic report skipped";
    logger.warn("periodic-report", "No state callback available");
    return;
  }

  const parts: string[] = [];

  // Header
  parts.push(`=== PERIODIC REPORT #${_reportCount + 1} ===`);
  parts.push(`Time: ${new Date(now).toISOString()}`);
  if (gapMs > 0) {
    parts.push(`Gap since last report: ${(gapMs / 60000).toFixed(1)} min`);
  }

  // Risk state
  parts.push("");
  parts.push("--- Risk State ---");
  parts.push(`Daily PnL: $${state.dailyPnl.toFixed(4)}`);
  parts.push(`Session PnL: $${state.sessionPnl.toFixed(4)}`);
  parts.push(`Locked: ${state.isLocked}`);
  parts.push(`Open positions: ${state.openPositions}`);
  parts.push(`Cooldown active: ${state.cooldownActive}`);

  // Activity summary
  parts.push("");
  parts.push("--- Activity ---");
  parts.push(state.recentActivity || "No recent activity");

  reportContent = parts.join("\n");

  // Record via journal (real state only)
  recordPeriodicReport(reportContent, {
    dailyPnl: state.dailyPnl,
    sessionPnl: state.sessionPnl,
    isLocked: state.isLocked,
    openPositions: state.openPositions,
    cooldownActive: state.cooldownActive,
  });

  _lastReportAt = now;
  _reportCount++;

  logger.info(
    "periodic-report",
    `Report #${_reportCount} generated (gap: ${(gapMs / 60000).toFixed(1)} min)`,
  );
}
