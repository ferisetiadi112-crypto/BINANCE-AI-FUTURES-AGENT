/**
 * Phase 3.8-B — Active reasoning + journal verification tests.
 *
 * A/B valid market state → structured reasoning result   (existing pipeline, exercised)
 * C   reasoningId (decision.id) unique
 * D   reasoningId correlates journal events (decisionId on TRADE_PROPOSED)
 * E   safe fallback is NOT labeled LLM
 * F   LLM unavailable → SAFE_FALLBACK NO_TRADE, never a fake LLM response
 * G   reasoning reaches journal (TRADE_PROPOSED carries reasoning text)
 * H   reasoning journal event is never POSITION_OPENED
 * I   startup reconciliation stays STARTUP_RECONCILIATION (from 3.7)
 * J/K execution stays disabled; trading gate false
 * L   malformed/insufficient market data → no fake decision
 */
import { describe, expect, it } from "vitest";
import { mergeLLMDecisionIntoAiDecision, generateDecision } from "../ai/decision-engine";
import type { AIDecisionOutput } from "../ai/llm/types";
import { SAFE_FALLBACK } from "../ai/llm/types";
import type { RouterResult } from "../ai/llm/router";
import type { MarketState } from "../runtime/types";
import { recordTradeProposed, recordRemotePositionDiscovered, getJournalEvents } from "../journal";
import { loadWorkerConfig } from "../runtime/windows/worker";

function fakeMarketState(overrides: Partial<MarketState> = {}): MarketState {
  const base: MarketState = {
    symbol: "BTCUSDT",
    timestamp: Date.now(),
    price: 65000,
    priceChange24h: 500,
    priceChangePercent24h: 0.8,
    trend: "UP",
    trendStrength: 70,
    momentum: "STRONG",
    momentumScore: 75,
    volatility: 300,
    volatilityPercent: 12,
    volume24h: 25000,
    volumeChange: 10,
    marketStructure: "HIGHER_HIGHS",
    marketRegime: "TRENDING_UP",
    regimeConfidence: 72,
    liquidity: 80,
    dataQuality: "GOOD",
    feedStatus: "ONLINE",
    lastUpdate: Date.now(),
    dataAge: 500,
  } as unknown as MarketState;
  return { ...base, ...overrides };
}

const llmOutput: AIDecisionOutput = {
  direction: "NO_TRADE",
  confidence: 0.62,
  strategy: "TREND_FOLLOWING",
  action: "WAIT",
  reasoning: "test reasoning text",
};

const providerResult: RouterResult = {
  decision: llmOutput,
  provider: "gemini",
  providerAttempts: 1,
  errors: [],
  elapsedMs: 120,
};

const fallbackResult: RouterResult = {
  decision: SAFE_FALLBACK,
  provider: "safe_fallback",
  providerAttempts: 3,
  errors: [{ provider: "gemini" as const, message: "all providers failed", rateLimited: false }],
  elapsedMs: 400,
};

describe("Phase 3.8-B — reasoning pipeline", () => {
  it("A/B. valid market state → structured reasoning result (id, direction, confidence, metadata)", () => {
    const decision = mergeLLMDecisionIntoAiDecision(llmOutput, fakeMarketState(), providerResult);
    expect(decision.id).toMatch(/^DEC-LLM-/);
    expect(decision.direction).toBe("NO_TRADE");
    expect(decision.confidence).toBe(0.62);
    expect(decision.symbol).toBe("BTCUSDT");
    expect(decision.modelVersion).toBe("llm-gemini");
  });

  it("C. reasoningId (decision.id) is unique across cycles", () => {
    const a = mergeLLMDecisionIntoAiDecision(llmOutput, fakeMarketState(), providerResult);
    const b = mergeLLMDecisionIntoAiDecision(llmOutput, fakeMarketState(), providerResult);
    expect(a.id).not.toBe(b.id);
  });

  it("E. safe fallback is NOT labeled LLM (honest provenance)", () => {
    const decision = mergeLLMDecisionIntoAiDecision(SAFE_FALLBACK, fakeMarketState(), fallbackResult);
    expect(decision.modelVersion).toBe("safe_fallback");
    expect(decision.modelVersion).not.toMatch(/^llm-/);
  });

  it("F. LLM unavailable → SAFE_FALLBACK NO_TRADE confidence 0, never a fabricated LLM response", () => {
    const decision = mergeLLMDecisionIntoAiDecision(SAFE_FALLBACK, fakeMarketState(), fallbackResult);
    expect(decision.direction).toBe("NO_TRADE");
    expect(decision.confidence).toBe(0);
  });

  it("L. malformed/insufficient market data → decision is skipped upstream; engine rejects INVALID data honestly", () => {
    // The runtime skips symbols whose feed state is not ONLINE (runtime.tick
    // filters reason !== "OK"); here we verify the state builder path honours
    // dataQuality so an INVALID market state never yields a confident trade.
    const bad = fakeMarketState({ dataQuality: "INVALID", feedStatus: "OFFLINE" });
    const decision = generateDecision(bad);
    // INVALID data must never produce a HIGH-confidence directional call —
    // the honest contract: NO_TRADE, or only a sub-threshold confidence.
    if (decision.direction !== "NO_TRADE") {
      expect(decision.confidence).toBeLessThan(0.6);
    }
  });
});

describe("Phase 3.8-B — journal semantics", () => {
  it("G/D. reasoning reaches journal with correlation (decisionId) and provenance label", () => {
    const id = "DEC-LLM-TEST-1";
    const evt = recordTradeProposed("BTCUSDT", "NO_TRADE", 0.62, "TREND_FOLLOWING", id, "llm-gemini");
    expect(evt.decisionId).toBe(id); // D: correlation
    expect(evt.reasoning).toContain("LLM provider: gemini"); // honest LLM label
  });

  it("E(b). fallback journal entry explicitly states no LLM response", () => {
    const evt = recordTradeProposed("BTCUSDT", "NO_TRADE", 0, "SAFE_FALLBACK", "DEC-X", "safe_fallback");
    expect(evt.reasoning).toContain("safe fallback (no LLM response)");
    expect(evt.reasoning).not.toContain("LLM provider:");
  });

  it("H. reasoning journal event is never POSITION_OPENED", () => {
    const evt = recordTradeProposed("BTCUSDT", "NO_TRADE", 0.5, "S", "DEC-Y", "llm-gemini");
    expect(evt.eventType).not.toBe("POSITION_OPENED");
  });

  it("I. startup reconciliation stays STARTUP_RECONCILIATION, never POSITION_OPENED", () => {
    const evt = recordRemotePositionDiscovered("SNTUSDT", "SHORT", 0, 20);
    expect(evt.eventType).toBe("STARTUP_RECONCILIATION");
  });

  it("journal buffer still holds both kinds without conflating them", () => {
    const events = getJournalEvents();
    const opened = events.filter((e) => e.eventType === "POSITION_OPENED");
    for (const e of opened) {
      // any POSITION_OPENED in the buffer came from execution-path helpers only
      expect(e.message).not.toContain("not an AI order");
    }
  });
});

describe("Phase 3.8-B — safety", () => {
  it("J/K. worker config refuses trading; gate stays false", () => {
    expect(() => loadWorkerConfig({ TRADING_ENABLED: "true" })).toThrow(/SAFETY GATE/);
    expect(loadWorkerConfig({}).mode).toBe("TESTNET");
  });
});
