# PHASE 7 DEEP AUDIT REPORT

## BINANCE AI FUTURES AGENT v0.1

---

## 1. EXECUTIVE SUMMARY

Phase 7 claims 184/184 tests passing, TypeScript clean, build successful, and 45/45 acceptance criteria met.

After deep source-code audit, I found **6 HIGH-severity findings**, **4 MEDIUM-severity findings**, and several LOW/INFO items. The most critical issues are:

1. **CRITICAL: Backtest entry/exit model is fundamentally broken** — every trade opens and closes at the same candle's close price, producing near-zero PnL per trade
2. **HIGH: No test for look-ahead bias exists** — the claim "look-ahead tests available" is false
3. **HIGH: Parameter robustness test does not actually vary parameters** — `createConfigWithParameter` is a no-op stub
4. **HIGH: Walk-forward uses identical config for train and validation** — no parameter selection/optimization occurs
5. **HIGH: `lookAheadProtected: true` is hardcoded** — not verified by any code
6. **HIGH: `totalSlippage` in metrics only counts entry slippage** — exit slippage from `closePosition` is silently discarded

**Verdict: PHASE 7 NOT VERIFIED — MAJOR ISSUES**

---

## 2. FILES AUDITED

| File | Lines | Purpose |
|---|---|---|
| `src/backend/backtest/historical-data.ts` | 307 | Historical data fetch, validation, dedup |
| `src/backend/backtest/engine.ts` | 370 | Backtest execution engine |
| `src/backend/backtest/walkforward.ts` | 230 | Walk-forward validation |
| `src/backend/backtest/robustness.ts` | 324 | Robustness analysis |
| `src/backend/backtest/index.ts` | 63 | Barrel export |
| `src/backend/backtest/historical-data.test.ts` | 110 | Data validation tests |
| `src/backend/backtest/engine.test.ts` | 128 | Backtest engine tests |
| `src/backend/backtest/walkforward.test.ts` | 80 | Walk-forward tests |
| `src/backend/paper/engine.ts` | 270 | Paper trading engine |
| `src/backend/market/symbols.ts` | 88 | Symbol universe config |
| `.github/workflows/ci.yml` | 25 | CI pipeline |

---

## 3. HISTORICAL DATA ENGINE AUDIT

### 3.1 Binance Endpoint

**File:** `src/backend/backtest/historical-data.ts`, lines 84-130

```
BINANCE_FUTURES_BASE = "https://fapi.binance.com"
Endpoint: /fapi/v1/klines
```

**Evidence:** Line 90: `const url = ${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endTime}&limit=${MAX_CANDLES_PER_REQUEST}`

✅ Correct public endpoint. No API key required.

### 3.2 Pagination

**Evidence:** Lines 85-130: `while (currentStart < endTime)` loop with `currentStart = (lastCandle[0] as number) + intervalMs`

✅ Pagination implemented via Binance limit + offset.

### 3.3 Rate Limiting

**Evidence:** Line 125: `await new Promise(resolve => setTimeout(resolve, 200))`

✅ 200ms delay between requests. Adequate for public endpoints.

### 3.4 Validation

**Evidence:** Lines 132-210: `validateCandles()` checks:
- Timestamp ordering (line 159)
- Duplicates via Set (line 165)
- OHLC validity: `open <= 0 || high <= 0 || low <= 0 || close <= 0` (line 177)
- `high < low` (line 182)
- Negative volume (line 186)
- Gaps: `candles[i].openTime > expectedTime + intervalMs * 0.1` (line 198)

✅ Comprehensive validation.

### 3.5 Findings

| ID | Severity | Finding |
|---|---|---|
| HD-1 | LOW | No retry logic — fetch errors silently break the loop (line 127: `break`). Data may be incomplete. |
| HD-2 | LOW | `datasetCounter` is module-level mutable — not persisted, resets on restart. Dataset IDs not reproducible. |
| HD-3 | INFO | Historical data is fetched live from Binance. Tests use synthetic mock candles, not real data. |

---

## 4. LOOK-AHEAD BIAS AUDIT

