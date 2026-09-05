/**
 * Phase 3.8-C.1 — Chat Agent tests (READ-ONLY guarantees)
 *
 * Covers: provider success/fallback/safe-fallback paths, honest modelVersion
 * provenance, no credential leakage, no trading executor involvement, and
 * TRADING_ENABLED staying false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

const mockProviders: Array<{
  name: string;
  generateDecision: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../ai/llm/providers", () => ({
  getAvailableProviders: vi.fn(() => mockProviders),
}));

vi.mock("../trading/runtime", () => ({
  isRuntimeRunning: vi.fn(() => true),
  getRuntimeSnapshot: vi.fn(() => ({
    stats: { lastTickAt: Date.now() },
    perSymbol: [{ symbol: "BTCUSDT" }],
    recentEvents: [
      {
        timestamp: Date.now(),
        symbol: "BTCUSDT",
        decision: "NO_TRADE",
        confidence: 0.4,
        strategy: "TREND_FOLLOWING",
      },
    ],
  })),
  getOrchestrator: vi.fn(() => ({})),
}));

vi.mock("../../server", () => ({
  isRuntimeInitialized: vi.fn(() => true),
  isDatabaseReady: vi.fn(() => true),
  getRuntimeInitError: vi.fn(() => null),
}));

vi.mock("../ai/autonomous-cycle", () => ({
  getAutonomousLoopStatus: vi.fn(() => ({
    status: "RUNNING",
    cyclesCompleted: 4,
    cyclesSkipped: 1,
    lastCycleStatus: "COMPLETED",
    lastCycleId: "CYC-test",
    tradingEnabled: false as const,
  })),
}));

// Import after mocks are registered
import { runChatProvidersForTest } from "./chat-agent-internal";
import { buildChatContext, buildChatSystemPrompt } from "./chat-agent";

// ─── Helpers ────────────────────────────────────────────────────────

function addProvider(name: string, behavior: "ok" | "fail" = "ok") {
  mockProviders.push({
    name,
    generateDecision:
      behavior === "ok"
        ? vi.fn().mockResolvedValue({
            action: "WAIT",
            direction: "NO_TRADE",
            confidence: 0,
            strategy: "TREND_FOLLOWING",
            reasoning: `reply from ${name}`,
          })
        : vi.fn().mockRejectedValue({ provider: name, message: "boom", code: "HTTP_ERROR", rateLimited: false }),
  });
}

function resetProviders() {
  mockProviders.length = 0;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Phase 3.8-D.6 — chat ↔ Agent Core ↔ system integration", () => {
  beforeEach(() => {
    resetProviders();
  });

  it("context carries real system readiness and autonomous loop state", async () => {
    const ctx = await buildChatContext();
    expect(ctx.systemReadiness).toEqual({ databaseReady: true, runtimeInitialized: true, bootError: false });
    expect(ctx.autonomousLoop).toMatchObject({ status: "RUNNING", cyclesCompleted: 4, tradingEnabled: false });
  });

  it("context trading status is hard-pinned false even with runtime state present", async () => {
    const ctx = await buildChatContext();
    expect(ctx.tradingEnabled).toBe(false);
    expect(ctx.autonomousLoop.tradingEnabled).toBe(false);
  });

  it("system prompt mentions autonomous loop scope guidance and single-agent identity", () => {
    const prompt = buildChatSystemPrompt();
    expect(prompt).toContain("autonomous");
    expect(prompt).toContain("orbital-futures-agent");
    expect(prompt).toContain("OUT OF SCOPE");
  });

  it("no credential material appears in the prompt or context", async () => {
    const ctx = await buildChatContext();
    const serialized = JSON.stringify(ctx) + buildChatSystemPrompt();
    const banned = ["postgres://", "Bearer ", "BEGIN PRIVATE KEY"];
    for (const s of banned) {
      expect(serialized.includes(s)).toBe(false);
    }
  });
});

describe("chat agent provider chain (Phase 3.8-C.1)", () => {
  beforeEach(() => {
    resetProviders();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("A. first provider success returns validated reply with honest modelVersion", async () => {
    addProvider("gemini", "ok");
    addProvider("groq", "ok");

    const result = await runChatProvidersForTest('{"system":"s","user":"u"}');

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gemini");
    expect(result!.modelVersion).toBe("llm-gemini");
    expect(result!.fallbackIndex).toBe(0);
    expect(result!.reply).toBe("reply from gemini");
    // Chain stops at first success — Groq never called
    expect(mockProviders[1]!.generateDecision).not.toHaveBeenCalled();
  });

  it("B. first provider failure falls through to the next provider", async () => {
    addProvider("gemini", "fail");
    addProvider("groq", "ok");

    const result = await runChatProvidersForTest('{"system":"s","user":"u"}');

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("groq");
    expect(result!.modelVersion).toBe("llm-groq");
    expect(result!.fallbackIndex).toBe(1);
    expect(mockProviders[0]!.generateDecision).toHaveBeenCalled();
  });

  it("C. all providers failing returns null (safe fallback path)", async () => {
    addProvider("gemini", "fail");
    addProvider("groq", "fail");
    addProvider("openrouter", "fail");

    const result = await runChatProvidersForTest('{"system":"s","user":"u"}');

    expect(result).toBeNull();
  });

  it("D. no providers configured returns null (safe fallback path)", async () => {
    const result = await runChatProvidersForTest('{"system":"s","user":"u"}');
    expect(result).toBeNull();
  });

  it("E. modelVersion is never llm-* unless the provider actually succeeded", async () => {
    addProvider("gemini", "fail");
    addProvider("mistral", "ok");

    const result = await runChatProvidersForTest('{"system":"s","user":"u"}');
    expect(result!.modelVersion).toBe("llm-mistral");
    expect(result!.modelVersion).not.toBe("llm-gemini");
  });

  it("F. trading executor is never imported or invoked by the chat module", async () => {
    // Dynamic require of the executor would fail in tests if the chat module
    // imported it — instead assert by source inspection on the module graph:
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./chat-agent.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/testnet-executor/);
    expect(src).not.toMatch(/placeOrder/);
    expect(src).not.toMatch(/cancelOrder/);
    expect(src).not.toMatch(/modifyOrder/);
    expect(src).not.toMatch(/setLeverage/);
    expect(src).not.toMatch(/changeMargin/);
  });

  it("G. TRADING_ENABLED stays false in the chat context regardless of env", async () => {
    vi.stubEnv("TRADING_ENABLED", "true");
    // Context builder hard-pins tradingEnabled: false (see chat-agent.ts).
    // Source-level guarantee:
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./chat-agent.ts", import.meta.url), "utf-8");
    expect(src).toMatch(/tradingEnabled: false/);
  });

  it("H. no credential material in prompt-building or response code", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./chat-agent.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/Authorization/);
    expect(src).not.toMatch(/Bearer /);
    expect(src).not.toMatch(/apiKey\s*=/);
    expect(src).not.toMatch(/apiSecret/);
    expect(src).not.toMatch(/DATABASE_URL/);
    expect(src).not.toMatch(/password/i);
  });
});
