/**
 * Phase 3.8-D.4 — Autonomous Control Loop Foundation tests (A–T).
 *
 * Verifies: cycle runs without Chat; single agent identity; evidence
 * hierarchy; USER_INSTRUCTION non-evidence; BUY/ALL-IN never become BUY;
 * NO_TRADE on insufficient evidence; provider fallback (safe_fallback);
 * READ_ONLY action passage; unknown/trading actions DENIED; no executor
 * dependency; no order/leverage/margin calls; verification; no infinite
 * retry; no overlap; chat cannot control the cycle; no credential material
 * in output; honest provenance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─── Mocks for all dynamic imports used by the cycle / registry ─────

vi.mock("../../server", () => ({
  isRuntimeInitialized: () => true,
  isDatabaseReady: () => true,
  getRuntimeInitError: () => null,
}));

vi.mock("../trading/runtime", () => ({
  getOrchestrator: () => null,
  getRuntimeSnapshot: () => ({
    stats: { tickCount: 0, lastTickAt: 0, totalProcessed: 0, totalDecisions: 0, totalErrors: 0, executionMode: "PAPER" },
    perSymbol: [],
    recentEvents: [],
  }),
  isRuntimeRunning: () => true,
}));

vi.mock("../database", () => ({
  isPostgresConfigured: () => true,
  initializeDatabase: async () => {},
}));

vi.mock("../exchange/binance-testnet", () => ({
  isTestnetConfigured: () => false,
}));

vi.mock("../journal", () => ({
  getRecentJournalEvents: () => [],
  getRecentJournalEventsAsync: async () => [],
  recordJournalEvent: vi.fn((e: unknown) => ({ id: "JEV-test", timestamp: Date.now(), ...(e as object) })),
}));

vi.mock("../exchange/unified-state", () => ({
  getExchangeSnapshot: () => ({ positions: [] }),
}));

vi.mock("../services/data-adapter", () => ({
  fetchFeedStatus: async () => ({ symbols: [], connected: false }),
  generateRealtimeMarketState: vi.fn(),
}));

vi.mock("../exchange/market-data-state", () => ({
  getMarketSnapshot: () => ({
    connectionStatus: "ONLINE",
    lastUpdateAt: Date.now(),
    subscribedSymbols: ["BTCUSDT"],
    symbols: {},
    dataFreshness: "FRESH",
  }),
}));

vi.mock("../ai/memory-context", () => ({
  buildMemoryContext: async () => ({
    available: false,
    lessonCount: 0,
    experienceCount: 0,
    lessons: [],
    experiences: [],
    formatted: "",
  }),
}));

vi.mock("./llm/providers", () => ({
  getAvailableProviders: () => [],
}));

// ─── Imports (after mocks) ─────────────────────────────────────────

import {
  runAutonomousCycle,
  maybeRunAutonomousCycle,
  isAutonomousCycleRunning,
  resetAutonomousCycleState,
  getAutonomousCycleStats,
  AUTONOMOUS_AGENT_ID,
  startAutonomousLoop,
  stopAutonomousLoop,
} from "./autonomous-cycle";
import { AGENT_IDENTITY } from "./agent-core";
import { AIRouter } from "./llm/router";
import type { AIProvider, AIDecisionOutput } from "./llm/types";
import { detectActionRequest } from "../api/controlled-actions";
import * as controlledActions from "../api/controlled-actions";
import { recordJournalEvent } from "../journal";
import { generateRealtimeMarketState } from "../services/data-adapter";
import type { MarketState } from "../runtime/types";

const NO_TRADE: AIDecisionOutput = {
  action: "WAIT",
  direction: "NO_TRADE",
  confidence: 0.4,
  strategy: "TREND_FOLLOWING",
  reasoning: "Test evidence does not support entry.",
};

function okProvider(name: "gemini" | "groq" | "openrouter" | "cerebras" | "mistral", decision: AIDecisionOutput): AIProvider {
  return {
    name,
    config: { name, baseUrl: "https://test.local", model: "test-model", apiKeyEnvVar: "TEST_ENV" },
    generateDecision: async () => decision,
  };
}

function failProvider(name: "gemini" | "groq" | "openrouter" | "cerebras" | "mistral"): AIProvider {
  return {
    name,
    config: { name, baseUrl: "https://test.local", model: "test-model", apiKeyEnvVar: "TEST_ENV" },
    generateDecision: async () => {
      throw { provider: name, message: "test failure", rateLimited: false };
    },
  };
}

const TEST_MARKET: MarketState = {
  symbol: "BTCUSDT",
  timestamp: 1_700_000_000_000,
  price: 60000,
  priceChange24h: 120,
  priceChangePercent24h: 0.2,
  trend: "UP",
  trendStrength: 55,
  momentum: "MODERATE",
  momentumScore: 50,
  volatility: 1200,
  volatilityPercent: 2,
  volume24h: 1000000,
  volumeChange: 5,
  marketStructure: "CONSOLIDATION",
  marketRegime: "RANGING",
  regimeConfidence: 60,
  liquidity: 80,
  dataQuality: "GOOD",
  feedStatus: "ONLINE",
  lastUpdate: 1_700_000_000_000,
  dataAge: 100,
};

const SECRET_PATTERNS: string[] = ["apiKey", "apiSecret", "DATABASE_URL", "password", "Authorization", "Bearer"];
const TRADING_CALLS: string[] = ["placeOrder", "cancelOrder", "modifyOrder", "setLeverage", "changeMargin"];

const __dirname = dirname(fileURLToPath(import.meta.url));

function readOwnSource(): string {
  return readFileSync(join(__dirname, "autonomous-cycle.ts"), "utf8");
}

function readChatSource(): string {
  return readFileSync(join(__dirname, "../api/chat-agent.ts"), "utf8");
}

beforeEach(() => {
  vi.mocked(recordJournalEvent).mockClear();
  (vi.mocked(generateRealtimeMarketState) as ReturnType<typeof vi.fn>).mockReset();
  resetAutonomousCycleState();
});

describe("A. autonomous cycle runs without Chat Agent input", () => {
  it("completes a full cycle with zero chat involvement", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const router = new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] });
    const res = await runAutonomousCycle({ router });
    expect(res.status).toBe("COMPLETED");
    expect(res.decision).toBe("NO_TRADE");
    expect(res.actionStatus).toBe("OK");
    expect(res.verificationStatus).toBe("VERIFIED");
    expect(res.journalRecorded).toBe(true);
    expect(res.cycleId).toMatch(/^CYC-/);
  });
});

describe("B. single agent identity preserved", () => {
  it("cycle carries the shared orbiter identity", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    expect(res.agentId).toBe(AGENT_IDENTITY.codename);
    expect(res.agentId).toBe(AUTONOMOUS_AGENT_ID);
  });
});

describe("C. evidence hierarchy remains authoritative", () => {
  it("collects system + market + risk evidence, in that priority", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    expect(res.evidenceCount).toBeGreaterThanOrEqual(3); // system, market, risk
    expect(res.observed.marketAvailable).toBe(true);
  });

  it("NO USER_INSTRUCTION evidence ever enters an autonomous cycle", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    expect(res.provenance).not.toBeNull();
    expect(res.provenance!.evidence.join(" ")).not.toContain("USER_INSTRUCTION");
    expect(res.provenance!.evidence.join(" ")).not.toContain("User instruction");
  });
});

describe("D. USER_INSTRUCTION is not evidence", () => {
  it("cycle API structurally cannot accept user text (no param)", () => {
    // TS-level: runAutonomousCycle accepts only options without user text.
    // At runtime, passing a fake user string as an option cannot create
    // USER_INSTRUCTION evidence.
    const source = readOwnSource();
    expect(source).not.toMatch(/userInstruction/);
  });
});

describe("E. 'BUY BTC' does not become a BUY decision", () => {
  it("autonomous cycle decides from evidence, never from trading keywords", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    // The cycle only saw system evidence — even if someone echoed "BUY BTC"
    // in reason text, the decision must come from the LLM/evidence.
    const res = await maybeRunAutonomousCycle({
      reason: "BUY BTC",
      router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }),
    });
    expect(res.decision).toBe("NO_TRADE");
    expect(detectActionRequest("BUY BTC")).toBeNull();
  });
});

describe("F. 'ALL IN BTC' does not become a BUY decision", () => {
  it("trading instruction is never a cycle decision input", async () => {
    const cls = await import("../ai/agent-core").then((m) => m.classifyUserInput("ALL IN BTC"));
    expect(cls.kind).toBe("TRADING_INSTRUCTION");
    expect(cls.isEvidence).toBe(false);
    expect(detectActionRequest("ALL IN BTC")).toBeNull();
  });
});

describe("G. NO_TRADE when evidence is insufficient", () => {
  it("no market evidence → safe no-op, no LLM call", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(null);
    const res = await runAutonomousCycle({});
    expect(res.status).toBe("NO_TRADE_INSUFFICIENT_EVIDENCE");
    expect(res.decision).toBe("NO_TRADE");
    expect(res.modelVersion).toBe("no_market_evidence");
    expect(res.modelVersion.startsWith("llm-")).toBe(false);
    expect(res.actionStatus).toBe("OK"); // READ_ONLY verification still runs
    expect(res.verificationStatus).toBe("VERIFIED");
  });
});

describe("H. provider failure falls through existing chain", () => {
  it("gemini fails → groq answers with honest provenance", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const router = new AIRouter({ providers: [failProvider("gemini"), okProvider("groq", NO_TRADE)] });
    const res = await runAutonomousCycle({ router });
    expect(res.decision).toBe("NO_TRADE");
    expect(res.modelVersion).toBe("llm-groq");
  });
});

describe("I. all providers failed → safe_fallback", () => {
  it("modelVersion = safe_fallback, decision NO_TRADE, no llm-* label", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const router = new AIRouter({ providers: [failProvider("gemini"), failProvider("groq"), failProvider("openrouter"), failProvider("cerebras"), failProvider("mistral")] });
    const res = await runAutonomousCycle({ router });
    expect(res.modelVersion).toBe("safe_fallback");
    expect(res.decision).toBe("NO_TRADE");
  });
});

describe("J. safe READ_ONLY action passes controlled actions", () => {
  it("system.readiness → ALLOW + VERIFIED", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({
      controlledActionId: "system.readiness",
      router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }),
    });
    expect(res.actionStatus).toBe("OK");
    expect(res.verificationStatus).toBe("VERIFIED");
    expect(res.actionResult?.decision.allowed).toBe(true);
  });
});

describe("K. unknown action is denied", () => {
  it("unregistered action → DENIED, cycle completes safely", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({
      controlledActionId: "not.registered",
      router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }),
    });
    expect(res.actionStatus).toBe("DENIED");
    expect(res.verificationStatus).toBe("DENIED");
    expect(res.status).toBe("COMPLETED_WITH_DENIED_ACTION");
  });
});

describe("L. trading-looking action is denied", () => {
  it("order.place → DENIED through the real registry", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({
      controlledActionId: "order.place",
      router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }),
    });
    expect(res.actionStatus).toBe("DENIED");
  });
});

describe("M. no direct executor/Binance mutation import", () => {
  it("cycle module never imports the trading executor", () => {
    const source = readOwnSource();
    expect(source).not.toContain("testnet-executor");
    expect(source).not.toContain("binance-testnet");
    expect(source).not.toContain("paper/engine");
  });
});

describe("N. no order/leverage/margin function called", () => {
  it("module source contains no execution call names", () => {
    const source = readOwnSource();
    for (const call of TRADING_CALLS) {
      expect(source).not.toContain(`${call}(`);
    }
  });

  it("cycle result never surfaces such capability names", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    for (const call of TRADING_CALLS) {
      expect(JSON.stringify(res)).not.toContain(call);
    }
  });
});

describe("O. action result is verified", () => {
  it("VERIFIED only when registry resultStatus = OK", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    expect(res.verificationStatus).toBe("VERIFIED");
    expect(res.actionResult?.decision.resultStatus).toBe("OK");
  });
});

describe("P. failed action cannot cause infinite retry", () => {
  it("registry executor is called exactly once for a failing action", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const spy = vi.spyOn(controlledActions, "executeControlledAction");
    try {
      const res = await runAutonomousCycle({
        controlledActionId: "not.registered",
        router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.actionStatus).toBe("DENIED");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Q. cycle cannot overlap itself", () => {
  it("second concurrent cycle → SKIPPED", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowProvider: AIProvider = {
      name: "gemini",
      config: { name: "gemini", baseUrl: "https://test.local", model: "test", apiKeyEnvVar: "TEST_ENV" },
      generateDecision: async () => {
        await gate;
        return NO_TRADE;
      },
    };
    const router = new AIRouter({ providers: [slowProvider] });

    const first = runAutonomousCycle({ router });
    const second = await runAutonomousCycle({ router });
    expect(second.status).toBe("SKIPPED");
    expect(second.actionId).toBeNull();

    release!();
    const firstResult = await first;
    expect(firstResult.status).toBe("COMPLETED");
    expect(isAutonomousCycleRunning()).toBe(false);
  });
});

describe("R. chat cannot directly control the autonomous cycle", () => {
  it("chat source never imports or invokes cycle control", () => {
    const source = readChatSource();
    expect(source).not.toContain("runAutonomousCycle");
    expect(source).not.toContain("startAutonomousLoop");
    expect(source).not.toContain("maybeRunAutonomousCycle");
  });

  it("chat detectActionRequest never maps to cycle control", () => {
    expect(detectActionRequest("start autonomous cycle")).toBeNull();
    // Even a conservative match ("loop" → runtime.status) is a benign READ_ONLY
    // registry action — never cycle control, never an execution path.
    // "run the agent loop" is a lifecycle CONTROL request — after the D.5
    // matcher hardening it maps to NO action at all (null), which is stricter
    // than mapping to a read-only lookup. Either way: never cycle control.
    const matched = detectActionRequest("run the agent loop");
    expect(matched).toBeNull();
  });
});

describe("S. no credential material reaches cycle output", () => {
  it("JSON output contains no credential patterns", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    const text = JSON.stringify(res).toLowerCase();
    for (const secret of SECRET_PATTERNS) {
      expect(text).not.toContain(secret.toLowerCase());
    }
  });

  it("journal details contain only safe metadata", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    const lastCall = vi.mocked(recordJournalEvent).mock.calls.at(-1)?.[0];
    const text = JSON.stringify(lastCall ?? "{}").toLowerCase();
    for (const secret of SECRET_PATTERNS) {
      expect(text).not.toContain(secret.toLowerCase());
    }
  });
});

describe("T. provenance remains honest", () => {
  it("llm-<provider> only after validated provider success", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const res = await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    expect(res.modelVersion).toBe("llm-gemini");
    expect(res.provenance?.modelVersion).toBe("llm-gemini");
  });

  it("insufficient evidence never gets an llm-* label", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(null);
    const res = await runAutonomousCycle({});
    expect(res.modelVersion.startsWith("llm-")).toBe(false);
  });
});

describe("Observability + scheduler integration", () => {
  it("stats track cycles and last result safely", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    await runAutonomousCycle({ router: new AIRouter({ providers: [okProvider("gemini", NO_TRADE)] }) });
    const stats = getAutonomousCycleStats();
    expect(stats.totalCycles).toBe(1);
    expect(stats.lastCycle?.cycleId).toMatch(/^CYC-/);
    expect(JSON.stringify(stats)).not.toContain("secret");
  });

  it("wires into the existing decision scheduler (no second scheduler)", async () => {
    startAutonomousLoop({ throttleMs: 60_000 });
    try {
      const { getSchedulerSnapshot } = await import("./decision-scheduler");
      expect(getSchedulerSnapshot().state.active).toBe(true);
      expect(getSchedulerSnapshot().state.throttleMs).toBe(60_000);
    } finally {
      stopAutonomousLoop();
    }
  });
});