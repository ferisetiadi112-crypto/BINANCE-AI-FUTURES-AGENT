/**
 * Trading Orchestrator — BINANCE AI FUTURES AGENT v0.1 (P4)
 *
 * The main coordination layer that ties everything together:
 *
 *   MarketState (Runtime Intelligence)
 *     → AI Decision Engine
 *       → Risk Engine (highest authority — authoritative pipeline)
 *         → TestnetExecutor (P4: Binance Futures Testnet)
 *           → Journal Events
 *             → Post-Trade Review
 *               → Database
 *                 → Dashboard
 *
 * P4 Execution Modes:
 * - PAPER: Uses PaperTradingEngine (simulation only)
 * - TESTNET: Uses TestnetExecutor (Binance Futures Testnet)
 *
 * This orchestrator ensures:
 * - AI cannot bypass Risk Engine
 * - Every trade passes through validateTradeProposal BEFORE execution
 * - validateOrderQuantity is called before execution
 * - TestnetExecutor only executes when Risk Engine APPROVES
 * - All decisions are logged as journal events
 * - Post-trade reviews are generated for every closed trade
 * - Session-day boundary handling (Asia/Jakarta)
 * - Position monitoring reconciles local vs Binance state
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
  recordPositionMonitor,
  recordPnlUpdated,
  recordRiskLocked,
  recordStartupReconciliation,
} from "../journal";
import { generatePostTradeReview } from "../journal/post-trade-review";
import { getSessionDay, hasSessionDayChanged } from "../journal/retention";
import {
  TestnetExecutor,
  getTestnetExecutor,
  type TestnetExecutionResult,
} from "../exchange/testnet-executor";

// ─── Execution Mode ─────────────────────────────────────────────

export type ExecutionMode = "PAPER" | "TESTNET";

export type OrchestratorState = {
  marketState: MarketState | null;
  lastDecision: AiDecision | null;
  lastRiskResult: { approved: boolean; reason: string } | null;
  lastTrade: PaperTrade | null;
  lastTestnetResult: TestnetExecutionResult | null;
  systemStatus: "INITIALIZING" | "RUNNING" | "PAUSED" | "ERROR";
  feedStatus: string;
  riskLocked: boolean;
  executionMode: ExecutionMode;
  testnetReady: boolean;
  reconciliationComplete: boolean;
};

export class TradingOrchestrator {
  private riskEngine: RiskEngine;
  private paperEngine: PaperTradingEngine;
  private testnetExecutor: TestnetExecutor | null;
  private state: OrchestratorState;
  private decisionHistory: AiDecision[] = [];
  private maxHistory = 100;
  private experienceCount = 0;
  private currentSessionDay: string;
  private recentActivity: string[] = [];
  private executionMode: ExecutionMode;
  private reconciliationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(executionMode: ExecutionMode = "PAPER") {
    this.executionMode = executionMode;

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

    // Testnet executor (P4)
    this.testnetExecutor = executionMode === "TESTNET" ? getTestnetExecutor() : null;

    this.state = {
      marketState: null,
      lastDecision: null,
      lastRiskResult: null,
      lastTrade: null,
      lastTestnetResult: null,
      systemStatus: "INITIALIZING",
      feedStatus: "OFFLINE",
      riskLocked: false,
      executionMode,
      testnetReady: false,
      reconciliationComplete: false,
    };

    this.currentSessionDay = getSessionDay();
  }

  // ─── Startup (P4) ─────────────────────────────────────────────

  /**
   * Initialize testnet execution on startup.
   * Validates config, connects, reconciles positions, restores risk state.
   */
  async initializeTestnet(): Promise<boolean> {
    if (this.executionMode !== "TESTNET" || !this.testnetExecutor) {
      logger.info("orchestrator", "Testnet mode not enabled — using PAPER mode");
      return false;
    }

    try {
      // Validate testnet configuration
      const validation = await this.testnetExecutor.validateTestnetConfig();
      if (!validation.valid) {
        logger.error(
          "orchestrator",
          `Testnet validation FAILED: ${validation.errors.join(", ")}`,
        );
        recordStartupReconciliation(
          false,
          `Testnet validation failed: ${validation.errors.join("; ")}`,
        );
        this.state.testnetReady = false;
        this.state.executionMode = "PAPER"; // Fail closed — fallback to paper
        return false;
      }

      logger.info(
        "orchestrator",
        `Testnet connected: balance=$${validation.balance.toFixed(2)}`,
      );

      // Sync wallet balance
      const balance = await this.testnetExecutor.syncBalance();
      this.riskEngine.setWalletBalance(balance);

      // Reconcile positions
      const localPositions = this.getLocalPositions();
      const reconciliation = await this.testnetExecutor.reconcilePositions(localPositions);

      if (!reconciliation.consistent) {
        logger.warn(
          "orchestrator",
          `Position discrepancy detected: localOnly=${reconciliation.localOnly.length}, remoteOnly=${reconciliation.remoteOnly.length}`,
        );

        // Handle remote-only positions (positions on Binance we don't know about)
        for (const remote of reconciliation.remoteOnly) {
          logger.warn(
            "orchestrator",
            `Remote position found: ${remote.side} ${remote.symbol} — tracking locally`,
          );
          // Track these positions in risk engine
          this.riskEngine.recordPositionOpened(remote.margin);
          recordPositionOpened(remote.symbol, remote.side, remote.margin, remote.leverage);
        }
      }

      this.state.testnetReady = true;
      this.state.reconciliationComplete = true;

      recordStartupReconciliation(
        true,
        `Testnet ready: balance=$${validation.balance.toFixed(2)}, positions reconciled`,
      );

      // Start periodic reconciliation (every 60 seconds)
      this.startReconciliationLoop();

      logger.info("orchestrator", "Testnet initialization complete");
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("orchestrator", `Testnet initialization failed: ${msg}`);
      recordStartupReconciliation(false, `Initialization failed: ${msg}`);
      this.state.testnetReady = false;
      this.state.executionMode = "PAPER"; // Fail closed
      return false;
    }
  }

  private startReconciliationLoop(): void {
    if (this.reconciliationInterval) return;

    this.reconciliationInterval = setInterval(async () => {
      try {
        await this.reconcilePositions();
      } catch (err) {
        logger.error("orchestrator", `Reconciliation error: ${err}`);
      }
    }, 60_000);
  }

  private stopReconciliationLoop(): void {
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }
  }

  /**
   * Reconcile local positions with Binance Testnet positions.
   */
  async reconcilePositions(): Promise<void> {
    if (!this.testnetExecutor || !this.state.testnetReady) return;

    try {
      const localPositions = this.getLocalPositions();
      const result = await this.testnetExecutor.reconcilePositions(localPositions);

      if (!result.consistent) {
        // Log discrepancies
        for (const remote of result.remoteOnly) {
          recordPositionMonitor(remote.symbol, false, true, "Remote-only position detected");
        }
        for (const local of result.localOnly) {
          recordPositionMonitor(local.symbol, true, false, "Local-only position detected");
        }
      }
    } catch (err) {
      logger.error("orchestrator", `Position reconciliation failed: ${err}`);
    }
  }

  private getLocalPositions(): Array<{ symbol: string; side: string; size: number }> {
    if (this.executionMode === "TESTNET") {
      // Use risk engine's tracked positions as local state
      // This will be compared against Binance positions during reconciliation
      const state = this.riskEngine.getState();
      if (state.openPositionCount > 0 && state.openPositionMargin > 0) {
        // We have tracked positions — return what we know
        // The reconciliation loop will verify against Binance
        return [{ symbol: "UNKNOWN", side: "LONG", size: 0 }];
      }
      return [];
    }
    const pos = this.paperEngine.getPosition();
    if (pos && pos.side !== "FLAT") {
      return [{ symbol: pos.symbol, side: pos.side, size: pos.size }];
    }
    return [];
  }

  // ─── Process Market Update ───────────────────────────────────────

  async processMarketUpdate(marketState: MarketState): Promise<{
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
    testnetResult: TestnetExecutionResult | null;
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
        testnetResult: null,
      };
    }

    // 3. Risk Engine Check (HIGHEST AUTHORITY)
    const currentPosition = this.executionMode === "TESTNET"
      ? await this.getTestnetCurrentPosition(marketState.symbol)
      : this.paperEngine.getPosition();
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
      recordRiskLocked("Hard profit cap", this.riskEngine.getDailyPnl(), this.riskEngine.getSessionPnl());
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

    // 5. Execute (Paper or Testnet)
    let trade: PaperTrade | null = null;
    let testnetResult: TestnetExecutionResult | null = null;

    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
        // P4: Testnet execution
        testnetResult = await this.validateAndExecuteTestnet(decision, marketState.price);
        if (testnetResult) {
          this.state.lastTestnetResult = testnetResult;
          decision.executionResult = testnetResult.success ? "EXECUTED" : "REJECTED";
          if (!testnetResult.success && testnetResult.error) {
            decision.executionDetails = testnetResult.error;
          }
        }
      } else {
        // Paper execution
        const proposalResult = this.validateAndExecute(decision, marketState.price);
        if (proposalResult) {
          trade = proposalResult;
          this.state.lastTrade = trade;

          // Update risk engine with actual PnL
          this.riskEngine.updateDailyPnl(trade.pnl);
          this.state.riskLocked = this.riskEngine.isSystemLocked();
          recordPnlUpdated(this.riskEngine.getDailyPnl(), this.riskEngine.getSessionPnl(), "paper-close");

          // Record trade events in journal
          recordTradeApproved(decision.symbol, decision.direction, decision.id);
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
            0,
            5,
          );

          decision.executionResult = "EXECUTED";
        }
      }

      if (!trade && !testnetResult) {
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

    return { decision, riskResult, trade, testnetResult };
  }

  // ─── LLM Market Update ──────────────────────────────────────────

  async processMarketUpdateLLM(marketState: MarketState): Promise<{
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
    testnetResult: TestnetExecutionResult | null;
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
        testnetResult: null,
      };
    }

    // 3. Risk Engine Check (HIGHEST AUTHORITY)
    const currentPosition = this.executionMode === "TESTNET"
      ? await this.getTestnetCurrentPosition(marketState.symbol)
      : this.paperEngine.getPosition();
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

    // 5. Execute (Paper or Testnet)
    let trade: PaperTrade | null = null;
    let testnetResult: TestnetExecutionResult | null = null;

    if (riskResult.approved && decision.direction !== "NO_TRADE") {
      if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
        testnetResult = await this.validateAndExecuteTestnet(decision, marketState.price);
        if (testnetResult) {
          this.state.lastTestnetResult = testnetResult;
          decision.executionResult = testnetResult.success ? "EXECUTED" : "REJECTED";
          if (!testnetResult.success && testnetResult.error) {
            decision.executionDetails = testnetResult.error;
          }
        }
      } else {
        const proposalResult = this.validateAndExecute(decision, marketState.price);
        if (proposalResult) {
          trade = proposalResult;
          this.state.lastTrade = trade;

          this.riskEngine.updateDailyPnl(trade.pnl);
          this.state.riskLocked = this.riskEngine.isSystemLocked();
          recordPnlUpdated(this.riskEngine.getDailyPnl(), this.riskEngine.getSessionPnl(), "paper-close");

          recordTradeApproved(decision.symbol, decision.direction, decision.id);
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
        }
      }

      if (!trade && !testnetResult) {
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

    return { decision, riskResult, trade, testnetResult };
  }

  // ─── Paper Execution Pipeline (P3) ──────

  private validateAndExecute(
    decision: AiDecision,
    currentPrice: number,
  ): PaperTrade | null {
    const leverage = this.paperEngine.getPosition()?.leverage || 5;

    const stopLossPrice =
      decision.direction === "LONG"
        ? currentPrice * 0.98
        : currentPrice * 1.02;

    const positionValue =
      this.paperEngine.getCapital() *
      (this.paperEngine.getConfig().positionSizePercent / 100);
    const quantity = positionValue / currentPrice;

    const proposal: TradeProposal = {
      symbol: decision.symbol,
      side: decision.direction as "LONG" | "SHORT",
      entryPrice: currentPrice,
      quantity,
      leverage,
      stopLossPrice,
    };

    const proposalResult = this.riskEngine.validateTradeProposal(proposal);

    if (!proposalResult.approved) {
      logger.warn("orchestrator", `Trade proposal REJECTED: ${proposalResult.reason}`);
      recordTradeRejected(decision.symbol, decision.direction, proposalResult.reason, decision.id);
      return null;
    }

    const quantityResult = this.riskEngine.validateOrderQuantity(
      currentPrice,
      quantity,
      leverage,
    );

    if (!quantityResult.valid) {
      logger.warn("orchestrator", `Order quantity REJECTED: ${quantityResult.reason}`);
      recordTradeRejected(decision.symbol, decision.direction, quantityResult.reason, decision.id);
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

  // ─── Testnet Execution Pipeline (P4) ──────

  /**
   * P4: Authoritative testnet trade validation + execution.
   * 1. Build TradeProposal
   * 2. Run validateTradeProposal (loss, leverage, capital)
   * 3. Run validateOrderQuantity
   * 4. Execute via TestnetExecutor
   * 5. Verify order confirmation
   * 6. Record in journal
   */
  private async validateAndExecuteTestnet(
    decision: AiDecision,
    currentPrice: number,
  ): Promise<TestnetExecutionResult | null> {
    if (!this.testnetExecutor || !this.state.testnetReady) {
      logger.warn("orchestrator", "Testnet not ready — cannot execute");
      return null;
    }

    const leverage = 5; // Default leverage

    // Calculate stop-loss (2% from entry)
    const stopLossPrice =
      decision.direction === "LONG"
        ? currentPrice * 0.98
        : currentPrice * 1.02;

    // Calculate take-profit (4% from entry)
    const takeProfitPrice =
      decision.direction === "LONG"
        ? currentPrice * 1.04
        : currentPrice * 0.96;

    // Calculate quantity based on available capital
    const availableCapital = this.riskEngine.getAiAllocationLimit() - this.riskEngine.getOpenPositionMargin();
    const marginToUse = Math.min(availableCapital, availableCapital * 0.5); // Use 50% of available
    const notional = marginToUse * leverage;
    const quantity = Math.floor((notional / currentPrice) * 1000) / 1000; // Round to 3 decimals

    if (quantity <= 0) {
      logger.warn("orchestrator", "Calculated quantity is zero — cannot execute");
      return null;
    }

    const proposal: TradeProposal = {
      symbol: decision.symbol,
      side: decision.direction as "LONG" | "SHORT",
      entryPrice: currentPrice,
      quantity,
      leverage,
      stopLossPrice,
    };

    // Validate through risk pipeline
    const proposalResult = this.riskEngine.validateTradeProposal(proposal);

    if (!proposalResult.approved) {
      logger.warn("orchestrator", `Trade proposal REJECTED: ${proposalResult.reason}`);
      recordTradeRejected(decision.symbol, decision.direction, proposalResult.reason, decision.id);
      return null;
    }

    // Validate order quantity
    const quantityResult = this.riskEngine.validateOrderQuantity(
      currentPrice,
      quantity,
      leverage,
    );

    if (!quantityResult.valid) {
      logger.warn("orchestrator", `Order quantity REJECTED: ${quantityResult.reason}`);
      recordTradeRejected(decision.symbol, decision.direction, quantityResult.reason, decision.id);
      return null;
    }

    // All validations passed — execute on Testnet
    recordTradeApproved(decision.symbol, decision.direction, decision.id);

    const result = await this.testnetExecutor.executeTrade({
      direction: decision.direction as "LONG" | "SHORT",
      symbol: decision.symbol,
      quantity,
      price: currentPrice,
      leverage,
      stopLossPrice,
      takeProfitPrice,
      decisionId: decision.id,
    });

    if (result.success) {
      // Track position in risk engine
      this.riskEngine.recordPositionOpened(result.actualMargin);

      recordTradeOpened(
        decision.symbol,
        decision.direction as "LONG" | "SHORT",
        result.price,
        result.actualMargin,
        result.actualLeverage,
        `TESTNET-${result.orderId}`,
      );
      recordPositionOpened(
        decision.symbol,
        decision.direction as "LONG" | "SHORT",
        result.actualMargin,
        result.actualLeverage,
      );
    }

    return result;
  }

  // ─── Position Monitoring (P4) ──────

  /**
   * Get current position for a symbol from testnet.
   * Returns null if no position.
   */
  private async getTestnetCurrentPosition(symbol: string): Promise<{
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    size: number;
  } | null> {
    // Query Binance directly — Binance is source of truth
    if (!this.testnetExecutor || !this.state.testnetReady) {
      return null;
    }

    try {
      const binancePosition = await this.testnetExecutor.getBinancePosition(symbol);
      if (binancePosition) {
        return {
          symbol: binancePosition.symbol,
          side: binancePosition.side,
          size: binancePosition.size,
        };
      }
      return null;
    } catch (err) {
      logger.warn("orchestrator", `Failed to get Binance position for ${symbol}: ${err}`);
      // On failure, use risk engine state as fallback
      if (this.riskEngine.getOpenPositionCount() > 0) {
        return { symbol, side: "LONG", size: 0.001 };
      }
      return null;
    }
  }

  // ─── Close Position (P4) ──────

  /**
   * Close a testnet position and record PnL.
   */
  async closeTestnetPosition(
    symbol: string,
    side: "LONG" | "SHORT",
    quantity: number,
    strategy: string,
    decisionId: string,
    confidence: number,
    openedAt: number,
  ): Promise<boolean> {
    if (!this.testnetExecutor || !this.state.testnetReady) {
      logger.warn("orchestrator", "Cannot close position — testnet not ready");
      return false;
    }

    const result = await this.testnetExecutor.closePosition(symbol, side, quantity);

    if (result.success) {
      // Update risk engine
      this.riskEngine.recordPositionClosed(quantity * result.exitPrice / 20); // Approximate margin
      this.riskEngine.updateDailyPnl(result.realizedPnl);
      this.state.riskLocked = this.riskEngine.isSystemLocked();

      recordPnlUpdated(
        this.riskEngine.getDailyPnl(),
        this.riskEngine.getSessionPnl(),
        "testnet-close",
      );

      // Record trade closed
      const duration = Date.now() - openedAt;
      const tradeId = `TESTNET-${result.orderId}`;

      recordTradeClosed(symbol, side, result.realizedPnl, tradeId, "EXCHANGE_CLOSE");
      recordPositionClosed(symbol, side, result.exitPrice, result.realizedPnl, result.orderId!);

      // Generate post-trade review
      generatePostTradeReview({
        tradeId,
        symbol,
        side,
        entryPrice: 0, // Would need to track this
        exitPrice: result.exitPrice,
        pnl: result.realizedPnl,
        exitReason: "EXCHANGE_CLOSE",
        strategy,
        confidence,
        duration,
      });

      // Persist trade
      await this.testnetExecutor.persistTrade(
        symbol,
        side === "LONG" ? "BUY" : "SELL",
        0, // entry price would need to be tracked
        result.exitPrice,
        quantity,
        result.realizedPnl,
        duration / 60000,
        strategy,
        "p4-testnet",
      );

      logger.info(
        "orchestrator",
        `Position closed: ${side} ${symbol} | PnL: $${result.realizedPnl.toFixed(4)}`,
      );

      return true;
    }

    logger.error("orchestrator", `Failed to close position: ${result.error}`);
    return false;
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
      this.riskEngine.resetSession();
    }
  }

  // ─── Activity Tracking ──────────────────────────────────────────

  private addActivity(activity: string): void {
    const timestamp = new Date().toISOString();
    this.recentActivity.push(`[${timestamp}] ${activity}`);
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
      testnetResult: TestnetExecutionResult | null;
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
        testnetResult: TestnetExecutionResult | null;
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

  getTestnetExecutor(): TestnetExecutor | null {
    return this.testnetExecutor;
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

  getExecutionMode(): ExecutionMode {
    return this.executionMode;
  }

  isTestnetReady(): boolean {
    return this.state.testnetReady;
  }

  // ─── Dashboard Data Contract (P4-FIX) ──────────────────────

  /**
   * Get real Binance account data + AI allocation guardrail.
   * This is the data contract for the future dashboard (P5).
   *
   * IMPORTANT: Binance balance is NEVER replaced by AI allocation.
   * They are separate concepts:
   * - Binance Balance = real money in the testnet account
   * - AI Allocation = how much the AI is allowed to use ($10 max)
   */
  async getBinanceAccountData(): Promise<{
    binanceAccount: {
      balance: number;
      availableBalance: number;
      unrealizedPnl: number;
      marginBalance: number;
    } | null;
    aiAllocation: {
      limit: number;
      allocated: number;
      available: number;
    };
    openPositions: Array<{
      symbol: string;
      side: string;
      size: number;
      entryPrice: number;
      markPrice: number;
      unrealizedPnl: number;
      leverage: number;
      margin: number;
    }>;
    riskState: {
      dailyPnl: number;
      sessionPnl: number;
      isLocked: boolean;
      lockReason: string;
      cooldownActive: boolean;
      cooldownEndsAt: number | null;
      hardCapReached: boolean;
    };
  }> {
    const riskState = this.riskEngine.getDailyStats();
    const aiAllocation = {
      limit: this.riskEngine.getAiAllocationLimit(),
      allocated: this.riskEngine.getOpenPositionMargin(),
      available: this.riskEngine.getAiAllocationLimit() - this.riskEngine.getOpenPositionMargin(),
    };

    if (this.executionMode !== "TESTNET" || !this.testnetExecutor || !this.state.testnetReady) {
      return {
        binanceAccount: null,
        aiAllocation,
        openPositions: [],
        riskState: {
          dailyPnl: riskState.pnl,
          sessionPnl: riskState.sessionPnl,
          isLocked: riskState.locked,
          lockReason: riskState.lockReason,
          cooldownActive: riskState.cooldownActive,
          cooldownEndsAt: riskState.cooldownEndsAt,
          hardCapReached: riskState.hardCapReached,
        },
      };
    }

    // Get REAL Binance account data
    let binanceAccount: { balance: number; availableBalance: number; unrealizedPnl: number; marginBalance: number } | null = null;
    let openPositions: Array<{ symbol: string; side: string; size: number; entryPrice: number; markPrice: number; unrealizedPnl: number; leverage: number; margin: number }> = [];

    try {
      const snapshot = await this.testnetExecutor.getAccountSnapshot();
      binanceAccount = {
        balance: snapshot.balance,
        availableBalance: snapshot.availableBalance,
        unrealizedPnl: snapshot.unrealizedPnl,
        marginBalance: snapshot.marginBalance,
      };
      openPositions = snapshot.positions;
    } catch (err) {
      logger.error("orchestrator", `Failed to get Binance account data: ${err}`);
      // binanceAccount remains null — dashboard shows "BINANCE DATA UNAVAILABLE"
    }

    return {
      binanceAccount,
      aiAllocation,
      openPositions,
      riskState: {
        dailyPnl: riskState.pnl,
        sessionPnl: riskState.sessionPnl,
        isLocked: riskState.locked,
        lockReason: riskState.lockReason,
        cooldownActive: riskState.cooldownActive,
        cooldownEndsAt: riskState.cooldownEndsAt,
        hardCapReached: riskState.hardCapReached,
      },
    };
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
    const modeLabel = this.executionMode === "TESTNET" ? "TESTNET MODE" : "PAPER MODE";
    logger.info("orchestrator", `Trading orchestrator started (${modeLabel})`);
  }

  stop(): void {
    this.state.systemStatus = "PAUSED";
    this.stopReconciliationLoop();
    logger.info("orchestrator", "Trading orchestrator paused");
  }

  resetDaily(): void {
    this.riskEngine.resetDaily();
    this.state.riskLocked = this.riskEngine.isSystemLocked();
    logger.info(
      "orchestrator",
      `Daily counters reset. Locked: ${this.state.riskLocked}`,
    );
  }
}
