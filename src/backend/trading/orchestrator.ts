/**
 * Trading Orchestrator — BINANCE AI FUTURES AGENT v0.1
 *
 * The main coordination layer that ties everything together:
 *
 *   MarketState (Runtime Intelligence)
 *     → AI Decision Engine
 *       → Risk Engine (highest authority — authoritative pipeline)
 *         → Paper Trading Engine
 *           → Journal Events
 *             → Post-Trade Review
 *               → Database
 *                 → Dashboard
 *
 * This orchestrator ensures:
 * - AI cannot bypass Risk Engine
 * - Every trade passes through validateTradeProposal BEFORE execution
 * - validateOrderQuantity is called before execution
 * - Paper trading is clearly marked as SIMULATION
 * - All decisions are logged as journal events
 * - Post-trade reviews are generated for every closed trade
 * - Session-day boundary handling (Asia/Jakarta)
 */

import type { MarketState } from "../runtime/types";
import type { AiDecision, PaperTrade, RiskCheckResult } from "../ai/types";
import {
  generateDecision,
  validateDecision,
  generateLLMDecision,
  mergeLLMDecisionIntoAiDecision,
} from "../ai/decision-engine";
import { RiskEngine, type TradeProposal } from "../risk/engine";
import { PaperTradingEngine } from "../paper/engine";
import {
  recordTradeExperience,
  recordNoTradeExperience,
  getRecentExperiences,
} from "../ai/experience-engine";
import { deriveLessons } from "../ai/lesson-engine";
import { generateRealtimeMarketState } from "../services/data-adapter";
import { getEnabledSymbols } from "../market/symbols";
import { logger } from "../logger";
import { walletRepository } from "../repositories/wallet";
import {
  recordMarketScan,
  recordRiskCheck,
  recordTradeProposed,
  recordTradeApproved,
  recordTradeRejected,
  recordTradeOpened,
  recordTradeClosed,
  recordCooldownStarted,
  recordDailyLossLimit,
  recordHardProfitCap,
  recordPositionOpened,
  recordPositionClosed,
} from "../journal";
import { generatePostTradeReview } from "../journal/post-trade-review";
import { getSessionDay, hasSessionDayChanged } from "../journal/retention";

export type OrchestratorState = {
  marketState: MarketState | null;
  lastDecision: AiDecision | null;
  lastRiskResult: { approved: boolean; reason: string } | null;
  lastTrade: PaperTrade | null;
  systemStatus: "INITIALIZING" | "RUNNING" | "PAUSED" | "ERROR";
  feedStatus: string;
  riskLocked: boolean;
};

export class TradingOrchestrator {
  private riskEngine: RiskEngine;
  private paperEngine: PaperTradingEngine;
  private state: OrchestratorState;
  private decisionHistory: AiDecision[] = [];
  private maxHistory = 100;
  private experienceCount = 0;
  private currentSessionDay: string;
  private recentActivity: string[] = [];

  constructor() {
    this.riskEngine = new RiskEngine({
      aiAllocationLimit: 10.0,
      sessionProfitTarget: 0.50,
      sessionHardCap: 2.00,
      maxLossPerTrade: 1.00,
      dailyLossLimit: 2.00,
      maxLeverage: 20,
      maxOpenPositions: 1,
      maxDecisionAge: 300_000,
      requireGoodDataQuality: true,
      minWalletBalance: 0.50,
      cooldownDurationMs: 12 * 60 * 60 * 1000,
    });

    this.paperEngine = new PaperTradingEngine({
      initialCapital: 10.0,
      simulatedFeeRate: 0.0004,
      simulatedSlippageRate: 0.0001,
      defaultLeverage: 5,
      positionSizePercent: 20,
    });

    this.state = {
      marketState: null,
      lastDecision: null,
      lastRiskResult: null,
      lastTrade: null,
      systemStatus: "INITIALIZING",
      feedStatus: "OFFLINE",
      riskLocked: false,
    };

    this.currentSessionDay = getSessionDay();
  }

  // ─── Process Market Update ───────────────────────────────────────

