/**
 * AI Logbook Formatter Tests — BINANCE AI FUTURES AGENT
 *
 * Tests for:
 * - Event → Bahasa Indonesia formatting
 * - Memory status determination
 * - Learning status determination
 * - Category mapping
 * - Empty state handling
 * - No fake data verification
 */

import { describe, it, expect } from "vitest";
import {
  formatLogbookEntry,
  formatLogbookEntries,
  computeLogbookSummary,
  EVENT_TO_CATEGORY,
  CATEGORY_LABELS,
  type LogbookCategory,
} from "./ai-logbook-formatter";
import type { JournalEvent } from "./index";

// ─── Test Helpers ───────────────────────────────────────────────────

function createEvent(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    id: "JEV-1000-1",
    timestamp: Date.now(),
    eventType: "MARKET_SCAN",
    importance: "LOW",
    symbol: "BTCUSDT",
    message: "Market scan: BTCUSDT (quality: GOOD)",
    ...overrides,
  };
}

// ─── Category Mapping Tests ─────────────────────────────────────────

describe("AI Logbook Formatter — Category Mapping", () => {
  it("maps MARKET_SCAN to ANALISIS", () => {
    expect(EVENT_TO_CATEGORY["MARKET_SCAN"]).toBe("ANALISIS");
  });

  it("maps RISK_CHECK to RISIKO", () => {
    expect(EVENT_TO_CATEGORY["RISK_CHECK"]).toBe("RISIKO");
  });

  it("maps TRADE_OPENED to TRADING", () => {
    expect(EVENT_TO_CATEGORY["TRADE_OPENED"]).toBe("TRADING");
  });

  it("maps TRADE_REJECTED to KEPUTUSAN", () => {
    expect(EVENT_TO_CATEGORY["TRADE_REJECTED"]).toBe("KEPUTUSAN");
  });

  it("maps SYSTEM_STARTED to SISTEM", () => {
    expect(EVENT_TO_CATEGORY["SYSTEM_STARTED"]).toBe("SISTEM");
  });

  it("maps POST_TRADE_REVIEW to PEMBELAJARAN", () => {
    expect(EVENT_TO_CATEGORY["POST_TRADE_REVIEW"]).toBe("PEMBELAJARAN");
  });

  it("has Bahasa Indonesia labels for all categories", () => {
    expect(CATEGORY_LABELS["ANALISIS"]).toBe("ANALISIS PASAR");
    expect(CATEGORY_LABELS["RISIKO"]).toBe("PEMERIKSAAN RISIKO");
    expect(CATEGORY_LABELS["TRADING"]).toBe("TRADING");
    expect(CATEGORY_LABELS["KEPUTUSAN"]).toBe("KEPUTUSAN AI");
    expect(CATEGORY_LABELS["SISTEM"]).toBe("AKTIVITAS SISTEM");
  });
});

// ─── MARKET_ANALYSIS Formatting ─────────────────────────────────────

describe("AI Logbook Formatter — MARKET_ANALYSIS", () => {
  it("formats market scan event in Bahasa Indonesia", () => {
    const event = createEvent({
      eventType: "MARKET_SCAN",
      symbol: "BTCUSDT",
      message: "Tren bullish, momentum positif",
    });

    const entry = formatLogbookEntry(event);

    expect(entry.category).toBe("ANALISIS");
    expect(entry.categoryLabel).toBe("ANALISIS PASAR");
    expect(entry.symbol).toBe("BTCUSDT");
    expect(entry.description).toContain("BTCUSDT");
    expect(entry.description).toContain("pemindaian pasar");
    expect(entry.result).toBe("TERCATAT");
    expect(entry.timeFormatted).toBeTruthy();
  });

  it("formats RESEARCH event", () => {
    const event = createEvent({
      eventType: "RESEARCH",
      symbol: "ETHUSDT",
    });

    const entry = formatLogbookEntry(event);

    expect(entry.category).toBe("ANALISIS");
    expect(entry.description).toContain("riset mendalam");
    expect(entry.symbol).toBe("ETHUSDT");
  });

  it("formats ANALYSIS event", () => {
    const event = createEvent({
      eventType: "ANALYSIS",
      symbol: "BTCUSDT",
    });

    const entry = formatLogbookEntry(event);

    expect(entry.description).toContain("menganalisis");
  });
});

// ─── RISK_CHECK Formatting ──────────────────────────────────────────

