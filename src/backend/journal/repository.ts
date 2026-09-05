/**
 * Journal Repository — BINANCE AI FUTURES AGENT v0.1
 *
 * Persistent storage for journal events in PostgreSQL/SQLite.
 * Used as source of truth for the AI Logbook dashboard.
 *
 * Architecture:
 *   recordJournalEvent() → JournalRepository.append() → PostgreSQL/SQLite
 *   getAiLogbook()       → JournalRepository.getRecent() → PostgreSQL/SQLite
 *
 * Key Principle:
 *   Database is source of truth. In-memory buffer is cache.
 *   DB write failure does NOT crash the runtime.
 */

import { dbQuery, dbQueryOne, dbExecute } from "../database";
import { logger } from "../logger";
import type { JournalEvent, JournalEventType, JournalImportance } from "./index";

// ─── Serialization Helpers ─────────────────────────────────────────

function serializePosition(position: JournalEvent["position"]): string | null {
  if (!position) return null;
  return JSON.stringify(position);
}

function serializeRiskDecision(riskDecision: JournalEvent["riskDecision"]): string | null {
  if (!riskDecision) return null;
  return JSON.stringify(riskDecision);
}

function serializeDetails(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  return JSON.stringify(details);
}

function serializeAiState(aiState: JournalEvent["aiState"]): string | null {
  if (!aiState) return null;
  return JSON.stringify(aiState);
}

function deserializeJson<T>(data: string | null): T | undefined {
  if (!data) return undefined;
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

// ─── Row → JournalEvent ───────────────────────────────────────────

function rowToEvent(row: Record<string, unknown>): JournalEvent {
  const symbol = row["symbol"] as string | null;
  const action = row["action"] as string | null;
  const reasoning = row["reasoning"] as string | null;
  const tradeId = row["trade_id"] as string | null;
  const decisionId = row["decision_id"] as string | null;
  const aiState = deserializeJson<NonNullable<JournalEvent["aiState"]>>(row["ai_state_data"] as string | null);
  const position = deserializeJson<NonNullable<JournalEvent["position"]>>(row["position_data"] as string | null);
  const riskDecision = deserializeJson<NonNullable<JournalEvent["riskDecision"]>>(row["risk_decision_data"] as string | null);
  const details = deserializeJson<Record<string, unknown>>(row["details_data"] as string | null);
  const pnlRaw = row["pnl"] as number | null;

  return {
    id: row["id"] as string,
    timestamp: row["timestamp"] as number,
    eventType: row["event_type"] as JournalEventType,
    importance: row["importance"] as JournalImportance,
    ...(symbol != null ? { symbol } : {}),
    message: row["message"] as string,
    ...(aiState != null ? { aiState } : {}),
    ...(action != null ? { action } : {}),
    ...(pnlRaw != null ? { pnl: pnlRaw } : {}),
    ...(position != null ? { position } : {}),
    ...(riskDecision != null ? { riskDecision } : {}),
    ...(reasoning != null ? { reasoning } : {}),
    ...(tradeId != null ? { tradeId } : {}),
    ...(decisionId != null ? { decisionId } : {}),
    ...(details != null ? { details } : {}),
  };
}

// ─── Repository Operations ────────────────────────────────────────

/**
 * Append a single journal event to the database.
 * Fire-and-forget: logs error but does not throw.
 */
export async function appendJournalEvent(event: JournalEvent): Promise<void> {
  try {
    await dbExecute(
      `INSERT INTO journal_events
        (id, timestamp, event_type, importance, symbol, message,
         position_data, risk_decision_data, reasoning, pnl, action,
         trade_id, decision_id, details_data, ai_state_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.timestamp,
        event.eventType,
        event.importance,
        event.symbol ?? null,
        event.message,
        serializePosition(event.position),
        serializeRiskDecision(event.riskDecision),
        event.reasoning ?? null,
        event.pnl ?? null,
        event.action ?? null,
        event.tradeId ?? null,
        event.decisionId ?? null,
        serializeDetails(event.details),
        serializeAiState(event.aiState),
      ]
    );
  } catch (err) {
    // DB write failure must NOT crash the trading runtime
    logger.warn(
      "journal-repository",
      `Failed to persist journal event ${event.id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Get recent journal events from the database, ordered by timestamp descending.
 */
export async function getRecentJournalEventsFromDB(
  limit: number = 500
): Promise<JournalEvent[]> {
  try {
    const rows = await dbQuery(
      `SELECT * FROM journal_events ORDER BY timestamp DESC LIMIT $1`,
      [limit]
    );
    return rows.map(rowToEvent);
  } catch (err) {
    logger.warn(
      "journal-repository",
      `Failed to read journal events: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/**
 * Get a single journal event by ID.
 */
export async function getJournalEventById(
  id: string
): Promise<JournalEvent | null> {
  try {
    const row = await dbQueryOne(
      `SELECT * FROM journal_events WHERE id = $1`,
      [id]
    );
    return row ? rowToEvent(row) : null;
  } catch (err) {
    logger.warn(
      "journal-repository",
      `Failed to read journal event ${id}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Count total journal events in the database.
 */
export async function countJournalEvents(): Promise<number> {
  try {
    const row = await dbQueryOne(
      `SELECT COUNT(*) as count FROM journal_events`
    );
    return parseInt((row?.["count"] as string) || "0", 10);
  } catch (err) {
    logger.warn(
      "journal-repository",
      `Failed to count journal events: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}

/**
 * Get journal events from a time range.
 */
export async function getJournalEventsInRange(
  from: number,
  to: number
): Promise<JournalEvent[]> {
  try {
    const rows = await dbQuery(
      `SELECT * FROM journal_events WHERE timestamp >= $1 AND timestamp <= $2 ORDER BY timestamp DESC`,
      [from, to]
    );
    return rows.map(rowToEvent);
  } catch (err) {
    logger.warn(
      "journal-repository",
      `Failed to read journal events in range: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/**
 * Get journal events grouped by calendar date (UTC day of the event).
 * Returns distinct dates newest-first, plus the total count per date.
 * Used by the Dashboard to build the daily Journal without overwriting
 * previous days — no destructive reset ever happens at midnight.
 */
export async function getJournalEventDates(
  limit: number = 30
): Promise<Array<{ date: string; count: number }>> {
  try {
    const rows = await dbQuery(
      `SELECT date(timestamp / 1000, 'unixepoch') as event_date, COUNT(*) as count
       FROM journal_events
       GROUP BY event_date
       ORDER BY event_date DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      date: r["event_date"] as string,
      count: parseInt(String(r["count"] ?? "0"), 10),
    }));
  } catch (err) {
    logger.warn(
      "journal-repository",
      `Failed to read journal event dates: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}
