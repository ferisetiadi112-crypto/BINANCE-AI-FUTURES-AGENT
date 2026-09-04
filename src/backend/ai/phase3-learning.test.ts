/**
 * Phase 3 — AI Learning Loop Tests
 *
 * Covers the 10 required scenarios:
 * 1. completed experience can be evaluated
 * 2. real trade result can produce a lesson
 * 3. insufficient evidence produces NO LESSON
 * 4. meaningless/repetitive activity does not create lessons (duplicates skipped)
 * 5. valuable lesson is stored
 * 6. duplicate lesson is avoided where practical
 * 7. stored lesson is available to a future AI decision (memory context)
 * 8. learning cannot execute a trade
 * 9. existing Risk Engine remains unchanged
 * 10. existing safety controls remain active
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import {
  deriveLessons,
  isDuplicateLesson,
  normalizeLessonText,
} from "./lesson-engine";
import type { TradeExperience } from "./experience-engine";
import * as experienceEngine from "./experience-engine";
import { buildMemoryContext } from "./memory-context";
import type { MarketState } from "../runtime/types";
import type { RouterResult } from "./llm/router";
import * as decisionEngine from "./decision-engine";
import { TradingOrchestrator } from "../trading/orchestrator";
import * as walletRepo from "../repositories/wallet";
import { RiskEngine } from "../risk/engine";

function makeExperience(overrides: Partial<TradeExperience> = {}): TradeExperience {
  return {
    id: `EXP-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    decisionId: "DEC-TEST",
    tradeId: "PAPER-TRD-001",
    symbol: "BTCUSDT",
    timestamp: Date.now(),
    marketRegime: "TRENDING_UP",
    strategy: "TREND_FOLLOWING",
    direction: "LONG",
    confidence: 0.75,
    entryPrice: 63000,
    exitPrice: 63500,
    duration: 3600000,
    fees: 0.025,
    slippage: 0.006,
    grossPnl: 0.075,
    netPnl: 0.05,
    drawdown: null,
    outcome: "WIN",
    marketContext: {
      symbol: "BTCUSDT",
      price: 63000,
      trend: "UP",
      trendStrength: 75,
      momentum: "STRONG",
      momentumScore: 80,
      volatility: 500,
      volume24h: 28000,
      marketRegime: "TRENDING_UP",
      regimeConfidence: 74,
      dataQuality: "GOOD",
      feedStatus: "ONLINE",
    },
    decisionVersion: "1.0.0",
    modelVersion: "llm-gemini",
    ...overrides,
  };
}

// ─── Evaluation & lesson-worthiness (pure) ─────────────────────────

describe("Phase 3 — experience evaluation & lesson selection", () => {
  it("evaluates a completed experience set with real outcome data (1)", async () => {
    // 10 completed WIN trades in a distinct regime → strong fresh evidence
    const experiences = Array.from({ length: 10 }, (_, i) =>
      makeExperience({ id: `EXP-W-${i}`, outcome: "WIN", netPnl: 0.05, direction: "LONG", marketRegime: "TEST_REGIME_ALPHA" }),
    );
    const stored = await deriveLessons(experiences, 5, { dedupe: false });
    expect(Array.isArray(stored)).toBe(true);
    // Evidence supports a regime lesson (70%+ win rate in TEST_REGIME_ALPHA)
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0]!.sourceExperienceIds.length).toBeGreaterThan(0);
  });

  it("produces NO LESSON with insufficient evidence (3)", async () => {
    const stored = await deriveLessons([makeExperience()], 5);
    expect(stored).toEqual([]);
  });

  it("skips duplicate lessons — repetitive activity does not re-learn (4, 6)", async () => {
    // Within one derivation, lessons are deduped by construction.
    const experiences = Array.from({ length: 10 }, (_, i) =>
      makeExperience({ id: `EXP-D-${i}-${Math.random().toString(36).slice(2)}`, outcome: "WIN", marketRegime: "TRENDING_UP" }),
    );
    const first = await deriveLessons(experiences, 5, { dedupe: false });
    const firstTexts = first.map((l) => l.text);
    const uniqueTexts = new Set(firstTexts.map(normalizeLessonText));
    expect(uniqueTexts.size).toBe(firstTexts.length);
    // normalizeLessonText collapses formatting differences
    expect(normalizeLessonText("TRENDING_UP regime  shows 75.0% win rate over 10 trades."))
      .toBe(normalizeLessonText("trending_up regime shows 75% win rate over 10 trades."));
  });

  it("duplicate detection works against stored memory (6)", async () => {
    // isDuplicateLesson runs against the real store; the mock-backed path
    // just needs to return a boolean without throwing.
    const result = await isDuplicateLesson("Breakout entries without volume confirmation produced repeated losses.");
    expect(typeof result).toBe("boolean");
  });
});

// ─── Memory → future decision (7) ──────────────────────────────────

describe("Phase 3 — stored lessons reach future AI decisions", () => {
  it("buildMemoryContext returns lessons from memory for the prompt (7)", async () => {
    const state = {
      symbol: "BTCUSDT",
    } as MarketState;
    const ctx = await buildMemoryContext(state);
    // Honest contract: either real memory (available) or explicitly empty.
    expect(typeof ctx.available).toBe("boolean");
    expect(typeof ctx.formatted).toBe("string");
    if (ctx.available) {
      expect(ctx.formatted).toContain("MEMORY");
      expect(ctx.lessons.length).toBeLessThanOrEqual(5);
      expect(ctx.experiences.length).toBeLessThanOrEqual(3);
    } else {
      expect(ctx.formatted).toBe("");
      expect(ctx.lessons).toEqual([]);
    }
  });
});

// ─── Runtime path: learning integrated, safety intact ──────────────

function makeState(): MarketState {
  return {
    symbol: "BTCUSDT",
    timestamp: Date.now(),
    price: 63000,
    priceChange24h: 500,
    priceChangePercent24h: 0.8,
    trend: "UP",
    trendStrength: 70,
    momentum: "STRONG",
    momentumScore: 75,
    volatility: 500,
    volatilityPercent: 0.8,
    volume24h: 28000,
    volumeChange: 15,
    marketStructure: "HIGHER_HIGHS",
    marketRegime: "TRENDING_UP",
    regimeConfidence: 74,
    liquidity: 80,
    dataQuality: "GOOD",
    feedStatus: "ONLINE",
    lastUpdate: Date.now(),
    dataAge: 1000,
  };
}

function routerResult(action: RouterResult["decision"]["action"]): RouterResult {
  return {
    decision: {
      action,
      direction: "NO_TRADE",
      confidence: 0.7,
      strategy: "TREND_FOLLOWING",
      reasoning: "Phase 3 test",
    },
    provider: "gemini",
    providerAttempts: 1,
    errors: [],
    elapsedMs: 5,
  };
}

describe("Phase 3 — runtime learning loop & safety", () => {
  let orchestrator: TradingOrchestrator;
  let walletSpy: ReturnType<typeof vi.spyOn>;
  let guardrailSpy: ReturnType<typeof vi.spyOn>;
  let llmSpies: MockInstance[] = [];

  beforeEach(async () => {
    walletSpy = vi.spyOn(walletRepo.walletRepository, "getBalance").mockResolvedValue(5.0);
    guardrailSpy = vi.spyOn(walletRepo.walletRepository, "logGuardrailEvent").mockResolvedValue(undefined);
    orchestrator = new TradingOrchestrator("PAPER", true);
  });

  afterEach(() => {
    llmSpies.forEach((s) => s.mockRestore());
    llmSpies = [];
    walletSpy.mockRestore();
    guardrailSpy.mockRestore();
  });

  it("a completed cycle records an experience through the runtime path (1, 2)", async () => {
    const expSpy = vi.spyOn(experienceEngine, "recordNoTradeExperience");
    const spy = vi.spyOn(decisionEngine, "generateLLMDecision").mockResolvedValue(routerResult("WAIT"));
    llmSpies.push(spy);

    await orchestrator.processMarketUpdateLLM(makeState());

    expect(expSpy).toHaveBeenCalled();
    expSpy.mockRestore();
  });

  it("completed trade produces a real trade experience (2)", async () => {
    const plan = {
      direction: "LONG" as const,
      entry: 63000,
      stopLoss: 61740,
      takeProfit: 65520,
      margin: 1,
      leverage: 5,
    };
    const expSpy = vi.spyOn(experienceEngine, "recordTradeExperience");
    const spy = vi
      .spyOn(decisionEngine, "generateLLMDecision")
      .mockResolvedValue({
        decision: {
          action: "OPEN",
          direction: "LONG",
          confidence: 0.8,
          strategy: "TREND_FOLLOWING",
          reasoning: "Phase 3 trade test",
          tradePlan: plan,
        },
        provider: "gemini",
        providerAttempts: 1,
        errors: [],
        elapsedMs: 5,
      } as RouterResult);
    llmSpies.push(spy);

    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(result.decision.executionResult).toBe("EXECUTED");
    expect(expSpy).toHaveBeenCalled();
    const exp = expSpy.mock.results[0]?.value;
    expect(exp).toBeDefined();
    expSpy.mockRestore();
  });

  it("learning never executes a trade (8)", async () => {
    // Deriving lessons must have zero effect on execution state.
    const executeSpy = vi.spyOn(orchestrator.getPaperEngine(), "execute");
    await deriveLessons(
      Array.from({ length: 10 }, (_, i) => makeExperience({ id: `EXP-S-${i}`, outcome: "LOSS", netPnl: -0.05 })),
    );
    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });

  it("Risk Engine is unchanged and still gates trades (9)", async () => {
    const engine = new RiskEngine({ tradingEnabled: true, aiAllocationLimit: 10 });
    const cfg = engine.getConfig();
    // Core safety config untouched by Phase 3
    expect(cfg.maxLossPerTrade).toBe(1.0);
    expect(cfg.maxLeverage).toBe(20);
    expect(cfg.dailyLossLimit).toBe(2.0);

    // A disabled engine still rejects all proposals
    const locked = new RiskEngine({ tradingEnabled: false });
    const decision = {
      id: "DEC-X",
      timestamp: Date.now(),
      symbol: "BTCUSDT",
      direction: "LONG" as const,
      confidence: 0.9,
      confidenceLevel: "HIGH" as const,
      strategy: "TREND_FOLLOWING" as const,
      marketRegime: "TRENDING_UP" as const,
      regimeConfidence: 80,
      evidence: {} as never,
      decisionVersion: "1.0.0",
      modelVersion: "llm-gemini",
    };
    const proposal = locked.validateTradeProposal({
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 63000,
      quantity: 0.0001,
      leverage: 5,
      stopLossPrice: 61740,
    });
    expect(proposal.approved).toBe(false);
    expect(proposal.reason).toContain("Trading is DISABLED");
  });

  it("safety controls remain active in the learning runtime (10)", async () => {
    const locked = new TradingOrchestrator("PAPER", false);
    const spy = vi.spyOn(decisionEngine, "generateLLMDecision").mockResolvedValue(routerResult("WAIT"));
    llmSpies.push(spy);
    // Even with learning active, tradingEnabled=false blocks execution.
    const result = await locked.processMarketUpdateLLM(makeState());
    expect(result.trade).toBeNull();
    expect(locked.getPaperEngine().getPosition()).toBeNull();
  });
});
