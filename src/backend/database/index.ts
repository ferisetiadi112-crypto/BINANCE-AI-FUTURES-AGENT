/**
 * Database Module — BINANCE AI FUTURES AGENT v0.1
 *
 * PRODUCTION PATH:
 *   Vercel → DATABASE_URL → Neon PostgreSQL
 *
 * TEST/DEV PATH:
 *   SQLite (better-sqlite3) — in-memory for tests, file for dev
 *
 * New code should use dbQuery/dbExecute from this module.
 * Legacy code can use getDatabase() for synchronous SQLite access.
 */

export {
  dbQuery,
  dbQueryOne,
  dbExecute,
  dbExecuteAndCount,
  dbTransaction,
  closeDatabase,
  isPostgresConfigured,
  getDatabase,
  createTestDatabase,
} from "./adapter";

import {
  dbQuery,
  dbQueryOne,
  dbExecute,
  isPostgresConfigured,
  closeDatabase,
} from "./adapter";
import { logger } from "../logger";

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Initialize the database.
 * Runs PostgreSQL migrations if DATABASE_URL is set.
 * For SQLite, schema is auto-initialized on first getDatabase() call.
 */
export async function initializeDatabase(): Promise<void> {
  if (!isPostgresConfigured()) {
    logger.info("database", "Using SQLite — schema auto-initialized on first access");
    return;
  }

  logger.info("database", "PostgreSQL detected — running migrations");

  // Check schema version
  let version = 0;
  try {
    const row = await dbQueryOne(
      "SELECT value FROM system_config WHERE key = 'schema_version'"
    );
    version = parseInt((row?.["value"] as string) || "0", 10);
  } catch {
    version = 0;
  }

  if (version >= CURRENT_SCHEMA_VERSION) {
    logger.info("database", `Schema version ${version} is current`);
    return;
  }

  // Run PostgreSQL migrations
  await runMigrations();

  // Update schema version
  await dbExecute(`
    INSERT INTO system_config (key, value, description, updated_at)
    VALUES ('schema_version', $1, 'Database schema version', NOW()::TEXT)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()::TEXT
  `, [String(CURRENT_SCHEMA_VERSION)]);

  logger.info("database", `Schema version set to ${CURRENT_SCHEMA_VERSION}`);
}

/**
 * PostgreSQL schema migrations.
 */
