/**
 * Risk Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * THE HIGHEST AUTHORITY.
 *
 * If AI says LONG but Risk Engine says REJECT → REJECT wins.
 * AI CANNOT bypass the Risk Engine.
 *
 * Risk Limits (Development):
 * - Initial Capital: $5.00
 * - Daily Profit Cap: +$0.50
 * - Daily Loss Limit: -$0.50
 * - Max Leverage: 10x
 * - Max Exposure: 80% of capital
 *
 * These are TESTING BOUNDARIES, not profit guarantees.
 */

import type { AiDecision } from "../ai/types";
import type { MarketState } from "../runtime/types";
import type { RiskCheckInput, RiskCheckResult } from "../ai/types";
import { logger } from "../logger";

// ─── Risk Configuration ───────────────────────────────────────────────

export type RiskConfig = {
  initialCapital: number;
  dailyProfitCap: number;
  dailyLossLimit: number;
  maxLeverage: number;
  maxExposurePercent: number;
  maxOpenPositions: number;
  maxDecisionAge: number; // ms — reject stale decisions
  requireGoodDataQuality: boolean;
};

const DEFAULT_RISK_CONFIG: RiskConfig = {
  initialCapital: 5.0,
  dailyProfitCap: 0.50,
  dailyLossLimit: 0.50,
  maxLeverage: 10,
  maxExposurePercent: 80,
  maxOpenPositions: 3,
  maxDecisionAge: 300_000, // 5 minutes
  requireGoodDataQuality: true,
};

// ─── Risk Engine ──────────────────────────────────────────────────────

type RecentDecision = {
  symbol: string;
  direction: string;
  strategy: string;
  timestamp: number;
};

export class RiskEngine {
  private config: RiskConfig;
  private dailyPnl = 0;
  private dailyTrades = 0;
  private isLocked = false;
  private lockReason = "";
  private recentDecisions: RecentDecision[] = [];

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  // ─── Main Check ──────────────────────────────────────────────────

  check(
    decision: AiDecision,
    marketState: MarketState,
    currentPosition: { symbol: string; side: "LONG" | "SHORT" | "FLAT"; size: number },
  ): RiskCheckResult {
    const checks: RiskCheckResult["checks"] = [];

    // 1. System lock check
    if (this.isLocked) {
      return {
        approved: false,
        reason: `System locked: ${this.lockReason}`,
        checks: [{ name: "system_lock", passed: false, message: this.lockReason }],
      };
    }

    // 2. NO_TRADE is always approved (no action needed)
    if (decision.direction === "NO_TRADE") {
      return {
        approved: true,
        reason: "NO_TRADE — no action required",
        checks: [{ name: "no_trade", passed: true, message: "No trade requested" }],
      };
    }

    // 3. Daily loss limit
    const dailyLossCheck = this.checkDailyLoss();
    checks.push(dailyLossCheck);

    // 4. Daily profit cap
    const dailyProfitCheck = this.checkDailyProfit();
    checks.push(dailyProfitCheck);

    // 5. Decision freshness
    const freshnessCheck = this.checkDecisionFreshness(decision);
    checks.push(freshnessCheck);

    // 6. Data quality
    const dataCheck = this.checkDataQuality(marketState);
    checks.push(dataCheck);

    // 7. Market regime safety
    const regimeCheck = this.checkMarketRegime(marketState);
    checks.push(regimeCheck);

    // 8. Position limit
    const positionCheck = this.checkPositionLimit(currentPosition);
    checks.push(positionCheck);

    // 9. Duplicate decision
    const duplicateCheck = this.checkDuplicateDecision(decision);
    checks.push(duplicateCheck);

    // 10. Confidence threshold
    const confidenceCheck = this.checkConfidenceThreshold(decision);
    checks.push(confidenceCheck);

    // Evaluate all checks
    const allPassed = checks.every(c => c.passed);
    const failedChecks = checks.filter(c => !c.passed);

    const result: RiskCheckResult = {
      approved: allPassed,
      reason: allPassed
        ? "All risk checks passed"
        : `Rejected: ${failedChecks.map(c => c.message).join("; ")}`,
      checks,
    };

    if (allPassed) {
      logger.info("risk-engine", `APPROVED: ${decision.direction} ${decision.symbol}`);
    } else {
      logger.warn("risk-engine", `REJECTED: ${decision.direction} ${decision.symbol} — ${result.reason}`);
    }

    return result;
  }

  // ─── Individual Checks ───────────────────────────────────────────

  private checkDailyLoss(): RiskCheckResult["checks"][0] {
    if (this.dailyPnl <= -this.config.dailyLossLimit) {
      this.lock("Daily loss limit reached");
      return {
        name: "daily_loss",
        passed: false,
        message: `Daily loss limit reached: $${this.dailyPnl.toFixed(2)} / -$${this.config.dailyLossLimit}`,
      };
    }
    return {
      name: "daily_loss",
      passed: true,
      message: `Daily PnL: $${this.dailyPnl.toFixed(2)}`,
    };
  }

  private checkDailyProfit(): RiskCheckResult["checks"][0] {
    if (this.dailyPnl >= this.config.dailyProfitCap) {
      this.lock("Daily profit cap reached");
      return {
        name: "daily_profit",
        passed: false,
        message: `Daily profit cap reached: $${this.dailyPnl.toFixed(2)} / +$${this.config.dailyProfitCap}`,
      };
    }
    return {
      name: "daily_profit",
      passed: true,
      message: `Daily PnL: $${this.dailyPnl.toFixed(2)}`,
    };
  }

