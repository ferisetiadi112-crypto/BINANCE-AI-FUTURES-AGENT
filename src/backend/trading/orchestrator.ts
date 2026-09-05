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
  validateAIAction,
  validateAITradePlan,
  type PositionInfo,
} from "../ai/decision-engine";
import { RiskEngine, type TradeProposal } from "../risk/engine";
import {
  computeEffectiveAllocation,
  computeAllocationRemaining,
} from "../risk/allocation";
import type { P6Decision } from "../research/p6-decision-engine";
import type { ResearchResult } from "../research/research-engine";
import { PaperTradingEngine } from "../paper/engine";
import {
  recordTradeExperience,
  recordNoTradeExperience,
  getRecentExperiences,
} from "../ai/experience-engine";
import { deriveLessons } from "../ai/lesson-engine";
import { buildExchangeContext } from "../ai/exchange-context";
import { buildMarketContext } from "../ai/market-context";
import { buildMemoryContext } from "../ai/memory-context";
import {
  startLatencyMeasurement,
  recordLatencyStage,
  completeLatencyMeasurement,
} from "../ai/latency";
import {
  onDecisionComplete,
} from "../ai/decision-scheduler";
import { generateRealtimeMarketState } from "../services/data-adapter";
import { getEnabledSymbols } from "../market/symbols";
import { MarketScanner } from "../market/scanner";
import { ResearchEngine } from "../research/research-engine";
import { P6DecisionEngine } from "../research/p6-decision-engine";
import { getMarketDataService } from "../market/data-service";
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
  recordLessonStored,
  recordNoReliableLesson,
  recordStartupReconciliation,
  recordRemotePositionDiscovered,
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
  /** P7C: Timestamp (ms) of the last successful Binance account-state sync. null = never synced. */
  lastSuccessfulSync: number | null;
  /** P7C: Timestamp (ms) of the last sync attempt (success or failure). */
  lastSyncAttempt: number | null;
  /** P7C: Error message from the last failed sync attempt. null = no error or last attempt succeeded. */
  connectionError: string | null;
  /** P7C: Total consecutive sync failures since last success. */
  consecutiveSyncFailures: number;
};