### 4.1 Critical Finding: Entry AND Exit at Same Candle Close

**File:** `src/backend/backtest/engine.ts`, lines 235-245

```typescript
// Execute Paper Trade
if (riskResult.approved && decision.direction !== "NO_TRADE") {
  const order = paperEngine.execute(decision, currentCandle.close);  // ENTRY at close[i]
  if (order) {
    // Simulate position update with next candle's close
    if (i + 1 < candles.length) {
      const nextCandle = candles[i + 1];
      if (nextCandle) {
        paperEngine.updatePosition(nextCandle.close);  // Update unrealized PnL
      }
    }
    // Close position for backtest
    const closePrice = currentCandle.close;  // EXIT at close[i] — SAME PRICE!
    const trade = paperEngine.closePosition(closePrice, "BACKTEST_EXIT");
```

**This is a CRITICAL logic error.** Entry and exit both use `currentCandle.close`. The position opens and closes at the exact same price. Every trade produces near-zero PnL (only fee/slippage losses). This is why all backtests show ~0% win rate and near-zero PnL.

**Impact:** Backtest results are meaningless. The engine does not actually test hold-period performance.

**Classification: CRITICAL**

### 4.2 Indicator Calculation

**File:** `src/backend/backtest/engine.ts`, lines 180-195

```typescript
const availableCandles = candles.slice(Math.max(0, i - 50), i + 1);
const closes = availableCandles.map(c => c.close);
const sma20 = closes.slice(-20).reduce((sum, c) => sum + c, 0) / 20;
const sma50 = closes.reduce((sum, c) => sum + c, 0) / 50;
```

✅ Indicators use only `candles[0..i]` — no future data. Slicing is correct.

### 4.3 Regime Classification

**Evidence:** Lines 197-203: Simple trend/momentum derived from `closes` (which is `candles[0..i]`).

✅ No look-ahead in regime classification.

### 4.4 AI Decision

**Evidence:** Line 205: `const decision = generateDecision(marketState)` — MarketState is built from historical data only.

✅ `generateDecision` is the same function used in live paper trading. No look-ahead.

### 4.5 Risk Engine

**Evidence:** Lines 218-226: `riskEngine.check(decision, marketState, currentPosition)` — same function as live.

✅ Risk engine is identical to paper trading.

### 4.6 Walk-Forward Split

**File:** `src/backend/backtest/walkforward.ts`, lines 140-145

```typescript
const trainCandles = candles.filter(c => c.openTime >= trainStart && c.openTime < trainEnd);
const validationCandles = candles.filter(c => c.openTime >= validationStart && c.openTime < validationEnd);
```

✅ Temporal split is clean — `trainEnd = validationStart`, no overlap.

### 4.7 Look-Ahead Test Exists?

**Searched:** All test files in `src/backend/backtest/`

**Result:** NO test exists that verifies indicator calculation uses only past data. The engine.test.ts tests only check `status === "COMPLETED"` and `lookAheadProtected === true`.

**Classification: HIGH** — Claim "look-ahead tests available" is FALSE.

### 4.8 `lookAheadProtected` Flag

**File:** `src/backend/backtest/engine.ts`, line 340

```typescript
lookAheadProtected: true,
```

This is **hardcoded to `true`**. No code ever sets it to `false`. No verification logic exists.

**Classification: HIGH** — The flag is a lie.

---

## 5. BACKTEST ENGINE AUDIT

### 5.1 Strategy Engine Usage

**File:** `src/backend/backtest/engine.ts`, line 205

```typescript
const decision = generateDecision(marketState);
```

✅ Uses the actual `generateDecision` from `src/backend/ai/decision-engine.ts`. Same as live.

### 5.2 Risk Engine Usage

**Evidence:** Lines 218-226: `new RiskEngine(...)` with same config as paper trading.

✅ Identical risk engine.

### 5.3 Paper Engine Usage

**Evidence:** Lines 155-163: `new PaperTradingEngine(...)` with same fee/slippage config.

✅ Uses actual PaperTradingEngine class.

### 5.4 Divergence: Backtest vs Paper Logic