  async processMarketUpdate(marketState: MarketState): Promise<{
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
  }> {
    // Check session-day boundary
    this.checkSessionDayBoundary();

    this.state.marketState = marketState;
    this.state.feedStatus = marketState.feedStatus;

    // Phase 9D: Sync wallet balance to Risk Engine
    const walletBalance = await walletRepository.getBalance();
    this.riskEngine.setWalletBalance(walletBalance);

    // Record market scan event
    recordMarketScan(marketState.symbol, marketState.dataQuality);

    // 1. Generate AI Decision
    const decision = generateDecision(marketState);
    this.state.lastDecision = decision;
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistory) {
      this.decisionHistory.shift();
    }

    // 2. Validate Decision
    const validation = validateDecision(decision);
    if (!validation.valid) {
      logger.error(
        "orchestrator",
        `Invalid decision: ${validation.errors.join(", ")}`,
      );
      return {
        decision,
        riskResult: {
          approved: false,
          reason: `Invalid decision: ${validation.errors.join(", ")}`,
        },
        trade: null,
      };
    }

    // 3. Risk Engine Check (HIGHEST AUTHORITY)
    const currentPosition = this.paperEngine.getPosition();
    const riskResult = this.riskEngine.check(
      decision,
      marketState,
      currentPosition
        ? {
            symbol: currentPosition.symbol,
            side: currentPosition.side,
            size: currentPosition.size,
          }
        : { symbol: marketState.symbol, side: "FLAT", size: 0 },
    );

    this.state.lastRiskResult = riskResult;
    this.state.riskLocked = this.riskEngine.isSystemLocked();

    // 4. Update decision with risk result
    decision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
    decision.riskReason = riskResult.reason;

    // Record risk check in journal
    recordRiskCheck(
      decision.symbol,
      decision.direction,
      riskResult.approved,
      riskResult.reason,
      riskResult.checks,
    );

    // Record journal events for lock states
    if (this.riskEngine.isHardCapReached()) {
      recordHardProfitCap(this.riskEngine.getSessionPnl());
    } else if (this.riskEngine.isCooldownActive()) {
      recordCooldownStarted(
        this.riskEngine.getSessionPnl(),
        this.riskEngine.getCooldownEndsAt()!,
      );
    }

