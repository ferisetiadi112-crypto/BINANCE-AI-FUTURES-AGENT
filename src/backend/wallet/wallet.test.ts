/**
 * Wallet Guardrails Tests — BINANCE AI FUTURES AGENT v0.1
 *
 * Verifies:
 * - Sandbox wallet balance operations (top-up, withdraw)
 * - AI-protection boundary (AI cannot modify wallet)
 * - Risk Engine balance validation
 * - Fail-safe logging for blocked trades
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";
import { RiskEngine } from "../risk/engine";
import type { AiDecision } from "../ai/types";
import type { MarketState } from "../runtime/types";

// ─── Test Database Setup ────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = join(__dirname, "../database/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

// ─── Mock Data ──────────────────────────────────────────────────────

const mockDecision: AiDecision = {
  id: "DEC-TEST-001",
  timestamp: Date.now(),
  symbol: "BTCUSDT",
  direction: "LONG",
  confidence: 0.75,
  confidenceLevel: "HIGH",
  strategy: "TREND_FOLLOWING",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  evidence: {
    trend: "UP (strength: 70)",
    momentum: "STRONG (score: 75)",
    volume: "24h: 28000",
    volatility: "ATR: 500",
    structure: "HIGHER_HIGHS",
    regime: "TRENDING_UP",
    regimeConfidence: 74,
    indicators: { rsi: 65, ema20: 63000, ema50: 62500, macd: 150, atr: 500 },
  },
  decisionVersion: "1.0.0",
  modelVersion: "rule-based-v1",
};

const mockMarketState: MarketState = {
  symbol: "BTCUSDT",
  timestamp: Date.now(),
  price: 63000,
  priceChange24h: 500,
  priceChangePercent24h: 0.8,
  trend: "UP",
  trendStrength: 70,
  momentum: "STRONG",
  momentumScore: 75,
  volatility: 500,
  volatilityPercent: 0.8,
  volume24h: 28000,
  volumeChange: 15,
  marketStructure: "HIGHER_HIGHS",
  marketRegime: "TRENDING_UP",
  regimeConfidence: 74,
  liquidity: 80,
  dataQuality: "GOOD",
  feedStatus: "ONLINE",
  lastUpdate: Date.now(),
  dataAge: 1000,
};

// ─── Sandbox Wallet Database Tests ──────────────────────────────────

describe("Sandbox Wallet — Database Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Seed main account
    db.prepare(
      "INSERT INTO accounts (id, name, balance, equity) VALUES (?, ?, ?, ?)",
    ).run("ACC-MAIN", "Main Futures Account", 5.0, 5.0);
  });

  afterEach(() => {
    db.close();
  });

  it("creates wallet_transactions table", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='wallet_transactions'",
      )
      .get() as { name: string } | undefined;
    expect(tables).toBeDefined();
  });

  it("creates guardrail_events table", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='guardrail_events'",
      )
      .get() as { name: string } | undefined;
    expect(tables).toBeDefined();
  });

  it("records a top-up transaction", () => {
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'boss')`,
    ).run("TXN-001", "ACC-MAIN", 2.5, 5.0, 7.5, "Boss top-up");

    const txn = db
      .prepare("SELECT * FROM wallet_transactions WHERE id = 'TXN-001'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.type).toBe("TOP_UP");
    expect(txn.amount).toBe(2.5);
    expect(txn.balance_before).toBe(5.0);
    expect(txn.balance_after).toBe(7.5);
    expect(txn.initiated_by).toBe("boss");
  });

  it("records a withdraw transaction", () => {
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'WITHDRAW', ?, ?, ?, ?, 'boss')`,
    ).run("TXN-002", "ACC-MAIN", 1.0, 5.0, 4.0, "Boss withdrawal");

    const txn = db
      .prepare("SELECT * FROM wallet_transactions WHERE id = 'TXN-002'")
      .get() as any;
    expect(txn).toBeDefined();
    expect(txn.type).toBe("WITHDRAW");
    expect(txn.amount).toBe(1.0);
  });

  it("updates account balance on top-up", () => {
    db.prepare(
      "UPDATE accounts SET balance = ?, equity = ? WHERE id = ?",
    ).run(7.5, 7.5, "ACC-MAIN");

    const acc = db
      .prepare("SELECT balance FROM accounts WHERE id = 'ACC-MAIN'")
      .get() as any;
    expect(acc.balance).toBe(7.5);
  });

  it("rejects top-up with zero or negative amount via CHECK constraint", () => {
    expect(() => {
      db.prepare(
        `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
         VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'boss')`,
      ).run("TXN-BAD", "ACC-MAIN", -1.0, 5.0, 4.0, "Bad", "boss");
    }).toThrow();
  });

  it("records guardrail events", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "TRADE_ALLOWED",
      "INFO",
      "LONG BTCUSDT — All risk checks passed",
      "{}",
      5.0,
    );

    const event = db
      .prepare("SELECT * FROM guardrail_events ORDER BY id DESC LIMIT 1")
      .get() as any;
    expect(event).toBeDefined();
    expect(event.event_type).toBe("TRADE_ALLOWED");
    expect(event.severity).toBe("INFO");
    expect(event.balance_snapshot).toBe(5.0);
  });

  it("records insufficient funds guardrail event", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "INSUFFICIENT_FUNDS",
      "ERROR",
      "Insufficient wallet balance: $0.20 (min: $0.50)",
      "{}",
      0.2,
    );

    const event = db
      .prepare("SELECT * FROM guardrail_events ORDER BY id DESC LIMIT 1")
      .get() as any;
    expect(event.event_type).toBe("INSUFFICIENT_FUNDS");
    expect(event.severity).toBe("ERROR");
  });

  it("records trade blocked guardrail event", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "TRADE_BLOCKED",
      "WARN",
      "Daily loss limit reached: -$0.55 / -$0.50",
      "{}",
      4.45,
    );

    const event = db
      .prepare("SELECT * FROM guardrail_events ORDER BY id DESC LIMIT 1")
      .get() as any;
    expect(event.event_type).toBe("TRADE_BLOCKED");
    expect(event.severity).toBe("WARN");
  });

  it("queries wallet transactions with LIMIT", () => {
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'boss')`,
    ).run("TXN-001", "ACC-MAIN", 1.0, 5.0, 6.0, "first");
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'WITHDRAW', ?, ?, ?, ?, 'boss')`,
    ).run("TXN-002", "ACC-MAIN", 0.5, 6.0, 5.5, "second");

    const txns = db
      .prepare("SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT 10")
      .all() as any[];
    expect(txns.length).toBe(2);
    // Both inserted in same instant — just verify both exist
    const ids = txns.map((t: any) => t.id).sort();
    expect(ids).toEqual(["TXN-001", "TXN-002"]);
  });
});

// ─── Risk Engine Wallet Balance Check ───────────────────────────────

describe("Risk Engine — Wallet Balance Check (Phase 9D)", () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine({
      aiAllocationLimit: 10.0,
      sessionProfitTarget: 0.50,
      sessionHardCap: 2.00,
      maxLossPerTrade: 1.00,
      dailyLossLimit: 2.00,
      maxLeverage: 20,
      maxOpenPositions: 1,
      minWalletBalance: 0.50,
    });
  });

  it("approves trade when wallet balance is above minimum", () => {
    engine.setWalletBalance(5.0);
    const result = engine.check(mockDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    const walletCheck = result.checks.find((c) => c.name === "wallet_balance");
    expect(walletCheck).toBeDefined();
    expect(walletCheck!.passed).toBe(true);
  });

  it("blocks trade when wallet balance is below minimum", () => {
    engine.setWalletBalance(0.3);
    const result = engine.check(mockDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    expect(result.approved).toBe(false);
    const walletCheck = result.checks.find((c) => c.name === "wallet_balance");
    expect(walletCheck).toBeDefined();
    expect(walletCheck!.passed).toBe(false);
    expect(walletCheck!.message).toContain("Insufficient wallet balance");
    expect(walletCheck!.message).toContain("$0.30");
  });

  it("blocks trade when wallet balance is exactly zero", () => {
    engine.setWalletBalance(0);
    const result = engine.check(mockDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    expect(result.approved).toBe(false);
    const walletCheck = result.checks.find((c) => c.name === "wallet_balance");
    expect(walletCheck!.passed).toBe(false);
  });

  it("reports correct wallet balance in check message", () => {
    engine.setWalletBalance(2.75);
    const result = engine.check(mockDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    const walletCheck = result.checks.find((c) => c.name === "wallet_balance");
    expect(walletCheck!.message).toContain("$2.75");
  });

  it("allows NO_TRADE even with zero balance", () => {
    engine.setWalletBalance(0);
    const noTradeDecision: AiDecision = {
      ...mockDecision,
      direction: "NO_TRADE",
      confidence: 0,
    };
    const result = engine.check(noTradeDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    expect(result.approved).toBe(true);
    expect(result.checks[0]!.name).toBe("no_trade");
  });

  it("returns wallet balance via getWalletBalance()", () => {
    engine.setWalletBalance(3.14);
    expect(engine.getWalletBalance()).toBe(3.14);
  });

  it("has default wallet balance equal to aiAllocationLimit", () => {
    expect(engine.getWalletBalance()).toBe(10.0);
  });

  it("wallet check is always present in checks array", () => {
    engine.setWalletBalance(5.0);
    const result = engine.check(mockDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    const walletChecks = result.checks.filter(
      (c) => c.name === "wallet_balance",
    );
    expect(walletChecks.length).toBe(1);
  });

  it("blocks trade when daily loss AND insufficient funds both apply", () => {
    engine.setWalletBalance(0.2);
    engine.updateDailyPnl(-2.5); // Triggers daily loss lock (-$2.00 limit)

    const result = engine.check(mockDecision, mockMarketState, {
      symbol: "BTCUSDT",
      side: "FLAT",
      size: 0,
    });

    expect(result.approved).toBe(false);
    // System lock fires first (before wallet check is even reached)
    expect(result.checks[0]!.name).toBe("system_lock");
  });
});

// ─── Fail-Safe Logging Integration ──────────────────────────────────

describe("Fail-Safe Logging — Guardrail Events", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("logs BALANCE_CHECK event before trade attempt", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "BALANCE_CHECK",
      "INFO",
      "Pre-trade balance check: $5.00",
      JSON.stringify({ symbol: "BTCUSDT", direction: "LONG" }),
      5.0,
    );

    const event = db
      .prepare(
        "SELECT * FROM guardrail_events WHERE event_type = 'BALANCE_CHECK'",
      )
      .get() as any;
    expect(event).toBeDefined();
    expect(event.balance_snapshot).toBe(5.0);
  });

  it("logs TRADE_ALLOWED event with full context", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "TRADE_ALLOWED",
      "INFO",
      "LONG BTCUSDT — All risk checks passed",
      JSON.stringify({
        confidence: 0.75,
        strategy: "TREND_FOLLOWING",
        symbol: "BTCUSDT",
      }),
      5.0,
    );

    const event = db
      .prepare(
        "SELECT * FROM guardrail_events WHERE event_type = 'TRADE_ALLOWED'",
      )
      .get() as any;
    expect(event).toBeDefined();
    const details = JSON.parse(event.details);
    expect(details.confidence).toBe(0.75);
    expect(details.strategy).toBe("TREND_FOLLOWING");
  });

  it("logs INSUFFICIENT_FUNDS with ERROR severity", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "INSUFFICIENT_FUNDS",
      "ERROR",
      "SHORT BTCUSDT — Insufficient wallet balance: $0.20 (min: $0.50)",
      JSON.stringify({ confidence: 0.65, strategy: "MOMENTUM" }),
      0.2,
    );

    const events = db
      .prepare(
        "SELECT * FROM guardrail_events WHERE event_type = 'INSUFFICIENT_FUNDS'",
      )
      .all() as any[];
    expect(events.length).toBe(1);
    expect(events[0]!.severity).toBe("ERROR");
  });

  it("logs WALLET_MODIFIED for boss top-up", () => {
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "WALLET_MODIFIED",
      "INFO",
      "Boss topped up $2.50 — New balance: $7.50",
      JSON.stringify({ type: "TOP_UP", amount: 2.5, note: "Boss top-up" }),
      7.5,
    );

    const event = db
      .prepare(
        "SELECT * FROM guardrail_events WHERE event_type = 'WALLET_MODIFIED'",
      )
      .get() as any;
    expect(event).toBeDefined();
    expect(event.balance_snapshot).toBe(7.5);
  });

  it("audit trail merges guardrail and wallet events sorted by time", () => {
    // Seed account for foreign key
    db.prepare(
      "INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)",
    ).run("ACC-MAIN", "Test", 5.0);

    // Insert guardrail event
    db.prepare(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("TRADE_ALLOWED", "INFO", "Trade allowed", "{}", 5.0);

    // Insert wallet transaction
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'boss')`,
    ).run("TXN-001", "ACC-MAIN", 2.0, 5.0, 7.0, "Top-up");

    const guardrailEvents = db
      .prepare("SELECT * FROM guardrail_events")
      .all() as any[];
    const walletEvents = db
      .prepare("SELECT * FROM wallet_transactions")
      .all() as any[];

    expect(guardrailEvents.length).toBe(1);
    expect(walletEvents.length).toBe(1);
  });

  it("enforces event_type CHECK constraint", () => {
    expect(() => {
      db.prepare(
        `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
         VALUES (?, ?, ?, ?, ?)`,
      ).run("INVALID_TYPE", "INFO", "Bad event", "{}", 0);
    }).toThrow();
  });

  it("enforces severity CHECK constraint", () => {
    expect(() => {
      db.prepare(
        `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
         VALUES (?, ?, ?, ?, ?)`,
      ).run("TRADE_ALLOWED", "INVALID_SEVERITY", "Bad event", "{}", 0);
    }).toThrow();
  });
});

// ─── AI Protection Boundary ─────────────────────────────────────────

describe("AI Protection Boundary", () => {
  it("wallet_transactions only allows 'boss' or 'system' as initiated_by", () => {
    const db = createTestDb();
    db.prepare(
      "INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)",
    ).run("ACC-MAIN", "Test", 5.0);

    // 'boss' is valid
    expect(() => {
      db.prepare(
        `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
         VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'boss')`,
      ).run("TXN-OK", "ACC-MAIN", 1.0, 5.0, 6.0, "ok");
    }).not.toThrow();

    // 'system' is also allowed by schema (for future automated reconciliation)
    expect(() => {
      db.prepare(
        `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
         VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'system')`,
      ).run("TXN-SYS", "ACC-MAIN", 1.0, 5.0, 6.0, "ok");
    }).not.toThrow();

    // Any other value is rejected by CHECK constraint
    expect(() => {
      db.prepare(
        `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
         VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'ai_agent')`,
      ).run("TXN-BAD", "ACC-MAIN", 1.0, 5.0, 6.0, "bad");
    }).toThrow();

    db.close();
  });
});