| Aspect | Paper Trading | Backtest | Match? |
|---|---|---|---|
| Entry price | `currentCandle.close` (market data) | `currentCandle.close` | ✅ |
| Exit price | next candle close / TP / SL | `currentCandle.close` (SAME candle!) | ❌ |
| Fees | `quantity * fillPrice * feeRate` | Same (via PaperEngine) | ✅ |
| Slippage | `currentPrice * slippageRate` | Same (via PaperEngine) | ✅ |
| Position lifecycle | open → updatePosition → close | open → updatePosition → close SAME candle | ❌ |
| Risk checks | 10 checks | 10 checks | ✅ |
| Daily limits | `updateDailyPnl` | `updateDailyPnl` | ✅ |

**The only difference is the exit model — and it's broken.**

### 5.5 Divergence Finding

**File:** `src/backend/backtest/engine.ts`, line 240

```typescript
const closePrice = currentCandle.close;
```

In paper trading, positions are held across candles and closed by TP/SL or explicit close. In the backtest, every position is immediately closed at the same candle's close.

**Classification: CRITICAL**

---

## 6. FEES + SLIPPAGE AUDIT

### 6.1 Entry Fee

**File:** `src/backend/paper/engine.ts`, line 85

```typescript
const fee = quantity * fillPrice * this.config.simulatedFeeRate;
```

✅ Fee calculated on notional value at fill price.

### 6.2 Exit Fee

**File:** `src/backend/paper/engine.ts`, line 162

```typescript
const fee = quantity * exitPrice * this.config.simulatedFeeRate;
```

✅ Exit fee calculated.

### 6.3 Slippage Model

**Evidence:** Line 82-84: `fillPrice = side === "BUY" ? currentPrice + slippage : currentPrice - slippage`

✅ Slippage applied to entry only. Exit slippage not applied in `closePosition`.

### 6.4 Finding: Exit Slippage Discarded

**File:** `src/backend/paper/engine.ts`, lines 158-175

```typescript
closePosition(currentPrice: number, reason: string): PaperTrade | null {
  // ...
  const slippage = exitPrice * this.config.simulatedSlippageRate;
  // slippage is calculated but NEVER subtracted from PnL!
  let pnl: number;
  if (side === "LONG") {
    pnl = (exitPrice - this.position.entryPrice) * quantity - fee;
    // Note: slippage is NOT in the PnL formula
  }
```

`slippage` is calculated and stored on the trade object but is **never deducted from PnL**. Only entry fee is deducted.

**Impact:** PnL is overstated by exit slippage amount.

**Classification: HIGH**

### 6.5 Finding: Backtest `totalSlippage` Only Counts Entry

**File:** `src/backend/backtest/engine.ts`, line 320

```typescript
const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);
```

`t.slippage` comes from the paper engine's `trade.slippage` which is `exitPrice * slippageRate`. But this value is never deducted from PnL. The `totalSlippage` metric is misleading — it reports a cost that wasn't actually charged.

**Classification: MEDIUM**

---

## 7. WALK-FORWARD VALIDATION AUDIT

### 7.1 Train/Validation Split

**File:** `src/backend/backtest/walkforward.ts`, lines 138-142

```typescript
const trainCandles = candles.filter(c => c.openTime >= trainStart && c.openTime < trainEnd);
const validationCandles = candles.filter(c => c.openTime >= validationStart && c.openTime < validationEnd);
```

✅ Clean temporal split. No overlap.

### 7.2 No Parameter Optimization

**Evidence:** Lines 155-170: Both train and validation use **identical** `BacktestConfig`:

```typescript
const trainConfig: BacktestConfig = { /* ... */ };
window.trainResult = runBacktest(trainCandles, trainConfig);

const validationConfig: BacktestConfig = {
  ...trainConfig,  // IDENTICAL config!
  id: `${window.id}-VAL`,
  // ...
};
window.validationResult = runBacktest(validationCandles, validationConfig);
```

The "train" phase runs a backtest but **does not select or optimize parameters**. The validation phase runs the exact same config. This is not walk-forward optimization — it's just running the same backtest on two time slices.

