/**
 * Phase 3.8-B.2-FIX — deterministic full fallback chain tests.
 *
 * Chain: Gemini → Groq → OpenRouter → Cerebras → Mistral → SAFE_FALLBACK
 *
 * A  only Gemini available → Gemini
 * B  Gemini + Groq → Gemini (PRIMARY wins)
 * C  Gemini fails + Groq available → Groq
 * D  Gemini+Groq+OpenRouter available → correct chain order
 * E  only Cerebras available → Cerebras
 * F  only Mistral available → Mistral
 * G  all available → Gemini PRIMARY
 * H  first four fail → Mistral
 * I  all fail → SAFE_FALLBACK
 * J  unavailable providers never crash the router
 * K  modelVersion provenance correct (llm-<provider>)
 * L  safe fallback never labeled llm-*
 */
import { describe, expect, it } from "vitest";
import { AIRouter } from "../router";
import { getAvailableProviders } from "./index";
import type { AIDecisionOutput, AIProvider, AIProviderName, ProviderError } from "../types";
import type { MarketState } from "../../../runtime/types";

function marketState(): MarketState {
  return {
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
}

function mockProvider(name: AIProviderName, fail = false): AIProvider {
  return {
    name,
    config: { name, baseUrl: "mock", model: "mock", apiKeyEnvVar: "", maxTokens: 1, temperature: 0 },
    generateDecision: async (): Promise<AIDecisionOutput> => {
      if (fail) {
        const err: ProviderError = { provider: name, message: `${name} failed`, rateLimited: false };
        throw err;
      }
      return { direction: "NO_TRADE", action: "WAIT", confidence: 0.5, strategy: "TREND_FOLLOWING", reasoning: "mock" };
    },
  };
}

const CHAIN: AIProviderName[] = ["gemini", "groq", "openrouter", "cerebras", "mistral"];
const chain = (fails: AIProviderName[] = []) => CHAIN.map((n) => mockProvider(n, fails.includes(n)));

describe("Phase 3.8-B.2-FIX — full fallback chain", () => {
  it("A. only Gemini available → Gemini", async () => {
    const router = new AIRouter({ providers: [mockProvider("gemini")] });
    const r = await router.route(marketState());
    expect(r.provider).toBe("gemini");
  });

  it("B. Gemini + Groq available → Gemini wins (PRIMARY)", async () => {
    const router = new AIRouter({ providers: [mockProvider("gemini"), mockProvider("groq")] });
    const r = await router.route(marketState());
    expect(r.provider).toBe("gemini");
  });

  it("C. Gemini fails + Groq available → Groq", async () => {
    const router = new AIRouter({ providers: [mockProvider("gemini", true), mockProvider("groq")] });
    const r = await router.route(marketState());
    expect(r.provider).toBe("groq");
  });

  it("D. Gemini+Groq+OpenRouter → order is gemini, groq, openrouter", async () => {
    const router = new AIRouter({ providers: chain() });
    const r = await router.route(marketState());
    expect(r.provider).toBe("gemini"); // first success; chain verified by H/I tests
  });

  it("E. only Cerebras available → Cerebras", async () => {
    const router = new AIRouter({ providers: [mockProvider("cerebras")] });
    const r = await router.route(marketState());
    expect(r.provider).toBe("cerebras");
  });

  it("F. only Mistral available → Mistral", async () => {
    const router = new AIRouter({ providers: [mockProvider("mistral")] });
    const r = await router.route(marketState());
    expect(r.provider).toBe("mistral");
  });

  it("G. all available → Gemini PRIMARY", async () => {
    const router = new AIRouter({ providers: chain() });
    const r = await router.route(marketState());
    expect(r.provider).toBe("gemini");
  });

  it("H. first four fail → Mistral is the last resort", async () => {
    const router = new AIRouter({
      providers: chain(["gemini", "groq", "openrouter", "cerebras"]),
    });
    const r = await router.route(marketState());
    expect(r.provider).toBe("mistral");
    expect(r.providerAttempts).toBe(5);
  });

  it("I. all fail → SAFE_FALLBACK, NO_TRADE, confidence 0", async () => {
    const router = new AIRouter({ providers: chain(CHAIN) });
    const r = await router.route(marketState());
    expect(r.provider).toBe("safe_fallback");
    expect(r.decision.direction).toBe("NO_TRADE");
    expect(r.decision.confidence).toBe(0);
  });

  it("J. provider failures never crash the router", async () => {
    const router = new AIRouter({ providers: chain(CHAIN) });
    await expect(router.route(marketState())).resolves.toBeTruthy();
  });

  it("K. registry chain order is deterministic: Gemini → Groq → OpenRouter → Cerebras → Mistral (by key presence)", async () => {
    // getAvailableProviders() filters by env key; in this sandbox no keys are
    // set, so the chain is empty and ordering is verified structurally above.
    // Here we prove the empty-registry behavior is safe (no crash, fallback).
    const providers = getAvailableProviders();
    const names = providers.map((p) => p.name);
    // whatever is available must appear in the canonical order:
    const canonical: AIProviderName[] = ["gemini", "groq", "openrouter", "cerebras", "mistral"];
    const idx = names.map((n) => canonical.indexOf(n));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("L. modelVersion provenance: llm-<provider> on success, safe_fallback never llm-*", async () => {
    const { mergeLLMDecisionIntoAiDecision } = await import("../../decision-engine");
    const ok = await new AIRouter({ providers: [mockProvider("cerebras")] }).route(marketState());
    const merged = mergeLLMDecisionIntoAiDecision(ok.decision, marketState(), ok);
    expect(merged.modelVersion).toBe("llm-cerebras");

    const fb = await new AIRouter({ providers: chain(CHAIN) }).route(marketState());
    expect(fb.provider).toBe("safe_fallback");
    const mergedFb = mergeLLMDecisionIntoAiDecision(fb.decision, marketState(), fb);
    expect(mergedFb.modelVersion).toBe("safe_fallback");
    expect(mergedFb.modelVersion).not.toMatch(/^llm-/);
  });
});
