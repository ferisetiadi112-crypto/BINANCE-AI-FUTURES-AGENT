/**
 * Risk Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * THE HIGHEST AUTHORITY.
 *
 * If AI says LONG but Risk Engine says REJECT → REJECT wins.
 * AI CANNOT bypass the Risk Engine.
 *
 * Mandatory Policies (P3-FIX):
 * - AI allocation: $10 USDT maximum
 * - Session profit target: +$0.50 → 12h cooldown
 * - Hard session profit cap: +$2.00 → permanent lock
 * - Max loss per trade: -$1.00 worst-case
 * - Daily loss limit: -$2.00
 * - Max simultaneous positions: 1
 * - Max leverage: 20x
 * - AI confidence minimum: 40%
 * - Decision freshness: 5 minutes
 * - Market data quality: GOOD required
 * - Duplicate protection: 30 seconds
 * - Fail closed on uncertainty
 */

import type { AiDecision } from "../ai/types";
import type { MarketState } from "../runtime/types";
import type { RiskCheckResult } from "../ai/types";
import { logger } from "../logger";

// ─── Risk Configuration ───────────────────────────────────────────────

export type RiskConfig = {
  /** Maximum AI-controlled trading capital allocation in USDT */
  aiAllocationLimit: number;
  /** Session profit target: +$0.50 triggers 12h cooldown */
  sessionProfitTarget: number;
  /** Hard session profit cap: +$2.00 locks trading permanently for session */
  sessionHardCap: number;
  /** Maximum loss per trade (worst-case at stop-loss) */
  maxLossPerTrade: number;
  /** Daily loss limit: -$2.00 locks trading */
  dailyLossLimit: number;
  /** Maximum leverage allowed */
  maxLeverage: number;
  /** Maximum simultaneous open positions */
  maxOpenPositions: number;
  /** Maximum age for an AI decision (ms) */
  maxDecisionAge: number;
  /** Require GOOD data quality */
  requireGoodDataQuality: boolean;
  /** Minimum wallet balance to allow trading */
  minWalletBalance: number;
  /** Cooldown duration after session profit target (ms) — 12 hours */
  cooldownDurationMs: number;
  /** Master trading kill-switch. When false, all trade proposals are REJECTED regardless of other checks. */
  tradingEnabled: boolean;
};

const DEFAULT_RISK_CONFIG: RiskConfig = {
  aiAllocationLimit: 10.0,
  sessionProfitTarget: 0.50,
  sessionHardCap: 2.00,
  maxLossPerTrade: 1.00,
  dailyLossLimit: 2.00,
  maxLeverage: 20,
  maxOpenPositions: 1,
  maxDecisionAge: 300_000, // 5 minutes
  requireGoodDataQuality: true,
  minWalletBalance: 0.50,
  cooldownDurationMs: 12 * 60 * 60 * 1000, // 12 hours
  tradingEnabled: false, // Fail-safe: trading disabled by default
};

// ─── Risk Engine ──────────────────────────────────────────────────────

type RecentDecision = {
  symbol: string;
  direction: string;
  strategy: string;
  timestamp: number;
};

/** The full trade proposal for loss/capital/leverage validation */
export type TradeProposal = {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  leverage: number;
  stopLossPrice: number;
};

export type FullRiskResult = RiskCheckResult & {
  sessionPnl: number;
  dailyPnl: number;
  isLocked: boolean;
  lockReason: string;
  cooldownActive: boolean;
  cooldownEndsAt: number | null;
};

export class RiskEngine {
  private config: RiskConfig;
  private dailyPnl = 0;
  private dailyTrades = 0;
  private isLocked = false;
  private lockReason = "";
  private recentDecisions: RecentDecision[] = [];
  private walletBalance: number;

  // Session state
  private sessionPnl = 0;
  private cooldownEndsAt: number | null = null;
  private hardCapReached = false;

  // Open position tracking for real capital allocation
  private openPositionMargin = 0;
  private openPositionCount = 0;

