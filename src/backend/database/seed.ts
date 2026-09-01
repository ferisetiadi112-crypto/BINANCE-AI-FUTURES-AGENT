/**
 * Database Seed — BINANCE AI FUTURES AGENT v0.1
 *
 * Populates the database with development data.
 * All data is clearly marked as SIMULATION/MOCK.
 *
 * Usage:
 *   bun run seed          (seed development database)
 *   bun run seed:reset    (drop and re-seed)
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const DB_PATH = join(process.cwd(), "data", "agent.db");

function getDatabase(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function initializeSchema(database: Database.Database): void {
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  database.exec(schema);

  // Set schema version
  database.prepare(`
    INSERT OR REPLACE INTO system_config (key, value, description, updated_at)
    VALUES ('schema_version', '1', 'Database schema version', datetime('now'))
  `).run();
}

function seedData(database: Database.Database): void {
  console.log("Seeding development data...");

  // Account
  database.prepare(`
    INSERT OR REPLACE INTO accounts (id, name, balance, equity, available_margin, realized_pnl, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("ACC-001", "Main Futures Account (SIMULATION)", 5.00, 5.12, 4.88, 0.12, "USDT");

  // Strategies
  const strategies = [
    { id: "STRAT-001", name: "Momentum Breakout", version: "v4.2", state: "ACTIVE", alloc: 38, win: 71.2, pf: 2.61, trades: 412, pnl: 12.40, sharpe: 2.34, dd: -5.8, desc: "Trend-following breakout for high-momentum regimes" },
    { id: "STRAT-002", name: "Mean Reversion", version: "v2.0", state: "ACTIVE", alloc: 24, win: 66.8, pf: 2.02, trades: 388, pnl: 8.20, sharpe: 1.89, dd: -7.2, desc: "Contrarian mean reversion for ranging markets" },
    { id: "STRAT-003", name: "Range Fade", version: "v1.4", state: "ACTIVE", alloc: 18, win: 63.1, pf: 1.74, trades: 244, pnl: 5.10, sharpe: 1.52, dd: -8.4, desc: "Fade overextended moves in range-bound conditions" },
    { id: "STRAT-004", name: "Volatility Squeeze", version: "v3.1", state: "PROBATION", alloc: 12, win: 58.4, pf: 1.41, trades: 156, pnl: 2.80, sharpe: 1.12, dd: -11.2, desc: "Exploit volatility compression breakouts" },
    { id: "STRAT-005", name: "Funding Arbitrage", version: "v0.9", state: "SHADOW", alloc: 8, win: 74.9, pf: 1.22, trades: 84, pnl: 1.10, sharpe: 0.95, dd: -4.1, desc: "Exploit funding rate dislocations" },
  ];

  for (const s of strategies) {
    database.prepare(`
      INSERT OR REPLACE INTO strategies (id, name, version, state, allocation_percent, win_rate, profit_factor, total_trades, total_pnl, sharpe_ratio, max_drawdown, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(s.id, s.name, s.version, s.state, s.alloc, s.win, s.pf, s.trades, s.pnl, s.sharpe, s.dd, s.desc);
  }

  // Trades (simulated small-capital trades)
  const trades = [
    { id: "TX-001", symbol: "BTCUSDT", side: "LONG", entry: 62410.2, exit: 63180.5, qty: 0.0001, pnl: 0.08, pct: 1.23, dur: 42, strat: "Momentum Breakout", stratVer: "v4.2", opened: "2026-09-01T14:20:00Z", closed: "2026-09-01T15:02:00Z" },
    { id: "TX-002", symbol: "ETHUSDT", side: "SHORT", entry: 3412.8, exit: 3388.1, qty: 0.001, pnl: 0.02, pct: 0.72, dur: 18, strat: "Mean Reversion", stratVer: "v2.0", opened: "2026-09-01T13:45:00Z", closed: "2026-09-01T14:03:00Z" },
    { id: "TX-003", symbol: "SOLUSDT", side: "LONG", entry: 184.42, exit: 181.9, qty: 0.01, pnl: -0.03, pct: -1.37, dur: 65, strat: "Range Fade", stratVer: "v1.4", opened: "2026-09-01T12:30:00Z", closed: "2026-09-01T13:35:00Z" },
    { id: "TX-004", symbol: "BTCUSDT", side: "LONG", entry: 61980.0, exit: 62740.4, qty: 0.0001, pnl: 0.08, pct: 1.23, dur: 131, strat: "Momentum Breakout", stratVer: "v4.2", opened: "2026-09-01T10:00:00Z", closed: "2026-09-01T12:11:00Z" },
    { id: "TX-005", symbol: "BNBUSDT", side: "SHORT", entry: 612.4, exit: 604.2, qty: 0.001, pnl: 0.008, pct: 1.34, dur: 36, strat: "Range Fade", stratVer: "v1.4", opened: "2026-09-01T09:15:00Z", closed: "2026-09-01T09:51:00Z" },
  ];

  for (const t of trades) {
    database.prepare(`
      INSERT OR REPLACE INTO trades (id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, pnl_percent, duration_minutes, strategy_name, strategy_version, opened_at, closed_at)
      VALUES (?, 'ACC-001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.id, t.symbol, t.side, t.entry, t.exit, t.qty, t.pnl, t.pct, t.dur, t.strat, t.stratVer, t.opened, t.closed);
  }

  // Positions (one open position)
  database.prepare(`
    INSERT OR REPLACE INTO positions (id, account_id, symbol, side, leverage, size, entry_price, mark_price, liquidation_price, take_profit_price, stop_loss_price, unrealized_pnl, margin, opened_at, status)
    VALUES (?, 'ACC-001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
  `).run("POS-001", "BTCUSDT", "LONG", 5, 0.0001, 63112.4, 63884.9, 54980.2, 65400.0, 62180.0, 0.08, 1.26, "2026-09-01T07:15:00Z");

  // AI Decisions
  database.prepare(`
    INSERT OR REPLACE INTO ai_decisions (id, action, symbol, size, confidence, strategy_name, strategy_version, strategy_edge, reasoning, regime, regime_confidence, risk_approved, executed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("DEC-001", "OPEN_LONG", "BTCUSDT", "0.0001 BTC · 5x", 87, "Momentum Breakout", "v4.2", 1.42,
    "Regime classifier returns TRENDING at 74%. Risk guardian approved.", "TRENDING — BULL EXPANSION", 74, 1, 0, "2026-09-01T07:15:00Z");

  // AI Experiences
  const experiences = [
    { id: "EXP-001", tag: "PATTERN", title: "Low-liquidity breakouts fail near session rollover", conf: 91, impact: "+0.18 PF" },
    { id: "EXP-002", tag: "RISK", title: "Correlated longs across majors amplify drawdown", conf: 84, impact: "-32% DD" },
    { id: "EXP-003", tag: "TIMING", title: "Best entries cluster 12-40m after volume spike", conf: 77, impact: "+4.1% WR" },
    { id: "EXP-004", tag: "EXIT", title: "Trailing stop at 1.4 ATR beats fixed TP in trends", conf: 88, impact: "+0.24 PF" },
    { id: "EXP-005", tag: "REGIME", title: "Mean reversion degrades when ADX > 34", conf: 82, impact: "+2.6% WR" },
  ];

  for (const e of experiences) {
    database.prepare(`
      INSERT OR REPLACE INTO ai_experiences (id, tag, title, confidence, impact, details, trade_ids)
      VALUES (?, ?, ?, ?, ?, ?, '[]')
    `).run(e.id, e.tag, e.title, e.conf, e.impact);
  }

  // AI Lessons
  const lessons = [
    { id: "LES-001", text: "Reduce size by 40% when funding exceeds 0.03%", cycle: 118 },
    { id: "LES-002", text: "Skip entries where spread > 1.8 bps", cycle: 114 },
    { id: "LES-003", text: "Regime classifier confidence below 55% → stand down", cycle: 109 },
    { id: "LES-004", text: "Post-news volatility windows favor fades for 20 minutes", cycle: 103 },
  ];

  for (const l of lessons) {
    database.prepare(`
      INSERT OR REPLACE INTO ai_lessons (id, text, cycle, source_experience_ids)
      VALUES (?, ?, ?, '[]')
    `).run(l.id, l.text, l.cycle);
  }

  // Risk Events
  const riskEvents = [
    { type: "DAILY_LOSS_LIMIT", severity: "INFO", message: "Daily loss limit monitoring active", details: "Current: $0.03 / $0.50" },
    { type: "LEVERAGE_CHECK", severity: "INFO", message: "Leverage within bounds", details: "Current: 5x / Max: 10x" },
    { type: "EXPOSURE_WARNING", severity: "WARN", message: "Exposure at 52.5% of cap", details: "Current: $2.60 / $5.00" },
  ];

  for (const r of riskEvents) {
    database.prepare(`
      INSERT INTO risk_events (event_type, severity, message, details)
      VALUES (?, ?, ?, ?)
    `).run(r.type, r.severity, r.message, r.details);
  }

  // System Config
  const configs = [
    { key: "initial_capital", value: "5.00", desc: "Initial capital for testing" },
    { key: "daily_profit_cap", value: "0.50", desc: "Daily profit cap (risk boundary)" },
    { key: "daily_loss_limit", value: "0.50", desc: "Daily loss limit (risk boundary)" },
    { key: "max_leverage", value: "10", desc: "Maximum leverage" },
    { key: "paper_trading", value: "true", desc: "Paper trading mode" },
    { key: "trading_enabled", value: "false", desc: "Real trading disabled" },
    { key: "binance_testnet", value: "false", desc: "Binance testnet not connected" },
    { key: "data_source", value: "mock", desc: "Current data source" },
  ];

  for (const c of configs) {
    database.prepare(`
      INSERT OR REPLACE INTO system_config (key, value, description)
      VALUES (?, ?, ?)
    `).run(c.key, c.value, c.desc);
  }

  console.log("Development seed complete.");
}

// Run if executed directly
if (require.main === module) {
  const db = getDatabase();
  try {
    initializeSchema(db);
    seedData(db);
    console.log(`Database seeded at ${DB_PATH}`);
  } finally {
    db.close();
  }
}
