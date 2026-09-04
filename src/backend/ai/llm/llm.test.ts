import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIDecisionSchema, SAFE_FALLBACK, type AIDecisionOutput, type AIProvider, type ProviderError } from "./types";
import { buildTradingPrompt } from "./prompt";
import { AIRouter } from "./router";
import type { MarketState } from "../../runtime/types";

// ─── Mock Market State ────────────────────────────────────────────────

const mockMarketState: MarketState = {
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

// ─── Helper: create mock provider ────────────────────────────────────

function createMockProvider(
  name: "groq" | "cerebras" | "gemini" | "mistral" | "openrouter",
  opts?: {
    decision?: AIDecisionOutput;
    error?: ProviderError;
  },
): AIProvider {
  return {
    name,
    config: {
      name,
      baseUrl: "https://mock.api.com",
      model: "mock-model",
      apiKeyEnvVar: `MOCK_${name.toUpperCase()}_KEY`,
    },
    generateDecision: opts?.error
      ? vi.fn().mockRejectedValue(opts.error)
      : vi.fn().mockResolvedValue(opts?.decision ?? {
          action: "WAIT" as const,
          direction: "LONG" as const,
          confidence: 0.72,
          strategy: "MOMENTUM" as const,
          reasoning: "Strong momentum with trend alignment",
        }),
  } satisfies AIProvider;
}

// ─── Zod Schema Validation Tests ─────────────────────────────────────

describe("AIDecisionSchema", () => {
  it("accepts valid LONG decision", () => {
    const valid: AIDecisionOutput = {
      action: "WAIT",
      direction: "LONG",
      confidence: 0.75,
      strategy: "TREND_FOLLOWING",
      reasoning: "Strong uptrend with momentum confirmation",
    };
    const result = AIDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts valid SHORT decision", () => {
    const valid: AIDecisionOutput = {
      action: "WAIT",
      direction: "SHORT",
      confidence: 0.6,
      strategy: "MOMENTUM",
      reasoning: "Bearish momentum divergence detected",
    };
    const result = AIDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts valid NO_TRADE decision", () => {
    const valid: AIDecisionOutput = {
      action: "WAIT",
      direction: "NO_TRADE",
      confidence: 0.3,
      strategy: "BREAKOUT",
      reasoning: "Insufficient signal clarity",
    };
    const result = AIDecisionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid direction", () => {
    const invalid = {
      direction: "BUY",
      confidence: 0.75,
      strategy: "TREND_FOLLOWING",
      reasoning: "test",
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects confidence below 0", () => {
    const invalid: AIDecisionOutput = {
      action: "WAIT",
      direction: "LONG",
      confidence: -0.1,
      strategy: "TREND_FOLLOWING",
      reasoning: "test",
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const invalid: AIDecisionOutput = {
      action: "WAIT",
      direction: "LONG",
      confidence: 1.5,
      strategy: "TREND_FOLLOWING",
      reasoning: "test",
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const invalid = {
      direction: "LONG",
      // missing confidence, strategy, reasoning
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects empty reasoning", () => {
    const invalid: AIDecisionOutput = {
      action: "WAIT",
      direction: "LONG",
      confidence: 0.75,
      strategy: "TREND_FOLLOWING",
      reasoning: "",
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid strategy", () => {
    const invalid = {
      direction: "LONG",
      confidence: 0.75,
      strategy: "SCALPING",
      reasoning: "test",
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects completely malformed JSON-like object", () => {
    const invalid = {
      foo: "bar",
      baz: 42,
    };
    const result = AIDecisionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts boundary confidence values (0 and 1)", () => {
    const atZero = AIDecisionSchema.safeParse({
      direction: "NO_TRADE",
      confidence: 0,
      strategy: "TREND_FOLLOWING",
      reasoning: "No confidence",
    });
    expect(atZero.success).toBe(true);

    const atOne = AIDecisionSchema.safeParse({
      direction: "LONG",
      confidence: 1,
      strategy: "MOMENTUM",
      reasoning: "Max confidence",
    });
    expect(atOne.success).toBe(true);
  });
});

// ─── Safe Fallback Tests ─────────────────────────────────────────────

describe("SAFE_FALLBACK", () => {
  it("defaults to NO_TRADE with confidence 0", () => {
    expect(SAFE_FALLBACK.direction).toBe("NO_TRADE");
    expect(SAFE_FALLBACK.confidence).toBe(0);
    expect(SAFE_FALLBACK.reasoning).toBeTruthy();
  });

  it("passes Zod validation", () => {
    const result = AIDecisionSchema.safeParse(SAFE_FALLBACK);
    expect(result.success).toBe(true);
  });
});

// ─── Prompt Builder Tests ─────────────────────────────────────────────

describe("buildTradingPrompt", () => {
  it("returns system and user prompt pair", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.system).toBeTruthy();
    expect(prompt.user).toBeTruthy();
  });

  it("includes symbol in user prompt", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.user).toContain("BTCUSDT");
  });

  it("includes price data", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.user).toContain("$63000");
  });

  it("includes capital constraint in system prompt", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.system).toContain("$5");
  });

  it("includes daily guardrail in system prompt", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.system).toContain("±$0.50");
  });

  it("requests JSON output format", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.user).toContain("JSON");
    expect(prompt.user).toContain("direction");
    expect(prompt.user).toContain("confidence");
  });

  it("includes market indicators", () => {
    const prompt = buildTradingPrompt(mockMarketState);
    expect(prompt.user).toContain("TREND");
    expect(prompt.user).toContain("MOMENTUM");
    expect(prompt.user).toContain("VOLATILITY");
  });
});

