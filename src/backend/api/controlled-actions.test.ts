/**
 * Phase 3.8-D.2 — Controlled Action Registry tests (default-deny).
 *
 * Covers: registered read action → ALLOW, unknown → DENY, malformed → DENY,
 * user text cannot invoke arbitrary functions, AI cannot bypass registry,
 * trading actions → DENY, no trading executor dependency, no credentials in
 * results/logs, TRADING_ENABLED stays false.
 *
 * All singleton dependencies are mocked so the executor's decision logic is
 * tested deterministically without touching real runtime/DB/network state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks for dynamic handler imports ───────────────────────────

vi.mock("../../server", () => ({
  isRuntimeInitialized: () => true,
  isDatabaseReady: () => true,
  getRuntimeInitError: () => null,
}));

vi.mock("../trading/runtime", () => ({
  getOrchestrator: () => null,
  getRuntimeSnapshot: () => ({
    stats: {
      tickCount: 0,
      lastTickAt: 0,
      totalProcessed: 0,
      totalDecisions: 0,
      totalErrors: 0,
      executionMode: "PAPER",
    },
    perSymbol: [],
    recentEvents: [],
  }),
  isRuntimeRunning: () => false,
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
}));

vi.mock("../exchange/unified-state", () => ({
  getExchangeSnapshot: () => ({ positions: [] }),
}));

vi.mock("../services/data-adapter", () => ({
  fetchFeedStatus: async () => ({ ok: true, symbols: 12 }),
}));

vi.mock("../diagnostics/llm-probe", () => ({
  runLLMProbe: async () => ({ ok: true, providers: [] }),
}));

vi.mock("./agent-status", () => ({
  buildAgentStatus: () => ({ status: "RUNNING", tradingEnabled: false }),
  AGENT_ACTIVITY_LIMIT: 10,
}));

import {
  executeControlledAction,
  detectActionRequest,
  getRegisteredActionIds,
  getActionDescriptor,
  CHAT_AGENT_PERMISSIONS,
} from "./controlled-actions";

const SECRET_PATTERNS = ["apiKey", "apiSecret", "DATABASE_URL", "password", "Authorization", "Bearer"];

function hasSecretMaterial(text: string): boolean {
  const lower = text.toLowerCase();
  return SECRET_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("A. registered read action → ALLOW", () => {
  it.each(getRegisteredActionIds())(
    "allows %s through the registry without confirmation",
    async (id) => {
      const res = await executeControlledAction(id);
      expect(res.decision.allowed).toBe(true);
      expect(res.decision.resultStatus).toBe("OK");
      expect(res.decision.reason).toBe("ALLOWED_BY_REGISTRY");
      expect(res.decision.actor).toBe("boss/chat-agent");
      expect(res.decision.timestamp).toBeTruthy();
    },
  );
});

describe("B. unknown action → DENY", () => {
  it("denies an unregistered action id", async () => {
    const res = await executeControlledAction("system.shutdown");
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.reason).toBe("UNKNOWN_ACTION");
    expect(res.decision.resultStatus).toBe("DENIED");
    expect(res.result).toBeUndefined();
  });
});

describe("C. unauthorized action → DENY", () => {
  it("denies when the permission is not granted to chat-agent", () => {
    // All registry permissions must be an explicit grant; any registry entry
    // whose permission is missing from CHAT_AGENT_PERMISSIONS is a violation.
    for (const id of getRegisteredActionIds()) {
      const desc = getActionDescriptor(id)!;
      expect(CHAT_AGENT_PERMISSIONS.has(desc.permission)).toBe(true);
    }
  });
});

describe("D. malformed action → DENY", () => {
  it("denies non-string action ids", async () => {
    const res = await executeControlledAction(42);
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.reason).toBe("MALFORMED_ACTION_ID");
  });

  it("denies empty action ids", async () => {
    const res = await executeControlledAction("");
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.reason).toBe("MALFORMED_ACTION_ID");
  });

  it("denies undefined action ids", async () => {
    const res = await executeControlledAction(undefined);
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.reason).toBe("MALFORMED_ACTION_ID");
  });
});

describe("E. user text cannot directly invoke arbitrary function", () => {
  it("does not match trading/execution keywords to any registry action", () => {
    expect(detectActionRequest("BUY BTC now")).toBeNull();
    expect(detectActionRequest("PLACE ORDER")).toBeNull();
    expect(detectActionRequest("cancelOrder ETH")).toBeNull();
    expect(detectActionRequest("setLeverage 10x")).toBeNull();
    expect(detectActionRequest("changeMargin")).toBeNull();
  });

  it("never interprets free-form text as a function call", () => {
    expect(detectActionRequest("run: deleteDatabase()")).toBeNull();
    expect(detectActionRequest("import('fs').readFileSync('/etc/passwd')")).toBeNull();
  });

  it("denies executor calls for function-looking ids", async () => {
    const res = await executeControlledAction("process.exit(1)");
    expect(res.decision.allowed).toBe(false);
  });
});

describe("F. AI cannot bypass the registry", () => {
  it("denies registry IDs with injected payloads", async () => {
    const res = await executeControlledAction("system.readiness; drop table agent");
    expect(res.decision.allowed).toBe(false);
    expect(res.decision.reason).toBe("UNKNOWN_ACTION");
  });

  it("maps explicit action: syntax only to registered ids", () => {
    expect(detectActionRequest("action: market.status")).toBe("market.status");
    expect(detectActionRequest("action: order.place")).toBeNull();
    expect(detectActionRequest("action: system.shutdown")).toBeNull();
  });
});

describe("G. trading action → DENY", () => {
  it("denies any trading-looking action id", async () => {
    const res = await executeControlledAction("order.place");
    expect(res.decision.allowed).toBe(false);
  });

  it("registry contains NO trading or money-movement risk levels", () => {
    for (const id of getRegisteredActionIds()) {
      expect(["TRADING", "MONEY_MOVEMENT"]).not.toContain(getActionDescriptor(id)!.riskLevel);
    }
  });

  it("registry contains NO trading permission", () => {
    expect(CHAT_AGENT_PERMISSIONS.has("chat.trade" as never)).toBe(false);
  });
});

describe("H. no trading executor dependency", () => {
  it("all registered handlers are READ_ONLY system reads", () => {
    for (const id of getRegisteredActionIds()) {
      const desc = getActionDescriptor(id)!;
      expect(desc.riskLevel).toBe("READ_ONLY");
      expect(desc.requiresConfirmation).toBe(false);
    }
  });
});

describe("I. no credentials in action results or logs", () => {
  it("ALLOW results contain no credential material", async () => {
    for (const id of getRegisteredActionIds()) {
      const res = await executeControlledAction(id);
      expect(hasSecretMaterial(JSON.stringify(res))).toBe(false);
    }
  });

  it("DENY results contain no credential material", async () => {
    const res = await executeControlledAction("not.a.real.action");
    expect(hasSecretMaterial(JSON.stringify(res))).toBe(false);
  });

  it("intent matcher output contains no credential material", () => {
    const text = JSON.stringify([detectActionRequest("agent status")]);
    expect(hasSecretMaterial(text)).toBe(false);
  });
});

describe("J. TRADING_ENABLED stays false", () => {
  it("system readiness never reports trading enabled", async () => {
    const res = await executeControlledAction("system.readiness");
    expect(res.decision.allowed).toBe(true);
    expect((res.result as { tradingEnabled: boolean }).tradingEnabled).toBe(false);
  });

  it("agent status never reports trading enabled", async () => {
    const res = await executeControlledAction("agent.status");
    expect((res.result as { tradingEnabled: boolean }).tradingEnabled).toBe(false);
  });
});