**Classification: HIGH** — Walk-forward does not perform optimization.

### 7.3 Robustness Score

**Evidence:** Lines 188-191:

```typescript
function calculateRobustnessScore(trainWinRate: number, validationWinRate: number): number {
  const diff = Math.abs(trainWinRate - validationWinRate) / 100;
  return Math.max(0, 1 - diff);
}
```

This is a simple difference metric, not a proper statistical test. Acceptable for a foundation but should not be over-interpreted.

**Classification: INFO**

---

## 8. OOS / OUT-OF-SAMPLE AUDIT

### 8.1 Data Leakage

The walk-forward engine splits data chronologically. No future data is used for past decisions.

✅ No data leakage in temporal splits.

### 8.2 Parameter Leakage

Since no parameter optimization occurs in walk-forward, there is no parameter leakage. However, this also means the OOS validation is meaningless — it's the same strategy on different data.

**Classification: HIGH** — OOS validation is vacuous.

### 8.3 Experience/Lesson Leakage

**File:** `src/backend/backtest/engine.ts`

The backtest engine does NOT call `recordTradeExperience()` or the lesson engine. It only calls `paperEngine.execute()` and `paperEngine.closePosition()`. No experiences are created during backtest.

✅ No experience/lesson leakage in backtest.

---

## 9. ROBUSTNESS ANALYSIS AUDIT

### 9.1 Parameter Variation

**File:** `src/backend/backtest/robustness.ts`, lines 55-110

```typescript
const config = createConfigWithParameter(baseConfig, param.name, value);
const result = runBacktest(candles, config);
```

**File:** `src/backend/backtest/robustness.ts`, lines 280-290

```typescript
function createConfigWithParameter(
  baseConfig: BacktestConfig,
  paramName: string,
  value: number,
): BacktestConfig {
  // This is a simplified version - in production, would need proper parameter mapping
  return {
    ...baseConfig,
    id: `${baseConfig.id}-${paramName}-${value}`,
    name: `${baseConfig.name}-${paramName}-${value}`,
  };
}
```

**`createConfigWithParameter` is a NO-OP stub.** It only changes `id` and `name` — it does NOT change any strategy parameter. All "parameter variations" run the exact same backtest with different labels.

**Classification: HIGH** — Parameter robustness analysis is non-functional.

### 9.2 Regime Robustness

**Evidence:** Lines 115-155: Groups candles by regime, runs separate backtests per group.

✅ Regime analysis runs actual separate backtests. However, the regime grouping is based on the same simplified SMA logic as the backtest engine, which is crude.

**Classification: LOW** — Simplified regime estimation.

### 9.3 Symbol Robustness

**Evidence:** Lines 160-190: Runs backtest per symbol from provided `symbolCandles` map.

✅ Symbol analysis works correctly if given proper candle data.

### 9.4 Cost Sensitivity

**Evidence:** Lines 195-235: Runs backtest with 4 fee/slippage scenarios.

✅ Cost sensitivity works correctly.

---

## 10. SYMBOL UNIVERSE AUDIT

**File:** `src/backend/market/symbols.ts`, lines 17-22

```typescript
const DEFAULT_SYMBOLS: SymbolConfig[] = [
  { symbol: "BTCUSDT", enabled: true, ... },
  { symbol: "ETHUSDT", enabled: true, ... },
  { symbol: "SOLUSDT", enabled: true, ... },
  { symbol: "BNBUSDT", enabled: true, ... },
];
```

✅ 4 symbols configured. Backtest accepts symbol as config parameter.

**Finding:** Backtest tests only use `BTCUSDT`. No test verifies multi-symbol backtesting.

**Classification: LOW**

---

## 11. DATABASE AUDIT

### 11.1 Phase 7 Database

Phase 7 does NOT add any new database tables. The `historical-data.ts` module creates in-memory `DatasetInfo` objects but does NOT persist them to SQLite. The backtest engine runs entirely in-memory.

### 11.2 Reproducibility

**File:** `src/backend/backtest/engine.ts`

