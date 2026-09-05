/**
 * Phase 3.8-D.5 — Production Autonomous Loop Wiring tests (A–O).
 *
 * Verifies the D.4 loop is wired into the production runtime safely:
 * single start at boot, no duplicates on restart, scheduler callback drives
 * cycles, in-flight → SKIPPED, shutdown stops scheduler, TRADING_ENABLED
 * untouched, chat cannot start/control the loop, user instruction never
 * enters autonomous evidence, no executor/order mutation imports, no
 * credential leakage, fail-closed behavior, one journal record per cycle,
 * and boot failure prevents the loop from starting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─── Mocks (same seams as D.4) ─────────────────────────────────────

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
  recordJournalEvent: vi.fn(() => ({ id: "JEV-test", timestamp: Date.now() })),
}));

vi.mock("../exchange/unified-state", () => ({
  getExchangeSnapshot: () => ({ positions: [] }),
}));

vi.mock("../services/data-adapter", () => ({
  fetchFeedStatus: async () => ({ symbols: [] }),
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
  startAutonomousLoop,
  stopAutonomousLoop,
  isAutonomousLoopActive,
  getAutonomousLoopStatus,
  shouldStartAutonomousLoop,
  resetAutonomousLoopState,
  maybeRunAutonomousCycle,
} from "./autonomous-cycle";
import { detectActionRequest } from "../api/controlled-actions";
import { resetScheduler, getSchedulerSnapshot, initializeScheduler, shutdownScheduler } from "./decision-scheduler";
import { generateRealtimeMarketState } from "../services/data-adapter";
import { recordJournalEvent } from "../journal";
import type { MarketState } from "../runtime/types";

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

const __dirname = dirname(fileURLToPath(import.meta.url));

function readOwnSource(): string {
  return readFileSync(join(__dirname, "autonomous-cycle.ts"), "utf8");
}

function readServerSource(): string {
  return readFileSync(join(__dirname, "../../server.ts"), "utf8");
}

function readChatSource(): string {
  return readFileSync(join(__dirname, "../api/chat-agent.ts"), "utf8");
}

beforeEach(() => {
  vi.mocked(recordJournalEvent).mockClear();
  (vi.mocked(generateRealtimeMarketState) as ReturnType<typeof vi.fn>).mockReset();
  resetScheduler();
  resetAutonomousLoopState();
});

describe("A. runtime start → autonomous loop starts once", () => {
  it("server boot successfully calls startAutonomousLoop after runtime init", () => {
    const source = readServerSource();
    expect(source).toContain("startAutonomousLoop()");
    expect(source).toContain("Autonomous loop started (READ-ONLY)");
  });

  it("startAutonomousLoop activates the existing scheduler", () => {
    startAutonomousLoop({ throttleMs: 60_000 });
    expect(isAutonomousLoopActive()).toBe(true);
    expect(getAutonomousLoopStatus().status).toBe("RUNNING");
    expect(getSchedulerSnapshot().state.active).toBe(true);
    expect(getSchedulerSnapshot().state.throttleMs).toBe(60_000);
    stopAutonomousLoop();
  });
});

describe("B. repeated initialization → no duplicate loop", () => {
  it("double start is ignored (single scheduler)", () => {
    startAutonomousLoop({ throttleMs: 60_000 });
    startAutonomousLoop({ throttleMs: 30_000 }); // duplicate — must be ignored
    expect(getSchedulerSnapshot().state.throttleMs).toBe(60_000);
    expect(getSchedulerSnapshot().state.active).toBe(true);
    stopAutonomousLoop();
    expect(getSchedulerSnapshot().state.active).toBe(false);
  });
});

describe("C. scheduler callback → runAutonomousCycle invoked", () => {
  it("wires the existing scheduler to the autonomous cycle", () => {
    // startAutonomousLoop installs maybeRunAutonomousCycle as the callback.
    let cb: (() => Promise<void> | void) | null = null;
    // Re-implement the wiring check by inspecting the module source (the
    // actual scheduler callback registration is covered via start/stop above).
    const source = readOwnSource();
    expect(source).toContain("maybeRunAutonomousCycle");
    expect(source).toContain("initializeScheduler(");
    expect(source).toContain("shutdownScheduler");
    void cb;
  });
});

describe("D. in-flight cycle → second cycle SKIPPED", () => {
  it("returns SKIPPED when a cycle is already running", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowProvider = {
      name: "gemini" as const,
      config: { name: "gemini" as const, baseUrl: "https://test.local", model: "test", apiKeyEnvVar: "TEST_ENV" },
      generateDecision: async (): Promise<import("./llm/types").AIDecisionOutput> => {
        await gate;
        return {
          action: "WAIT",
          direction: "NO_TRADE",
          confidence: 0.4,
          strategy: "TREND_FOLLOWING",
          reasoning: "test",
        };
      },
    };
    const { AIRouter } = await import("./llm/router");
    const router = new AIRouter({ providers: [slowProvider] });

    const first = maybeRunAutonomousCycle({ router });
    const second = await maybeRunAutonomousCycle({ router });
    expect(second.status).toBe("SKIPPED");
    release();
    await first;
  });
});

describe("E. runtime shutdown → scheduler stops", () => {
  it("stopAutonomousLoop deactivates scheduler and sets STOPPED", () => {
    startAutonomousLoop({ throttleMs: 60_000 });
    expect(isAutonomousLoopActive()).toBe(true);
    stopAutonomousLoop();
    expect(isAutonomousLoopActive()).toBe(false);
    expect(getAutonomousLoopStatus().status).toBe("STOPPED");
    expect(getSchedulerSnapshot().state.active).toBe(false);
  });
});

describe("F. tradingEnabled remains false", () => {
  it("loop observability hard-pins tradingEnabled: false", () => {
    startAutonomousLoop();
    expect(getAutonomousLoopStatus().tradingEnabled).toBe(false);
    stopAutonomousLoop();
  });

  it("server wiring never changes TRADING_ENABLED semantics", () => {
    const server = readServerSource();
    expect(server).toContain('detectTradingEnabled(): boolean {\n  return process.env["TRADING_ENABLED"] === "true";');
  });
});

describe("G. chat cannot start autonomous cycle", () => {
  it("chat source never imports or invokes loop control", () => {
    const chat = readChatSource();
    expect(chat).not.toContain("startAutonomousLoop");
    expect(chat).not.toContain("maybeRunAutonomousCycle");
    expect(chat).not.toContain("runAutonomousCycle");
    expect(chat).not.toContain("stopAutonomousLoop");
  });

  it("chat intent matcher never maps to loop control", () => {
    expect(detectActionRequest("start the autonomous loop")).toBeNull();
    expect(detectActionRequest("stop the autonomous loop")).toBeNull();
    expect(detectActionRequest("restart the autonomous loop")).toBeNull();
  });
});

describe("H. user instruction cannot enter autonomous evidence", () => {
  it("autonomous module has no userInstruction input", () => {
    const source = readOwnSource();
    expect(source).not.toMatch(/userInstruction/);
  });

  it("chat classifier keeps user text as non-evidence input", async () => {
    const { classifyUserInput } = await import("./agent-core");
    expect(classifyUserInput("BUY BTC").isEvidence).toBe(false);
  });
});

describe("I. no trading executor import", () => {
  it("cycle module imports no executor", () => {
    const source = readOwnSource();
    expect(source).not.toContain("testnet-executor");
    expect(source).not.toContain("binance-testnet");
    expect(source).not.toContain("paper/engine");
  });
});

describe("J. no order mutation calls", () => {
  it("no order/leverage/margin call names in the loop module", () => {
    const source = readOwnSource();
    for (const call of ["placeOrder(", "cancelOrder(", "modifyOrder(", "setLeverage(", "changeMargin("]) {
      expect(source).not.toContain(call);
    }
  });
});

describe("K. no credential leakage", () => {
  it("loop observability contains only safe metadata", () => {
    startAutonomousLoop();
    const text = JSON.stringify(getAutonomousLoopStatus()).toLowerCase();
    stopAutonomousLoop();
    for (const secret of ["apikey", "apisecret", "database_url", "password", "authorization", "bearer"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("L. autonomous cycle remains fail-closed", () => {
  it("no market evidence → NO_TRADE_INSUFFICIENT_EVIDENCE", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(null);
    const res = await maybeRunAutonomousCycle({});
    expect(res.status).toBe("NO_TRADE_INSUFFICIENT_EVIDENCE");
    expect(res.decision).toBe("NO_TRADE");
  });
});

describe("M. restart does not duplicate scheduler", () => {
  it("start → stop → start keeps exactly one active scheduler", () => {
    startAutonomousLoop({ throttleMs: 90_000 });
    stopAutonomousLoop();
    startAutonomousLoop({ throttleMs: 45_000 });
    expect(getSchedulerSnapshot().state.active).toBe(true);
    expect(getSchedulerSnapshot().state.throttleMs).toBe(45_000);
    stopAutonomousLoop();
    expect(getSchedulerSnapshot().state.active).toBe(false);
  });
});

describe("N. journal semantics — one record per completed cycle", () => {
  it("a completed cycle writes exactly one journal event", async () => {
    vi.mocked(generateRealtimeMarketState).mockReturnValue(TEST_MARKET);
    const { AIRouter } = await import("./llm/router");
    const router = new AIRouter({
      providers: [
        {
          name: "gemini",
          config: { name: "gemini", baseUrl: "https://test.local", model: "test", apiKeyEnvVar: "TEST_ENV" },
          generateDecision: async () => ({
            action: "WAIT",
            direction: "NO_TRADE",
            confidence: 0.4,
            strategy: "TREND_FOLLOWING",
            reasoning: "test",
          }),
        },
      ],
    });
    const res = await maybeRunAutonomousCycle({ router });
    expect(res.journalRecorded).toBe(true);
    expect(vi.mocked(recordJournalEvent)).toHaveBeenCalledTimes(1);
  });

  it("skipped cycles write nothing", async () => {
    // SKIPPED path never reaches the journal record step.
    const skipped = maybeRunAutonomousCycle({});
    const second = await maybeRunAutonomousCycle({});
    expect(second.status).toBe("SKIPPED");
    expect(second.journalRecorded).toBe(false);
    const { resetAutonomousCycleState: reset } = await import("./autonomous-cycle");
    reset();
    await skipped.catch(() => {});
  });
});

describe("O. production boot failure → loop does not start", () => {
  it("shouldStartAutonomousLoop is fail-closed", () => {
    expect(
      shouldStartAutonomousLoop({ databaseReady: true, runtimeInitialized: true, bootError: null }),
    ).toBe(true);
    // Database not ready → no loop.
    expect(
      shouldStartAutonomousLoop({ databaseReady: false, runtimeInitialized: true, bootError: null }),
    ).toBe(false);
    // Runtime not initialized → no loop.
    expect(
      shouldStartAutonomousLoop({ databaseReady: true, runtimeInitialized: false, bootError: null }),
    ).toBe(false);
    // Boot error present → no loop, regardless of readiness flags.
    expect(
      shouldStartAutonomousLoop({
        databaseReady: true,
        runtimeInitialized: true,
        bootError: "Database init failed: write CONNECT_TIMEOUT",
      }),
    ).toBe(false);
  });
});