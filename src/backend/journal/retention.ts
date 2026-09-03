/**
 * Journal Retention — BINANCE AI FUTURES AGENT v0.1
 *
 * M-3: Automatic journal retention enforcement.
 *
 * Retention policy:
 * - 10 days maximum
 * - Anything older than 10 days is automatically deleted
 * - Runs through the server-side journal/orchestrator lifecycle
 * - Cannot create duplicate schedulers
 *
 * Session-day handling:
 * - Uses Asia/Jakarta timezone (UTC+7)
 * - Daily rollover corresponds to Indonesian local midnight
 * - Session day boundary: 00:00 WIB (17:00 UTC)
 */

import { logger } from "../logger";

// ─── Configuration ───────────────────────────────────────────────────

/** Maximum retention period: 10 days */
const RETENTION_DAYS = 10;

/** Retention check interval: 1 hour */
const RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Session timezone: Asia/Jakarta (UTC+7) */
const SESSION_TIMEZONE = "Asia/Jakarta";
const SESSION_UTC_OFFSET_HOURS = 7;

// ─── State ───────────────────────────────────────────────────────────

let _retentionTimer: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _lastCleanupAt = 0;
let _cleanupCount = 0;

/**
 * Callback to perform the actual cleanup.
 * Set by the orchestrator/runtime.
 */
let _cleanupCallback: ((cutoffTimestamp: number) => number) | null = null;

// ─── Session Day Calculation ─────────────────────────────────────────

/**
 * Get the current session day in Asia/Jakarta timezone.
 * Returns a string like "2026-09-02" representing the local date.
 */
export function getSessionDay(now?: number): string {
  const timestamp = now ?? Date.now();
  // Convert to Asia/Jakarta time (UTC+7)
  const jakartaTime = new Date(timestamp + SESSION_UTC_OFFSET_HOURS * 3600 * 1000);
  const year = jakartaTime.getUTCFullYear();
  const month = String(jakartaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jakartaTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the session-day boundary (midnight WIB) as a UTC timestamp.
 * @param dayOffset - Number of days to offset from today (0 = today, -1 = yesterday)
 */
export function getSessionDayBoundary(dayOffset: number = 0): number {
  const now = Date.now();
  const jakartaTime = new Date(now + SESSION_UTC_OFFSET_HOURS * 3600 * 1000);
  
  // Set to midnight WIB
  jakartaTime.setUTCHours(0, 0, 0, 0);
  
  // Apply offset
  jakartaTime.setUTCDate(jakartaTime.getUTCDate() + dayOffset);
  
  // Convert back to UTC timestamp
  return jakartaTime.getTime() - SESSION_UTC_OFFSET_HOURS * 3600 * 1000;
}

/**
 * Check if the current time has crossed a session-day boundary.
 * Used to trigger daily resets.
 */
export function hasSessionDayChanged(previousDay: string): boolean {
  return getSessionDay() !== previousDay;
}

// ─── Retention Enforcement ───────────────────────────────────────────

/**
 * Start automatic retention enforcement.
 * Idempotent — safe to call multiple times.
 * Only one timer runs at a time.
 */
export function startRetentionEnforcement(
  cleanupFn: (cutoffTimestamp: number) => number,
): void {
  if (_running) {
    logger.debug("retention", "Already running — skipping start");
    return;
  }

  _cleanupCallback = cleanupFn;
  _running = true;

  // Run initial cleanup
  enforceRetentionPolicy();

  // Set up interval
  _retentionTimer = setInterval(() => {
    if (!_running) return;
    enforceRetentionPolicy();
  }, RETENTION_CHECK_INTERVAL_MS);

  logger.info(
    "retention",
    `Retention enforcement started (interval: ${RETENTION_CHECK_INTERVAL_MS / 60000}min, retention: ${RETENTION_DAYS} days)`,
  );
}

/**
 * Stop retention enforcement.
 */
export function stopRetentionEnforcement(): void {
  if (_retentionTimer !== null) {
    clearInterval(_retentionTimer);
    _retentionTimer = null;
  }
  _running = false;
  _cleanupCallback = null;
  logger.info("retention", "Retention enforcement stopped");
}

/**
 * Check if retention enforcement is running.
 */
export function isRetentionRunning(): boolean {
  return _running;
}

/**
 * Get retention stats.
 */
export function getRetentionStats(): {
  running: boolean;
  lastCleanupAt: number;
  cleanupCount: number;
  retentionDays: number;
} {
  return {
    running: _running,
    lastCleanupAt: _lastCleanupAt,
    cleanupCount: _cleanupCount,
    retentionDays: RETENTION_DAYS,
  };
}

/**
 * Force a retention cleanup (for testing or manual trigger).
 */
export function enforceRetentionPolicy(): number {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  if (!_cleanupCallback) {
    logger.warn("retention", "No cleanup callback set");
    return 0;
  }

  const deleted = _cleanupCallback(cutoffMs);
  _lastCleanupAt = Date.now();
  _cleanupCount++;

  if (deleted > 0) {
    logger.info(
      "retention",
      `Retention cleanup #${_cleanupCount}: deleted ${deleted} old journal events (cutoff: ${new Date(cutoffMs).toISOString()})`,
    );
  }

  return deleted;
}

/**
 * Reset state (for testing only).
 */
export function resetRetentionState(): void {
  stopRetentionEnforcement();
  _lastCleanupAt = 0;
  _cleanupCount = 0;
}

// ─── Review Retention ────────────────────────────────────────────────

let _reviewRetentionTimer: ReturnType<typeof setInterval> | null = null;
let _reviewRunning = false;

/**
 * Start review retention enforcement.
 * Separated from journal retention to avoid duplicate timers.
 */
export function startReviewRetentionEnforcement(
  cleanupFn: (cutoffTimestamp: number) => number,
): void {
  if (_reviewRunning) {
    logger.debug("retention", "Review retention already running");
    return;
  }

  _reviewRunning = true;

  const checkAndCleanup = () => {
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const deleted = cleanupFn(cutoffMs);
    if (deleted > 0) {
      logger.info("retention", `Review retention: deleted ${deleted} old reviews`);
    }
  };

  // Run initial
  checkAndCleanup();

  _reviewRetentionTimer = setInterval(checkAndCleanup, RETENTION_CHECK_INTERVAL_MS);
}

/**
 * Stop review retention.
 */
export function stopReviewRetentionEnforcement(): void {
  if (_reviewRetentionTimer !== null) {
    clearInterval(_reviewRetentionTimer);
    _reviewRetentionTimer = null;
  }
  _reviewRunning = false;
}
