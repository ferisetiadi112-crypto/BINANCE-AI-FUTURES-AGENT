/**
 * Phase 2 — AI Decision & Trade Planning Tests
 *
 * Covers the 12 required scenarios:
 * 1. RESEARCH_MORE   2. WAIT   3. OPEN (valid plan executes)   4. HOLD
 * 5. CLOSE           6. valid trade plan   7. invalid trade plan blocked
 * 8. AI proposal rejected by Risk Engine   9. HOLD/CLOSE without position
 * 10. OPEN duplicate blocked   11. LLM failure stays safe
 * 12. safety controls remain active (tradingEnabled)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateAIAction, validateAITradePlan, type PositionInfo } from "../ai/decision-engine";
import type { MarketState } from "../runtime/types";
import type { MockInstance } from "vitest";
import type { AITradePlan } from "../ai/llm/types";
import type { RouterResult } from "../ai/llm/router";
import * as decisionEngine from "../ai/decision-engine";
import { TradingOrchestrator } from "./orchestrator";
import * as walletRepo from "../repositories/wallet";

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

const validPlan: AITradePlan = {
  direction: "LONG",
  entry: 63000,
  stopLoss: 61740,
  takeProfit: 65520,
  margin: 1,
  leverage: 5,
};

function routerResult(decision: {
  action: RouterResult["decision"]["action"];
  direction?: RouterResult["decision"]["direction"];
  confidence?: number;
  reasoning?: string;
  tradePlan?: AITradePlan;
}): RouterResult {
  return {
    decision: {
      action: decision.action,
      direction: decision.direction ?? "NO_TRADE",
      confidence: decision.confidence ?? 0.7,
      strategy: "TREND_FOLLOWING",
      reasoning: decision.reasoning ?? "Phase 2 test",
      ...(decision.tradePlan ? { tradePlan: decision.tradePlan } : {}),
    },
    provider: "gemini",
    providerAttempts: 1,
    errors: [],
    elapsedMs: 5,
  };
}

// ─── Pure validators ────────────────────────────────────────────────

describe("Phase 2 — validateAIAction (position awareness)", () => {
  const flat: PositionInfo = { hasPosition: false, symbol: null, side: null, size: 0 };
  const long: PositionInfo = { hasPosition: true, symbol: "BTCUSDT", side: "LONG", size: 0.079 };

  it("RESEARCH_MORE is allowed flat and with position", () => {
    expect(validateAIAction("RESEARCH_MORE", flat)).toBeNull();
    expect(validateAIAction("RESEARCH_MORE", long)).toBeNull();
  });

  it("WAIT is allowed flat and with position", () => {
    expect(validateAIAction("WAIT", flat)).toBeNull();
    expect(validateAIAction("WAIT", long)).toBeNull();
  });

  it("OPEN is allowed only without a position", () => {
    expect(validateAIAction("OPEN", flat)).toBeNull();
    expect(validateAIAction("OPEN", long)).toContain("duplicate position not allowed");
  });

  it("HOLD/CLOSE are rejected without a position (9)", () => {
    expect(validateAIAction("HOLD", flat)).toContain("no position is open");
    expect(validateAIAction("CLOSE", flat)).toContain("no position is open");
  });

  it("HOLD/CLOSE are allowed with a position", () => {
    expect(validateAIAction("HOLD", long)).toBeNull();
    expect(validateAIAction("CLOSE", long)).toBeNull();
  });
});

describe("Phase 2 — validateAITradePlan (structural plan checks)", () => {
  it("accepts a structurally valid plan (6)", () => {
    expect(validateAITradePlan(validPlan, 63000)).toBeNull();
  });

  it("rejects OPEN without a plan (7)", () => {
    expect(validateAITradePlan(undefined, 63000)).toContain("missing a trade plan");
  });

  it("rejects LONG plan with stop-loss above entry", () => {
    expect(validateAITradePlan({ ...validPlan, stopLoss: 65000 }, 63000)).toContain(
      "stop-loss must be below entry",
    );
  });

  it("rejects SHORT plan with take-profit above entry", () => {
    // Valid SHORT SL (above entry) so the TP check is what fires.
    expect(validateAITradePlan({ ...validPlan, direction: "SHORT", stopLoss: 64500, takeProfit: 65000 }, 63000)).toContain(
      "take-profit must be below entry",
    );
  });

  it("rejects leverage outside 1-20", () => {
    expect(validateAITradePlan({ ...validPlan, leverage: 25 }, 63000)).toContain("leverage must be 1-20");
  });

  it("rejects impossible entry far from market price", () => {
    // Fix TP/SL coherence relative to the new entry so the deviation check is what fires.
    expect(validateAITradePlan({ ...validPlan, entry: 70000, stopLoss: 68600, takeProfit: 72800 }, 63000)).toContain("deviates");
  });
});

// ─── Orchestrator pipeline (runtime path) ───────────────────────────

describe("Phase 2 — orchestrator action pipeline", () => {
  let orchestrator: TradingOrchestrator;
  let walletSpy: ReturnType<typeof vi.spyOn>;
  let guardrailSpy: ReturnType<typeof vi.spyOn>;
  let llmSpies: MockInstance[] = [];

  function mockLLM(result: RouterResult) {
    const spy = vi
      .spyOn(decisionEngine, "generateLLMDecision")
      .mockResolvedValue(result);
    llmSpies.push(spy);
    return spy;
  }

  beforeEach(async () => {
    walletSpy = vi.spyOn(walletRepo.walletRepository, "getBalance").mockResolvedValue(5.0);
    guardrailSpy = vi.spyOn(walletRepo.walletRepository, "logGuardrailEvent").mockResolvedValue(undefined);
    orchestrator = new TradingOrchestrator("PAPER", true);
  });

  afterEach(() => {
    llmSpies.forEach(s => s.mockRestore());
    llmSpies = [];
    walletSpy.mockRestore();
    guardrailSpy.mockRestore();
  });

  it("RESEARCH_MORE produces no trade (1)", async () => {
    const spy = mockLLM(routerResult({ action: "RESEARCH_MORE", reasoning: "Data insufficient" }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(spy).toHaveBeenCalled();
    expect(result.decision.action).toBe("RESEARCH_MORE");
    expect(result.decision.direction).toBe("NO_TRADE");
    expect(result.trade).toBeNull();
  });

  it("WAIT produces no trade (2)", async () => {
    mockLLM(routerResult({ action: "WAIT", reasoning: "Not attractive" }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(result.decision.action).toBe("WAIT");
    expect(result.trade).toBeNull();
  });

  it("OPEN with a valid plan executes via the plan path (3, 6)", async () => {
    mockLLM(routerResult({ action: "OPEN", direction: "LONG", confidence: 0.8, tradePlan: validPlan }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(result.decision.direction).toBe("LONG");
    expect(result.decision.tradePlan).toBeDefined();
    expect(result.decision.executionResult).toBe("EXECUTED");
    const pos = orchestrator.getPaperEngine().getPosition();
    expect(pos).not.toBeNull();
    expect(pos!.side).toBe("LONG");
  });

  it("CLOSE with an open position closes it (5)", async () => {
    mockLLM(routerResult({ action: "OPEN", direction: "LONG", confidence: 0.8, tradePlan: validPlan }));
    await orchestrator.processMarketUpdateLLM(makeState());
    expect(orchestrator.getPaperEngine().getPosition()).not.toBeNull();

    mockLLM(routerResult({ action: "CLOSE", direction: "LONG", reasoning: "Momentum reversed" }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(result.decision.action).toBe("CLOSE");
    expect(result.decision.executionResult).toBe("EXECUTED");
    expect(orchestrator.getPaperEngine().getPosition()).toBeNull();
  });

  it("HOLD with an open position does not trade (4)", async () => {
    mockLLM(routerResult({ action: "OPEN", direction: "LONG", confidence: 0.8, tradePlan: validPlan }));
    await orchestrator.processMarketUpdateLLM(makeState());

    mockLLM(routerResult({ action: "HOLD", reasoning: "Keep position" }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(result.decision.action).toBe("HOLD");
    expect(result.trade).toBeNull();
    expect(orchestrator.getPaperEngine().getPosition()).not.toBeNull();
  });

  it("OPEN with an existing position is downgraded to WAIT honestly (10)", async () => {
    mockLLM(routerResult({ action: "OPEN", direction: "LONG", confidence: 0.8, tradePlan: validPlan }));
    await orchestrator.processMarketUpdateLLM(makeState());
    const sizeBefore = orchestrator.getPaperEngine().getPosition()!.size;

    const spy = mockLLM(routerResult({ action: "OPEN", direction: "LONG", confidence: 0.9, tradePlan: validPlan }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(spy).toHaveBeenCalled();
    expect(result.decision.action).toBe("WAIT");
    expect(result.decision.executionDetails).toContain("AI_PLAN_BLOCKED");
    expect(result.decision.executionDetails).toContain("duplicate");
    expect(orchestrator.getPaperEngine().getPosition()!.size).toBe(sizeBefore);
  });

  it("HOLD without a position is downgraded to WAIT honestly (9)", async () => {
    const spy = mockLLM(routerResult({ action: "HOLD", reasoning: "should be blocked" }));
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(spy).toHaveBeenCalled();
    expect(result.decision.action).toBe("WAIT");
    expect(result.decision.executionDetails).toContain("AI_ACTION_INVALID");
    expect(result.trade).toBeNull();
  });

  it("invalid trade plan is blocked honestly (7)", async () => {
    const spy = mockLLM(
      routerResult({
        action: "OPEN",
        direction: "LONG",
        tradePlan: { ...validPlan, stopLoss: 65000 }, // SL above entry for LONG — invalid
      }),
    );
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(spy).toHaveBeenCalled();
    expect(result.decision.action).toBe("WAIT");
    expect(result.decision.executionDetails).toContain("AI_PLAN_BLOCKED");
    expect(result.trade).toBeNull();
  });

  it("LLM failure remains safe — WAIT, no trade (11)", async () => {
    const spy = vi.spyOn(decisionEngine, "generateLLMDecision").mockRejectedValue(new Error("providers down"));
    llmSpies.push(spy);
    const result = await orchestrator.processMarketUpdateLLM(makeState());
    expect(result.decision.direction).toBe("NO_TRADE");
    expect(result.decision.executionDetails).toContain("AI_SAFE_FALLBACK");
    expect(result.trade).toBeNull();
  });

  it("Risk Engine remains the final authority on AI plans (8, 12)", async () => {
    // tradingEnabled=false → Risk Engine blocks execution of the AI plan
    const locked = new TradingOrchestrator("PAPER", false);
    const spy = mockLLM(routerResult({ action: "OPEN", direction: "LONG", confidence: 0.9, tradePlan: validPlan }));
    const result = await locked.processMarketUpdateLLM(makeState());
    expect(spy).toHaveBeenCalled();
    expect(result.decision.action).toBe("OPEN");
    // Plan passes the initial check() but is REJECTED by the Risk Engine's
    // validateTradeProposal kill-switch during execution — no trade happens.
    expect(result.trade).toBeNull();
    expect(result.decision.executionResult).toBe("REJECTED");
    expect(result.decision.riskReason).toContain("Trading is DISABLED");
  });
});
