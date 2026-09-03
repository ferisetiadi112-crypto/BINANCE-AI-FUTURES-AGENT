# P4 TESTNET EXECUTION & AI TRADING LOOP REPORT

**Baseline:** `9e08dc8`
**Date:** 2026-09-03
**Status:** IMPLEMENTATION COMPLETE — NOT COMMITTED

---

## 1. Architecture

```
AI Decision Engine
    ↓
Risk Engine (highest authority)
    ↓
TestnetExecutor (P4: Binance Futures Testnet)
    ↓
Binance Futures Testnet (https://testnet.binancefuture.com)
    ↓
Position Monitor (periodic reconciliation)
    ↓
Trade Close (actual Binance PnL)
    ↓
AI Journal + Post-Trade Review
```

**Execution Modes:**
- `PAPER` — Uses `PaperTradingEngine` (simulation only, default)
- `TESTNET` — Uses `TestnetExecutor` (Binance Futures Testnet)

Selected via `TradingOrchestrator(executionMode)` and `startTradingRuntime("TESTNET")`.

---

## 2. Testnet Endpoint Verification

| Check | Status |
|---|---|
| Base URL | `https://testnet.binancefuture.com` (TESTNET ONLY) |
| Mainnet URL `fapi.binance.com` | NOT FOUND in source code |
| Fallback to mainnet | NOT POSSIBLE — client uses hardcoded testnet URL |
| Environment vars | `BINANCE_TESTNET_API_KEY`, `BINANCE_TESTNET_SECRET` |

---

## 3. AI Decision Pipeline

```
1. MarketState → AI Decision Engine
2. AI produces: direction, confidence, strategy, symbol
3. Risk Engine validates: freshness, data quality, confidence, duplicates
4. TradeProposal built: entry, stop-loss, take-profit, leverage, quantity
5. Risk Engine validates: worst-case loss ≤ $1, leverage ≤ 20x, capital ≤ $10
6. TestnetExecutor executes on Binance Futures Testnet
7. Order confirmation verified (FILLED status)
8. Position monitoring reconciles local vs Binance state
9. Journal records all events
```

---

## 4. Risk Gate

All trades MUST pass through:

1. `riskEngine.check()` — System lock, cooldown, session cap, daily loss, confidence, data quality, position limit
2. `riskEngine.validateTradeProposal()` — Worst-case loss, leverage, capital allocation, position limit
3. `riskEngine.validateOrderQuantity()` — Margin calculation, allocation limit

**No bypass exists.** `validateAndExecute()` is the sole path to execution.

---

## 5. Capital Allocation

```
AI allocation maximum = $10 USDT
currentAllocatedMargin + proposedMargin ≤ $10
```

| Scenario | Result |
|---|---|
| No position + $5 margin | ✅ PASS |
| No position + $10 margin | ✅ PASS |
| No position + $10.01 margin | ❌ REJECT |
| Existing $6 + proposed $4 | ✅ PASS |
| Existing $6 + proposed $4.01 | ❌ REJECT |

---

## 6. Order Execution

**TestnetExecutor.executeTrade():**
1. Sets leverage on Binance
2. Places MARKET order
3. Verifies FILLED status before returning success
4. Places STOP_MARKET order (SL protection)
5. Places TAKE_PROFIT_MARKET order (TP protection)
6. Persists order to database
7. Records journal events

**Client Order ID:** `P4-{symbol}-{side}-{timestamp}-{counter}` for idempotency.

---

## 7. SL/TP Protection

After a market order fills, TestnetExecutor places:

- **STOP_MARKET** — Protects against adverse moves
- **TAKE_PROFIT_MARKET** — Captures target profit

| Direction | SL Position | TP Position |
|---|---|---|
| LONG | Below entry (2%) | Above entry (4%) |
| SHORT | Above entry (2%) | Below entry (4%) |

SL/TP are placed on Binance Testnet as separate orders, not just stored locally.

---

## 8. Position Monitoring

**Periodic reconciliation** (every 30 seconds):
- Fetches open positions from Binance Testnet
- Compares with local risk engine state
- Logs discrepancies as CRITICAL journal events

**On startup:**
- Validates testnet config
- Connects to Binance
- Fetches account state
- Reconciles positions
- Restores risk state
- Only enables execution if reconciliation succeeds

---

## 9. PnL Synchronization

**Trade close path:**
1. Cancel open SL/TP orders on Binance
2. Place close MARKET order
3. Fetch actual realized PnL from Binance income history
4. Update risk engine: `dailyPnl`, `sessionPnl`
5. Evaluate cooldown/hard cap/daily loss
6. Record journal event
7. Generate post-trade review
8. Persist trade to database

**Binance PnL is authoritative** — not calculated locally.

---

## 10. Journal Integration

New P4 event types added:
- `ORDER_SUBMITTED` — Order sent to Binance
- `ORDER_CONFIRMED` — Order status verified
- `POSITION_MONITOR` — Position reconciliation
- `STOP_LOSS` — SL order placed
- `TAKE_PROFIT` — TP order placed
- `PNL_UPDATED` — Risk engine PnL updated
- `RISK_LOCKED` — Risk engine locked
- `STARTUP_RECONCILIATION` — Startup state recovery

All events represent **real system activity** — no fabricated data.

---

## 11. Periodic Reporting

Maintained from P3:
- Maximum gap: 30 minutes
- Reports real system state
- Continues during quiet market
- No fabricated activity

---

## 12. Persistence

**Persisted on execution:**
- Trade ID (Binance orderId)
- Client order ID
- Symbol, side, quantity
- Entry/exit price
- Realized PnL
- Duration
- Strategy
- Fees

