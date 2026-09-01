-- BINANCE AI FUTURES AGENT v0.1 — Database Schema
-- SQLite. Designed for 12-month testing lifecycle.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Main Account',
  balance REAL NOT NULL DEFAULT 0,
  equity REAL NOT NULL DEFAULT 0,
  available_margin REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USDT',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
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
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','LIQUIDATED'))
);

CREATE TABLE IF NOT EXISTS orders (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS strategies (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS strategy_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id TEXT NOT NULL REFERENCES strategies(id),
  date TEXT NOT NULL,
  win_rate REAL,
  profit_factor REAL,
  trades_count INTEGER,
  pnl REAL,
  drawdown REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  open_time TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol_time
  ON market_data(symbol, interval, open_time DESC);

CREATE TABLE IF NOT EXISTS ai_decisions (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_experiences (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL CHECK(tag IN ('PATTERN','RISK','TIMING','EXIT','REGIME','GENERAL')),
  title TEXT NOT NULL,
  confidence REAL NOT NULL,
  impact TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  trade_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trade Experiences: Detailed record of every paper trade and no-trade decision
-- Used by the Experience Engine for learning and analysis
CREATE TABLE IF NOT EXISTS trade_experiences (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trade_experiences_time ON trade_experiences(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trade_experiences_outcome ON trade_experiences(outcome);

CREATE TABLE IF NOT EXISTS ai_lessons (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  source_experience_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'CANDIDATE'
    CHECK(state IN ('ACTIVE','CANDIDATE','ARCHIVED')),
  accuracy REAL NOT NULL DEFAULT 0,
  profit_factor REAL NOT NULL DEFAULT 0,
  training_cycles INTEGER NOT NULL DEFAULT 0,
  config_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_experiments (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('INFO','WARN','ERROR','CRITICAL')),
  message TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_time ON ai_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_time ON risk_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_time ON system_events(created_at DESC);
