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
import type { TradeExperience } from "../ai/experience-engine";
import { generateDecision, validateDecision } from "../ai/decision-engine";
import { RiskEngine } from "../risk/engine";
import { PaperTradingEngine } from "../paper/engine";
import { recordTradeExperience, recordNoTradeExperience } from "../ai/experience-engine";
import { deriveLessons } from "../ai/lesson-engine";
import { logger } from "../logger";

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
    this.state.riskLocked = this.riskEngine.isSystemLocked();

    // 4. Update decision with risk result
    decision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
    decision.riskReason = riskResult.reason;

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

    // 7. Derive Lessons periodically (every 10 experiences)
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      // In production, fetch recent experiences from database
      // For now, we'll use a placeholder array
      const recentExperiences: TradeExperience[] = [];
      deriveLessons(recentExperiences);
    }

    this.state.systemStatus = "RUNNING";

    return { decision, riskResult, trade };
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