export class TradingOrchestrator {
  private riskEngine: RiskEngine;
  private paperEngine: PaperTradingEngine;
  private testnetExecutor: TestnetExecutor | null;
  private lastSyncedWalletBalance = 0;
  private state: OrchestratorState;
  private decisionHistory: AiDecision[] = [];
  private maxHistory = 100;
  private experienceCount = 0;
  private currentSessionDay: string;
  private recentActivity: string[] = [];
  private executionMode: ExecutionMode;
  private reconciliationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(executionMode: ExecutionMode = "PAPER", tradingEnabled = false) {
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
      tradingEnabled, // P7D-2B: master kill-switch, default OFF
    });

    logger.info(
      "orchestrator",
      `RiskEngine created: tradingEnabled=${tradingEnabled}, executionMode=${executionMode}`,
    );

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
      lastSuccessfulSync: null,
      lastSyncAttempt: null,
      connectionError: null,
      consecutiveSyncFailures: 0,
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
      // P7C: Track that initialization was attempted but not possible
      this.state.lastSyncAttempt = Date.now();
      this.state.connectionError = "Testnet not configured — missing executor or not in TESTNET mode";
      this.state.consecutiveSyncFailures++;
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
        // P7A: NO PAPER fallback — execution stays disabled until testnet is healthy
        // P7C: Track validation failure
        this.state.lastSyncAttempt = Date.now();
        this.state.connectionError = validation.errors.join("; ");
        this.state.consecutiveSyncFailures++;
        return false;
      }

      logger.info(
        "orchestrator",
        `Testnet connected: balance=$${validation.balance.toFixed(2)}`,
      );

      // P7A: Fetch REAL Binance Futures available balance and set effective allocation
      const balance = await this.testnetExecutor.syncBalance();
      this.riskEngine.setWalletBalance(balance);
      this.riskEngine.setEffectiveAllocationLimit(balance);

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
          // Phase 3.7: this is a reconciliation sync of a pre-existing Binance
          // position — recorded as STARTUP_RECONCILIATION, never POSITION_OPENED.
          recordRemotePositionDiscovered(remote.symbol, remote.side, remote.margin, remote.leverage);
        }
      }

      this.state.testnetReady = true;
      this.state.reconciliationComplete = true;
      // P7C: Record successful sync — timestamp only set after verified Binance response
      this.state.lastSuccessfulSync = Date.now();
      this.state.lastSyncAttempt = Date.now();
      this.state.connectionError = null;
      this.state.consecutiveSyncFailures = 0;

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
      // P7A: Fail closed — NO PAPER fallback. Trading stays disabled.
      this.state.testnetReady = false;
      // P7C: Record failure state
      this.state.lastSyncAttempt = Date.now();
      this.state.connectionError = msg;
      this.state.consecutiveSyncFailures++;
      // executionMode stays TESTNET but testnetReady=false → execution blocked
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

  async processMarketUpdate(
    marketState: MarketState,
    options?: { skipBalanceSync?: boolean },
  ): Promise<{
    decision: AiDecision;
    riskResult: { approved: boolean; reason: string };
    trade: PaperTrade | null;
    testnetResult: TestnetExecutionResult | null;
  }> {
    // Check session-day boundary
    this.checkSessionDayBoundary();

    this.state.marketState = marketState;
    this.state.feedStatus = marketState.feedStatus;

    // Balance sync is hoisted to once-per-tick by processRealtimeUpdate().
    // Direct callers (tests, diagnostics) still sync on demand by default.
    if (!options?.skipBalanceSync) {
      await this.syncAccountBalance();
    }
    const walletBalance = this.lastSyncedWalletBalance;

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

    // 7. Derive Lessons periodically (every 10 actual experiences).
    // Phase 3: only non-duplicate, evidence-backed lessons are stored;
    // an empty result is recorded honestly, never fabricated.
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      try {
        const recentExperiences = await getRecentExperiences(50);
        if (recentExperiences.length >= 5) {
          const stored = await deriveLessons(recentExperiences);
          if (stored.length > 0) {
            recordLessonStored(stored.length, stored[0]!.cycle);
          } else {
            recordNoReliableLesson(recentExperiences.length);
          }
        } else {
          recordNoReliableLesson(recentExperiences.length);
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

    // P7A: Sync REAL Binance Futures balance to Risk Engine in TESTNET mode.
    // In PAPER mode, use sandbox wallet. In TESTNET, Binance is source of truth.
    let walletBalance: number;
    if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
      try {
        const realBalance = await this.testnetExecutor.syncBalance();
        walletBalance = realBalance;
        this.riskEngine.setEffectiveAllocationLimit(realBalance);
      } catch (err) {
        logger.warn("orchestrator", `Failed to sync real Futures balance: ${err}`);
        walletBalance = 0;
        this.riskEngine.setEffectiveAllocationLimit(0); // Fail closed
        // P7C: Track sync failure in connection state
        this.state.lastSyncAttempt = Date.now();
        this.state.connectionError = err instanceof Error ? err.message : String(err);
        this.state.consecutiveSyncFailures++;
      }
    } else {
      walletBalance = await walletRepository.getBalance();
    }
    this.riskEngine.setWalletBalance(walletBalance);

    // Record market scan event
    recordMarketScan(marketState.symbol, marketState.dataQuality);

    // P7D-5.4: Start latency measurement for this decision pipeline
    startLatencyMeasurement(marketState.symbol);
    recordLatencyStage("STATE_UPDATED");

    // P7D-5.2: Build exchange context for AI awareness (read-only)
    let exchangeContext: import("../ai/llm/prompt").ExchangeContextForPrompt | null = null;
    try {
      exchangeContext = await buildExchangeContext();
    } catch (err) {
      logger.warn("orchestrator", `Failed to build exchange context for AI: ${err}`);
    }

    // P7D-5.3: Build realtime market context for AI awareness (read-only)
    let aiMarketContext: import("../ai/market-context").AiMarketContext | null = null;
    try {
      aiMarketContext = await buildMarketContext();
    } catch (err) {
      logger.warn("orchestrator", `Failed to build market context for AI: ${err}`);
    }

    recordLatencyStage("CONTEXT_BUILT");

    // Phase 2: REAL position state — passed to the AI (position-aware prompt)
    // and used to gate HOLD/CLOSE/OPEN after the LLM responds.
    const positionInfo: PositionInfo = await this.getCurrentPositionInfo(marketState.symbol);
    const positionHint: import("../ai/llm/prompt").PositionHint = positionInfo.hasPosition
      ? { hasPosition: true, symbol: positionInfo.symbol, side: positionInfo.side, size: positionInfo.size }
      : { hasPosition: false, symbol: null, side: null, size: 0 };

    let decision: AiDecision;
    let llmProvider: string | null = null;
    let usedSafeFallback = false;
    try {
      recordLatencyStage("LLM_START");
      // Phase 1: Research (real klines/indicators for this symbol) — best effort.
      // If research fails, the LLM still runs on the base MarketState.
      let research: import("../research/research-engine").ResearchResult | null = null;
      try {
        const snapshot = await getMarketDataService().getSnapshot(marketState.symbol);
        if (snapshot && snapshot.dataQuality !== "INVALID") {
          research = new ResearchEngine().research(snapshot);
        }
      } catch (err) {
        logger.warn("orchestrator", `Research context unavailable for ${marketState.symbol}: ${err}`);
      }

      // Phase 1: Bounded memory context (lessons + experiences) — best effort.
      const memoryContext = await buildMemoryContext(marketState);

      recordLatencyStage("CONTEXT_BUILT_RESEARCH_MEMORY");

      const routerResult = await generateLLMDecision(
        marketState,
        exchangeContext,
        aiMarketContext,
        memoryContext,
        research,
        positionHint,
      );
      recordLatencyStage("LLM_RESPONSE");

      if (routerResult.provider === "safe_fallback") {
        // EXISTING SAFE FALLBACK behavior — recorded honestly, never fabricated.
        usedSafeFallback = true;
        logger.warn(
          "orchestrator",
          "LLM all providers failed — using SAFE_FALLBACK (NO_TRADE, confidence 0), NOT the rule-based engine",
        );
        decision = mergeLLMDecisionIntoAiDecision(routerResult.decision, marketState, routerResult);
      } else {
        llmProvider = routerResult.provider;
        decision = mergeLLMDecisionIntoAiDecision(routerResult.decision, marketState, routerResult);
      }
    } catch (err) {
      // Complete LLM pipeline failure → existing SAFE_FALLBACK (NO_TRADE),
      // honestly labeled. The rule-based engine is preserved but is no longer
      // the silent substitute for a failed AI response.
      usedSafeFallback = true;
      logger.error("orchestrator", `LLM pipeline failed — using SAFE_FALLBACK: ${err}`);
      decision = mergeLLMDecisionIntoAiDecision(
        (await import("../ai/llm/types")).SAFE_FALLBACK,
        marketState,
        { decision: (await import("../ai/llm/types")).SAFE_FALLBACK, provider: "safe_fallback", providerAttempts: 0, errors: [], elapsedMs: 0 },
      );
    }

    // Phase 1: Record the honest decision source (LLM provider or safe fallback)
    decision.executionDetails = usedSafeFallback
      ? `AI_SAFE_FALLBACK: all LLM providers failed — decision is the existing NO_TRADE safe fallback, not AI analysis${decision.executionDetails ? ` | ${decision.executionDetails}` : ""}`
      : `AI_PROVIDER: ${llmProvider}${decision.executionDetails ? ` | ${decision.executionDetails}` : ""}`;

    // Phase 2: Position-aware action gating. Invalid/unsafe AI actions are
    // downgraded to WAIT honestly — no values are invented.
    const rawAction = decision.action ?? "WAIT";
    let actionError: string | null = null;
    if (rawAction === "OPEN") {
      actionError = validateAIAction("OPEN", positionInfo) ?? validateAITradePlan(decision.tradePlan, marketState.price);
      if (actionError) {
        logger.warn("orchestrator", `AI OPEN blocked: ${actionError}`);
        decision.action = "WAIT";
        decision.direction = "NO_TRADE";
        decision.tradePlan = undefined;
        decision.executionDetails = `AI_PLAN_BLOCKED: ${actionError}${decision.executionDetails ? ` | ${decision.executionDetails}` : ""}`;
      } else {
        decision.direction = decision.tradePlan!.direction;
      }
    } else if (rawAction === "HOLD" || rawAction === "CLOSE") {
      actionError = validateAIAction(rawAction, positionInfo);
      if (actionError) {
        logger.warn("orchestrator", `AI ${rawAction} invalid: ${actionError}`);
        decision.action = "WAIT";
        decision.direction = "NO_TRADE";
        decision.executionDetails = `AI_ACTION_INVALID: ${actionError}${decision.executionDetails ? ` | ${decision.executionDetails}` : ""}`;
      } else if (rawAction === "HOLD") {
        // HOLD maintains the existing position — never a new trade.
        decision.direction = "NO_TRADE";
      } else {
        // CLOSE: direction mirrors the open position side so journal/experience records it.
        decision.direction = positionInfo.side as "LONG" | "SHORT";
      }
    } else {
      // RESEARCH_MORE / WAIT — no trade this cycle.
      decision.direction = "NO_TRADE";
    }

    recordLatencyStage("DECISION_COMPLETED");
    completeLatencyMeasurement();
    onDecisionComplete();

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

    // 5. Execute (Paper or Testnet) — Phase 2: action-aware
    let trade: PaperTrade | null = null;
    let testnetResult: TestnetExecutionResult | null = null;

    if (decision.action === "CLOSE" && !actionError) {
      // CLOSE reduces exposure — executed via the existing close paths.
      const closeResult = await this.executeCloseAction(decision, marketState, positionInfo);
      trade = closeResult.trade;
      decision.executionResult = closeResult.detail.startsWith("CLOSED") ? "EXECUTED" : "REJECTED";
      decision.executionDetails = `${closeResult.detail}${decision.executionDetails ? ` | ${decision.executionDetails}` : ""}`;
      if (trade) this.state.lastTrade = trade;
    } else if (riskResult.approved && decision.direction !== "NO_TRADE") {
      if (decision.action === "OPEN" && decision.tradePlan && !actionError) {
        // Phase 2: AI-proposed trade plan → validation → Risk Engine → execution.
        if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
          testnetResult = await this.executeTestnetWithPlan(decision, decision.tradePlan);
          if (testnetResult) {
            this.state.lastTestnetResult = testnetResult;
            decision.executionResult = testnetResult.success ? "EXECUTED" : "REJECTED";
            if (!testnetResult.success && testnetResult.error) {
              decision.executionDetails = testnetResult.error;
            }
          }
        } else {
          const planTrade = this.executeOpenWithPlan(decision, decision.tradePlan);
          if (planTrade) {
            trade = planTrade;
            this.state.lastTrade = trade;
            decision.executionResult = "EXECUTED";
          } else {
            decision.executionResult = "REJECTED";
          }
        }
      } else if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
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

      if (!trade && !testnetResult && !decision.executionResult) {
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

    // 7. Derive Lessons periodically. Phase 3: only non-duplicate,
    // evidence-backed lessons are stored; empty result recorded honestly.
    this.experienceCount++;
    if (this.experienceCount % 10 === 0) {
      try {
        const recentExperiences = await getRecentExperiences(50);
        if (recentExperiences.length >= 5) {
          const stored = await deriveLessons(recentExperiences);
          if (stored.length > 0) {
            recordLessonStored(stored.length, stored[0]!.cycle);
          } else {
            recordNoReliableLesson(recentExperiences.length);
          }
        } else {
          recordNoReliableLesson(recentExperiences.length);
        }
      } catch (err) {
        logger.error("orchestrator", `Lesson derivation failed: ${err}`);
      }
    }

    this.state.systemStatus = "RUNNING";

    return { decision, riskResult, trade, testnetResult };
  }

  // ─── Position Helpers (Phase 2) ─────────────────────────────

  /**
   * Phase 2: Get the REAL current position for a symbol (PAPER or TESTNET),
   * used for AI position-awareness and action gating.
   */
  private async getCurrentPositionInfo(symbol: string): Promise<PositionInfo> {
    if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
      const pos = await this.getTestnetCurrentPosition(symbol);
      if (pos && pos.side !== "FLAT" && pos.size > 0) {
        return { hasPosition: true, symbol: pos.symbol, side: pos.side, size: pos.size };
      }
      return { hasPosition: false, symbol: null, side: null, size: 0 };
    }
    const pos = this.paperEngine.getPosition();
    if (pos && pos.side !== "FLAT") {
      return { hasPosition: true, symbol: pos.symbol, side: pos.side, size: pos.size };
    }
    return { hasPosition: false, symbol: null, side: null, size: 0 };
  }

  /**
   * Phase 2: CLOSE execution path. PAPER: close via paper engine at market.
   * TESTNET: close via existing TestnetExecutor (Binance PnL authoritative).
   * Returns the closed trade or null with an honest failure detail.
   */
  private async executeCloseAction(
    decision: AiDecision,
    marketState: MarketState,
    positionInfo: PositionInfo,
  ): Promise<{ trade: PaperTrade | null; testnetResult: TestnetExecutionResult | null; detail: string }> {
    if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady && positionInfo.symbol && positionInfo.side) {
      const ok = await this.closeTestnetPosition(
        positionInfo.symbol,
        positionInfo.side,
        positionInfo.size,
        decision.strategy,
        decision.id,
        decision.confidence,
        Date.now(),
      );
      if (ok) {
        recordTradeClosed(positionInfo.symbol, positionInfo.side, 0, decision.id, "AI_CLOSE");
        return { trade: null, testnetResult: null, detail: `CLOSED ${positionInfo.side} ${positionInfo.symbol} via testnet` };
      }
      return { trade: null, testnetResult: null, detail: "CLOSE failed: testnet close returned failure" };
    }

    // PAPER mode: close at current market price
    const closed = this.paperEngine.closePosition(marketState.price, "AI_CLOSE");
    if (closed) {
      this.riskEngine.recordPositionClosed(closed.quantity * closed.exitPrice / 20);
      this.riskEngine.updateDailyPnl(closed.pnl);
      this.state.riskLocked = this.riskEngine.isSystemLocked();
      recordPnlUpdated(this.riskEngine.getDailyPnl(), this.riskEngine.getSessionPnl(), "ai-close");
      recordTradeClosed(closed.symbol, closed.side, closed.pnl, closed.id, "AI_CLOSE");
      recordPositionClosed(closed.symbol, closed.side, closed.exitPrice, closed.pnl, 0);
      return { trade: closed, testnetResult: null, detail: `CLOSED ${closed.side} ${closed.symbol} @ ${closed.exitPrice.toFixed(2)}, PnL $${closed.pnl.toFixed(4)}` };
    }
    return { trade: null, testnetResult: null, detail: "CLOSE failed: no closable paper position" };
  }

  // ─── Phase 2: AI Trade Plan Execution ──────

  /**
   * Phase 2: Execute an OPEN using the AI-proposed trade plan (PAPER mode).
   * Plan → structural validation (already done) → Risk Engine proposal/quantity
   * validation (final authority) → existing paper engine execution.
   */
  private executeOpenWithPlan(decision: AiDecision, plan: NonNullable<AiDecision["tradePlan"]>): PaperTrade | null {
    const quantity = plan.margin * plan.leverage / plan.entry;
    // Round to 6 decimals (Binance LOT_SIZE precision is applied by the executor);
    // naive 3-decimal rounding zeroes out small-capital quantities.
    const roundedQty = Math.floor(quantity * 1_000_000) / 1_000_000;
    if (roundedQty <= 0) {
      logger.warn("orchestrator", "AI plan quantity is zero — cannot execute");
      recordTradeRejected(decision.symbol, plan.direction, "AI plan produced zero quantity", decision.id);
      return null;
    }

    // Risk Engine = FINAL AUTHORITY on the AI's plan.
    const proposal: TradeProposal = {
      symbol: decision.symbol,
      side: plan.direction,
      entryPrice: plan.entry,
      quantity: roundedQty,
      leverage: plan.leverage,
      stopLossPrice: plan.stopLoss,
    };

    const proposalResult = this.riskEngine.validateTradeProposal(proposal);
    if (!proposalResult.approved) {
      logger.warn("orchestrator", `AI plan REJECTED by Risk Engine: ${proposalResult.reason}`);
      recordTradeRejected(decision.symbol, plan.direction, `AI plan rejected: ${proposalResult.reason}`, decision.id);
      decision.riskResult = "REJECTED";
      decision.riskReason = `AI plan rejected: ${proposalResult.reason}`;
      return null;
    }

    const quantityResult = this.riskEngine.validateOrderQuantity(plan.entry, roundedQty, plan.leverage);
    if (!quantityResult.valid) {
      logger.warn("orchestrator", `AI plan quantity REJECTED: ${quantityResult.reason}`);
      recordTradeRejected(decision.symbol, plan.direction, `AI plan quantity rejected: ${quantityResult.reason}`, decision.id);
      return null;
    }

    recordTradeApproved(decision.symbol, plan.direction, decision.id);

    // Execute via the existing paper engine, honoring the AI plan (SL/TP/leverage/size).
    const order = this.paperEngine.execute(
      { ...decision, direction: plan.direction },
      plan.entry,
      { quantity: roundedQty, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit, leverage: plan.leverage },
    );
    if (!order) return null;

    const position = this.paperEngine.getPosition();
    if (position) this.riskEngine.recordPositionOpened(position.margin);

    recordTradeOpened(decision.symbol, plan.direction, order.fillPrice, position?.margin ?? 0, plan.leverage, order.id);
    recordPositionOpened(decision.symbol, plan.direction, position?.margin ?? 0, plan.leverage);

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

  /**
   * Phase 2: Execute an OPEN using the AI-proposed trade plan (TESTNET mode).
   * Same risk pipeline; existing TestnetExecutor performs the actual orders.
   */
  private async executeTestnetWithPlan(
    decision: AiDecision,
    plan: NonNullable<AiDecision["tradePlan"]>,
  ): Promise<TestnetExecutionResult | null> {
    if (!this.testnetExecutor || !this.state.testnetReady) return null;

    const quantity = plan.margin * plan.leverage / plan.entry;
    // Round to 6 decimals (Binance LOT_SIZE precision is applied by the executor);
    // naive 3-decimal rounding zeroes out small-capital quantities.
    const roundedQty = Math.floor(quantity * 1_000_000) / 1_000_000;
    if (roundedQty <= 0) {
      logger.warn("orchestrator", "AI plan quantity is zero — cannot execute on testnet");
      recordTradeRejected(decision.symbol, plan.direction, "AI plan produced zero quantity", decision.id);
      return null;
    }

    const proposal: TradeProposal = {
      symbol: decision.symbol,
      side: plan.direction,
      entryPrice: plan.entry,
      quantity: roundedQty,
      leverage: plan.leverage,
      stopLossPrice: plan.stopLoss,
    };

    const proposalResult = this.riskEngine.validateTradeProposal(proposal);
    if (!proposalResult.approved) {
      logger.warn("orchestrator", `AI plan REJECTED by Risk Engine: ${proposalResult.reason}`);
      recordTradeRejected(decision.symbol, plan.direction, `AI plan rejected: ${proposalResult.reason}`, decision.id);
      decision.riskResult = "REJECTED";
      decision.riskReason = `AI plan rejected: ${proposalResult.reason}`;
      return null;
    }

    const quantityResult = this.riskEngine.validateOrderQuantity(plan.entry, roundedQty, plan.leverage);
    if (!quantityResult.valid) {
      logger.warn("orchestrator", `AI plan quantity REJECTED: ${quantityResult.reason}`);
      recordTradeRejected(decision.symbol, plan.direction, `AI plan quantity rejected: ${quantityResult.reason}`, decision.id);
      return null;
    }

    recordTradeApproved(decision.symbol, plan.direction, decision.id);

    const result = await this.testnetExecutor.executeTrade({
      direction: plan.direction,
      symbol: decision.symbol,
      quantity: roundedQty,
      price: plan.entry,
      leverage: plan.leverage,
      stopLossPrice: plan.stopLoss,
      takeProfitPrice: plan.takeProfit,
      decisionId: decision.id,
    });

    if (result.success) {
      this.riskEngine.recordPositionOpened(result.actualMargin);
      recordTradeOpened(decision.symbol, plan.direction, result.price, result.actualMargin, result.actualLeverage, `TESTNET-${result.orderId}`);
      recordPositionOpened(decision.symbol, plan.direction, result.actualMargin, result.actualLeverage);
    }
    return result;
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

    // P7A: Calculate quantity based on effective allocation (from real Binance balance)
    const availableCapital = this.riskEngine.getEffectiveAllocationLimit() - this.riskEngine.getOpenPositionMargin();
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

  /**
   * Synchronize the account balance with the Risk Engine ONCE per tick.
   *
   * Previously this ran inside processMarketUpdate() for every enabled
   * symbol (12x per tick in TESTNET mode, each a signed Binance REST call
   * plus DB writes). Identical logic and fail-closed behavior — hoisted.
   */
  async syncAccountBalance(): Promise<void> {
    // P7A: Sync REAL Binance Futures balance to Risk Engine in TESTNET mode.
    // In PAPER mode, use sandbox wallet. In TESTNET, Binance is source of truth.
    let walletBalance: number;
    if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
      try {
        const realBalance = await this.testnetExecutor.syncBalance();
        walletBalance = realBalance;
        this.riskEngine.setEffectiveAllocationLimit(realBalance);
      } catch (err) {
        logger.warn("orchestrator", `Failed to sync real Futures balance: ${err}`);
        walletBalance = 0;
        this.riskEngine.setEffectiveAllocationLimit(0); // Fail closed
        // P7C: Track sync failure in connection state
        this.state.lastSyncAttempt = Date.now();
        this.state.connectionError = err instanceof Error ? err.message : String(err);
        this.state.consecutiveSyncFailures++;
      }
    } else {
      walletBalance = await walletRepository.getBalance();
    }
    this.riskEngine.setWalletBalance(walletBalance);
    this.lastSyncedWalletBalance = walletBalance;
  }

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

    // Sync balance ONCE per tick, before processing any symbols.
    // Previously each enabled symbol called syncBalance() inside
    // processMarketUpdate() — identical logic and fail-closed behavior,
    // but 12x the signed Binance REST calls per tick in TESTNET mode.
    await this.syncAccountBalance().catch((err) => {
      logger.warn("orchestrator", `Tick-level balance sync failed: ${err}`);
    });

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

        // Balance sync is now handled once-per-tick above.
        // Phase 1: The LIVE runtime decision path is the LLM/AI pipeline
        // (processMarketUpdateLLM). The rule-based processMarketUpdate()
        // remains as the compatibility/analysis path for tests and tooling.
        const result = await this.processMarketUpdateLLM(marketState);
        results.push({ symbol: s.symbol, result, reason: "OK" });
      } catch (err) {
        logger.error("orchestrator", `Error processing ${s.symbol}: ${err}`);
        results.push({ symbol: s.symbol, result: null, reason: "ERROR" });
      }
    }

    return results;
  }

  // ─── P6: Real AI Research + Decision Cycle ──────────────────────

  /**
   * P6: Full scan → research → decide → risk → execute cycle.
   * Uses REAL Binance Testnet market data throughout.
   *
   * Flow:
   *   1. Scan eligible symbols (from exchange info + 24h ticker)
   *   2. Research top candidates (real klines, real indicators)
   *   3. AI decision (real calculated entry/SL/TP/leverage/margin)
   *   4. Risk Engine validation (existing P3 gate)
   *   5. Execute if approved (existing P4 testnet executor)
   *   6. Journal all events
   */
  async processP6Cycle(): Promise<{
    symbolsScanned: number;
    candidatesEvaluated: number;
    decision: P6Decision;
    riskResult: { approved: boolean; reason: string };
    testnetResult: TestnetExecutionResult | null;
  }> {
    const startTime = Date.now();
    this.checkSessionDayBoundary();

    // Initialize P6 components
    const scanner = new MarketScanner();
    const researchEngine = new ResearchEngine();
    const decisionEngine = new P6DecisionEngine();

    // 1. Scan for eligible symbols (REAL data)
    recordMarketScan("SCAN", "GOOD");
    logger.info("p6-cycle", "Starting P6 scan → research → decide → risk → execute cycle");

    const scanResult = await scanner.scan();
    if (scanResult.dataQuality === "INVALID" || scanResult.eligibleSymbols.length === 0) {
      const noTrade: P6Decision = {
        symbol: "N/A",
        direction: "NO_TRADE",
        confidence: 0,
        reasoning: `No eligible symbols: scanned ${scanResult.symbolsScanned}, eligible 0. ` +
          (scanResult.rejectedSymbols.length > 0
            ? `Rejected: ${scanResult.rejectedSymbols.map((r) => `${r.symbol} (${r.reason})`).join("; ")}`
            : ""),
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        leverage: 0,
        proposedMargin: 0,
        expectedRiskReward: 0,
        worstCaseLoss: 0,
        invalidationReason: "No eligible symbols",
        researchScore: 0,
        researchEvidence: [],
        timestamp: Date.now(),
        researchId: `P6-SCAN-${Date.now()}`,
      };
      this.addActivity(`P6 SCAN: ${scanResult.symbolsScanned} scanned, 0 eligible (${scanResult.dataQuality})`);
      return {
        symbolsScanned: scanResult.symbolsScanned,
        candidatesEvaluated: 0,
        decision: noTrade,
        riskResult: { approved: false, reason: "No eligible symbols" },
        testnetResult: null,
      };
    }

    // 2. Research top candidates (real klines + indicators)
    let bestDecision: P6Decision | null = null;
    let bestResearch: ResearchResult | null = null;
    let evaluated = 0;

    const dataService = getMarketDataService();
    for (const symbol of scanResult.eligibleSymbols.slice(0, 5)) {
      try {
        const snapshot = await dataService.getSnapshot(symbol);
        if (snapshot.dataQuality === "INVALID") continue;

        const research = researchEngine.research(snapshot);
        evaluated++;

        // Track best candidate
        if (research.tradeableDirection !== "NO_TRADE" && research.score > 0) {
          if (!bestDecision || research.score > (bestResearch?.score ?? 0)) {
            // Get current allocated margin
            const existingMargin = this.riskEngine.getOpenPositionMargin();
            bestDecision = decisionEngine.makeDecision(
              research,
              snapshot,
              existingMargin,
              this.riskEngine.getEffectiveAllocationLimit(),
            );
            bestResearch = research;
          }
        }
      } catch (err) {
        logger.warn("p6-cycle", `Research failed for ${symbol}: ${err}`);
      }
    }

    // If no tradeable candidate found
    if (!bestDecision || bestDecision.direction === "NO_TRADE") {
      const noTrade: P6Decision = bestDecision ?? {
        symbol: scanResult.eligibleSymbols[0] || "N/A",
        direction: "NO_TRADE",
        confidence: 0,
        reasoning: "No candidate passed research threshold",
        entryPrice: 0,
        stopLoss: 0,
        takeProfit: 0,
        leverage: 0,
        proposedMargin: 0,
        expectedRiskReward: 0,
        worstCaseLoss: 0,
        invalidationReason: "No qualifying candidate",
        researchScore: 0,
        researchEvidence: [],
        timestamp: Date.now(),
        researchId: `P6-NOCANDIDATE-${Date.now()}`,
      };

      this.addActivity(
        `P6: Scanned ${scanResult.symbolsScanned} → ${evaluated} researched → NO_TRADE (score insufficient)`,
      );

      return {
        symbolsScanned: scanResult.symbolsScanned,
        candidatesEvaluated: evaluated,
        decision: noTrade,
        riskResult: { approved: false, reason: noTrade.invalidationReason || "No qualifying candidate" },
        testnetResult: null,
      };
    }

    // 3. Build AiDecision for Risk Engine compatibility
    const aiDecision = decisionEngine.toAiDecision(bestDecision);
    this.state.lastDecision = aiDecision;
    this.decisionHistory.push(aiDecision);
    if (this.decisionHistory.length > this.maxHistory) this.decisionHistory.shift();

    // Record P6 research + decision in journal
    recordRiskCheck(
      bestDecision.symbol,
      bestDecision.direction,
      false, // will be updated after risk check
      bestDecision.reasoning,
      bestResearch?.evidence.map((ev: string) => ({ name: "research", passed: true, message: ev })),
    );

    // 4. Risk Engine validation (existing P3 gate)
    const currentPosition = this.executionMode === "TESTNET"
      ? await this.getTestnetCurrentPosition(bestDecision.symbol)
      : this.paperEngine.getPosition();

    const riskResult = this.riskEngine.check(
      aiDecision,
      {
        symbol: bestDecision.symbol,
        timestamp: Date.now(),
        price: bestDecision.entryPrice,
        priceChange24h: 0,
        priceChangePercent24h: 0,
        trend: bestResearch?.trend.direction === "UP" ? "UP" : bestResearch?.trend.direction === "DOWN" ? "DOWN" : "FLAT",
        trendStrength: bestResearch?.trend.strength ?? 0,
        momentum: "MODERATE",
        momentumScore: bestResearch?.momentum.rsi ?? 50,
        volatility: bestResearch?.volatility.atr ?? 0,
        volatilityPercent: bestResearch?.volatility.atrPercent ?? 0,
        volume24h: 0,
        volumeChange: 0,
        marketStructure: "MIXED",
        marketRegime: "UNCERTAIN",
        regimeConfidence: 50,
        liquidity: 50,
        dataQuality: bestResearch?.dataQuality === "GOOD" ? "GOOD" : "DEGRADED",
        feedStatus: "ONLINE",
        lastUpdate: Date.now(),
        dataAge: 0,
      },
      currentPosition
        ? { symbol: currentPosition.symbol, side: currentPosition.side, size: currentPosition.size }
        : { symbol: bestDecision.symbol, side: "FLAT", size: 0 },
    );

    this.state.lastRiskResult = riskResult;
    this.state.riskLocked = this.riskEngine.isSystemLocked();

    aiDecision.riskResult = riskResult.approved ? "APPROVED" : "REJECTED";
    aiDecision.riskReason = riskResult.reason;

    recordRiskCheck(
      bestDecision.symbol,
      bestDecision.direction,
      riskResult.approved,
      riskResult.reason,
      riskResult.checks,
    );

    // 5. Execute if approved
    let testnetResult: TestnetExecutionResult | null = null;

    if (riskResult.approved) {
      if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
        // Use P6 decision parameters (real calculated entry/SL/TP/leverage/margin)
        testnetResult = await this.executeP6Decision(bestDecision, aiDecision);
        if (testnetResult) {
          this.state.lastTestnetResult = testnetResult;
          aiDecision.executionResult = testnetResult.success ? "EXECUTED" : "REJECTED";
          if (!testnetResult.success && testnetResult.error) {
            aiDecision.executionDetails = testnetResult.error;
          }
        }
      }

      if (!testnetResult) {
        aiDecision.executionResult = "SKIPPED";
      }
    } else if (!riskResult.approved) {
      aiDecision.executionResult = "REJECTED";
      aiDecision.executionDetails = riskResult.reason;
      recordTradeRejected(bestDecision.symbol, bestDecision.direction, riskResult.reason, aiDecision.id);
    } else {
      aiDecision.executionResult = "SKIPPED";
      recordTradeProposed(bestDecision.symbol, "NO_TRADE", bestDecision.confidence, "P6" as any, aiDecision.id);
    }

    // 6. Record experience
    await recordTradeExperience(aiDecision, {
      symbol: bestDecision.symbol,
      timestamp: Date.now(),
      price: bestDecision.entryPrice,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      trend: "FLAT",
      trendStrength: 0,
      momentum: "MODERATE",
      momentumScore: 0,
      volatility: 0,
      volatilityPercent: 0,
      volume24h: 0,
      volumeChange: 0,
      marketStructure: "MIXED",
      marketRegime: "UNCERTAIN",
      regimeConfidence: 0,
      liquidity: 0,
      dataQuality: "GOOD",
      feedStatus: "ONLINE",
      lastUpdate: Date.now(),
      dataAge: 0,
    }, null, riskResult);

    this.addActivity(
      `P6 ${bestDecision.direction} ${bestDecision.symbol} ` +
        `(${aiDecision.executionResult}) score=${bestDecision.researchScore.toFixed(0)} ` +
        `margin=$${bestDecision.proposedMargin.toFixed(2)} ${bestDecision.leverage}x`,
    );

    const elapsed = Date.now() - startTime;
    logger.info(
      "p6-cycle",
      `P6 cycle complete: ${bestDecision.direction} ${bestDecision.symbol} ` +
        `(${aiDecision.executionResult}) in ${elapsed}ms`,
    );

    return {
      symbolsScanned: scanResult.symbolsScanned,
      candidatesEvaluated: evaluated,
      decision: bestDecision,
      riskResult,
      testnetResult,
    };
  }

  /**
   * Execute a P6 decision on Binance Testnet.
   * Uses the P6-calculated entry/SL/TP/leverage/margin directly.
   */
  private async executeP6Decision(
    p6Decision: P6Decision,
    aiDecision: AiDecision,
  ): Promise<TestnetExecutionResult | null> {
    if (!this.testnetExecutor || !this.state.testnetReady) return null;

    const quantity = (p6Decision.proposedMargin * p6Decision.leverage) / p6Decision.entryPrice;
    const roundedQty = Math.floor(quantity * 1000) / 1000;

    if (roundedQty <= 0) {
      logger.warn("p6-cycle", "P6 calculated zero quantity — cannot execute");
      return null;
    }

    // Validate through existing P3 risk pipeline
    const proposal: TradeProposal = {
      symbol: p6Decision.symbol,
      side: p6Decision.direction as "LONG" | "SHORT",
      entryPrice: p6Decision.entryPrice,
      quantity: roundedQty,
      leverage: p6Decision.leverage,
      stopLossPrice: p6Decision.stopLoss,
    };

    const proposalResult = this.riskEngine.validateTradeProposal(proposal);
    if (!proposalResult.approved) {
      logger.warn("p6-cycle", `P6 proposal REJECTED: ${proposalResult.reason}`);
      recordTradeRejected(p6Decision.symbol, p6Decision.direction, proposalResult.reason, aiDecision.id);
      return null;
    }

    const quantityResult = this.riskEngine.validateOrderQuantity(
      p6Decision.entryPrice,
      roundedQty,
      p6Decision.leverage,
    );
    if (!quantityResult.valid) {
      logger.warn("p6-cycle", `P6 quantity REJECTED: ${quantityResult.reason}`);
      recordTradeRejected(p6Decision.symbol, p6Decision.direction, quantityResult.reason, aiDecision.id);
      return null;
    }

    recordTradeApproved(p6Decision.symbol, p6Decision.direction, aiDecision.id);

    const result = await this.testnetExecutor.executeTrade({
      direction: p6Decision.direction as "LONG" | "SHORT",
      symbol: p6Decision.symbol,
      quantity: roundedQty,
      price: p6Decision.entryPrice,
      leverage: p6Decision.leverage,
      stopLossPrice: p6Decision.stopLoss,
      takeProfitPrice: p6Decision.takeProfit,
      decisionId: aiDecision.id,
    });

    if (result.success) {
      this.riskEngine.recordPositionOpened(result.actualMargin);
      recordTradeOpened(
        p6Decision.symbol,
        p6Decision.direction as "LONG" | "SHORT",
        result.price,
        result.actualMargin,
        result.actualLeverage,
        `TESTNET-${result.orderId}`,
      );
      recordPositionOpened(
        p6Decision.symbol,
        p6Decision.direction as "LONG" | "SHORT",
        result.actualMargin,
        result.actualLeverage,
      );
    }

    return result;
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
  /**
   * P7C: Get the authoritative connection-state model.
   * Returned to both the dashboard API and getBinanceAccountData.
   */
  getConnectionState(): {
    configured: boolean;
    testnetReady: boolean;
    lastSuccessfulSync: number | null;
    lastSyncAttempt: number | null;
    connectionError: string | null;
    consecutiveSyncFailures: number;
    isStale: boolean;
  } {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — if no sync in 5 min, data is stale
    const lastSync = this.state.lastSuccessfulSync;
    const isStale = lastSync === null || (Date.now() - lastSync) > STALE_THRESHOLD_MS;
    return {
      configured: this.executionMode === "TESTNET" && this.testnetExecutor !== null,
      testnetReady: this.state.testnetReady,
      lastSuccessfulSync: this.state.lastSuccessfulSync,
      lastSyncAttempt: this.state.lastSyncAttempt,
      connectionError: this.state.connectionError,
      consecutiveSyncFailures: this.state.consecutiveSyncFailures,
      isStale,
    };
  }

  async getBinanceAccountData(): Promise<{
    binanceAccount: {
      balance: number;
      availableBalance: number;
      unrealizedPnl: number;
      marginBalance: number;
      /** P7D-3-FIX-REALIZED-PNL-2: Realized PnL from Binance Futures Testnet (GET /fapi/v1/income) */
      realizedPnl: number | null;
      realizedPnlStatus: "SUCCESS" | "ERROR" | "UNAVAILABLE";
    } | null;
    aiAllocation: {
      limit: number;
      /** min(real Futures USDⓈ-M available balance, $10) — 0 when account state is unavailable (fail closed) */
      effectiveAllocation: number;
      allocated: number;
      available: number;
      /** false when Binance account state could not be obtained — allocation is NOT tradeable */
      accountAvailable: boolean;
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
      marginType: "isolated" | "cross" | "unknown";
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
    /** P7C: Connection state — truthful status of Binance Testnet connectivity */
    connectionState: ReturnType<TradingOrchestrator["getConnectionState"]>;
  }> {
    const riskState = this.riskEngine.getDailyStats();
    const hardLimit = this.riskEngine.getAiAllocationLimit();

    // P7A: effective allocation = min(REAL Futures USDⓈ-M available balance, $10).
    // The simulated/sandbox wallet (walletRepository) is NEVER used here — Binance
    // Testnet is the only source of truth for account state.
    let effectiveAllocation = 0;
    let accountAvailable = false;
    let binanceAccount: { balance: number; availableBalance: number; unrealizedPnl: number; marginBalance: number; realizedPnl: number | null; realizedPnlStatus: "SUCCESS" | "ERROR" | "UNAVAILABLE" } | null = null;
    let realizedPnl: number | null = null;
    let realizedPnlStatus: "SUCCESS" | "ERROR" | "UNAVAILABLE" = "UNAVAILABLE";
    let openPositions: Array<{ symbol: string; side: string; size: number; entryPrice: number; markPrice: number; unrealizedPnl: number; leverage: number; margin: number; marginType: "isolated" | "cross" | "unknown" }> = [];

    if (this.executionMode === "TESTNET" && this.testnetExecutor && this.state.testnetReady) {
      try {
        const snapshot = await this.testnetExecutor.getAccountSnapshot();
        binanceAccount = {
          balance: snapshot.balance,
          availableBalance: snapshot.availableBalance,
          unrealizedPnl: snapshot.unrealizedPnl,
          marginBalance: snapshot.marginBalance,
          realizedPnl: null,
          realizedPnlStatus: "UNAVAILABLE" as const,
        };
        openPositions = snapshot.positions;
        effectiveAllocation = computeEffectiveAllocation(snapshot.availableBalance);
        accountAvailable = true;

        // P7D-3-FIX-REALIZED-PNL-2: Fetch realized PnL from Binance Futures Testnet
        // Source of truth: Binance /fapi/v1/income with incomeType=REALIZED_PNL
        // CRITICAL: Distinguishes real zero (SUCCESS+value=0) from error (ERROR+value=null)
        const pnlResult = await this.testnetExecutor.getRealizedPnl();
        realizedPnl = pnlResult.value;
        realizedPnlStatus = pnlResult.status;
        if (binanceAccount) {
          binanceAccount.realizedPnl = pnlResult.value;
          binanceAccount.realizedPnlStatus = pnlResult.status;
        }
      } catch (err) {
        logger.error("orchestrator", `Failed to get Binance account data: ${err}`);
        // P7C: Track sync failure
        this.state.lastSyncAttempt = Date.now();
        this.state.connectionError = err instanceof Error ? err.message : String(err);
        this.state.consecutiveSyncFailures++;
        // binanceAccount stays null → dashboard shows "BINANCE TESTNET OFFLINE"
        // effectiveAllocation stays 0 → fail closed: no capital is presented as available
      }

      // P7C: Track sync success (only if binanceAccount was obtained)
      if (binanceAccount !== null) {
        this.state.lastSuccessfulSync = Date.now();
        this.state.lastSyncAttempt = Date.now();
        this.state.connectionError = null;
        this.state.consecutiveSyncFailures = 0;
      }
    } else {
      // P7C: Not in TESTNET mode — mark sync attempt but not an error
      this.state.lastSyncAttempt = Date.now();
    }

    const allocated = accountAvailable ? this.riskEngine.getOpenPositionMargin() : 0;
    const aiAllocation = {
      limit: hardLimit,
      effectiveAllocation,
      allocated,
      available: computeAllocationRemaining(effectiveAllocation, allocated),
      accountAvailable,
    };

    return {
      binanceAccount: binanceAccount ? { ...binanceAccount } : null,
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
      connectionState: this.getConnectionState(),
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