// ─── AIRouter Fallback Tests (using provider injection) ───────────────

describe("AIRouter", () => {
  const mockValidDecision: AIDecisionOutput = {
    action: "WAIT",
    direction: "LONG",
    confidence: 0.72,
    strategy: "MOMENTUM",
    reasoning: "Strong momentum with trend alignment",
  };

  it("returns safe fallback when no providers configured", async () => {
    const router = new AIRouter({ providers: [] });
    const result = await router.route(mockMarketState);

    expect(result.decision.direction).toBe("NO_TRADE");
    expect(result.decision.confidence).toBe(0);
    expect(result.provider).toBe("safe_fallback");
    expect(result.providerAttempts).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("safe fallback passes Zod validation", async () => {
    const router = new AIRouter({ providers: [] });
    const result = await router.route(mockMarketState);

    const validation = AIDecisionSchema.safeParse(result.decision);
    expect(validation.success).toBe(true);
  });

  it("records timing in result", async () => {
    const router = new AIRouter({ providers: [] });
    const result = await router.route(mockMarketState);

    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty errors array when no providers configured", async () => {
    const router = new AIRouter({ providers: [] });
    const result = await router.route(mockMarketState);

    expect(result.errors).toEqual([]);
  });

  it("succeeds on first provider", async () => {
    const groqProvider = createMockProvider("groq", { decision: mockValidDecision });
    const router = new AIRouter({ providers: [groqProvider] });
    const result = await router.route(mockMarketState);

    expect(result.decision.direction).toBe("LONG");
    expect(result.decision.confidence).toBe(0.72);
    expect(result.provider).toBe("groq");
    expect(result.errors).toHaveLength(0);
    expect(groqProvider.generateDecision).toHaveBeenCalledTimes(1);
  });

  it("falls back to next provider when first throws", async () => {
    const groqProvider = createMockProvider("groq", {
      error: { provider: "groq", message: "Rate limited", code: "RATE_LIMITED", rateLimited: true },
    });
    const cerebrasProvider = createMockProvider("cerebras", { decision: mockValidDecision });
    const router = new AIRouter({ providers: [groqProvider, cerebrasProvider] });
    const result = await router.route(mockMarketState);

    expect(result.decision.direction).toBe("LONG");
    expect(result.provider).toBe("cerebras");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rateLimited).toBe(true);
  });

  it("returns safe fallback when ALL providers fail", async () => {
    const groqProvider = createMockProvider("groq", {
      error: { provider: "groq", message: "Timeout", code: "TIMEOUT", rateLimited: false },
    });
    const cerebrasProvider = createMockProvider("cerebras", {
      error: { provider: "cerebras", message: "Server error", code: "HTTP_ERROR", rateLimited: false },
    });
    const router = new AIRouter({ providers: [groqProvider, cerebrasProvider] });
    const result = await router.route(mockMarketState);

    expect(result.decision.direction).toBe("NO_TRADE");
    expect(result.decision.confidence).toBe(0);
    expect(result.provider).toBe("safe_fallback");
    expect(result.errors).toHaveLength(2);
  });

  it("stops retrying on rate limit and moves to next provider", async () => {
    const groqProvider = createMockProvider("groq", {
      error: { provider: "groq", message: "Rate limited", code: "RATE_LIMITED", rateLimited: true },
    });
    const cerebrasProvider = createMockProvider("cerebras", { decision: mockValidDecision });
    const router = new AIRouter({ maxRetries: 3, providers: [groqProvider, cerebrasProvider] });
    const result = await router.route(mockMarketState);

    // Rate limit should only call once, not retry 3 times
    expect(groqProvider.generateDecision).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("cerebras");
  });

  it("retries on non-rate-limit errors up to maxRetries", async () => {
    const groqProvider = createMockProvider("groq", {
      error: { provider: "groq", message: "Timeout", code: "TIMEOUT", rateLimited: false },
    });
    const router = new AIRouter({ maxRetries: 3, providers: [groqProvider] });
    const result = await router.route(mockMarketState);

    expect(groqProvider.generateDecision).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe("safe_fallback");
    expect(result.errors).toHaveLength(3);
  });

  it("reports correct providerAttempts count", async () => {
    const groqProvider = createMockProvider("groq", {
      error: { provider: "groq", message: "Error", code: "ERR", rateLimited: false },
    });
    const cerebrasProvider = createMockProvider("cerebras", {
      error: { provider: "cerebras", message: "Error", code: "ERR", rateLimited: false },
    });
    const router = new AIRouter({ providers: [groqProvider, cerebrasProvider] });
    const result = await router.route(mockMarketState);

    expect(result.providerAttempts).toBe(2);
    expect(result.errors).toHaveLength(2);
  });
});

// ─── OpenAI-Compatible Provider Tests ─────────────────────────────────

describe("OpenAICompatibleProvider", () => {
  it("Groq provider can be instantiated", async () => {
    const { GroqProvider } = await import("./providers/groq");
    const provider = new GroqProvider();
    expect(provider.name).toBe("groq");
    expect(provider.config.model).toBeTruthy();
  });

  it("Gemini provider can be instantiated", async () => {
    const { GeminiProvider } = await import("./providers/gemini");
    const provider = new GeminiProvider();
    expect(provider.name).toBe("gemini");
  });

  it("all OpenAI-compatible providers have distinct names", async () => {
    const { GroqProvider } = await import("./providers/groq");
    const { CerebrasProvider } = await import("./providers/cerebras");
    const { MistralProvider } = await import("./providers/mistral");
    const { OpenRouterProvider } = await import("./providers/openrouter");

    const names = [
      new GroqProvider().name,
      new CerebrasProvider().name,
      new MistralProvider().name,
      new OpenRouterProvider().name,
    ];
    const unique = new Set(names);
    expect(unique.size).toBe(4);
  });

  it("all providers have correct base URLs", async () => {
    const { GroqProvider } = await import("./providers/groq");
    const { CerebrasProvider } = await import("./providers/cerebras");
    const { GeminiProvider } = await import("./providers/gemini");
    const { MistralProvider } = await import("./providers/mistral");
    const { OpenRouterProvider } = await import("./providers/openrouter");

    expect(new GroqProvider().config.baseUrl).toContain("groq.com");
    expect(new CerebrasProvider().config.baseUrl).toContain("cerebras.ai");
    expect(new GeminiProvider().config.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(new MistralProvider().config.baseUrl).toContain("mistral.ai");
    expect(new OpenRouterProvider().config.baseUrl).toContain("openrouter.ai");
  });
});
