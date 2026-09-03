/**
 * Risk State Persistence — BINANCE AI FUTURES AGENT v0.1
 *
 * Persists critical Risk Engine state to the database.
 * State survives server restarts and cold starts.
 *
 * M-1 FAIL CLOSED: If persistent risk state cannot be loaded reliably,
 * TRADING MUST BE LOCKED. Risk state uncertainty = NO TRADE.
 *
 * Persisted values:
 * - daily_pnl: Current day's realized PnL
 * - session_pnl: Current session realized PnL
 * - is_locked: Whether the system is locked
 * - lock_reason: Reason for the lock
 * - cooldown_ends_at: Cooldown expiry timestamp (ms)
 * - hard_cap_reached: Whether hard profit cap was reached
 * - open_position_margin: Total margin allocated to open positions
 * - open_position_count: Number of open positions
 */

import {
  dbQueryOne,
  dbExecute,
  isPostgresConfigured,
} from "../database/adapter";
import { getDatabase } from "../database";
import { logger } from "../logger";

// ─── Types ───────────────────────────────────────────────────────────

export type PersistedRiskState = {
  dailyPnl: number;
  sessionPnl: number;
  isLocked: boolean;
  lockReason: string;
  cooldownEndsAt: number | null;
  hardCapReached: boolean;
  openPositionMargin: number;
  openPositionCount: number;
};

/** State returned when DB is unavailable — fail closed */
const FAIL_CLOSED_STATE: PersistedRiskState = {
  dailyPnl: 0,
  sessionPnl: 0,
  isLocked: true,
  lockReason: "Risk state unavailable — fail closed (database error)",
  cooldownEndsAt: null,
  hardCapReached: false,
  openPositionMargin: 0,
  openPositionCount: 0,
};

// ─── Internal Helpers ───────────────────────────────────────────────

async function queryValue(sql: string): Promise<string | undefined> {
  if (isPostgresConfigured()) {
    const row = await dbQueryOne(sql);
    return row?.["value"] as string | undefined;
  }
  const db = getDatabase();
  const row = db
    .prepare(sql.replace(/\$1/g, "?"))
    .get() as { value: string } | undefined;
  return row?.value;
}

// ─── Persistence Functions ───────────────────────────────────────────

/**
 * M-1: Load persisted risk state from the database.
 * Returns FAIL-CLOSED state if DB is unavailable or query fails.
 * This ensures trading is locked when state is uncertain.
 */
export async function loadRiskState(): Promise<PersistedRiskState> {
  try {
    const dailyPnl = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'daily_pnl'",
    );
    const sessionPnl = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'session_pnl'",
    );
    const isLocked = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'is_locked'",
    );
    const lockReason = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'lock_reason'",
    );
    const cooldownEndsAt = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'cooldown_ends_at'",
    );
    const hardCapReached = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'hard_cap_reached'",
    );
    const openPositionMargin = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'open_position_margin'",
    );
    const openPositionCount = await queryValue(
      "SELECT value FROM risk_state WHERE key = 'open_position_count'",
    );

    // Parse cooldown — if expiry is in the future, keep it active
    const cooldownMs = cooldownEndsAt ? parseInt(cooldownEndsAt, 10) : null;
    const activeCooldown =
      cooldownMs !== null && cooldownMs > Date.now() ? cooldownMs : null;

    return {
      dailyPnl: parseFloat(dailyPnl || "0") || 0,
      sessionPnl: parseFloat(sessionPnl || "0") || 0,
      isLocked: isLocked === "true" || activeCooldown !== null,
      lockReason: lockReason || (activeCooldown !== null ? "Cooldown active from previous session" : ""),
      cooldownEndsAt: activeCooldown,
      hardCapReached: hardCapReached === "true",
      openPositionMargin: parseFloat(openPositionMargin || "0") || 0,
      openPositionCount: parseInt(openPositionCount || "0", 10) || 0,
    };
  } catch (error) {
    // M-1: FAIL CLOSED — database failure means locked
    logger.warn(
      "risk-persistence",
      `Failed to load risk state — FAIL CLOSED: ${error}`,
    );
    return { ...FAIL_CLOSED_STATE };
  }
}

/**
 * Save the complete risk state to the database.
 * Uses UPSERT for each key.
 */
export async function saveRiskState(
  state: PersistedRiskState,
): Promise<void> {
  try {
    if (isPostgresConfigured()) {
      const entries: [string, string][] = [
        ["daily_pnl", String(state.dailyPnl)],
        ["session_pnl", String(state.sessionPnl)],
        ["is_locked", String(state.isLocked)],
        ["lock_reason", state.lockReason],
        [
          "cooldown_ends_at",
          state.cooldownEndsAt !== null ? String(state.cooldownEndsAt) : "",
        ],
        ["hard_cap_reached", String(state.hardCapReached)],
        ["open_position_margin", String(state.openPositionMargin)],
        ["open_position_count", String(state.openPositionCount)],
      ];
      for (const [key, value] of entries) {
        await dbExecute(
          `INSERT INTO risk_state (key, value, updated_at) VALUES ($1, $2, NOW()::TEXT)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()::TEXT`,
          [key, value],
        );
      }
    } else {
      const db = getDatabase();
      const upsert = db.prepare(`
        INSERT INTO risk_state (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
      `);
      const entries: [string, string][] = [
        ["daily_pnl", String(state.dailyPnl)],
        ["session_pnl", String(state.sessionPnl)],
        ["is_locked", String(state.isLocked)],
        ["lock_reason", state.lockReason],
        [
          "cooldown_ends_at",
          state.cooldownEndsAt !== null ? String(state.cooldownEndsAt) : "",
        ],
        ["hard_cap_reached", String(state.hardCapReached)],
        ["open_position_margin", String(state.openPositionMargin)],
        ["open_position_count", String(state.openPositionCount)],
      ];
      for (const [key, value] of entries) {
        upsert.run(key, value, value);
      }
    }
  } catch (error) {
    logger.error(
      "risk-persistence",
      `Failed to save risk state: ${error}`,
    );
  }
}

/**
 * Save only the daily PnL to the database.
 */
export async function saveDailyPnl(pnl: number): Promise<void> {
  try {
    if (isPostgresConfigured()) {
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('daily_pnl', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [String(pnl)],
      );
    } else {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO risk_state (key, value, updated_at)
        VALUES ('daily_pnl', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
      `).run(String(pnl), String(pnl));
    }
  } catch (error) {
    logger.error("risk-persistence", `Failed to save daily PnL: ${error}`);
  }
}

/**
 * Save only the lock state to the database.
 */
export async function saveLockState(
  isLocked: boolean,
  reason: string,
): Promise<void> {
  try {
    if (isPostgresConfigured()) {
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('is_locked', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [String(isLocked)],
      );
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('lock_reason', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [reason],
      );
    } else {
      const db = getDatabase();
      const upsert = db.prepare(`
        INSERT INTO risk_state (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
      `);
      upsert.run("is_locked", String(isLocked), String(isLocked));
      upsert.run("lock_reason", reason, reason);
    }
  } catch (error) {
    logger.error("risk-persistence", `Failed to save lock state: ${error}`);
  }
}