- `Date.now()` is used for trade IDs (line 251: `BT-TRD-${tradeCounter}`) — counter-based, reproducible per run
- PaperEngine uses `Date.now()` for position/order IDs — NOT reproducible across runs
- `lookAheadProtected: true` is hardcoded

**The same backtest run twice with the same data WILL produce different trade IDs and timestamps.** Core metrics (PnL, win rate) SHOULD be deterministic since they depend only on candle data and strategy logic. However, because of the entry/exit-at-same-close bug, all trades have near-zero PnL anyway.

**Classification: MEDIUM** — Not fully reproducible due to timestamp-based IDs, but core results should be deterministic.

---

## 12. PHASE 6 INTEGRATION AUDIT

### 12.1 Strategy Versions

**File:** `src/backend/backtest/engine.ts`, line 63

```typescript
strategyVersion: string;
```

Config carries version info but it's only stored on the result — it doesn't affect backtest logic.

✅ Version metadata available.

### 12.2 Confidence Calibration

Backtest trades carry `confidence` from the AI decision engine. This feeds into the `baseline` calculation which can be used by the calibration engine.

✅ Integration point exists.

### 12.3 A/B Experiment Infrastructure

Not directly used by backtest. The backtest is a standalone evaluation tool.

**Classification: INFO**

---

## 13. PHASE 5 LEARNING INTEGRATION AUDIT

### 13.1 Experience Leakage

**Evidence:** The backtest engine does NOT call `recordTradeExperience()` or `recordNoTradeExperience()`. No database writes occur during backtest.

✅ No experience leakage.

### 13.2 Lesson Leakage

The lesson engine is not invoked during backtest.

✅ No lesson leakage.

---

## 14. RISK ENGINE AUDIT

### 14.1 Risk Engine in Backtest

**File:** `src/backend/backtest/engine.ts`, lines 152-163

```typescript
const riskEngine = new RiskEngine({
  initialCapital: config.initialCapital,
  dailyProfitCap: config.riskConfig.dailyProfitCap,
  dailyLossLimit: config.riskConfig.dailyLossLimit,
  maxLeverage: config.riskConfig.maxLeverage,
  maxExposurePercent: config.riskConfig.maxExposurePercent,
});
```

Lines 218-226:

```typescript
const riskResult = riskEngine.check(
  decision,
  marketState,
  currentPosition ? { ... } : { symbol: config.symbol, side: "FLAT", size: 0 },
);
```

✅ Risk engine is used with same config. All 10 checks apply. Daily PnL is updated (line 259: `riskEngine.updateDailyPnl(trade.pnl)`).

### 14.2 Bypass Search

No code path in the backtest skips or weakens risk engine checks. The risk engine is instantiated with the same parameters as paper trading.

✅ No risk engine bypass found.

---

## 15. CI/CD AUDIT

**File:** `.github/workflows/ci.yml`

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  check:
    steps:
      - bun install
      - bun tsc -b --noEmit
      - bun run test
      - bun run build
