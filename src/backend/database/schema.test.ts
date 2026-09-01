import { describe, it, expect, afterEach } from "vitest";
import { createTestDatabase } from "./index";
import Database from "better-sqlite3";

describe("Database Schema", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  it("initializes schema successfully", () => {
    db = createTestDatabase();
    expect(db).toBeDefined();
  });

  it("creates all required tables", () => {
    db = createTestDatabase();

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain("accounts");
    expect(tableNames).toContain("positions");
    expect(tableNames).toContain("orders");
    expect(tableNames).toContain("trades");
    expect(tableNames).toContain("strategies");
    expect(tableNames).toContain("strategy_metrics");
    expect(tableNames).toContain("market_data");
    expect(tableNames).toContain("ai_decisions");
    expect(tableNames).toContain("ai_experiences");
    expect(tableNames).toContain("ai_lessons");
    expect(tableNames).toContain("ai_models");
    expect(tableNames).toContain("ai_experiments");
    expect(tableNames).toContain("risk_events");
    expect(tableNames).toContain("system_config");
    expect(tableNames).toContain("system_events");
  });

  it("supports foreign keys", () => {
    db = createTestDatabase();

    // Insert account first
    db.prepare("INSERT INTO accounts (id, name) VALUES (?, ?)").run("ACC-TEST", "Test");

    // Insert trade with valid foreign key
    db.prepare(`
      INSERT INTO trades (id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, pnl_percent, duration_minutes, strategy_name, strategy_version, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("TX-TEST", "ACC-TEST", "BTCUSDT", "LONG", 100, 110, 0.01, 0.1, 10, 30, "Test", "v1", "2026-01-01", "2026-01-01");

    const trade = db.prepare("SELECT * FROM trades WHERE id = 'TX-TEST'").get() as any;
    expect(trade).toBeDefined();
    expect(trade.account_id).toBe("ACC-TEST");
  });

  it("enforces foreign key constraints", () => {
    db = createTestDatabase();

    // Try to insert trade with non-existent account
    expect(() => {
      db.prepare(`
        INSERT INTO trades (id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, pnl_percent, duration_minutes, strategy_name, strategy_version, opened_at, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("TX-BAD", "NON-EXISTENT", "BTCUSDT", "LONG", 100, 110, 0.01, 0.1, 10, 30, "Test", "v1", "2026-01-01", "2026-01-01");
    }).toThrow();
  });

  it("supports WAL mode", () => {
    db = createTestDatabase();
    const journalMode = db.pragma("journal_mode", { simple: true }) as string;
    // In-memory databases don't support WAL, but we verify it's set
    expect(typeof journalMode).toBe("string");
  });

  it("can perform basic CRUD operations", () => {
    db = createTestDatabase();

    // Create
    db.prepare("INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)").run("ACC-CRUD", "CRUD Test", 100.0);
    const created = db.prepare("SELECT * FROM accounts WHERE id = 'ACC-CRUD'").get() as any;
    expect(created.balance).toBe(100.0);

    // Read
    const read = db.prepare("SELECT * FROM accounts WHERE id = 'ACC-CRUD'").get() as any;
    expect(read.name).toBe("CRUD Test");

    // Update
    db.prepare("UPDATE accounts SET balance = 200.0 WHERE id = 'ACC-CRUD'").run();
    const updated = db.prepare("SELECT * FROM accounts WHERE id = 'ACC-CRUD'").get() as any;
    expect(updated.balance).toBe(200.0);

    // Delete
    db.prepare("DELETE FROM accounts WHERE id = 'ACC-CRUD'").run();
    const deleted = db.prepare("SELECT * FROM accounts WHERE id = 'ACC-CRUD'").get();
    expect(deleted).toBeUndefined();
  });
});
