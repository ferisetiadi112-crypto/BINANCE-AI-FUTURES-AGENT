import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";

// We test repositories by creating an in-memory database and
// mocking the getDatabase function. This tests the SQL logic
// without needing a real database file.

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = join(__dirname, "../database/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

describe("Repository SQL Queries", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe("Account Operations", () => {
    it("can insert and retrieve account", () => {
      db.prepare("INSERT INTO accounts (id, name, balance, equity) VALUES (?, ?, ?, ?)").run("ACC-001", "Test", 5.0, 5.1);
      const result = db.prepare("SELECT * FROM accounts WHERE id = ?").get("ACC-001") as any;
      expect(result).toBeDefined();
      expect(result.name).toBe("Test");
      expect(result.balance).toBe(5.0);
    });

    it("can get main account", () => {
      db.prepare("INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)").run("ACC-001", "First", 5.0);
      db.prepare("INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)").run("ACC-002", "Second", 10.0);
      const result = db.prepare("SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1").get() as any;
      expect(result.id).toBe("ACC-001");
    });
  });

  describe("Trade Operations", () => {
    beforeEach(() => {
      db.prepare("INSERT INTO accounts (id, name) VALUES (?, ?)").run("ACC-001", "Test");
    });

    it("can insert and retrieve trades", () => {
      db.prepare(`
        INSERT INTO trades (id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, pnl_percent, duration_minutes, strategy_name, strategy_version, opened_at, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("TX-001", "ACC-001", "BTCUSDT", "LONG", 100, 110, 0.01, 0.1, 10, 30, "Test", "v1", "2026-01-01", "2026-01-01");

      const trade = db.prepare("SELECT * FROM trades WHERE id = 'TX-001'").get() as any;
      expect(trade).toBeDefined();
      expect(trade.symbol).toBe("BTCUSDT");
      expect(trade.pnl).toBe(0.1);
    });

    it("can query trade statistics", () => {
      // Insert 4 trades: 3 wins, 1 loss
      for (let i = 0; i < 4; i++) {
        const pnl = i < 3 ? 0.1 : -0.1;
        db.prepare(`
          INSERT INTO trades (id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, pnl_percent, duration_minutes, strategy_name, strategy_version, opened_at, closed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`TX-${i}`, "ACC-001", "BTCUSDT", "LONG", 100, 110, 0.01, pnl, 10, 30, "Test", "v1", "2026-01-01", "2026-01-01");
      }

      const stats = db.prepare(`
        SELECT
          COUNT(*) as totalTrades,
          SUM(CASE WHEN pnl >= 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as winRate,
          SUM(pnl) as totalPnl
        FROM trades
      `).get() as any;

      expect(stats.totalTrades).toBe(4);
      expect(stats.winRate).toBeCloseTo(75.0, 1);
      expect(stats.totalPnl).toBeCloseTo(0.2, 2);
    });
  });

  describe("Position Operations", () => {
    beforeEach(() => {
      db.prepare("INSERT INTO accounts (id, name) VALUES (?, ?)").run("ACC-001", "Test");
    });

    it("can track open positions", () => {
      db.prepare(`
        INSERT INTO positions (id, account_id, symbol, side, leverage, size, entry_price, mark_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `).run("POS-001", "ACC-001", "BTCUSDT", "LONG", 5, 0.0001, 63000, 63500);

      const open = db.prepare("SELECT COUNT(*) as count FROM positions WHERE status = 'OPEN'").get() as any;
      expect(open.count).toBe(1);
    });

    it("can update mark price", () => {
      db.prepare(`
        INSERT INTO positions (id, account_id, symbol, side, leverage, size, entry_price, mark_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `).run("POS-001", "ACC-001", "BTCUSDT", "LONG", 5, 0.0001, 63000, 63000);

      db.prepare("UPDATE positions SET mark_price = ?, unrealized_pnl = ? WHERE id = ?").run(63500, 0.05, "POS-001");

      const pos = db.prepare("SELECT * FROM positions WHERE id = 'POS-001'").get() as any;
      expect(pos.mark_price).toBe(63500);
      expect(pos.unrealized_pnl).toBe(0.05);
    });
  });

  describe("Strategy Operations", () => {
    it("can track strategy performance", () => {
      db.prepare(`
        INSERT INTO strategies (id, name, version, state, allocation_percent, win_rate, profit_factor, total_trades, total_pnl)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("STRAT-001", "Test Strategy", "v1", "ACTIVE", 50, 65.0, 2.0, 100, 5.0);

      const strat = db.prepare("SELECT * FROM strategies WHERE id = 'STRAT-001'").get() as any;
      expect(strat).toBeDefined();
      expect(strat.name).toBe("Test Strategy");
      expect(strat.win_rate).toBe(65.0);
    });

    it("can query active strategies", () => {
      db.prepare("INSERT INTO strategies (id, name, version, state) VALUES (?, ?, ?, ?)").run("S1", "Active", "v1", "ACTIVE");
      db.prepare("INSERT INTO strategies (id, name, version, state) VALUES (?, ?, ?, ?)").run("S2", "Shadow", "v1", "SHADOW");
      db.prepare("INSERT INTO strategies (id, name, version, state) VALUES (?, ?, ?, ?)").run("S3", "Active2", "v1", "ACTIVE");

      const active = db.prepare("SELECT * FROM strategies WHERE state = 'ACTIVE'").all() as any[];
      expect(active.length).toBe(2);
    });
  });

  describe("AI Decision Operations", () => {
    it("can log AI decisions", () => {
      db.prepare(`
        INSERT INTO ai_decisions (id, action, symbol, size, confidence, strategy_name, strategy_version, strategy_edge, reasoning, regime, regime_confidence, risk_approved, executed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("DEC-001", "OPEN_LONG", "BTCUSDT", "0.0001 BTC", 87, "Momentum", "v1", 1.42, "Test reasoning", "TRENDING", 74, 1, 0);

      const decision = db.prepare("SELECT * FROM ai_decisions WHERE id = 'DEC-001'").get() as any;
      expect(decision).toBeDefined();
      expect(decision.action).toBe("OPEN_LONG");
      expect(decision.confidence).toBe(87);
    });

    it("can query latest decision", () => {
      db.prepare("INSERT INTO ai_decisions (id, action, symbol, size, confidence, strategy_name, strategy_version, strategy_edge, reasoning, regime, regime_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("DEC-1", "HOLD", "BTCUSDT", "0", 50, "Test", "v1", 0, "Reason", "UNKNOWN", 0);
      db.prepare("INSERT INTO ai_decisions (id, action, symbol, size, confidence, strategy_name, strategy_version, strategy_edge, reasoning, regime, regime_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("DEC-2", "OPEN_LONG", "BTCUSDT", "0.0001 BTC", 87, "Momentum", "v1", 1.4, "Reason", "TRENDING", 74);

      const latest = db.prepare("SELECT * FROM ai_decisions ORDER BY id DESC LIMIT 1").get() as any;
      expect(latest.id).toBe("DEC-2");
    });
  });

  describe("Risk Event Operations", () => {
    it("can log risk events", () => {
      db.prepare("INSERT INTO risk_events (event_type, severity, message, details) VALUES (?, ?, ?, ?)").run("TEST", "INFO", "Test event", "Details");

      const events = db.prepare("SELECT * FROM risk_events").all() as any[];
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe("TEST");
    });

    it("can query by severity", () => {
      db.prepare("INSERT INTO risk_events (event_type, severity, message, details) VALUES (?, ?, ?, ?)").run("T1", "INFO", "Info", "");
      db.prepare("INSERT INTO risk_events (event_type, severity, message, details) VALUES (?, ?, ?, ?)").run("T2", "WARN", "Warn", "");
      db.prepare("INSERT INTO risk_events (event_type, severity, message, details) VALUES (?, ?, ?, ?)").run("T3", "INFO", "Info2", "");

      const warns = db.prepare("SELECT * FROM risk_events WHERE severity = 'WARN'").all() as any[];
      expect(warns.length).toBe(1);
    });
  });

  describe("System Config Operations", () => {
    it("can store and retrieve config", () => {
      db.prepare("INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)").run("test_key", "test_value", "Test");

      const result = db.prepare("SELECT value FROM system_config WHERE key = 'test_key'").get() as any;
      expect(result.value).toBe("test_value");
    });

    it("can upsert config", () => {
      db.prepare("INSERT INTO system_config (key, value) VALUES (?, ?)").run("key1", "value1");
      db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)").run("key1", "value2");

      const result = db.prepare("SELECT value FROM system_config WHERE key = 'key1'").get() as any;
      expect(result.value).toBe("value2");
    });
  });

  describe("AI Experience Operations", () => {
    it("can store and query experiences", () => {
      db.prepare("INSERT INTO ai_experiences (id, tag, title, confidence, impact) VALUES (?, ?, ?, ?, ?)").run("EXP-1", "PATTERN", "Test pattern", 90, "+0.1 PF");
      db.prepare("INSERT INTO ai_experiences (id, tag, title, confidence, impact) VALUES (?, ?, ?, ?, ?)").run("EXP-2", "RISK", "Test risk", 85, "-10% DD");

      const patterns = db.prepare("SELECT * FROM ai_experiences WHERE tag = 'PATTERN'").all() as any[];
      expect(patterns.length).toBe(1);
      expect(patterns[0].confidence).toBe(90);
    });
  });

  describe("AI Lesson Operations", () => {
    it("can store and query lessons by cycle", () => {
      db.prepare("INSERT INTO ai_lessons (id, text, cycle) VALUES (?, ?, ?)").run("LES-1", "Lesson 1", 100);
      db.prepare("INSERT INTO ai_lessons (id, text, cycle) VALUES (?, ?, ?)").run("LES-2", "Lesson 2", 110);

      const latest = db.prepare("SELECT MAX(cycle) as cycle FROM ai_lessons").get() as any;
      expect(latest.cycle).toBe(110);
    });
  });
});
