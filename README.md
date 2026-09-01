# BINANCE AI FUTURES AGENT v0.1

> **Orbital AI** — A retro-futuristic AI trading command center for Binance Futures.

An autonomous AI trading agent built for long-term testing before real-money deployment.

**⚠️ Phase 7 — Extended Backtesting + Walk-Forward Validation + CI/CD Complete. No real trading. No order execution.**

---

## Architecture

```
Frontend (Lovable Dashboard)
  ├── TanStack Start + React 19
  ├── TanStack Router (file-based)
  └── Tailwind CSS + shadcn/ui
        │
        ▼
API Layer (Server Functions)
  └── src/backend/api/index.ts
        │
        ▼
Application Services
  ├── src/backend/services/data-adapter.ts
  ├── src/backend/trading/orchestrator.ts
  ├── src/backend/ai/decision-engine.ts
  ├── src/backend/risk/engine.ts
  └── src/backend/paper/engine.ts
        │
        ▼
Domain Logic
  ├── src/backend/ai/strategies.ts (5 strategy modules)
  ├── src/backend/runtime/engine.ts (Runtime Intelligence)
  ├── src/backend/runtime/indicators.ts (EMA, RSI, MACD, ATR, VWAP)
  ├── src/backend/runtime/regime.ts (Market regime classifier)
  └── src/backend/market/validation.ts (Data quality)
        │
        ▼
Infrastructure
  ├── src/backend/repositories/ (9 data access modules)
  ├── src/backend/database/ (SQLite + schema versioning)
  ├── src/backend/exchange/binance-market.ts (REST - READ-ONLY)
  ├── src/backend/exchange/binance-stream.ts (WebSocket - READ-ONLY)
  └── src/backend/logger.ts (Structured logging)
```

### Trading Pipeline (Phase 4)

```
Binance Market Data (REST + WebSocket)
  ↓
Market Data Validation
  ↓
Runtime Intelligence Engine
  ↓ MarketState
Strategy Evaluation (5 modules)
  ↓ Candidate Signals
AI Decision Engine
  ↓ AiDecision
Risk Engine (HIGHEST AUTHORITY)
  ↓ RiskCheckResult
Paper Trading Engine
  ↓ PaperTrade
Database
  ↓
Dashboard
```

---

## Key Principles

- **Risk Engine is supreme** — AI decisions are always subordinate to risk controls
- **NO_TRADE is a valid decision** — the AI can choose not to trade
- **Paper trading only** — all trades are simulated until 12-month validation complete
- **Small capital target** — $5 initial, ±$0.50 daily boundary
- **Self-improvement is controlled** — no automatic strategy/model changes
- **12-month testing** — extensive validation before real money

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TanStack Start, TanStack Router |
| Styling | Tailwind CSS 4.2, shadcn/ui (46 components) |
| Charting | Recharts + custom SVG candlestick |
| Backend | TypeScript server functions (TanStack Start) |
| Database | SQLite via better-sqlite3 |
| Testing | Vitest |
| Bundler | Vite 8.1.5 |
| Package Manager | Bun |

---

## Getting Started

```bash
# Install dependencies
bun install

# Seed development database
bun run seed

# Run tests
bun run test

# Type check
bun tsc -b --noEmit

# Build
bun run build

# Start dev server (Freebuff manages this)
bun run dev
```

---

## API Endpoints

| Endpoint | Description | Data Source |
|----------|-------------|-------------|
| `GET /api/dashboard` | Account, equity, recent trades | Database |
| `GET /api/runtime` | System status, last decision | Runtime Engine |
| `GET /api/market` | Symbol data, candles | Binance / Mock |
| `GET /api/performance` | Equity curve, audit summary | Database |
| `GET /api/strategies` | Strategy portfolio | Database |
| `GET /api/trades` | Trade history | Database |
| `GET /api/learning` | AI experiences, lessons | Database |
| `GET /api/experiments` | AI experiments, models | Database |
| `GET /api/risk` | Risk status, events | Risk Engine |
| `GET /api/audit` | AI evolution, confidence | Database |
| `GET /api/system` | System config, events | Database |
| `GET /api/health` | System health check | All systems |

---

## Database

SQLite with schema versioning. 15 tables:

- `accounts` — Trading accounts
- `positions` — Open/closed positions
- `orders` — Order history
- `trades` — Completed trades
- `strategies` — Strategy definitions
- `strategy_metrics` — Daily strategy performance
- `market_data` — Historical candles
- `ai_decisions` — AI decision log
- `ai_experiences` — Pattern observations
- `ai_lessons` — Derived rules
- `ai_models` — Model versions
- `ai_experiments` — A/B experiments
- `risk_events` — Risk system events
- `system_config` — Configuration
- `system_events` — System events

---

## Dashboard Routes

| Route | Page | Status |
|-------|------|--------|
| `/` | Dashboard | ✅ |
| `/ai-intelligence` | AI Intelligence | ✅ |
| `/market-analysis` | Market Analysis | ✅ |
| `/trading` | Trading | ✅ |
| `/strategies` | Strategies | ✅ |
| `/trades` | Trades | ✅ |
| `/learning` | AI Learning | ✅ |
| `/ai-audit` | AI Audit | ✅ |
| `/risk-center` | Risk Center | ✅ |
| `/system` | System | ✅ |

All 10 routes use the API client (`@/api/client`) — no direct mock imports.

---

## Development

```bash
# Run all tests
bun run test

# Seed database
bun run seed

# Reset and re-seed
bun run seed:reset
```

---

## Safety

- **NO** Binance API credentials in repository
- **NO** real order execution
- **NO** production trading permission
- **NO** withdrawal capability
- **ALL** trades clearly marked as PAPER / SIMULATION
- **Risk Engine** has absolute authority over AI decisions
- **Daily limits** enforced automatically

---

*Phase 4 Complete. AI Decision Engine + Risk Engine + Paper Trading verified with 126 tests.*
