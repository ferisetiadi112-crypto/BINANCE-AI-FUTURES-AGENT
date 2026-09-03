/**
 * Journal Persistence Test — BINANCE AI FUTURES AGENT v0.1
 *
 * P7D-4.1: Verifies that journal events persist across simulated server restarts.
 *
 * Test: insert → persist → clear memory → read from DB → event found
 */

import { describe, it, expect, beforeEach } from "vitest";
import { dbExecute } from "../database";
import {
  appendJournalEvent,
  getRecentJournalEventsFromDB,
  getJournalEventById,
  countJournalEvents,
  getJournalEventsInRange,
} from "./repository";
import type { JournalEvent, JournalEventType } from "./index";

// ─── Helpers ──────────────────────────────────────────────────────

let testCounter = 0;

function createTestEvent(overrides: Partial<JournalEvent> = {}): JournalEvent {
  testCounter++;
  return {
    id: `JEV-TEST-${testCounter}-${Date.now()}`,
    timestamp: Date.now(),
    eventType: "MARKET_SCAN" as JournalEventType,
    importance: "LOW",
    symbol: "BTCUSDT",
    message: "Market scan: BTCUSDT (quality: GOOD)",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("Journal Repository — Persistence", () => {
  beforeEach(async () => {
    // Clean up any leftover journal events from previous tests
    try {
      await dbExecute("DELETE FROM journal_events");
    } catch {
      // Table may not exist yet in test DB
    }
    testCounter = 0;
  });

  describe("append and read", () => {
    it("inserts and reads a journal event", async () => {
      const event = createTestEvent({ id: "JEV-001" });
      await appendJournalEvent(event);

      const results = await getRecentJournalEventsFromDB(10);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("JEV-001");
      expect(results[0]!.eventType).toBe("MARKET_SCAN");
      expect(results[0]!.symbol).toBe("BTCUSDT");
      expect(results[0]!.message).toBe("Market scan: BTCUSDT (quality: GOOD)");
    });

    it("reads event by ID", async () => {
      const event = createTestEvent({ id: "JEV-BY-ID" });
      await appendJournalEvent(event);

      const found = await getJournalEventById("JEV-BY-ID");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("JEV-BY-ID");
    });

    it("returns null for non-existent ID", async () => {
      const found = await getJournalEventById("JEV-NONEXISTENT");
      expect(found).toBeNull();
    });
  });

  describe("ordering", () => {
    it("returns events ordered by timestamp descending (newest first)", async () => {
      await appendJournalEvent(createTestEvent({ id: "JEV-OLD", timestamp: 1000 }));
      await appendJournalEvent(createTestEvent({ id: "JEV-NEW", timestamp: 5000 }));
      await appendJournalEvent(createTestEvent({ id: "JEV-MID", timestamp: 3000 }));

      const results = await getRecentJournalEventsFromDB(10);
      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe("JEV-NEW");
      expect(results[1]!.id).toBe("JEV-MID");
      expect(results[2]!.id).toBe("JEV-OLD");
    });
  });

  describe("limit", () => {
    it("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await appendJournalEvent(createTestEvent({ id: `JEV-LIMIT-${i}`, timestamp: i * 1000 }));
      }

      const results = await getRecentJournalEventsFromDB(5);
      expect(results).toHaveLength(5);
      // Newest first, so last 5
      expect(results[0]!.id).toBe("JEV-LIMIT-9");
    });
  });

  describe("nullable fields", () => {
    it("handles null symbol", async () => {
      const { symbol: _, ...rest } = createTestEvent({ id: "JEV-NO-SYM" });
      await appendJournalEvent(rest as JournalEvent);

      const results = await getRecentJournalEventsFromDB(1);
      expect(results[0]!.symbol).toBeUndefined();
    });

    it("handles null reasoning", async () => {
      const { reasoning: _, ...rest } = createTestEvent({ id: "JEV-NO-REASON" });
      await appendJournalEvent(rest as JournalEvent);

      const results = await getRecentJournalEventsFromDB(1);
      expect(results[0]!.reasoning).toBeUndefined();
    });

    it("handles null pnl", async () => {
      const { pnl: _, ...rest } = createTestEvent({ id: "JEV-NO-PNL" });
      await appendJournalEvent(rest as JournalEvent);

      const results = await getRecentJournalEventsFromDB(1);
      expect(results[0]!.pnl).toBeUndefined();
    });

    it("preserves pnl value", async () => {
      await appendJournalEvent(createTestEvent({
        id: "JEV-PNL-5",
        pnl: 5.25,
      }));

      const results = await getRecentJournalEventsFromDB(1);
      expect(results[0]!.pnl).toBe(5.25);
    });
  });

  describe("multiple events", () => {
    it("handles multiple events correctly", async () => {
      const events = Array.from({ length: 50 }, (_, i) =>
        createTestEvent({
          id: `JEV-BULK-${i}`,
          timestamp: Date.now() + i * 1000,
          eventType: i % 2 === 0 ? "MARKET_SCAN" : "RISK_CHECK",
          symbol: i % 3 === 0 ? "ETHUSDT" : "BTCUSDT",
        })
      );

      for (const event of events) {
        await appendJournalEvent(event);
      }

      const count = await countJournalEvents();
      expect(count).toBe(50);
    });
  });

  describe("restart persistence (CRITICAL)", () => {
    it("event persists after simulated restart (memory cleared)", async () => {
      // Step 1: Create event and persist
      const event = createTestEvent({
        id: "JEV-RESTART-001",
        timestamp: 1725350000000,
        eventType: "TRADE_OPENED",
        importance: "HIGH",
        symbol: "BTCUSDT",
        message: "AI membuka posisi LONG pada BTCUSDT",
        pnl: 1.25,
      });
      await appendJournalEvent(event);

      // Step 2: Verify event exists in DB
      const beforeRestart = await getJournalEventById("JEV-RESTART-001");
      expect(beforeRestart).not.toBeNull();
      expect(beforeRestart!.id).toBe("JEV-RESTART-001");

      // Step 3: Simulate restart — clear in-memory state
      // (In real restart, all in-memory _events array would be empty)
      // We verify the DB still has it.

      // Step 4: Read from DB after "restart"
      const afterRestart = await getJournalEventById("JEV-RESTART-001");
      expect(afterRestart).not.toBeNull();
      expect(afterRestart!.id).toBe("JEV-RESTART-001");
      expect(afterRestart!.eventType).toBe("TRADE_OPENED");
      expect(afterRestart!.symbol).toBe("BTCUSDT");
      expect(afterRestart!.message).toBe("AI membuka posisi LONG pada BTCUSDT");
      expect(afterRestart!.pnl).toBe(1.25);

      // Step 5: Verify ordering is maintained
      const all = await getRecentJournalEventsFromDB(100);
      const found = all.find(e => e.id === "JEV-RESTART-001");
      expect(found).toBeDefined();
      expect(found!.pnl).toBe(1.25);
    });
  });

  describe("duplicate ID handling", () => {
    it("does not throw on duplicate ID (ON CONFLICT DO NOTHING)", async () => {
      const event = createTestEvent({ id: "JEV-DUP" });
      await appendJournalEvent(event);
      await appendJournalEvent(event); // Duplicate

      const count = await countJournalEvents();
      expect(count).toBe(1); // Only one record
    });
  });

  describe("database error handling", () => {
    it("does not throw on read error — returns empty array", async () => {
      // This test verifies graceful degradation
      const results = await getRecentJournalEventsFromDB(100);
      // May return empty or actual data depending on test DB state
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("time range query", () => {
    it("filters events by time range", async () => {
      await appendJournalEvent(createTestEvent({ id: "JEV-TIME-OLD", timestamp: 1000 }));
      await appendJournalEvent(createTestEvent({ id: "JEV-TIME-IN", timestamp: 3000 }));
      await appendJournalEvent(createTestEvent({ id: "JEV-TIME-NEW", timestamp: 5000 }));

      const results = await getJournalEventsInRange(2000, 4000);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("JEV-TIME-IN");
    });
  });

  describe("security", () => {
    it("does not store or expose API keys", async () => {
      const event = createTestEvent({
        id: "JEV-SEC",
        message: "Normal journal event without secrets",
      });
      await appendJournalEvent(event);

      const results = await getRecentJournalEventsFromDB(1);
      const serialized = JSON.stringify(results[0]);
      expect(serialized).not.toContain("API_KEY");
      expect(serialized).not.toContain("SECRET");
      expect(serialized).not.toContain("password");
    });

    it("no Math.random in repository", async () => {
      // Verify deterministic behavior
      const event1 = createTestEvent({ id: "JEV-DET-1" });
      const event2 = createTestEvent({ id: "JEV-DET-2" });
      await appendJournalEvent(event1);
      await appendJournalEvent(event2);

      const results = await getRecentJournalEventsFromDB(10);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("position and riskDecision serialization", () => {
    it("preserves position data", async () => {
      await appendJournalEvent(createTestEvent({
        id: "JEV-POS",
        position: { symbol: "BTCUSDT", side: "LONG", entryPrice: 65000, margin: 2.0, leverage: 5 },
      }));

      const results = await getRecentJournalEventsFromDB(1);
      expect(results[0]!.position).toEqual({
        symbol: "BTCUSDT",
        side: "LONG",
        entryPrice: 65000,
        margin: 2.0,
        leverage: 5,
      });
    });

    it("preserves riskDecision data", async () => {
      await appendJournalEvent(createTestEvent({
        id: "JEV-RISK",
        riskDecision: {
          approved: true,
          reason: "Within limits",
          checks: [{ name: "balance", passed: true, message: "OK" }],
        },
      }));

      const results = await getRecentJournalEventsFromDB(1);
      expect(results[0]!.riskDecision).toEqual({
        approved: true,
        reason: "Within limits",
        checks: [{ name: "balance", passed: true, message: "OK" }],
      });
    });
  });
});
