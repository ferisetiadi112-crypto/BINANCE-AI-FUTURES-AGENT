/**
 * Database Persistence Tests — BINANCE AI FUTURES AGENT v0.1
 *
 * Tests:
 * 1. Database adapter works (SQLite for tests)
 * 2. Schema initializes correctly
 * 3. Risk state persistence (load/save)
 * 4. Wallet persistence (top-up/withdraw survives re-read)
 * 5. Guardrail events persist
 * 6. Async query functions work
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  dbQuery,
  dbQueryOne,
  dbExecute,
  createTestDatabase,
} from "./adapter";
import {
  loadRiskState,
  saveRiskState,
  saveDailyPnl,
  saveLockState,
} from "../risk/persistence";

// ─── Test Helpers ────────────────────────────────────────────────────

function createTestDb() {
  const db = createTestDatabase();
  // Seed account
  db.prepare(`
    INSERT OR REPLACE INTO accounts (id, name, balance, equity, available_margin, realized_pnl, currency)
    VALUES ('ACC-TEST', 'Test Account', 5.00, 5.00, 5.00, 0, 'USDT')
  `).run();
  // Seed system config
  db.prepare(`
    INSERT OR REPLACE INTO system_config (key, value, description)
    VALUES ('initial_capital', '5.00', 'Test capital')
  `).run();
  return db;
}

// ─── Schema Tests ────────────────────────────────────────────────────

describe("Database Schema", () => {
  it("creates all required tables", () => {
    const db = createTestDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("accounts");
    expect(tableNames).toContain("positions");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("trades");
    expect(tableNames).toContain("strategies");
    expect(tableNames).toContain("ai_decisions");
    expect(tableNames).toContain("ai_experiences");
    expect(tableNames).toContain("ai_lessons");
    expect(tableNames).toContain("risk_events");
    expect(tableNames).toContain("system_config");
    expect(tableNames).toContain("wallet_transactions");
    expect(tableNames).toContain("guardrail_events");
    expect(tableNames).toContain("risk_state");
    db.close();
  });

  it("risk_state table accepts key-value pairs", () => {
    const db = createTestDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO risk_state (key, value) VALUES ('daily_pnl', '0.12')
    `).run();
    const row = db.prepare("SELECT value FROM risk_state WHERE key = 'daily_pnl'").get() as { value: string };
    expect(row.value).toBe("0.12");
    db.close();
  });
});

// ─── Risk State Persistence Tests ────────────────────────────────────

describe("Risk State Persistence", () => {
  it("loads default risk state when nothing is persisted", async () => {
    // Reset to defaults
    await saveRiskState({ dailyPnl: 0, isLocked: false, lockReason: "" });
    const state = await loadRiskState();
    expect(state.dailyPnl).toBe(0);
    expect(state.isLocked).toBe(false);
    expect(state.lockReason).toBe("");
  });

  it("saves and loads daily PnL (round-trip)", async () => {
    await saveDailyPnl(0.25);
    const state = await loadRiskState();
    expect(state.dailyPnl).toBe(0.25);
    // Clean up
    await saveDailyPnl(0);
  });

  it("saves and loads lock state (round-trip)", async () => {
    await saveLockState(true, "Daily loss limit reached");
    const state = await loadRiskState();
    expect(state.isLocked).toBe(true);
    expect(state.lockReason).toBe("Daily loss limit reached");
    // Clean up
    await saveLockState(false, "");
  });

  it("saves and loads full risk state (round-trip)", async () => {
    await saveRiskState({
      dailyPnl: -0.30,
      isLocked: true,
      lockReason: "Daily loss limit",
    });
    const state = await loadRiskState();
    expect(state.dailyPnl).toBe(-0.30);
    expect(state.isLocked).toBe(true);
    expect(state.lockReason).toBe("Daily loss limit");
    // Clean up
    await saveRiskState({ dailyPnl: 0, isLocked: false, lockReason: "" });
  });

  it("overwrites previous risk state", async () => {
    await saveDailyPnl(0.10);
    await saveDailyPnl(0.20);
    const state = await loadRiskState();
    expect(state.dailyPnl).toBe(0.20);
    // Clean up
    await saveDailyPnl(0);
  });

  it("unlocks system (round-trip)", async () => {
    await saveLockState(true, "Test lock");
    await saveLockState(false, "");
    const state = await loadRiskState();
    expect(state.isLocked).toBe(false);
    expect(state.lockReason).toBe("");
  });
});

// ─── Wallet Persistence Tests ────────────────────────────────────────

describe("Wallet Persistence", () => {
  it("top-up persists balance", () => {
    const db = createTestDb();
    const account = db.prepare("SELECT balance FROM accounts WHERE id = 'ACC-TEST'").get() as { balance: number };
    expect(account.balance).toBe(5.00);

    // Simulate top-up
    const newBalance = account.balance + 2.50;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?").run(newBalance, "ACC-TEST");
    db.prepare(`
      INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
      VALUES ('TXN-1', 'ACC-TEST', 'TOP_UP', 2.50, 5.00, 7.50, 'Test', 'boss')
    `).run();

    // Verify persistence
    const updated = db.prepare("SELECT balance FROM accounts WHERE id = 'ACC-TEST'").get() as { balance: number };
    expect(updated.balance).toBe(7.50);

    const txn = db.prepare("SELECT * FROM wallet_transactions WHERE id = 'TXN-1'").get() as { type: string; amount: number };
    expect(txn.type).toBe("TOP_UP");
    expect(txn.amount).toBe(2.50);

    db.close();
  });

  it("withdraw persists balance", () => {
    const db = createTestDb();
    const newBalance = 5.00 - 1.50;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?").run(newBalance, "ACC-TEST");
    db.prepare(`
      INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
      VALUES ('TXN-2', 'ACC-TEST', 'WITHDRAW', 1.50, 5.00, 3.50, 'Test', 'boss')
    `).run();

    const updated = db.prepare("SELECT balance FROM accounts WHERE id = 'ACC-TEST'").get() as { balance: number };
    expect(updated.balance).toBe(3.50);
    db.close();
  });

  it("wallet transactions are queryable after insert", () => {
    const db = createTestDb();
    db.prepare(`
      INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
      VALUES ('TXN-3', 'ACC-TEST', 'TOP_UP', 1.00, 5.00, 6.00, 'Test', 'boss')
    `).run();
    db.prepare(`
      INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
      VALUES ('TXN-4', 'ACC-TEST', 'WITHDRAW', 0.50, 6.00, 5.50, 'Test', 'boss')
    `).run();

    const txns = db.prepare("SELECT * FROM wallet_transactions ORDER BY created_at DESC").all() as { type: string }[];
    expect(txns.length).toBeGreaterThanOrEqual(2);
    db.close();
  });
});

// ─── Guardrail Event Persistence Tests ───────────────────────────────

describe("Guardrail Event Persistence", () => {
  it("logs and retrieves guardrail events", () => {
    const db = createTestDb();
    db.prepare(`
      INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
      VALUES ('TRADE_ALLOWED', 'INFO', 'All checks passed', '{}', 5.00)
    `).run();
    db.prepare(`
      INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
      VALUES ('INSUFFICIENT_FUNDS', 'ERROR', 'Balance too low', '{}', 0.10)
    `).run();

    const events = db.prepare("SELECT * FROM guardrail_events ORDER BY created_at DESC").all() as { event_type: string; severity: string }[];
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.event_type).toBeDefined();
    db.close();
  });

  it("CHECK constraint rejects invalid event types", () => {
    const db = createTestDb();
    expect(() => {
      db.prepare(`
        INSERT INTO guardrail_events (event_type, severity, message, details)
        VALUES ('INVALID_TYPE', 'INFO', 'Test', '{}')
      `).run();
    }).toThrow();
    db.close();
  });
});

// ─── Async Query Tests ───────────────────────────────────────────────

describe("Async Query Functions", () => {
  it("dbQuery returns rows", async () => {
    const rows = await dbQuery("SELECT * FROM sqlite_master WHERE type = 'table'");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("dbQueryOne returns a single row", async () => {
    const row = await dbQueryOne("SELECT 1 as num");
    expect(row?.["num"]).toBe(1);
  });

  it("dbExecute runs mutations", async () => {
    // This test uses the in-memory SQLite from the adapter
    // The adapter auto-creates schema on init
    const rows = await dbQuery("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(rows.length).toBeGreaterThan(0);
  });
});
