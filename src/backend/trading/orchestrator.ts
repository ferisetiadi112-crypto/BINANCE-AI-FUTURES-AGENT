/**
 * Trading Orchestrator — BINANCE AI FUTURES AGENT v0.1
 *
 * The main coordination layer that ties everything together:
 *
 *   MarketState (Runtime Intelligence)
 *     → AI Decision Engine
 *       → Risk Engine (highest authority)
 *         → Paper Trading Engine
 *           → Database
 *             → Dashboard
 *
 * This orchestrator ensures:
 * - AI cannot bypass Risk Engine
 * - Paper trading is clearly marked as SIMULATION
 * - All decisions are logged
 * - Daily safety limits are enforced
 */

import type { MarketState } from "../runtime/types";
import type { AiDecision, PaperTrade } from "../ai/types";
import { generateDecision, validateDecision, generateLLMDecision, mergeLLMDecisionIntoAiDecision } from "../ai/decision-engine";
import { RiskEngine } from "../risk/engine";
import { PaperTradingEngine } from "../paper/engine";
import { recordTradeExperience, recordNoTradeExperience, getRecentExperiences } from "../ai/experience-engine";
import { deriveLessons } from "../ai/lesson-engine";
import { generateRealtimeMarketState } from "../services/data-adapter";
import { getEnabledSymbols } from "../market/symbols";
import { logger } from "../logger";
import { walletRepository } from "../repositories/wallet";

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

  constructor() {
    this.riskEngine = new RiskEngine({
      initialCapital: 5.0,
      dailyProfitCap: 0.50,
      dailyLossLimit: 0.50,
      maxLeverage: 10,
      maxExposurePercent: 80,
    });

    this.paperEngine = new PaperTradingEngine({
      initialCapital: 5.0,
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
  }

  // ─── Process Market Update ───────────────────────────────────────

  processMarketUpdate(marketState: MarketState): {
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
  } {
    this.state.marketState = marketState;
    this.state.feedStatus = marketState.feedStatus;

    // Phase 9D: Sync wallet balance to Risk Engine
    const walletBalance = walletRepository.getBalance();
    this.riskEngine.setWalletBalance(walletBalance);

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
      logger.error("orchestrator", `Invalid decision: ${validation.errors.join(", ")}`);
      return {
        decision,
        riskResult: { approved: false, reason: `Invalid decision: ${validation.errors.join(", ")}` },
        trade: null,
      };
    }

    // 3. Risk Engine Check (HIGHEST AUTHORITY)
    const currentPosition = this.paperEngine.getPosition();
    const riskResult = this.riskEngine.check(
      decision,
      marketState,
      currentPosition
        ? { symbol: currentPosition.symbol, side: currentPosition.side, size: currentPosition.size }
        : { symbol: marketState.symbol, side: "FLAT", size: 0 },
    );

    this.state.lastRiskResult = riskResult;
    this.state.riskLocked = this.riskEngine.isSystemLocked();    // 4. Update decision with risk result
    decision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
    decision.riskReason = riskResult.reason;

    // Phase 9D: Log guardrail event for LLM path
    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      walletRepository.logGuardrailEvent(
        "TRADE_ALLOWED",
        "INFO",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        { confidence: decision.confidence, strategy: decision.strategy },
        walletBalance,
      );
    } else if (!riskResult.approved) {
      const isInsufficient = riskResult.reason.includes("Insufficient wallet");
      walletRepository.logGuardrailEvent(
        isInsufficient ? "INSUFFICIENT_FUNDS" : "TRADE_BLOCKED",
        isInsufficient ? "ERROR" : "WARN",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        { confidence: decision.confidence, strategy: decision.strategy, riskReason: riskResult.reason },
        walletBalance,
      );
    }

    // 5. Execute Paper Trade (only if approved)
    let trade: PaperTrade | null = null;

    if (riskResult.approved && decision.direction !== "NO_TRADE") {

      trade = this.paperEngine.execute(decision, marketState.price) as PaperTrade | null;
      if (trade) {
        trade.strategy = decision.strategy;
        trade.decisionId = decision.id;
        this.state.lastTrade = trade;

        // Update risk engine with PnL
        this.riskEngine.updateDailyPnl(trade.pnl);
        this.state.riskLocked = this.riskEngine.isSystemLocked();
      }

      decision.executionResult = trade ? "EXECUTED" : "SKIPPED";
    } else if (!riskResult.approved) {
      decision.executionResult = "REJECTED";
      decision.executionDetails = riskResult.reason;
    } else {
      decision.executionResult = "SKIPPED";
    }

    // 6. Record Experience (Phase 5: AI Learning)
    if (decision.direction === "NO_TRADE") {
      recordNoTradeExperience(decision, marketState, riskResult);
    } else {
      recordTradeExperience(decision, marketState, trade, riskResult);
    }

    // 7. Derive Lessons periodically (every 10 actual experiences)
    // experienceCount tracks actual experience records created, not just symbols processed
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      try {
        // Fetch recent experiences from database — these are actual persisted records
        const recentExperiences = getRecentExperiences(50);
        if (recentExperiences.length > 0) {
          deriveLessons(recentExperiences);
        }
      } catch (err) {
        // Learning failure must never crash the trading runtime
        logger.error("orchestrator", `Lesson derivation failed: ${err}`);
      }
    }

    this.state.systemStatus = "RUNNING";

    return { decision, riskResult, trade };
  }

  // ─── LLM Market Update ──────────────────────────────────────────

  /**
   * Process a market update using the LLM provider chain.
   * Same pipeline as processMarketUpdate but uses AIRouter for decisions
   * instead of rule-based evaluation.
   *
   * Falls back to rule-based decision if LLM returns NO_TRADE with
   * safe_fallback provider (all LLM providers failed).
   */
  async processMarketUpdateLLM(marketState: MarketState): Promise<{
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
  }> {
    this.state.marketState = marketState;
    this.state.feedStatus = marketState.feedStatus;

    // Phase 9D: Sync wallet balance to Risk Engine
    const walletBalance = walletRepository.getBalance();
    this.riskEngine.setWalletBalance(walletBalance);

    // 1. Generate LLM Decision (with fallback to rule-based)
    let decision: AiDecision;
    try {
      const routerResult = await generateLLMDecision(marketState);

      // If LLM fell back to safe_fallback, use rule-based engine instead
      if (routerResult.provider === "safe_fallback") {
        logger.warn("orchestrator", "LLM all providers failed — falling back to rule-based decision");
        decision = generateDecision(marketState);
      } else {
        decision = mergeLLMDecisionIntoAiDecision(
          routerResult.decision,
          marketState,
          routerResult,
        );
      }
    } catch (err) {
      // LLM failure must never crash the trading runtime
      logger.error("orchestrator", `LLM decision failed, using rule-based: ${err}`);
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
      logger.error("orchestrator", `Invalid decision: ${validation.errors.join(", ")}`);
      return {
        decision,
        riskResult: { approved: false, reason: `Invalid decision: ${validation.errors.join(", ")}` },
        trade: null,
      };
    }

    // 3. Risk Engine Check (HIGHEST AUTHORITY)
    const currentPosition = this.paperEngine.getPosition();
    const riskResult = this.riskEngine.check(
      decision,
      marketState,
      currentPosition
        ? { symbol: currentPosition.symbol, side: currentPosition.side, size: currentPosition.size }
        : { symbol: marketState.symbol, side: "FLAT", size: 0 },
    );

    this.state.lastRiskResult = riskResult;
    this.state.riskLocked = this.riskEngine.isSystemLocked();    // 4. Update decision with risk result
    decision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
    decision.riskReason = riskResult.reason;

    // Phase 9D: Log guardrail event for LLM path
    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      walletRepository.logGuardrailEvent(
        "TRADE_ALLOWED",
        "INFO",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        { confidence: decision.confidence, strategy: decision.strategy },
        walletBalance,
      );
    } else if (!riskResult.approved) {
      const isInsufficient = riskResult.reason.includes("Insufficient wallet");
      walletRepository.logGuardrailEvent(
        isInsufficient ? "INSUFFICIENT_FUNDS" : "TRADE_BLOCKED",
        isInsufficient ? "ERROR" : "WARN",
        `[LLM] ${decision.direction} ${decision.symbol} — ${riskResult.reason}`,
        { confidence: decision.confidence, strategy: decision.strategy, riskReason: riskResult.reason },
        walletBalance,
      );
    }

    // 5. Execute Paper Trade (only if approved)
    let trade: PaperTrade | null = null;

    if (riskResult.approved && decision.direction !== "NO_TRADE") {

      trade = this.paperEngine.execute(decision, marketState.price) as PaperTrade | null;
      if (trade) {
        trade.strategy = decision.strategy;
        trade.decisionId = decision.id;
        this.state.lastTrade = trade;

        // Update risk engine with PnL
        this.riskEngine.updateDailyPnl(trade.pnl);
        this.state.riskLocked = this.riskEngine.isSystemLocked();
      }

      decision.executionResult = trade ? "EXECUTED" : "SKIPPED";
    } else if (!riskResult.approved) {
      decision.executionResult = "REJECTED";
      decision.executionDetails = riskResult.reason;
    } else {
      decision.executionResult = "SKIPPED";
    }

    // 6. Record Experience (Phase 5: AI Learning)
    if (decision.direction === "NO_TRADE") {
      recordNoTradeExperience(decision, marketState, riskResult);
    } else {
      recordTradeExperience(decision, marketState, trade, riskResult);
    }

    // 7. Derive Lessons periodically (every 10 actual experiences)
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      try {
        const recentExperiences = getRecentExperiences(50);
        if (recentExperiences.length > 0) {
          deriveLessons(recentExperiences);
        }
      } catch (err) {
        logger.error("orchestrator", `Lesson derivation failed: ${err}`);
      }
    }

    this.state.systemStatus = "RUNNING";

    return { decision, riskResult, trade };
  }

  // ─── Real-Time Processing ───────────────────────────────────────

  /**
   * Process real-time market data for all enabled symbols from the WebSocket feed.
   * Uses generateRealtimeMarketState() which reads from FeedManager (Binance WebSocket).
   * OFFLINE/STALE data is rejected — null snapshots are skipped (no AI decision generated).
   *
   * Returns results for symbols where real-time data was available.
   */
  processRealtimeUpdate(): {
    symbol: string;
    result: { decision: AiDecision; riskResult: { approved: boolean; reason: string }; trade: PaperTrade | null } | null;
    reason: string;
  }[] {
    const symbols = getEnabledSymbols();
    const results: {
      symbol: string;
      result: { decision: AiDecision; riskResult: { approved: boolean; reason: string }; trade: PaperTrade | null } | null;
      reason: string;
    }[] = [];

    for (const s of symbols) {
      try {
        const marketState = generateRealtimeMarketState(s.symbol);
        if (!marketState) {
          results.push({ symbol: s.symbol, result: null, reason: "OFFLINE/STALE/insufficient_data" });
          continue;
        }

        const result = this.processMarketUpdate(marketState);
        results.push({ symbol: s.symbol, result, reason: "OK" });
      } catch (err) {
        logger.error("orchestrator", `Error processing ${s.symbol}: ${err}`);
        results.push({ symbol: s.symbol, result: null, reason: "ERROR" });
      }
    }

    return results;
  }

  // ─── Getters ─────────────────────────────────────────────────────

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

  // ─── Lifecycle ───────────────────────────────────────────────────

  /**
   * Get enabled symbols from the symbol universe.
   */
  getEnabledSymbols() {
    return getEnabledSymbols();
  }

  /**
   * Get real-time market state for a specific symbol from FeedManager.
   * Returns null if feed is OFFLINE/STALE or insufficient data.
   */
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
    this.riskEngine.resetDaily();
    this.state.riskLocked = false;
    logger.info("orchestrator", "Daily counters reset");
  }
}