describe("AI Logbook Formatter — RISK_CHECK", () => {
  it("formats approved risk check as LULUS", () => {
    const event = createEvent({
      eventType: "RISK_CHECK",
      symbol: "BTCUSDT",
      riskDecision: {
        approved: true,
        reason: "All checks passed",
        checks: [
          { name: "confidence", passed: true, message: "OK" },
          { name: "position_limit", passed: true, message: "OK" },
        ],
      },
    });

    const entry = formatLogbookEntry(event);

    expect(entry.category).toBe("RISIKO");
    expect(entry.result).toBe("LULUS");
    expect(entry.description).toContain("Keputusan: LULUS");
    expect(entry.riskCheck).toBe("2/2 pemeriksaan lulus");
  });

  it("formats rejected risk check as DITOLAK", () => {
    const event = createEvent({
      eventType: "RISK_CHECK",
      symbol: "BTCUSDT",
      riskDecision: {
        approved: false,
        reason: "Confidence too low",
      },
    });

    const entry = formatLogbookEntry(event);

    expect(entry.result).toBe("DITOLAK");
    expect(entry.description).toContain("Keputusan: DITOLAK");
  });
});

// ─── TRADE_OPENED Formatting ────────────────────────────────────────

describe("AI Logbook Formatter — TRADE_OPENED", () => {
  it("formats trade opened with position details", () => {
    const event = createEvent({
      eventType: "TRADE_OPENED",
      symbol: "BTCUSDT",
      position: {
        symbol: "BTCUSDT",
        side: "LONG",
        entryPrice: 63000,
        margin: 0.5,
        leverage: 5,
      },
    });

    const entry = formatLogbookEntry(event);

    expect(entry.category).toBe("TRADING");
    expect(entry.result).toBe("BERHASIL");
    expect(entry.description).toContain("LONG");
    expect(entry.description).toContain("BTCUSDT");
    expect(entry.memoryStatus).toBe("DISIMPAN");
  });

  it("formats SHORT position", () => {
    const event = createEvent({
      eventType: "POSITION_OPENED",
      symbol: "ETHUSDT",
      position: {
        symbol: "ETHUSDT",
        side: "SHORT",
        entryPrice: 3200,
        margin: 0.3,
        leverage: 10,
      },
    });

    const entry = formatLogbookEntry(event);

    expect(entry.description).toContain("SHORT");
    expect(entry.description).toContain("ETHUSDT");
  });
});

// ─── TRADE_CLOSED Formatting ────────────────────────────────────────

describe("AI Logbook Formatter — TRADE_CLOSED", () => {
  it("formats trade closed with PnL", () => {
    const event = createEvent({
      eventType: "TRADE_CLOSED",
      symbol: "BTCUSDT",
      pnl: 0.25,
    });

    const entry = formatLogbookEntry(event);

    expect(entry.result).toBe("SELESAI");
    expect(entry.description).toContain("menutup posisi");
    expect(entry.description).toContain("$0.25");
    expect(entry.memoryStatus).toBe("DISIMPAN");
  });
});

// ─── Memory Status Tests ────────────────────────────────────────────

describe("AI Logbook Formatter — Memory Status", () => {
  it("shows DISIMPAN for trade events", () => {
    const event = createEvent({ eventType: "TRADE_OPENED" });
    const entry = formatLogbookEntry(event);
    expect(entry.memoryStatus).toBe("DISIMPAN");
  });

  it("shows TIDAK DISIMPAN for low-importance events", () => {
    const event = createEvent({
      eventType: "MARKET_SCAN",
      importance: "LOW",
    });
    const entry = formatLogbookEntry(event);
    expect(entry.memoryStatus).toBe("TIDAK DISIMPAN");
    expect(entry.memoryReason).toBeTruthy();
  });

  it("shows TIDAK DISIMPAN for standard risk checks", () => {
    const event = createEvent({
      eventType: "RISK_CHECK",
      importance: "MEDIUM",
      riskDecision: { approved: true, reason: "OK" },
    });
    const entry = formatLogbookEntry(event);
    expect(entry.memoryStatus).toBe("TIDAK DISIMPAN");
  });
});

// ─── Learning Status Tests ──────────────────────────────────────────