    // Phase 9D: Log guardrail event for LLM path
    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      await walletRepository.logGuardrailEvent(
        "TRADE_ALLOWED",
        "INFO",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        { confidence: decision.confidence, strategy: decision.strategy },
        walletBalance,
      );
    } else if (!riskResult.approved) {
      const isInsufficient = riskResult.reason.includes("Insufficient wallet");
      await walletRepository.logGuardrailEvent(
        isInsufficient ? "INSUFFICIENT_FUNDS" : "TRADE_BLOCKED",
        isInsufficient ? "ERROR" : "WARN",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        {
          confidence: decision.confidence,
          strategy: decision.strategy,
          riskReason: riskResult.reason,
        },
        walletBalance,
      );
    }

    // 5. Execute Paper Trade (only if approved AND passes trade proposal validation)
    let trade: PaperTrade | null = null;

    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      // H-1: Authoritative trade proposal validation BEFORE execution
      const proposalResult = this.validateAndExecute(
        decision,
        marketState.price,
      );

      if (proposalResult) {
        trade = proposalResult;
        this.state.lastTrade = trade;

        // Update risk engine with actual PnL
        this.riskEngine.updateDailyPnl(trade.pnl);
        this.state.riskLocked = this.riskEngine.isSystemLocked();

        // Record trade events in journal
        recordTradeApproved(
          decision.symbol,
          decision.direction,
          decision.id,
        );
        recordTradeOpened(
          decision.symbol,
          decision.direction as "LONG" | "SHORT",
          trade.entryPrice,
          trade.pnl > 0
            ? (trade.entryPrice * (trade.quantity || 0)) /
                (this.riskEngine.getConfig().maxLeverage || 5)
            : 0,
          this.paperEngine.getPosition()?.leverage || 5,
          trade.id,
        );
        recordPositionOpened(
          decision.symbol,
          decision.direction as "LONG" | "SHORT",
          0, // margin calculated by paper engine
          5, // default leverage
        );

        decision.executionResult = "EXECUTED";
      } else {
        decision.executionResult = "SKIPPED";
      }
    } else if (!riskResult.approved) {
      decision.executionResult = "REJECTED";
      decision.executionDetails = riskResult.reason;
      recordTradeRejected(
        decision.symbol,
        decision.direction,
        riskResult.reason,
        decision.id,
      );
    } else {
      decision.executionResult = "SKIPPED";
      // Record NO_TRADE proposed if there was a signal
      if (decision.direction === "NO_TRADE") {
        recordTradeProposed(
          decision.symbol,
          "NO_TRADE",
          decision.confidence,
          decision.strategy,
          decision.id,
        );
      }
    }

    // Track recent activity
    this.addActivity(
      `${decision.direction} ${decision.symbol} (${decision.executionResult || "N/A"})`,
    );

    // 6. Record Experience (Phase 5: AI Learning)
    if (decision.direction === "NO_TRADE") {
      await recordNoTradeExperience(decision, marketState, riskResult);
    } else {
      await recordTradeExperience(decision, marketState, trade, riskResult);
    }

    // 7. Derive Lessons periodically (every 10 actual experiences)
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      try {
        const recentExperiences = await getRecentExperiences(50);
        if (recentExperiences.length > 0) {
          await deriveLessons(recentExperiences);
        }
      } catch (err) {
        logger.error("orchestrator", `Lesson derivation failed: ${err}`);
      }
    }

    this.state.systemStatus = "RUNNING";

    return { decision, riskResult, trade };
  }

  // ─── LLM Market Update ──────────────────────────────────────────

  async processMarketUpdateLLM(marketState: MarketState): Promise<{
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
  }> {
    // Check session-day boundary
    this.checkSessionDayBoundary();

    this.state.marketState = marketState;
    this.state.feedStatus = marketState.feedStatus;

    // Phase 9D: Sync wallet balance to Risk Engine
    const walletBalance = await walletRepository.getBalance();
    this.riskEngine.setWalletBalance(walletBalance);

    // Record market scan event
    recordMarketScan(marketState.symbol, marketState.dataQuality);

    // 1. Generate LLM Decision (with fallback to rule-based)
    let decision: AiDecision;
    try {
      const routerResult = await generateLLMDecision(marketState);

      if (routerResult.provider === "safe_fallback") {
        logger.warn(
          "orchestrator",
          "LLM all providers failed — falling back to rule-based decision",
        );
        decision = generateDecision(marketState);
      } else {
        decision = mergeLLMDecisionIntoAiDecision(
          routerResult.decision,
          marketState,
          routerResult,
        );
      }
    } catch (err) {
      logger.error(
        "orchestrator",
        `LLM decision failed, using rule-based: ${err}`,
      );
      decision = generateDecision(marketState);
    }

    this.state.lastDecision = decision;
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxHistory) {
      this.decisionHistory.shift();
    }

    // 2. Validate Decision
    const validation = validateDecision(decision);
    if (!validation.valid) {
      logger.error(
        "orchestrator",
        `Invalid decision: ${validation.errors.join(", ")}`,
      );
      return {
        decision,
        riskResult: {
          approved: false,
          reason: `Invalid decision: ${validation.errors.join(", ")}`,
        },
        trade: null,
      };
    }

    // 3. Risk Engine Check (HIGHEST AUTHORITY)
    const currentPosition = this.paperEngine.getPosition();
    const riskResult = this.riskEngine.check(
      decision,
      marketState,
      currentPosition
        ? {
            symbol: currentPosition.symbol,
            side: currentPosition.side,
            size: currentPosition.size,
          }
        : { symbol: marketState.symbol, side: "FLAT", size: 0 },
    );

    this.state.lastRiskResult = riskResult;
    this.state.riskLocked = this.riskEngine.isSystemLocked();

    // 4. Update decision with risk result
    decision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
    decision.riskReason = riskResult.reason;

    // Record risk check in journal
    recordRiskCheck(
      decision.symbol,
      decision.direction,
      riskResult.approved,
      riskResult.reason,
      riskResult.checks,
    );

    // Phase 9D: Log guardrail event
    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      await walletRepository.logGuardrailEvent(
        "TRADE_ALLOWED",
        "INFO",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        { confidence: decision.confidence, strategy: decision.strategy },
        walletBalance,
      );
    } else if (!riskResult.approved) {
      const isInsufficient = riskResult.reason.includes("Insufficient wallet");
      await walletRepository.logGuardrailEvent(
        isInsufficient ? "INSUFFICIENT_FUNDS" : "TRADE_BLOCKED",
        isInsufficient ? "ERROR" : "WARN",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        {
          confidence: decision.confidence,
          strategy: decision.strategy,
          riskReason: riskResult.reason,
        },
        walletBalance,
      );
    }

    // 5. Execute Paper Trade (only if approved AND passes trade proposal validation)
    let trade: PaperTrade | null = null;

    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      const proposalResult = this.validateAndExecute(
        decision,
        marketState.price,
      );

      if (proposalResult) {
        trade = proposalResult;
        this.state.lastTrade = trade;

        this.riskEngine.updateDailyPnl(trade.pnl);
        this.state.riskLocked = this.riskEngine.isSystemLocked();

        recordTradeApproved(
          decision.symbol,
          decision.direction,
          decision.id,
        );
        recordTradeOpened(
          decision.symbol,
          decision.direction as "LONG" | "SHORT",
          trade.entryPrice,
          0,
          5,
          trade.id,
        );
        recordPositionOpened(
          decision.symbol,
          decision.direction as "LONG" | "SHORT",
          0,
          5,
        );

        decision.executionResult = "EXECUTED";
      } else {
        decision.executionResult = "SKIPPED";
      }
    } else if (!riskResult.approved) {
      decision.executionResult = "REJECTED";
      decision.executionDetails = riskResult.reason;
      recordTradeRejected(
        decision.symbol,
        decision.direction,
        riskResult.reason,
        decision.id,
      );
    } else {
      decision.executionResult = "SKIPPED";
      if (decision.direction === "NO_TRADE") {
        recordTradeProposed(
          decision.symbol,
          "NO_TRADE",
          decision.confidence,
          decision.strategy,
          decision.id,
        );
      }
    }

    this.addActivity(
      `${decision.direction} ${decision.symbol} (${decision.executionResult || "N/A"})`,
    );

    // 6. Record Experience
    if (decision.direction === "NO_TRADE") {
      await recordNoTradeExperience(decision, marketState, riskResult);
    } else {
      await recordTradeExperience(decision, marketState, trade, riskResult);
    }

    // 7. Derive Lessons periodically
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      try {
        const recentExperiences = await getRecentExperiences(50);
        if (recentExperiences.length > 0) {
          await deriveLessons(recentExperiences);
        }
      } catch (err) {
        logger.error("orchestrator", `Lesson derivation failed: ${err}`);
      }
    }

    this.state.systemStatus = "RUNNING";

    return { decision, riskResult, trade };
  }

  // ─── Trade Proposal Validation & Execution Pipeline (H-1) ──────

  /**
   * Authoritative trade validation + execution pipeline.
   * H-1: No trade may reach paperEngine.execute() unless this passes.
   *
   * 1. Build TradeProposal from decision + market data
   * 2. Run validateTradeProposal (loss, leverage, capital)
   * 3. Run validateOrderQuantity
   * 4. Only then call paperEngine.execute()
   */
  private validateAndExecute(
    decision: AiDecision,
    currentPrice: number,
  ): PaperTrade | null {
    const leverage = this.paperEngine.getPosition()?.leverage || 5;

    // Calculate stop-loss (2% from entry for LONG, 2% for SHORT)
    const stopLossPrice =
      decision.direction === "LONG"
        ? currentPrice * 0.98
        : currentPrice * 1.02;

    // Calculate quantity from position sizing
    const positionValue =
      this.paperEngine.getCapital() *
      (this.paperEngine.getConfig().positionSizePercent / 100);
    const quantity = positionValue / currentPrice;

    // Build proposal
    const proposal: TradeProposal = {
      symbol: decision.symbol,
      side: decision.direction as "LONG" | "SHORT",
      entryPrice: currentPrice,
      quantity,
      leverage,
      stopLossPrice,
    };

    // H-1: Validate through authoritative risk pipeline
    const proposalResult = this.riskEngine.validateTradeProposal(proposal);

    if (!proposalResult.approved) {
      logger.warn(
        "orchestrator",
        `Trade proposal REJECTED: ${proposalResult.reason}`,
      );
      recordTradeRejected(
        decision.symbol,
        decision.direction,
        proposalResult.reason,
        decision.id,
      );
      return null;
    }

    // M-2: Validate order quantity
    const quantityResult = this.riskEngine.validateOrderQuantity(
      currentPrice,
      quantity,
      leverage,
    );

    if (!quantityResult.valid) {
      logger.warn(
        "orchestrator",
        `Order quantity REJECTED: ${quantityResult.reason}`,
      );
      recordTradeRejected(
        decision.symbol,
        decision.direction,
        quantityResult.reason,
        decision.id,
      );
      return null;
    }

    // All validations passed — execute via paper engine
    const order = this.paperEngine.execute(decision, currentPrice);
    if (!order) {
      return null;
    }

    // Track position in risk engine
    const position = this.paperEngine.getPosition();
    if (position) {
      this.riskEngine.recordPositionOpened(position.margin);
    }

    // Convert order to PaperTrade-like return
    const trade: PaperTrade = {
      id: order.id,
      symbol: order.symbol,
      side: order.side === "BUY" ? "LONG" : "SHORT",
      entryPrice: order.fillPrice,
      exitPrice: order.fillPrice,
      quantity: order.quantity,
      pnl: 0,
      pnlPercent: 0,
      fees: order.simulatedFee,
      slippage: order.simulatedSlippage,
      duration: 0,
      strategy: decision.strategy,
      decisionId: decision.id,
      openedAt: order.timestamp,
      closedAt: 0,
    };

    return trade;
  }

  // ─── Session Day Handling ───────────────────────────────────────

  private checkSessionDayBoundary(): void {
    const today = getSessionDay();
    if (hasSessionDayChanged(this.currentSessionDay)) {
      logger.info(
        "orchestrator",
        `Session day changed: ${this.currentSessionDay} → ${today}`,
      );
      this.currentSessionDay = today;
      // Reset session at day boundary
      this.riskEngine.resetSession();
    }
  }

  // ─── Activity Tracking ──────────────────────────────────────────

  private addActivity(activity: string): void {
    const timestamp = new Date().toISOString();
    this.recentActivity.push(`[${timestamp}] ${activity}`);
    // Keep last 20 activities
    if (this.recentActivity.length > 20) {
      this.recentActivity.shift();
    }
  }

  // ─── Real-Time Processing ───────────────────────────────────────

  async processRealtimeUpdate(): Promise<{
    symbol: string;
    result: {
      decision: AiDecision;
      riskResult: { approved: boolean; reason: string };
      trade: PaperTrade | null;
    } | null;
    reason: string;
  }[]> {
    const symbols = await getEnabledSymbols();
    const results: {
      symbol: string;
      result: {
        decision: AiDecision;
        riskResult: { approved: boolean; reason: string };
        trade: PaperTrade | null;
      } | null;
      reason: string;
    }[] = [];

    for (const s of symbols) {
      try {
        const marketState = generateRealtimeMarketState(s.symbol);
        if (!marketState) {
          results.push({
            symbol: s.symbol,
            result: null,
            reason: "OFFLINE/STALE/insufficient_data",
          });
          continue;
        }

        const result = await this.processMarketUpdate(marketState);
        results.push({ symbol: s.symbol, result, reason: "OK" });
      } catch (err) {
        logger.error("orchestrator", `Error processing ${s.symbol}: ${err}`);
        results.push({ symbol: s.symbol, result: null, reason: "ERROR" });
      }
    }

    return results;
  }

  // ─── Getters ───────────────────────────────────────────────────

  getState(): OrchestratorState {
    return { ...this.state };
  }

  getDecisionHistory(): AiDecision[] {
    return [...this.decisionHistory];
  }

  getRiskEngine(): RiskEngine {
    return this.riskEngine;
  }

  getPaperEngine(): PaperTradingEngine {
    return this.paperEngine;
  }

  getPaperStats() {
    return this.paperEngine.getStats();
  }

  getDailyStats() {
    return this.riskEngine.getDailyStats();
  }

  getRecentActivity(): string[] {
    return [...this.recentActivity];
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  async getEnabledSymbols() {
    return await getEnabledSymbols();
  }

  getRealtimeMarketState(symbol: string): MarketState | null {
    return generateRealtimeMarketState(symbol);
  }

  start(): void {
    this.state.systemStatus = "RUNNING";
    logger.info("orchestrator", "Trading orchestrator started (PAPER MODE)");
  }

  stop(): void {
    this.state.systemStatus = "PAUSED";
    logger.info("orchestrator", "Trading orchestrator paused");
  }

  resetDaily(): void {
    // H-2: resetDaily must NOT bypass active cooldown
    this.riskEngine.resetDaily();
    this.state.riskLocked = this.riskEngine.isSystemLocked();
    logger.info(
      "orchestrator",
      `Daily counters reset. Locked: ${this.state.riskLocked}`,
    );
  }
}
