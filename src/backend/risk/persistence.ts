/**
 * Risk State Persistence — BINANCE AI FUTURES AGENT v0.1
 *
 * Persists critical Risk Engine state to the database.
 * State survives server restarts and cold starts.
 *
 * Persisted values:
 * - daily_pnl: Current day's realized PnL
 * - is_locked: Whether the system is locked
 * - lock_reason: Reason for the lock
 *
 * On startup, the Risk Engine loads persisted state from the database.
 * On state changes, the Risk Engine saves to the database.
 */

import { dbQueryOne, dbExecute, isPostgresConfigured } from "../database/adapter";
import { getDatabase } from "../database";
import { logger } from "../logger";

// ─── Types ───────────────────────────────────────────────────────────

export type PersistedRiskState = {
  dailyPnl: number;
  isLocked: boolean;
  lockReason: string;
};

// ─── Internal Helpers ───────────────────────────────────────────────

/**
 * Execute a query that returns a single value.
 * Uses PostgreSQL (async) in production, SQLite (sync) in tests.
 * NOTE: In tests, this writes to/reads from the file-based SQLite at data/agent.db.
 * Tests should use save/load directly and verify the round-trip.
 */
async function queryValue(sql: string): Promise<string | undefined> {
  if (isPostgresConfigured()) {
    const row = await dbQueryOne(sql);
    return row?.["value"] as string | undefined;
  }
  // SQLite path (tests/dev)
  const db = getDatabase();
  const row = db.prepare(sql.replace(/\$1/g, "?")).get() as { value: string } | undefined;
  return row?.value;
}

// ─── Persistence Functions ───────────────────────────────────────────

/**
 * Load persisted risk state from the database.
 * Returns default values if no state is persisted.
 */
export async function loadRiskState(): Promise<PersistedRiskState> {
  try {
    const dailyPnl = await queryValue("SELECT value FROM risk_state WHERE key = 'daily_pnl'");
    const isLocked = await queryValue("SELECT value FROM risk_state WHERE key = 'is_locked'");
    const lockReason = await queryValue("SELECT value FROM risk_state WHERE key = 'lock_reason'");

    return {
      dailyPnl: parseFloat(dailyPnl || "0") || 0,
      isLocked: isLocked === "true",
      lockReason: lockReason || "",
    };
  } catch (error) {
    logger.warn("risk-persistence", `Failed to load risk state: ${error}`);
    return { dailyPnl: 0, isLocked: false, lockReason: "" };
  }
}

/**
 * Save risk state to the database.
 * Uses UPSERT to handle both insert and update.
 */
export async function saveRiskState(state: PersistedRiskState): Promise<void> {
  try {
    if (isPostgresConfigured()) {
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('daily_pnl', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [String(state.dailyPnl)]
      );
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('is_locked', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [String(state.isLocked)]
      );
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('lock_reason', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [state.lockReason]
      );
    } else {
      const db = getDatabase();
      const upsert = db.prepare(`
        INSERT INTO risk_state (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
      `);
      upsert.run("daily_pnl", String(state.dailyPnl), String(state.dailyPnl));
      upsert.run("is_locked", String(state.isLocked), String(state.isLocked));
      upsert.run("lock_reason", state.lockReason, state.lockReason);
    }
  } catch (error) {
    logger.error("risk-persistence", `Failed to save risk state: ${error}`);
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
        [String(pnl)]
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
export async function saveLockState(isLocked: boolean, reason: string): Promise<void> {
  try {
    if (isPostgresConfigured()) {
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('is_locked', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [String(isLocked)]
      );
      await dbExecute(
        `INSERT INTO risk_state (key, value, updated_at) VALUES ('lock_reason', $1, NOW()::TEXT)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT`,
        [reason]
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