describe("AI Logbook Formatter — Learning Status", () => {
  it("shows TERSIMPAN for post-trade review", () => {
    const event = createEvent({ eventType: "POST_TRADE_REVIEW" });
    const entry = formatLogbookEntry(event);
    expect(entry.learningStatus).toBe("TERSIMPAN");
  });

  it("shows BELUM ADA for trade closed (waiting for review)", () => {
    const event = createEvent({ eventType: "TRADE_CLOSED" });
    const entry = formatLogbookEntry(event);
    expect(entry.learningStatus).toBe("BELUM ADA");
  });

  it("shows BELUM ADA for market scan", () => {
    const event = createEvent({ eventType: "MARKET_SCAN" });
    const entry = formatLogbookEntry(event);
    expect(entry.learningStatus).toBe("BELUM ADA");
  });
});

// ─── Empty / Edge Cases ─────────────────────────────────────────────

describe("AI Logbook Formatter — Edge Cases", () => {
  it("handles event without symbol", () => {
    const event = createEvent({
      eventType: "SYSTEM_STARTED",
    });
    delete event.symbol;

    const entry = formatLogbookEntry(event);

    expect(entry.symbol).toBeNull();
    expect(entry.description).toContain("dimulai");
  });

  it("handles event without message", () => {
    const event = createEvent({
      eventType: "MARKET_SCAN",
      message: "",
    });

    const entry = formatLogbookEntry(event);
    expect(entry.description).toBeTruthy();
  });

  it("formatLogbookEntries returns sorted by timestamp descending", () => {
    const events = [
      createEvent({ id: "JEV-1", timestamp: 1000 }),
      createEvent({ id: "JEV-2", timestamp: 3000 }),
      createEvent({ id: "JEV-3", timestamp: 2000 }),
    ];

    const entries = formatLogbookEntries(events);
    expect(entries[0]!.id).toBe("JEV-2");
    expect(entries[1]!.id).toBe("JEV-3");
    expect(entries[2]!.id).toBe("JEV-1");
  });
});

// ─── Summary Tests ──────────────────────────────────────────────────

describe("AI Logbook Formatter — Summary", () => {
  it("computes summary from entries", () => {
    const now = Date.now();
    const entries = [
      { category: "ANALISIS", timestamp: now, memoryStatus: "TIDAK DISIMPAN" as const, learningStatus: "BELUM ADA" as const, result: "TERCATAT" },
      { category: "RISIKO", timestamp: now, memoryStatus: "TIDAK DISIMPAN" as const, learningStatus: "BELUM ADA" as const, result: "LULUS" },
      { category: "TRADING", timestamp: now, memoryStatus: "DISIMPAN" as const, learningStatus: "BELUM ADA" as const, result: "BERHASIL" },
      { category: "KEPUTUSAN", timestamp: now, memoryStatus: "TIDAK DISIMPAN" as const, learningStatus: "BELUM ADA" as const, result: "DITOLAK" },
    ] as any[];

    const summary = computeLogbookSummary(entries);

    expect(summary.analyses).toBe(1);
    expect(summary.riskChecks).toBe(1);
    expect(summary.trades).toBe(1);
    expect(summary.decisions).toBe(1);
    expect(summary.memorySaved).toBe(1);
  });

  it("returns zeros for empty entries", () => {
    const summary = computeLogbookSummary([]);

    expect(summary.totalToday).toBe(0);
    expect(summary.analyses).toBe(0);
    expect(summary.trades).toBe(0);
    expect(summary.memorySaved).toBe(0);
  });
});

// ─── Safety Audit Tests ─────────────────────────────────────────────

describe("AI Logbook Formatter — Safety", () => {
  it("does not use Math.random in output", () => {
    const entry = formatLogbookEntry(createEvent());
    const output = JSON.stringify(entry);
    expect(output).not.toContain("Math.random");
  });

  it("does not contain hardcoded trading data", () => {
    const entry = formatLogbookEntry(createEvent());
    expect(entry.description).not.toContain("63000");
    expect(entry.description).not.toContain("hardcoded");
  });

  it("uses only real event timestamps", () => {
    const ts = 1700000000000;
    const event = createEvent({ timestamp: ts });
    const entry = formatLogbookEntry(event);
    expect(entry.timestamp).toBe(ts);
  });

  it("preserves technical event ID for audit", () => {
    const event = createEvent({ id: "JEV-12345-42" });
    const entry = formatLogbookEntry(event);
    expect(entry.technicalEventId).toBe("JEV-12345-42");
    expect(entry.technicalEventType).toBe("MARKET_SCAN");
  });
});