async function runMigrations(): Promise<void> {
  const { dbExecute } = await import("./adapter");

  const statements = [
    // Core tables
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Main Account',
      balance REAL NOT NULL DEFAULT 0,
      equity REAL NOT NULL DEFAULT 0,
      available_margin REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USDT',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
      leverage INTEGER NOT NULL DEFAULT 1,
      size REAL NOT NULL DEFAULT 0,
      entry_price REAL NOT NULL DEFAULT 0,
      mark_price REAL NOT NULL DEFAULT 0,
      liquidation_price REAL NOT NULL DEFAULT 0,
      take_profit_price REAL,
      stop_loss_price REAL,
      unrealized_pnl REAL NOT NULL DEFAULT 0,
      margin REAL NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      closed_at TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','LIQUIDATED'))
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
      order_type TEXT NOT NULL CHECK(order_type IN ('MARKET','LIMIT','STOP_MARKET','TAKE_PROFIT_MARKET')),
      price REAL,
      quantity REAL NOT NULL,
      filled_quantity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','OPEN','FILLED','PARTIALLY_FILLED','CANCELED','REJECTED','EXPIRED')),
      strategy_id TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      pnl REAL NOT NULL,
      pnl_percent REAL NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      strategy_name TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      open_order_id TEXT REFERENCES orders(id),
      close_order_id TEXT REFERENCES orders(id),
      opened_at TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'SHADOW'
        CHECK(state IN ('ACTIVE','SHADOW','PROBATION','DEPRECATED')),
      allocation_percent REAL NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      profit_factor REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      total_pnl REAL NOT NULL DEFAULT 0,
      sharpe_ratio REAL NOT NULL DEFAULT 0,
      max_drawdown REAL NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS strategy_metrics (
      id SERIAL PRIMARY KEY,
      strategy_id TEXT NOT NULL REFERENCES strategies(id),
      date TEXT NOT NULL,
      win_rate REAL,
      profit_factor REAL,
      trades_count INTEGER,
      pnl REAL,
      drawdown REAL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS market_data (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      open_time TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_data_symbol_time ON market_data(symbol, interval, open_time DESC)`,
    `CREATE TABLE IF NOT EXISTS ai_decisions (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL CHECK(action IN ('OPEN_LONG','OPEN_SHORT','CLOSE','HOLD','NO_TRADE')),
      symbol TEXT NOT NULL,
      size TEXT NOT NULL,
      confidence REAL NOT NULL,
      strategy_name TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      strategy_edge REAL NOT NULL,
      reasoning TEXT NOT NULL,
      regime TEXT NOT NULL,
      regime_confidence REAL NOT NULL,
      signals_snapshot TEXT NOT NULL DEFAULT '{}',
      risk_approved INTEGER NOT NULL DEFAULT 1,
      risk_rejection_reason TEXT,
      executed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_experiences (
      id TEXT PRIMARY KEY,
      tag TEXT NOT NULL CHECK(tag IN ('PATTERN','RISK','TIMING','EXIT','REGIME','GENERAL')),
      title TEXT NOT NULL,
      confidence REAL NOT NULL,
      impact TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      trade_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS trade_experiences (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      trade_id TEXT,
      symbol TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      market_regime TEXT NOT NULL,
      strategy TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LONG','SHORT','NO_TRADE')),
      confidence REAL NOT NULL,
      entry_price REAL,
      exit_price REAL,
      duration INTEGER,
      fees REAL,
      slippage REAL,
      gross_pnl REAL,
      net_pnl REAL,
      drawdown REAL,
      outcome TEXT NOT NULL CHECK(outcome IN ('WIN','LOSS','BREAKEVEN','CANCELLED','INVALID','NO_TRADE_SKIPPED','NO_TRADE_RISK_REJECTED')),
      market_context TEXT NOT NULL DEFAULT '{}',
      decision_version TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_trade_experiences_time ON trade_experiences(timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_trade_experiences_outcome ON trade_experiences(outcome)`,
    `CREATE TABLE IF NOT EXISTS ai_lessons (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      cycle INTEGER NOT NULL,
      source_experience_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'CANDIDATE'
        CHECK(state IN ('ACTIVE','CANDIDATE','ARCHIVED')),
      accuracy REAL NOT NULL DEFAULT 0,
      profit_factor REAL NOT NULL DEFAULT 0,
      training_cycles INTEGER NOT NULL DEFAULT 0,
      config_snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'RUNNING'
        CHECK(state IN ('RUNNING','COMPLETED','FAILED','REJECTED')),
      start_date TEXT NOT NULL,
      end_date TEXT,
      sample_size INTEGER NOT NULL DEFAULT 0,
      control_win_rate REAL NOT NULL DEFAULT 0,
      treatment_win_rate REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      conclusion TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS risk_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('INFO','WARN','ERROR','CRITICAL')),
      message TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE TABLE IF NOT EXISTS system_events (
      id SERIAL PRIMARY KEY,
      component TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id, closed_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_decisions_time ON ai_decisions(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_risk_events_time ON risk_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_system_events_time ON system_events(created_at DESC)`,
    // Wallet tables (Phase 9D)
    `CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL CHECK(type IN ('TOP_UP','WITHDRAW')),
      amount REAL NOT NULL CHECK(amount > 0),
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      initiated_by TEXT NOT NULL DEFAULT 'boss' CHECK(initiated_by IN ('boss','system')),
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account ON wallet_transactions(account_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS guardrail_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL CHECK(event_type IN ('BALANCE_CHECK','TRADE_BLOCKED','TRADE_ALLOWED','INSUFFICIENT_FUNDS','MARKET_UNSTABLE','DAILY_LIMIT_REACHED','WALLET_MODIFIED')),
      severity TEXT NOT NULL CHECK(severity IN ('INFO','WARN','ERROR','CRITICAL')),
      message TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      balance_snapshot REAL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_guardrail_events_time ON guardrail_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_guardrail_events_type ON guardrail_events(event_type, created_at DESC)`,
    // Risk state persistence (P2)
    `CREATE TABLE IF NOT EXISTS risk_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )`,
  ];

  for (const stmt of statements) {
    await dbExecute(stmt);
  }

  // Seed initial risk state
  await dbExecute(`
    INSERT INTO risk_state (key, value, updated_at) VALUES ('daily_pnl', '0', NOW()::TEXT) ON CONFLICT (key) DO NOTHING
  `);
  await dbExecute(`
    INSERT INTO risk_state (key, value, updated_at) VALUES ('is_locked', 'false', NOW()::TEXT) ON CONFLICT (key) DO NOTHING
  `);
  await dbExecute(`
    INSERT INTO risk_state (key, value, updated_at) VALUES ('lock_reason', '', NOW()::TEXT) ON CONFLICT (key) DO NOTHING
  `);

  logger.info("database", "PostgreSQL migrations complete");
}