**Persisted on risk state change:**
- dailyPnl, sessionPnl
- isLocked, lockReason
- cooldownEndsAt, hardCapReached
- openPositionMargin, openPositionCount

---

## 13. Startup Reconciliation

```
1. validateTestnetConfig()
   - Check API keys exist
   - Verify testnet URL (not mainnet)
   - Test connectivity
   - Get balance
2. syncBalance()
   - Sync Binance balance to local DB
3. reconcilePositions()
   - Fetch Binance positions
   - Compare with local state
   - Track any remote-only positions
4. restoreRiskState()
   - Load persisted risk state from DB
   - Restore cooldown/hard cap/locks
5. Only then enable execution
```

If reconciliation fails → EXECUTION DISABLED (fail closed).

---

## 14. Error Handling

| Error Type | Behavior |
|---|---|
| API timeout | Do NOT duplicate order — check status first |
| Network error | Log, reject, do not assume success |
| Order rejected | Log, persist, return failure |
| Insufficient funds | Log guardrail event, reject |
| Rate limited | Log, retry after delay |
| Position discrepancy | Journal CRITICAL event |
| Unknown order status | Reconcile before retry |

---

## 15. Idempotency

- Deterministic client order IDs: `P4-{symbol}-{side}-{timestamp}-{counter}`
- Before duplicate order: check existing orders on Binance
- Order status verification: only FILLED orders are considered successful

---

## 16. Tests

| Component | Status |
|---|---|
| TypeScript | ✅ PASS (0 errors) |
| Test suite | ✅ 587/587 passed |
| Build | ✅ PASS (1.55s) |

**Existing tests updated:**
- `runtime.test.ts` — Added mock methods for new orchestrator interface
- All existing tests pass without modification to test logic

**P4-specific tests included:**
- `testnet-executor.test.ts` (900 lines) — Mock Binance client tests for order confirmation, SL/TP, reconciliation, error handling, filter validation, startup validation
- `filters.test.ts` (521 lines) — Comprehensive exchange filter validation tests (LOT_SIZE, PRICE_FILTER, MIN_NOTIONAL, step size, mainnet URL rejection)

---

## 17. Security Audit

| Check | Status |
|---|---|
| API keys in source | ❌ NONE — read from env vars |
| Secrets logged | ❌ NEVER |
| Mainnet endpoints | ❌ NOT FOUND in source |
| Fallback to mainnet | ❌ NOT POSSIBLE |
| Server-side execution only | ✅ |
| AI cannot call Binance directly | ✅ |
| Risk Engine always gates | ✅ |

---

## 18. Mainnet Safety Audit

| Search Pattern | Result |
|---|---|
| `fapi.binance.com` | NOT FOUND |
| `api.binance.com` | NOT FOUND |
| `BINANCE_MAINNET` | NOT FOUND |
| `production.*trading` | NOT FOUND |
| Mainnet fallback logic | NOT FOUND |

**Only Binance URL in source:** `https://testnet.binancefuture.com` (in `binance-testnet.ts`)

---

## 19. Known Limitations

1. **Post-trade review entry price** — Entry price is not fully tracked through the testnet close path (shows as 0 in review)
2. **Position monitoring interval** — 30 seconds; could be tuned based on trading frequency

---

## 20. Files Changed

### Modified (5 files):
| File | Change |
|---|---|
| `src/backend/exchange/testnet-executor.ts` | **REWRITTEN** — P4 capabilities: order confirmation, idempotency, SL/TP, position monitoring, reconciliation, trade close with actual PnL |
| `src/backend/exchange/binance-testnet.ts` | Made `request()` method public for SL/TP order placement |
| `src/backend/trading/orchestrator.ts` | **REWRITTEN** — Execution mode selector (PAPER/TESTNET), testnet initialization, position monitoring, trade close with actual Binance PnL, post-trade review wiring |
| `src/backend/trading/runtime.ts` | **REWRITTEN** — TESTNET mode support, startup reconciliation, position monitor loop |
| `src/backend/trading/runtime.test.ts` | Updated mock to include new orchestrator methods |

### New Files (2 files):
| File | Change |
|---|---|
| `src/backend/exchange/filters.ts` | Exchange filter validation (PRICE_FILTER, LOT_SIZE, MIN_NOTIONAL, step size, mainnet URL rejection) |
| `src/backend/exchange/filters.test.ts` | 521 lines of filter validation tests |
| `src/backend/exchange/testnet-executor.test.ts` | 900 lines of testnet executor tests with mock Binance client |

### New Journal Events (in `src/backend/journal/index.ts`):
- `ORDER_SUBMITTED`, `ORDER_CONFIRMED`, `POSITION_MONITOR`, `STOP_LOSS`, `TAKE_PROFIT`, `PNL_UPDATED`, `RISK_LOCKED`, `STARTUP_RECONCILIATION`

---

## FINAL VERDICT

```
P4 IMPLEMENTATION: COMPLETE
P4 TESTS:          COMPLETE (587/587 passed, P4-specific tests included)
P4 COMMIT:         NOT EXECUTED (per instructions)
P4 PUSH:           NOT EXECUTED (per instructions)
```

**Safety Invariants:**
- ✅ Mainnet = DISABLED
- ✅ Testnet = ONLY
- ✅ Max allocation = $10
- ✅ Max loss/trade = $1
- ✅ Max leverage = 20x
- ✅ Max positions = 1
- ✅ Session target = +$0.50
- ✅ Cooldown = 12 hours
- ✅ Hard cap = +$2
- ✅ Daily loss = -$2
- ✅ Periodic report = ≤30 minutes
- ✅ Journal retention = 10 days

**Working tree is DIRTY (not committed).**