  private checkDecisionFreshness(decision: AiDecision): RiskCheckResult["checks"][0] {
    const age = Date.now() - decision.timestamp;
    if (age > this.config.maxDecisionAge) {
      return {
        name: "decision_freshness",
        passed: false,
        message: `Decision too old: ${(age / 1000).toFixed(0)}s (max: ${(this.config.maxDecisionAge / 1000).toFixed(0)}s)`,
      };
    }
    return {
      name: "decision_freshness",
      passed: true,
      message: `Decision age: ${(age / 1000).toFixed(0)}s`,
    };
  }

  private checkDataQuality(state: MarketState): RiskCheckResult["checks"][0] {
    if (this.config.requireGoodDataQuality && state.dataQuality !== "GOOD") {
      return {
        name: "data_quality",
        passed: false,
        message: `Data quality: ${state.dataQuality} (requires GOOD)`,
      };
    }
    return {
      name: "data_quality",
      passed: true,
      message: `Data quality: ${state.dataQuality}`,
    };
  }

  private checkMarketRegime(state: MarketState): RiskCheckResult["checks"][0] {
    // Reject in UNCERTAIN regime with low confidence
    if (state.marketRegime === "UNCERTAIN" && state.regimeConfidence < 40) {
      return {
        name: "market_regime",
        passed: false,
        message: `Regime uncertain with low confidence: ${state.regimeConfidence}%`,
      };
    }
    return {
      name: "market_regime",
      passed: true,
      message: `Regime: ${state.marketRegime} (${state.regimeConfidence}%)`,
    };
  }

  private checkPositionLimit(currentPosition: { symbol: string; side: string; size: number }): RiskCheckResult["checks"][0] {
    if (currentPosition.side !== "FLAT" && currentPosition.size > 0) {
      return {
        name: "position_limit",
        passed: false,
        message: `Already in position: ${currentPosition.side} ${currentPosition.symbol}`,
      };
    }
    return {
      name: "position_limit",
      passed: true,
      message: "No open position",
    };
  }

  private checkDuplicateDecision(decision: AiDecision): RiskCheckResult["checks"][0] {
    // Deterministic duplicate detection: same symbol + direction + strategy within 30 seconds
    const now = Date.now();
    const DUPLICATE_WINDOW_MS = 30_000;

    // Clean old entries
    this.recentDecisions = this.recentDecisions.filter(
      (d) => now - d.timestamp < DUPLICATE_WINDOW_MS,
    );

    // Check for duplicate
    const isDuplicate = this.recentDecisions.some(
      (d) =>
        d.symbol === decision.symbol &&
        d.direction === decision.direction &&
        d.strategy === decision.strategy,
    );

    // Track this decision
    this.recentDecisions.push({
      symbol: decision.symbol,
      direction: decision.direction,
      strategy: decision.strategy,
      timestamp: now,
    });

    if (isDuplicate) {
      return {
        name: "duplicate_check",
        passed: false,
        message: `Duplicate decision: ${decision.direction} ${decision.symbol} via ${decision.strategy} within ${DUPLICATE_WINDOW_MS / 1000}s`,
      };
    }

    return {
      name: "duplicate_check",
      passed: true,
      message: "No duplicate detected",
    };
  }

  private checkConfidenceThreshold(decision: AiDecision): RiskCheckResult["checks"][0] {
    if (decision.confidence < 0.4) {
      return {
        name: "confidence_threshold",
        passed: false,
        message: `Confidence too low: ${(decision.confidence * 100).toFixed(1)}% (min: 40%)`,
      };
    }
    return {
      name: "confidence_threshold",
      passed: true,
      message: `Confidence: ${(decision.confidence * 100).toFixed(1)}%`,
    };
  }

  // ─── State Management ────────────────────────────────────────────

  updateDailyPnl(pnl: number): void {
    this.dailyPnl += pnl;
    logger.info("risk-engine", `Daily PnL updated: $${this.dailyPnl.toFixed(2)}`);

    // Check limits after update
    if (this.dailyPnl <= -this.config.dailyLossLimit) {
      this.lock("Daily loss limit reached");
    } else if (this.dailyPnl >= this.config.dailyProfitCap) {
      this.lock("Daily profit cap reached");
    }
  }

  resetDaily(): void {
    this.dailyPnl = 0;
    this.dailyTrades = 0;
    this.unlock();
    logger.info("risk-engine", "Daily counters reset");
  }

  lock(reason: string): void {
    this.isLocked = true;
    this.lockReason = reason;
    logger.warn("risk-engine", `LOCKED: ${reason}`);
  }

  unlock(): void {
    this.isLocked = false;
    this.lockReason = "";
    logger.info("risk-engine", "Unlocked");
  }

  isSystemLocked(): boolean {
    return this.isLocked;
  }

  getLockReason(): string {
    return this.lockReason;
  }

  getDailyStats() {
    return {
      pnl: this.dailyPnl,
      trades: this.dailyTrades,
      profitCap: this.config.dailyProfitCap,
      lossLimit: this.config.dailyLossLimit,
      locked: this.isLocked,
      lockReason: this.lockReason,
    };
  }

  getConfig(): RiskConfig {
    return { ...this.config };
  }
}