```

✅ Correct triggers, correct steps.

**Finding:** No caching of dependencies. No matrix testing. No environment secrets handling (correct — none needed).

**Classification: INFO** — Minimal but functional.

---

## 16. TEST QUALITY AUDIT

### 16.1 Coverage Analysis

| Claimed Test Area | Test Exists? | Tests Correctly? |
|---|---|---|
| Look-ahead protection | ❌ NO | N/A |
| Data gaps | ✅ YES (validateCandles) | ✅ Correct |
| Duplicates | ✅ YES | ✅ Correct |
| Malformed candles | ✅ YES (OHLC validation) | ✅ Correct |
| Fees | ✅ YES (tracks fees ≥ 0) | ⚠️ Only checks ≥ 0, not actual values |
| Slippage | ✅ YES (tracks slippage ≥ 0) | ⚠️ Only checks ≥ 0 |
| LONG trades | ⚠️ Implicit | Not explicitly tested |
| SHORT trades | ⚠️ Implicit | Not explicitly tested |
| NO_TRADE | ❌ NO | N/A |
| TP/SL | ❌ NO | N/A |
| Daily profit limit | ❌ NO | N/A |
| Daily loss limit | ❌ NO | N/A |
| Walk-forward leakage | ❌ NO | N/A |
| OOS isolation | ❌ NO | N/A |
| Robustness | ❌ NO (no robustness tests) | N/A |
| Reproducibility | ❌ NO | N/A |

### 16.2 Happy-Path Tests

**File:** `src/backend/backtest/engine.test.ts`

All 5 tests are happy-path:
1. Returns FAILED for insufficient data ✅
2. Runs backtest with sufficient data ✅ (but result is meaningless due to same-candle entry/exit)
3. Calculates equity curve ✅
4. Tracks fees and slippage ✅
5. Creates baseline ✅

**Missing tests:**
- Verify indicator calculation uses only past data
- Verify entry/exit at different prices
- Verify TP/SL execution
- Verify daily loss limit triggers
- Verify walk-forward temporal isolation
- Verify parameter variation actually changes behavior

**Classification: HIGH** — Test coverage is significantly overclaimed.

### 16.3 Test Counts vs Claims

| Claim | Actual |
|---|---|
| "184/184 tests passing" | ✅ True — tests do pass |
| "look-ahead tests available" | ❌ FALSE — no such test exists |
| "reproducibility tests available" | ❌ FALSE — no such test exists |
| "robustness tests available" | ❌ FALSE — no robustness.test.ts exists |

---

## 17. SECURITY AUDIT

| Check | Status |
|---|---|
| No Binance API keys | ✅ |
| No secrets in code | ✅ |
| No real order execution | ✅ — `placeOrder()` throws in binance-adapter |
| No withdrawal | ✅ |
| No production trading | ✅ — `trading_enabled: false` in seed |
| Hardcoded credential | ✅ None found |

✅ Security posture is clean.

---

## 18. PERFORMANCE / SCALABILITY AUDIT

### 18.1 Memory

**File:** `src/backend/backtest/engine.ts`

The entire candle array is held in memory. For 1 year of 1h data: ~8,760 candles × ~200 bytes = ~1.7MB. Acceptable.

For 1 year of 1m data: ~525,600 candles × ~200 bytes = ~105MB. Could be problematic.

**Classification: LOW** — No streaming/chunked processing.

### 18.2 Walk-Forward Computation

Walk-forward runs N full backtests (one per window). With 60 days of data and 7-day windows: ~8 windows × 2 phases = ~16 backtests. Each backtest iterates all candles. O(N × W) where N = candles, W = windows.

**Classification: INFO** — Acceptable for current scale.

---

## 19. FINDINGS BY SEVERITY

### CRITICAL

| ID | File | Line | Finding | Impact |
|---|---|---|---|---|
| F-C1 | `engine.ts` | 235-245 | Entry AND exit at `currentCandle.close` — same price | All backtest trades have near-zero PnL. Backtest results are meaningless. |

### HIGH

| ID | File | Line | Finding | Impact |
|---|---|---|---|---|
| F-H1 | `engine.ts` | 340 | `lookAheadProtected: true` is hardcoded | No verification of look-ahead safety |
| F-H2 | `robustness.ts` | 280-290 | `createConfigWithParameter` is a no-op stub | Parameter robustness analysis is non-functional |
| F-H3 | `walkforward.ts` | 155-170 | Train and validation use identical config | Walk-forward "optimization" performs no optimization |
| F-H4 | `paper/engine.ts` | 170-175 | Exit slippage calculated but not deducted from PnL | PnL overstated by exit slippage |
| F-H5 | Tests | — | No look-ahead test exists | Claim "look-ahead tests available" is false |
| F-H6 | Tests | — | No robustness test, no reproducibility test | Claims in Phase 7 report are false |

### MEDIUM

| ID | File | Line | Finding | Impact |
|---|---|---|---|---|
| F-M1 | `engine.ts` | 320 | `totalSlippage` metric misleading | Reports uncharged cost |
| F-M2 | `paper/engine.ts` | 122-128 | Position IDs use `Date.now()` | Not reproducible across runs |
| F-M3 | Tests | engine.test.ts | All tests are happy-path only | Missing edge case coverage |
| F-M4 | `engine.ts` | 197-203 | Simplified regime (SMA-only) differs from live regime classifier | Backtest regime ≠ live regime |

### LOW

| ID | File | Line | Finding | Impact |
|---|---|---|---|---|
| F-L1 | `historical-data.ts` | 127 | No retry on fetch error | Incomplete data silently accepted |
| F-L2 | `engine.ts` | 250-255 | Hardcoded `marketStructure: "HIGHER_HIGHS"` | Simplified vs live |
| F-L3 | `engine.ts` | 227-231 | `regimeConfidence: 60` hardcoded | Simplified vs live |
| F-L4 | `robustness.ts` | 250-270 | Regime grouping uses same simplified SMA | Regime ≠ live classification |
| F-L5 | Tests | — | Tests only use BTCUSDT | Multi-symbol not tested |

### INFO

| ID | File | Finding |
|---|---|---|
| F-I1 | `engine.ts` | 150 candles start at index 50 — first 50 candles never generate trades |
| F-I2 | `walkforward.ts` | Walk-forward runs multiple backtests in sequence — acceptable for current scale |
| F-I3 | CI | No dependency caching — slower CI runs |

---

## 20. ACCEPTANCE CRITERIA MATRIX

| # | Criterion | Claimed | Source Evidence | Test Evidence | Status |
|---|---|---|---|---|---|
| 1 | Phase 6 audit passed | ✅ | Verified Phase 6 code | N/A | PASS |
| 2 | Historical data engine available | ✅ | `historical-data.ts` | `historical-data.test.ts` | PASS |
| 3 | Historical data validation available | ✅ | `validateCandles()` | 5 tests | PASS |
| 4 | Gap detection available | ✅ | Lines 193-205 | `hasGaps` test | PASS |
| 5 | Duplicate detection available | ✅ | Lines 165-170 | `hasDuplicates` test | PASS |
| 6 | Backtest engine available | ✅ | `engine.ts` | 5 tests | PASS |
| 7 | Backtest uses actual strategy/AI pipeline | ✅ | `generateDecision()` import | Tests pass | PARTIAL — pipeline used but exit model broken |
| 8 | Look-ahead protection available | ✅ | Hardcoded `true` | ❌ No test | FAIL |
| 9 | Realistic fees available | ✅ | PaperEngine fees | `totalFees ≥ 0` | PARTIAL — entry fees realistic, exit fees not charged to PnL |
| 10 | Realistic slippage available | ✅ | PaperEngine slippage | `totalSlippage ≥ 0` | FAIL — slippage not deducted from PnL |
| 11 | Stop-loss simulation available | ✅ | PaperEngine has TP/SL | ❌ Not triggered in backtest (same-candle exit) | FAIL |
| 12 | Take-profit simulation available | ✅ | PaperEngine has TP/SL | ❌ Same as above | FAIL |
| 13 | Equity curve available | ✅ | `equityCurve[]` | `equity > 0` test | PASS |
| 14 | Drawdown calculation available | ✅ | `drawdown` field | `drawdown ≥ 0` test | PASS |
| 15 | Baseline comparison available | ✅ | `calculateBaseline()` | `baseline.sampleSize ≥ 0` | PASS |
| 16 | In-sample framework available | ✅ | Walk-forward train phase | 3 tests | PARTIAL — framework exists but no optimization |
| 17 | Out-of-sample framework available | ✅ | Walk-forward validation phase | 3 tests | PARTIAL — framework exists but identical to train |
| 18 | Walk-forward framework available | ✅ | `walkforward.ts` | 3 tests | PARTIAL — windows computed but no optimization |
| 19 | Parameter robustness available | ✅ | `robustness.ts` | ❌ No test | FAIL — stub function, no actual variation |
| 20 | Regime robustness available | ✅ | `robustness.ts` | ❌ No test | PARTIAL — works but simplified regime |
| 21 | Symbol robustness available | ✅ | `robustness.ts` | ❌ No test | PASS (code correct, no test) |
| 22 | Cost sensitivity available | ✅ | `robustness.ts` | ❌ No test | PASS (code correct, no test) |
| 23 | Performance attribution available | ✅ | Metrics breakdown in result | Implicit | PASS |
| 24 | Backtest reproducibility available | ✅ | Hardcoded flag | ❌ No test | FAIL — timestamp-based IDs |
| 25 | Backtest audit trail available | ✅ | Config/results stored | Implicit | PASS |
| 26 | Backtest vs paper comparison | ✅ | Framework ready | ❌ No test | NOT VERIFIED |
| 27 | Dashboard backtest available | ✅ | Types exist | ❌ No route/component | NOT VERIFIED |
| 28 | Dashboard walk-forward available | ✅ | Types exist | ❌ No route/component | NOT VERIFIED |
| 29 | Dashboard robustness available | ✅ | Types exist | ❌ No route/component | NOT VERIFIED |
| 30 | API available | ✅ | Barrel export | ❌ No server function | NOT VERIFIED |
| 31 | Database versioning safe | ✅ | No new tables | N/A | PASS |
| 32 | CI typecheck available | ✅ | `ci.yml` | N/A | PASS |
| 33 | CI test available | ✅ | `ci.yml` | N/A | PASS |
| 34 | CI build available | ✅ | `ci.yml` | N/A | PASS |
| 35 | Backtest tests available | ✅ | 5 tests | Tests pass | PASS |
| 36 | Look-ahead tests available | ✅ | ❌ None exist | N/A | FAIL |
| 37 | Reproducibility tests available | ✅ | ❌ None exist | N/A | FAIL |
| 38 | Safety tests available | ✅ | ❌ None exist | N/A | FAIL |
| 39 | TypeScript clean | ✅ | `tsc --noEmit` passes | N/A | PASS |
| 40 | All tests passing | ✅ | 184/184 | N/A | PASS |
| 41 | Build successful | ✅ | `bun run build` | N/A | PASS |
| 42 | No real trading | ✅ | `placeOrder()` throws | N/A | PASS |
| 43 | No live strategy promotion | ✅ | `canPromoteToLive()` returns false | N/A | PASS |
| 44 | No Risk Engine bypass | ✅ | Identical engine used | N/A | PASS |
| 45 | No credential leakage | ✅ | No keys in code | N/A | PASS |

**Summary: 24 PASS, 7 PARTIAL, 9 FAIL, 5 NOT VERIFIED**

---

## 21. FINAL VERDICT

# C. PHASE 7 NOT VERIFIED — MAJOR ISSUES

### Required Fixes Before Commit

1. **CRITICAL (F-C1):** Fix backtest entry/exit model — positions must be held across candles and closed by TP/SL or a future candle, not at the same candle's close
2. **HIGH (F-H2):** Implement actual parameter variation in `createConfigWithParameter`
3. **HIGH (F-H3):** Walk-forward must perform parameter selection/optimization during train phase
4. **HIGH (F-H4):** Fix exit slippage not being deducted from PnL in `paper/engine.ts`
5. **HIGH (F-H5/F-H6):** Add tests for look-ahead protection, robustness, and reproducibility
6. **MEDIUM (F-M1):** Fix `totalSlippage` metric to reflect actual charged costs

### Items That Are Correct

- Historical data engine (fetch, validate, dedup) ✅
- Walk-forward temporal split ✅
- Risk engine integration (identical to paper) ✅
- Security posture ✅
- TypeScript compilation ✅
- CI/CD pipeline ✅
- No experience/lesson leakage in backtest ✅
- No risk engine bypass ✅

### Trading Validation

**Software correctness ≠ backtest validity ≠ trading performance.**

The backtest engine compiles and runs without errors. However:
- The entry/exit model is broken (same-candle close)
- The results show near-zero PnL on every trade
- No statistical validation exists
- No real market data has been used in tests

**Trading edge has NOT been proven.** The software foundation is partially built but the core backtest logic needs fundamental fixes before any performance conclusions can be drawn.

---

*Audit completed. 16 files read, 6 critical/high findings identified. No code changes made.*