  /**
   * P7: Effective allocation limit = min(real Futures available balance, aiAllocationLimit).
   * Defaults to the configured max ($10). Set to 0 when Binance account state is
   * unavailable → fail closed. Never exceeds the authoritative $10 cap.
   */
  private effectiveAllocationLimit: number;

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.walletBalance = this.config.aiAllocationLimit;
    this.effectiveAllocationLimit = this.config.aiAllocationLimit;
  }

  // ─── Wallet Balance ─────────────────────────────────────────────

  setWalletBalance(balance: number): void {
    this.walletBalance = balance;
  }

  getWalletBalance(): number {
    return this.walletBalance;
  }

  // ─── Configuration Getters ─────────────────────────────────────

  getConfig(): RiskConfig {
    return { ...this.config };
  }

  getMaxLossPerTrade(): number {
    return this.config.maxLossPerTrade;
  }

  getAiAllocationLimit(): number {
    return this.config.aiAllocationLimit;
  }

  /**
   * P7: Set the effective allocation limit based on REAL Futures available balance.
   * Clamped to [0, aiAllocationLimit]. A value of 0 fail-closes trading.
   */
  setEffectiveAllocationLimit(limit: number): void {
    if (!Number.isFinite(limit) || limit <= 0) {
      this.effectiveAllocationLimit = 0;
      return;
    }
    this.effectiveAllocationLimit = Math.min(limit, this.config.aiAllocationLimit);
  }

  getEffectiveAllocationLimit(): number {
    return this.effectiveAllocationLimit;
  }

  getMaxLeverage(): number {
    return this.config.maxLeverage;
  }

  // --- Trading Enabled Flag ---

  /**
   * P7D-2B: Master trading kill-switch.
   * When false, validateTradeProposal() rejects ALL proposals regardless of other checks.
   */
  isTradingEnabled(): boolean {
    return this.config.tradingEnabled;
  }

  setTradingEnabled(enabled: boolean): void {
    this.config.tradingEnabled = enabled;
    logger.info(
      "risk-engine",
      `Trading ${enabled ? "ENABLED" : "DISABLED"} via setTradingEnabled()`,
    );
  }

  // ─── Session State ─────────────────────────────────────────────

  getSessionPnl(): number {
    return this.sessionPnl;
  }

  getDailyPnl(): number {
    return this.dailyPnl;
  }

  getCooldownEndsAt(): number | null {
    return this.cooldownEndsAt;
  }

  isCooldownActive(): boolean {
    return this.cooldownEndsAt !== null && Date.now() < this.cooldownEndsAt;
  }

  isHardCapReached(): boolean {
    return this.hardCapReached;
  }

  getOpenPositionMargin(): number {
    return this.openPositionMargin;
  }

  getOpenPositionCount(): number {
    return this.openPositionCount;
  }

  // ─── Position Tracking ─────────────────────────────────────────

  /** Called when a position is opened with actual margin used */
  recordPositionOpened(margin: number): void {
    this.openPositionCount++;
    this.openPositionMargin += margin;
    logger.info(
      "risk-engine",
      `Position opened: margin=$${margin.toFixed(4)}, total allocated=$${this.openPositionMargin.toFixed(4)}`,
    );
  }

  /** Called when a position is closed, releasing margin */
  recordPositionClosed(margin: number): void {
    this.openPositionCount = Math.max(0, this.openPositionCount - 1);
    this.openPositionMargin = Math.max(0, this.openPositionMargin - margin);
    logger.info(
      "risk-engine",
      `Position closed: margin=$${margin.toFixed(4)}, total allocated=$${this.openPositionMargin.toFixed(4)}`,
    );
  }

  // ─── Main Check ────────────────────────────────────────────────

  check(
    decision: AiDecision,
    marketState: MarketState,
    currentPosition: {
      symbol: string;
      side: "LONG" | "SHORT" | "FLAT";
      size: number;
    },
  ): RiskCheckResult {
    const checks: RiskCheckResult["checks"] = [];

    // 1. System lock check
    if (this.isLocked) {
      return {
        approved: false,
        reason: `System locked: ${this.lockReason}`,
        checks: [
          {
            name: "system_lock",
            passed: false,
            message: this.lockReason,
          },
        ],
      };
    }

    // 2. Cooldown check (H-2: cooldown must block trading)
    if (this.isCooldownActive()) {
      const remaining = this.cooldownEndsAt! - Date.now();
      return {
        approved: false,
        reason: `Cooldown active: ${Math.ceil(remaining / 60000)} minutes remaining`,
        checks: [
          {
            name: "cooldown",
            passed: false,
            message: `Session profit target reached. Cooldown until ${new Date(this.cooldownEndsAt!).toISOString()}`,
          },
        ],
      };
    }

    // 3. NO_TRADE is always approved (no action needed)
    if (decision.direction === "NO_TRADE") {
      return {
        approved: true,
        reason: "NO_TRADE — no action required",
        checks: [
          { name: "no_trade", passed: true, message: "No trade requested" },
        ],
      };
    }

    // 4. Daily loss limit
    checks.push(this.checkDailyLoss());

    // 5. Daily/session profit cap
    checks.push(this.checkSessionCap());

    // 6. Decision freshness
    checks.push(this.checkDecisionFreshness(decision));

    // 7. Data quality
    checks.push(this.checkDataQuality(marketState));

    // 8. Market regime safety
    checks.push(this.checkMarketRegime(marketState));

    // 9. Position limit
    checks.push(this.checkPositionLimit(currentPosition));

    // 10. Duplicate decision
    checks.push(this.checkDuplicateDecision(decision));

    // 11. Confidence threshold (minimum 40%)
    checks.push(this.checkConfidenceThreshold(decision));

    // 12. Wallet balance check
    checks.push(this.checkWalletBalance());

    // Evaluate all checks
    const allPassed = checks.every((c) => c.passed);
    const failedChecks = checks.filter((c) => !c.passed);

    const result: RiskCheckResult = {
      approved: allPassed,
      reason: allPassed
        ? "All risk checks passed"
        : `Rejected: ${failedChecks.map((c) => c.message).join("; ")}`,
      checks,
    };

    if (allPassed) {
      logger.info(
        "risk-engine",
        `APPROVED: ${decision.direction} ${decision.symbol}`,
      );
    } else {
      logger.warn(
        "risk-engine",
        `REJECTED: ${decision.direction} ${decision.symbol} — ${result.reason}`,
      );
    }

    return result;
  }

  // ─── Trade Proposal Validation (H-1: authoritative pipeline) ───

  /**
   * Validate a complete trade proposal through the authoritative risk pipeline.
   * This MUST be called before any execution (paper or testnet).
   *
   * Calculates:
   * - notional value
   * - margin used
   * - worst-case loss at stop-loss
   * - available capital allocation
   * - leverage validation
   * - capital guardrail
   *
   * Rejects if:
   * - worst-case loss > $1.00
   * - leverage invalid or > 20x
   * - margin would exceed $10 allocation
   * - calculation impossible (fail closed)
   */
  validateTradeProposal(proposal: TradeProposal): {
    approved: boolean;
    reason: string;
    worstCaseLoss: number;
    proposedMargin: number;
    totalAllocated: number;
    checks: Array<{ name: string; passed: boolean; message: string }>;
  } {
    const checks: Array<{ name: string; passed: boolean; message: string }> =
      [];
    let approved = true;

    // P7D-2B: Master trading kill-switch check
    if (!this.config.tradingEnabled) {
      checks.push({
        name: "trading_enabled",
        passed: false,
        message: "Trading is DISABLED (tradingEnabled=false). All proposals rejected.",
      });
      logger.warn(
        "risk-engine",
        "Trade proposal REJECTED: trading disabled (tradingEnabled=false)",
      );
      return {
        approved: false,
        reason: "Trading is DISABLED (tradingEnabled=false). All proposals rejected.",
        worstCaseLoss: 0,
        proposedMargin: 0,
        totalAllocated: this.openPositionMargin,
        checks,
      };
    }

    // 1. Validate leverage (M-2)
    const leverageCheck = this.checkLeverage(proposal.leverage);
    checks.push(leverageCheck);
    if (!leverageCheck.passed) approved = false;

    // 2. Calculate margin and notional
    const notionalValue = proposal.entryPrice * proposal.quantity;
    const proposedMargin = notionalValue / proposal.leverage;

    if (proposedMargin <= 0) {
      checks.push({
        name: "margin_calculation",
        passed: false,
        message: `Invalid margin: $${proposedMargin.toFixed(4)}`,
      });
      return {
        approved: false,
        reason: "Invalid margin calculation",
        worstCaseLoss: 0,
        proposedMargin: 0,
        totalAllocated: this.openPositionMargin,
        checks,
      };
    }

    checks.push({
      name: "margin_calculation",
      passed: true,
      message: `Margin: $${proposedMargin.toFixed(4)} (notional: $${notionalValue.toFixed(2)} / ${proposal.leverage}x)`,
    });

    // 3. Capital allocation guardrail (G: real $10 allocation)
    const totalAllocated = this.openPositionMargin + proposedMargin;
    const capitalCheck = this.checkCapitalAllocation(
      proposedMargin,
      totalAllocated,
    );
    checks.push(capitalCheck);
    if (!capitalCheck.passed) approved = false;

    // 4. Calculate worst-case loss at stop-loss (H-1)
    const worstCaseLossCheck = this.checkWorstCaseLoss(proposal);
    checks.push(worstCaseLossCheck);
    if (!worstCaseLossCheck.passed) approved = false;

    // 5. Position limit (max 1)
    const positionCheck = {
      name: "position_limit",
      passed: this.openPositionCount < this.config.maxOpenPositions,
      message:
        this.openPositionCount < this.config.maxOpenPositions
          ? `Open positions: ${this.openPositionCount}/${this.config.maxOpenPositions}`
          : `Max positions reached: ${this.openPositionCount}/${this.config.maxOpenPositions}`,
    };
    checks.push(positionCheck);
    if (!positionCheck.passed) approved = false;

    // 6. Session profit target check (cooldown)
    if (this.sessionPnl >= this.config.sessionProfitTarget) {
      checks.push({
        name: "session_profit_target",
        passed: false,
        message: `Session profit target reached: +$${this.sessionPnl.toFixed(2)} ≥ +$${this.config.sessionProfitTarget.toFixed(2)}`,
      });
      approved = false;
    } else {
      checks.push({
        name: "session_profit_target",
        passed: true,
        message: `Session PnL: $${this.sessionPnl.toFixed(2)}`,
      });
    }

    const worstCaseLoss =
      worstCaseLossCheck.passed
        ? Math.abs(
            (proposal.stopLossPrice - proposal.entryPrice) *
              proposal.quantity,
          )
        : 0;

    return {
      approved,
      reason: approved
        ? "Trade proposal approved"
        : `Rejected: ${checks
            .filter((c) => !c.passed)
            .map((c) => c.message)
            .join("; ")}`,
      worstCaseLoss,
      proposedMargin,
      totalAllocated,
      checks,
    };
  }

  /**
   * Validate order quantity against capital limits.
   * Must be called before execution.
   */
  validateOrderQuantity(
    price: number,
    quantity: number,
    leverage: number,
  ): { valid: boolean; reason: string; margin: number } {
    if (quantity <= 0) {
      return { valid: false, reason: "Quantity must be positive", margin: 0 };
    }
    if (price <= 0) {
      return { valid: false, reason: "Price must be positive", margin: 0 };
    }
    if (leverage <= 0 || leverage > this.config.maxLeverage) {
      return {
        valid: false,
        reason: `Invalid leverage: ${leverage}x (max: ${this.config.maxLeverage}x)`,
        margin: 0,
      };
    }

    const notional = price * quantity;
    const margin = notional / leverage;

    const effectiveLimit = this.getEffectiveAllocationLimit();

    if (margin > effectiveLimit) {
      return {
        valid: false,
        reason: `Margin $${margin.toFixed(2)} exceeds effective AI allocation limit $${effectiveLimit.toFixed(2)} (max: $${this.config.aiAllocationLimit})`,
        margin,
      };
    }

    if (this.openPositionMargin + margin > effectiveLimit) {
      return {
        valid: false,
        reason: `Total allocation $${(this.openPositionMargin + margin).toFixed(2)} would exceed effective limit $${effectiveLimit.toFixed(2)} (max: $${this.config.aiAllocationLimit})`,
        margin,
      };
    }

    return { valid: true, reason: "OK", margin };
  }

  // ─── Individual Checks ─────────────────────────────────────────

  private checkDailyLoss(): RiskCheckResult["checks"][0] {
    if (this.dailyPnl <= -this.config.dailyLossLimit) {
      this.lock(`Daily loss limit reached: $${this.dailyPnl.toFixed(2)}`);
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

  private checkSessionCap(): RiskCheckResult["checks"][0] {
    // Hard cap: +$2.00 permanently locks for session
    if (this.sessionPnl >= this.config.sessionHardCap) {
      this.lock(
        `Hard session profit cap reached: +$${this.sessionPnl.toFixed(2)}`,
      );
      this.hardCapReached = true;
      return {
        name: "session_hard_cap",
        passed: false,
        message: `Hard session profit cap reached: +$${this.sessionPnl.toFixed(2)} / +$${this.config.sessionHardCap}`,
      };
    }

    // Soft target: +$0.50 starts cooldown
    if (
      this.sessionPnl >= this.config.sessionProfitTarget &&
      !this.isCooldownActive()
    ) {
      this.startCooldown();
      return {
        name: "session_profit_target",
        passed: false,
        message: `Session profit target reached: +$${this.sessionPnl.toFixed(2)}. Starting 12h cooldown.`,
      };
    }

    return {
      name: "session_profit_target",
      passed: true,
      message: `Session PnL: $${this.sessionPnl.toFixed(2)}`,
    };
  }

  private checkDecisionFreshness(
    decision: AiDecision,
  ): RiskCheckResult["checks"][0] {
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

  private checkPositionLimit(
    currentPosition: { symbol: string; side: string; size: number },
  ): RiskCheckResult["checks"][0] {
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

  private checkDuplicateDecision(
    decision: AiDecision,
  ): RiskCheckResult["checks"][0] {
    const now = Date.now();
    const DUPLICATE_WINDOW_MS = 30_000;

    this.recentDecisions = this.recentDecisions.filter(
      (d) => now - d.timestamp < DUPLICATE_WINDOW_MS,
    );

    const isDuplicate = this.recentDecisions.some(
      (d) =>
        d.symbol === decision.symbol &&
        d.direction === decision.direction &&
        d.strategy === decision.strategy,
    );

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

  private checkConfidenceThreshold(
    decision: AiDecision,
  ): RiskCheckResult["checks"][0] {
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

  private checkWalletBalance(): RiskCheckResult["checks"][0] {
    // P7A: Use effective allocation limit (from real Binance Futures balance)
    // NOT the sandbox wallet balance. If effectiveAllocation is 0, fail closed.
    const effectiveLimit = this.getEffectiveAllocationLimit();
    if (effectiveLimit <= 0) {
      return {
        name: "wallet_balance",
        passed: false,
        message: `Effective allocation is $0.00 — Binance Futures balance unavailable or zero; trading blocked (fail closed)`,
      };
    }
    if (effectiveLimit < this.config.minWalletBalance) {
      return {
        name: "wallet_balance",
        passed: false,
        message: `Effective allocation $${effectiveLimit.toFixed(2)} is below minimum $${this.config.minWalletBalance.toFixed(2)} — trading blocked`,
      };
    }
    return {
      name: "wallet_balance",
      passed: true,
      message: `Effective allocation: $${effectiveLimit.toFixed(2)} (hard max: $${this.config.aiAllocationLimit})`,
    };
  }

  // ─── Trade Proposal Checks ─────────────────────────────────────

  /**
   * M-2: Validate actual leverage (not confidence/volatility proxy)
   */
  private checkLeverage(leverage: number): {
    name: string;
    passed: boolean;
    message: string;
  } {
    if (leverage === null || leverage === undefined || isNaN(leverage)) {
      return {
        name: "leverage",
        passed: false,
        message: "Leverage is missing — REJECT",
      };
    }
    if (leverage <= 0) {
      return {
        name: "leverage",
        passed: false,
        message: `Invalid leverage: ${leverage} — REJECT`,
      };
    }
    if (leverage > this.config.maxLeverage) {
      return {
        name: "leverage",
        passed: false,
        message: `Leverage ${leverage}x exceeds maximum ${this.config.maxLeverage}x — REJECT`,
      };
    }
    return {
      name: "leverage",
      passed: true,
      message: `Leverage: ${leverage}x (max: ${this.config.maxLeverage}x)`,
    };
  }

  /**
   * G: Real $10 capital allocation — actual margin-based
   */
  private checkCapitalAllocation(
    proposedMargin: number,
    totalAllocated: number,
  ): {
    name: string;
    passed: boolean;
    message: string;
  } {
    const effectiveLimit = this.getEffectiveAllocationLimit();
    if (totalAllocated > effectiveLimit) {
      return {
        name: "capital_allocation",
        passed: false,
        message: `Total allocation $${totalAllocated.toFixed(2)} would exceed effective limit $${effectiveLimit.toFixed(2)} (current: $${this.openPositionMargin.toFixed(2)}, proposed: $${proposedMargin.toFixed(2)}; hard max: $${this.config.aiAllocationLimit})`,
      };
    }
    return {
      name: "capital_allocation",
      passed: true,
      message: `Capital: $${totalAllocated.toFixed(2)} / $${effectiveLimit.toFixed(2)} allocated (hard max: $${this.config.aiAllocationLimit})`,
    };
  }

  /**
   * H-1: Worst-case loss at stop-loss must be ≤ $1.00
   * If calculation is impossible, REJECT (fail closed)
   */
  private checkWorstCaseLoss(proposal: TradeProposal): {
    name: string;
    passed: boolean;
    message: string;
  } {
    // Fail closed: if stop-loss is missing or invalid, reject
    if (
      proposal.stopLossPrice === null ||
      proposal.stopLossPrice === undefined ||
      isNaN(proposal.stopLossPrice) ||
      proposal.stopLossPrice <= 0
    ) {
      return {
        name: "worst_case_loss",
        passed: false,
        message: "Invalid or missing stop-loss — REJECT (fail closed)",
      };
    }

    // Calculate worst-case loss at stop-loss
    let worstCaseLoss: number;
    if (proposal.side === "LONG") {
      // LONG: stop must be below entry
      if (proposal.stopLossPrice >= proposal.entryPrice) {
        return {
          name: "worst_case_loss",
          passed: false,
          message: `LONG stop-loss $${proposal.stopLossPrice} must be below entry $${proposal.entryPrice} — REJECT`,
        };
      }
      worstCaseLoss =
        (proposal.entryPrice - proposal.stopLossPrice) * proposal.quantity;
    } else {
      // SHORT: stop must be above entry
      if (proposal.stopLossPrice <= proposal.entryPrice) {
        return {
          name: "worst_case_loss",
          passed: false,
          message: `SHORT stop-loss $${proposal.stopLossPrice} must be above entry $${proposal.entryPrice} — REJECT`,
        };
      }
      worstCaseLoss =
        (proposal.stopLossPrice - proposal.entryPrice) * proposal.quantity;
    }

    if (worstCaseLoss < 0) {
      return {
        name: "worst_case_loss",
        passed: false,
        message: `Impossible loss calculation: $${worstCaseLoss.toFixed(4)} — REJECT (fail closed)`,
      };
    }

    if (worstCaseLoss > this.config.maxLossPerTrade) {
      return {
        name: "worst_case_loss",
        passed: false,
        message: `Worst-case loss $${worstCaseLoss.toFixed(4)} exceeds $${this.config.maxLossPerTrade} limit`,
      };
    }

    return {
      name: "worst_case_loss",
      passed: true,
      message: `Worst-case loss: $${worstCaseLoss.toFixed(4)} (limit: $${this.config.maxLossPerTrade})`,
    };
  }

  // ─── State Management ──────────────────────────────────────────

  updateDailyPnl(pnl: number): void {
    this.dailyPnl += pnl;
    this.sessionPnl += pnl;
    logger.info(
      "risk-engine",
      `PnL updated: daily=$${this.dailyPnl.toFixed(2)}, session=$${this.sessionPnl.toFixed(2)}`,
    );

    // Check daily loss limit
    if (this.dailyPnl <= -this.config.dailyLossLimit) {
      this.lock(`Daily loss limit reached: $${this.dailyPnl.toFixed(2)}`);
    }

    // Check session hard cap
    if (this.sessionPnl >= this.config.sessionHardCap) {
      this.hardCapReached = true;
      this.lock(
        `Hard session profit cap reached: +$${this.sessionPnl.toFixed(2)}`,
      );
    }

    // Check session profit target (cooldown)
    if (
      this.sessionPnl >= this.config.sessionProfitTarget &&
      !this.hardCapReached
    ) {
      this.startCooldown();
    }
  }

  /**
   * H-2: resetDaily must NOT bypass active cooldown.
   * Only resets daily counters. Cooldown remains active if in effect.
   */
  resetDaily(): void {
    this.dailyPnl = 0;
    this.dailyTrades = 0;
    // Do NOT reset sessionPnl, cooldownEndsAt, or hardCapReached
    // Cooldown and session state persist across daily reset

    // Only unlock if there's no active cooldown and no hard cap
    if (!this.isCooldownActive() && !this.hardCapReached) {
      this.unlock();
    }
    logger.info(
      "risk-engine",
      `Daily counters reset. Session PnL: $${this.sessionPnl.toFixed(2)}, cooldown active: ${this.isCooldownActive()}, hard cap: ${this.hardCapReached}`,
    );
  }

  /**
   * Reset session state (start of new session/day).
   * Called at session-day boundary (Asia/Jakarta midnight).
   * Clears cooldown and hard cap only at session boundary.
   */
  resetSession(): void {
    this.sessionPnl = 0;
    this.cooldownEndsAt = null;
    this.hardCapReached = false;
    this.dailyPnl = 0;
    this.dailyTrades = 0;
    this.unlock();
    logger.info("risk-engine", "Session reset (new session-day)");
  }

  /**
   * Restore persisted risk state (from database).
   * Used on startup to recover state across restarts.
   */
  restoreState(state: {
    dailyPnl: number;
    sessionPnl: number;
    isLocked: boolean;
    lockReason: string;
    cooldownEndsAt: number | null;
    hardCapReached: boolean;
    openPositionMargin: number;
    openPositionCount: number;
  }): void {
    this.dailyPnl = state.dailyPnl;
    this.sessionPnl = state.sessionPnl;
    this.isLocked = state.isLocked;
    this.lockReason = state.lockReason;
    this.cooldownEndsAt = state.cooldownEndsAt;
    this.hardCapReached = state.hardCapReached;
    this.openPositionMargin = state.openPositionMargin;
    this.openPositionCount = state.openPositionCount;

    logger.info(
      "risk-engine",
      `State restored: daily=$${this.dailyPnl.toFixed(2)}, session=$${this.sessionPnl.toFixed(2)}, locked=${this.isLocked}, cooldown=${this.cooldownEndsAt !== null}`,
    );
  }

  /**
   * Get full state for persistence.
   */
  getState(): {
    dailyPnl: number;
    sessionPnl: number;
    isLocked: boolean;
    lockReason: string;
    cooldownEndsAt: number | null;
    hardCapReached: boolean;
    openPositionMargin: number;
    openPositionCount: number;
  } {
    return {
      dailyPnl: this.dailyPnl,
      sessionPnl: this.sessionPnl,
      isLocked: this.isLocked,
      lockReason: this.lockReason,
      cooldownEndsAt: this.cooldownEndsAt,
      hardCapReached: this.hardCapReached,
      openPositionMargin: this.openPositionMargin,
      openPositionCount: this.openPositionCount,
    };
  }

  // ─── Lock/Unlock ───────────────────────────────────────────────

  private startCooldown(): void {
    if (this.cooldownEndsAt !== null && Date.now() < this.cooldownEndsAt) {
      return; // Already cooling down
    }
    this.cooldownEndsAt = Date.now() + this.config.cooldownDurationMs;
    this.isLocked = true;
    this.lockReason = `Session profit target +$${this.config.sessionProfitTarget} reached — 12h cooldown`;
    logger.warn(
      "risk-engine",
      `COOLDOWN STARTED: 12h cooldown until ${new Date(this.cooldownEndsAt).toISOString()}`,
    );
  }

  lock(reason: string): void {
    this.isLocked = true;
    this.lockReason = reason;
    logger.warn("risk-engine", `LOCKED: ${reason}`);
  }

  private unlock(): void {
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
      sessionPnl: this.sessionPnl,
      dailyLossLimit: this.config.dailyLossLimit,
      sessionProfitTarget: this.config.sessionProfitTarget,
      sessionHardCap: this.config.sessionHardCap,
      locked: this.isLocked,
      lockReason: this.lockReason,
      cooldownActive: this.isCooldownActive(),
      cooldownEndsAt: this.cooldownEndsAt,
      hardCapReached: this.hardCapReached,
      openPositionMargin: this.openPositionMargin,
      openPositionCount: this.openPositionCount,
      aiAllocationLimit: this.config.aiAllocationLimit,
      effectiveAllocationLimit: this.effectiveAllocationLimit,
    };
  }
}
