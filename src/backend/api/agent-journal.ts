/**
 * Agent Journal API — persistent, database-backed dashboard journal.
 *
 * Serves the Dashboard's JOURNAL and LIVE WORK LOG sections from the
 * persistent `journal_events` table (source of truth). Data survives
 * page refresh, browser reconnect, AI reconnect, agent restart,
 * deployment and new AI sessions. Nothing here depends on AI memory,
 * chat state, React state or connection state.
 *
 * The Dashboard NEVER invents events: everything comes from real agent
 * events emitted on the AgentEventBus and persisted by the repository.
 */

import { createServerFn } from "@tanstack/react-start";
import type { ApiResponse } from "../../types/api";
import {
  getRecentJournalEventsFromDB,
  getJournalEventsInRange,
  getJournalEventDates,
} from "../journal/repository";
import { categorizeEvent } from "../journal/event-bus";

// ─── Types ─────────────────────────────────────────────────────────

export type AgentJournalEvent = {
  id: string;
  timestamp: number;
  /** ISO date string (UTC calendar day of the event), e.g. "2026-09-05". */
  date: string;
  time: string;
  eventType: string;
  category: string;
  symbol: string | null;
  action: string | null;
  message: string;
  status: string | null;
  pnl: number | null;
  position: {
    symbol: string;
    side: string;
    entryPrice: number;
    margin: number;
    leverage: number;
  } | null;
};

export type AgentJournalDay = {
  date: string;
  count: number;
  events: AgentJournalEvent[];
};

export type AgentJournalPayload = {
  /** Calendar dates that genuinely have events, newest first. */
  availableDates: Array<{ date: string; count: number }>;
  /** Journal entries for the requested date(s), oldest first within the day. */
  days: AgentJournalDay[];
  /** Latest persisted work-log entries (categorized, newest last). */
  workLog: AgentJournalEvent[];
  /** Server-generated timestamp for freshness display. */
  fetchedAt: string;
};

// ─── Helpers ───────────────────────────────────────────────────────

/** UTC calendar date for a timestamp, e.g. "2026-09-05". */
export function eventDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** HH:MM:SS clock time for a timestamp (UTC). */
export function eventTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 19);
}

function toAgentJournalEvent(e: Awaited<ReturnType<typeof getRecentJournalEventsFromDB>>[number]): AgentJournalEvent {
  return {
    id: e.id,
    timestamp: e.timestamp,
    date: eventDate(e.timestamp),
    time: eventTime(e.timestamp),
    eventType: e.eventType,
    category: categorizeEvent(e.eventType),
    symbol: e.symbol ?? null,
    action: e.action ?? null,
    message: e.message,
    status:
      e.riskDecision !== undefined
        ? e.riskDecision.approved
          ? "APPROVED"
          : "REJECTED"
        : null,
    pnl: typeof e.pnl === "number" ? e.pnl : null,
    position: e.position ?? null,
  };
}

/** Outcome events — completed activities shown as Journal entries. */
export const JOURNAL_OUTCOME_EVENTS: ReadonlySet<string> = new Set([
  "TRADE_OPENED",
  "POSITION_OPENED",
  "TRADE_CLOSED",
  "POSITION_CLOSED",
  "TRADE_REJECTED",
  "POST_TRADE_REVIEW",
  "STOP_LOSS",
  "TAKE_PROFIT",
  "TRADE_PROPOSED",
  "RISK_LOCKED",
  "DAILY_LOSS_LIMIT",
  "PROFIT_TARGET_REACHED",
  "HARD_PROFIT_CAP",
]);

const WORK_LOG_LIMIT = 40;
const MAX_EVENTS_PER_DAY = 300;

/**
 * Pure helper: group events by their calendar date.
 * Events append within each day; days never overwrite each other.
 * Exported for tests.
 */
export function groupEventsByDate(
  events: ReturnType<typeof getRecentJournalEventsFromDB> extends Promise<infer T> ? T : never,
): Array<{ date: string; count: number; events: ReturnType<typeof getRecentJournalEventsFromDB> extends Promise<infer T> ? T : never }> {
  const byDate = new Map<string, typeof events>();
  for (const e of events) {
    const d = eventDate(e.timestamp);
    const list = byDate.get(d);
    if (list) list.push(e);
    else byDate.set(d, [e]);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest date first
    .map(([date, list]) => {
      const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp); // oldest first within day (append-only)
      return { date, count: sorted.length, events: sorted };
    });
}

// ─── Server function ───────────────────────────────────────────────

export const getAgentJournal = createServerFn({ method: "GET" })
  .validator((input: { date?: string } | undefined) => input ?? {})
  .handler(async ({ data }): Promise<ApiResponse<AgentJournalPayload>> => {
    const dates = await getJournalEventDates(30);

    // Events for the requested date (default: today, UTC).
    // Historical dates remain permanently available — midnight only
    // changes the UI date filter, never the stored data.
    const selectedDate = data?.date ?? dates[0]?.date ?? eventDate(Date.now());
    const selected = dates.find((d) => d.date === selectedDate);

    let dayEvents: Awaited<ReturnType<typeof getRecentJournalEventsFromDB>> = [];
    if (selected) {
      const from = Date.parse(`${selectedDate}T00:00:00.000Z`);
      const to = from + 24 * 60 * 60 * 1000 - 1;
      const all = await getJournalEventsInRange(from, to);
      dayEvents = all.slice(-MAX_EVENTS_PER_DAY); // newest up to cap
    }

    // Work log: latest persisted events of any kind, capped, oldest last.
    const recent = await getRecentJournalEventsFromDB(WORK_LOG_LIMIT);
    const workLog = [...recent]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-WORK_LOG_LIMIT)
      .map(toAgentJournalEvent);

    // Days payload: the selected day (always) — grouped oldest→newest.
    const days: AgentJournalDay[] = [
      {
        date: selectedDate,
        count: selected?.count ?? 0,
        events: dayEvents.map(toAgentJournalEvent),
      },
    ];

    return {
      data: {
        availableDates: dates,
        days,
        workLog,
        fetchedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      source: "live",
    };
  });
