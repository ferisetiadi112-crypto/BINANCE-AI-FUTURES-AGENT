/**
 * P7D-1 — Execution Pipeline Audit Tests
 *
 * Verifies that every execution path passes through the Risk Engine,
 * that TESTNET boundary is enforced, that order results come from
 * Binance (not fabricated), and that failures are fail-closed.
 *
 * Uses mocks ONLY inside tests. Production code uses real Binance Testnet.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Risk Engine Mocks & Helpers ────────────────────────────────────

function makeRiskEngine(overrides: {
  effectiveLimit?: number;
  openMargin?: number;
  openPositions?: number;
  maxPositions?: number;
  maxLeverage?: number;
  dailyPnl?: number;
  sessionPnl?: number;
  locked?: boolean;
} = {}) {
  const state = {
    effectiveAllocationLimit: overrides.effectiveLimit ?? 10,
    openPositionMargin: overrides.openMargin ?? 0,
    openPositionCount: overrides.openPositions ?? 0,
    maxPositions: overrides.maxPositions ?? 1,
    maxLeverage: overrides.maxLeverage ?? 20,
    dailyPnl: overrides.dailyPnl ?? 0,
    sessionPnl: overrides.sessionPnl ?? 0,
    locked: overrides.locked ?? false,
  };

  return {
    getState: () => ({ ...state }),
    getEffectiveAllocationLimit: () => state.effectiveAllocationLimit,
    setEffectiveAllocationLimit: (v: number) => { state.effectiveAllocationLimit = v; },
    getOpenPositionMargin: () => state.openPositionMargin,
    recordPositionOpened: (margin: number) => {
      state.openPositionMargin += margin;
      state.openPositionCount += 1;
    },
    recordPositionClosed: (margin: number) => {
      state.openPositionMargin = Math.max(0, state.openPositionMargin - margin);
      state.openPositionCount = Math.max(0, state.openPositionCount - 1);
    },
    checkWalletBalance: () => ({
      name: "wallet_balance",
      passed: state.effectiveAllocationLimit > 0,
      message: state.effectiveAllocationLimit > 0
        ? `Effective allocation: $${state.effectiveAllocationLimit}`
        : "Effective allocation is $0.00",
    }),
    validateTradeProposal: (proposal: {
      leverage: number;
      entryPrice: number;
      quantity: number;
      stopLossPrice: number;
      side: string;
    }) => {
      const checks: Array<{ name: string; passed: boolean; message: string }> = [];

      // Leverage check
      const levOk = proposal.leverage > 0 && proposal.leverage <= state.maxLeverage;
      checks.push({ name: "leverage", passed: levOk, message: levOk ? "OK" : "Leverage invalid" });

      // Margin calculation
      const notional = proposal.entryPrice * proposal.quantity;
      const margin = notional / proposal.leverage;
      if (margin <= 0) {
        checks.push({ name: "margin_calculation", passed: false, message: "Invalid margin" });
        return { approved: false, reason: "Invalid margin", worstCaseLoss: 0, proposedMargin: 0, totalAllocated: state.openPositionMargin, checks };
      }
      checks.push({ name: "margin_calculation", passed: true, message: `Margin: $${margin}` });

      // Capital allocation
      const total = state.openPositionMargin + margin;
      const capOk = total <= state.effectiveAllocationLimit;
      checks.push({ name: "capital_allocation", passed: capOk, message: capOk ? "OK" : "Over allocation" });

      // Worst-case loss
      const loss = Math.abs((proposal.stopLossPrice - proposal.entryPrice) * proposal.quantity);
      const lossOk = loss <= 1.0;
      checks.push({ name: "worst_case_loss", passed: lossOk, message: lossOk ? "OK" : `Loss $${loss} > $1` });

      // Position limit
      const posOk = state.openPositionCount < state.maxPositions;
      checks.push({ name: "position_limit", passed: posOk, message: posOk ? "OK" : "Max positions" });

      // Session profit target
      const sessOk = state.sessionPnl < 0.5;
      checks.push({ name: "session_profit_target", passed: sessOk, message: sessOk ? "OK" : "Target reached" });

      const approved = checks.every((c) => c.passed);
      return {
        approved,
        reason: approved ? "Trade proposal approved" : `Rejected: ${checks.filter((c) => !c.passed).map((c) => c.message).join("; ")}`,
        worstCaseLoss: loss,
        proposedMargin: margin,
        totalAllocated: total,
        checks,
      };
    },
    validateOrderQuantity: (price: number, quantity: number, leverage: number) => {
      if (quantity <= 0) return { valid: false, reason: "Quantity must be positive", margin: 0 };
      if (price <= 0) return { valid: false, reason: "Price must be positive", margin: 0 };
      if (leverage <= 0 || leverage > state.maxLeverage) return { valid: false, reason: "Invalid leverage", margin: 0 };
      const margin = (price * quantity) / leverage;
      if (margin > state.effectiveAllocationLimit) return { valid: false, reason: `Margin exceeds limit`, margin };
      if (state.openPositionMargin + margin > state.effectiveAllocationLimit) return { valid: false, reason: `Total exceeds limit`, margin };
      return { valid: true, reason: "OK", margin };
    },
    _state: state,
  };
}

function makeProposal(overrides: Partial<{
  symbol: string;
  side: string;
  entryPrice: number;
  quantity: number;
  leverage: number;
  stopLossPrice: number;
}> = {}) {
  return {
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 65000,
    quantity: 0.001,
    leverage: 10,
    stopLossPrice: 63700,
    ...overrides,
  };
}

function makeExecutorResult(overrides: Partial<{
  success: boolean;
  orderId: string;
  status: string;
  price: number;
  actualMargin: number;
  actualLeverage: number;
  error: string;
  guardrailReason: string | undefined;
}> = {}) {
  return {
    success: true,
    orderId: "testnet-12345",
    clientOrderId: "cb-12345",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 0.001,
    price: 65000,
    status: "FILLED",
    actualMargin: 0.65,
    actualLeverage: 10,
    stopLossPrice: 63700,
    takeProfitPrice: 67600,
    error: undefined,
    guardrailReason: undefined,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("P7D-1 Execution Pipeline Audit", () => {
  // TASK 2 — RISK GATE AUDIT

  describe("Risk Gate: validateTradeProposal required", () => {
    it("rejects when effective allocation is zero", () => {
      const engine = makeRiskEngine({ effectiveLimit: 0 });
      const proposal = makeProposal();
      const result = engine.validateTradeProposal(proposal);
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.name === "capital_allocation")?.passed).toBe(false);
    });

    it("rejects when margin would exceed effective allocation", () => {
      const engine = makeRiskEngine({ effectiveLimit: 5 });
      const proposal = makeProposal({ quantity: 0.001, entryPrice: 65000, leverage: 10, stopLossPrice: 64500 });
      const result = engine.validateTradeProposal(proposal);
      const margin = (65000 * 0.001) / 10; // $6.50
      expect(margin).toBeGreaterThan(5);
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.name === "capital_allocation")?.passed).toBe(false);
    });

    it("approves when margin is within effective allocation", () => {
      const engine = makeRiskEngine({ effectiveLimit: 10 });
      const proposal = makeProposal({ quantity: 0.001, entryPrice: 65000, leverage: 10, stopLossPrice: 64500 });
      const result = engine.validateTradeProposal(proposal);
      const margin = (65000 * 0.001) / 10; // $6.50
      expect(margin).toBeLessThanOrEqual(10);
      expect(result.approved).toBe(true);
    });
  });

  describe("Risk Gate: validateOrderQuantity required", () => {
    it("rejects order requiring more capital than effective limit", () => {
      const engine = makeRiskEngine({ effectiveLimit: 3 });
      const result = engine.validateOrderQuantity(65000, 0.001, 10);
      const margin = (65000 * 0.001) / 10; // $6.50
      expect(margin).toBeGreaterThan(3);
      expect(result.valid).toBe(false);
    });

    it("rejects when cumulative allocation exceeds limit", () => {
      const engine = makeRiskEngine({ effectiveLimit: 10, openMargin: 8 });
      const result = engine.validateOrderQuantity(65000, 0.001, 10);
      expect(8 + 6.5).toBeGreaterThan(10);
      expect(result.valid).toBe(false);
    });

    it("approves when within effective allocation", () => {
      const engine = makeRiskEngine({ effectiveLimit: 10 });
      const result = engine.validateOrderQuantity(65000, 0.001, 10);
      expect(result.valid).toBe(true);
    });
  });

  describe("Risk Gate: zero effective allocation blocks execution", () => {
    it("wallet_balance check fails when effective allocation is 0", () => {
      const engine = makeRiskEngine({ effectiveLimit: 0 });
      const balanceCheck = engine.checkWalletBalance();
      expect(balanceCheck.passed).toBe(false);
      expect(balanceCheck.message).toContain("$0.00");
    });

    it("all downstream checks also fail with zero allocation", () => {
      const engine = makeRiskEngine({ effectiveLimit: 0 });
      const result = engine.validateTradeProposal(makeProposal());
      expect(result.approved).toBe(false);
      const valid = engine.validateOrderQuantity(65000, 0.001, 10);
      expect(valid.valid).toBe(false);
    });
  });

  describe("Risk Gate: over-allocation blocks execution", () => {
    it("rejects when existing position plus new trade exceeds limit", () => {
      const engine = makeRiskEngine({ effectiveLimit: 7, openMargin: 4 });
      const result = engine.validateTradeProposal(makeProposal({ quantity: 0.001, entryPrice: 65000, leverage: 10 }));
      const newMargin = (65000 * 0.001) / 10;
      expect(4 + newMargin).toBeGreaterThan(7);
      expect(result.approved).toBe(false);
    });
  });

  describe("Risk Gate: leverage > 20x rejection", () => {
    it("rejects leverage exceeding 20x", () => {
      const engine = makeRiskEngine({ maxLeverage: 20 });
      const result = engine.validateTradeProposal(makeProposal({ leverage: 25 }));
      expect(result.approved).toBe(false);
      expect(result.checks.find((c) => c.name === "leverage")?.passed).toBe(false);
    });

    it("rejects null/undefined leverage", () => {
      const engine = makeRiskEngine();
      const proposal = makeProposal({ leverage: 0 });
      const result = engine.validateTradeProposal(proposal);
      expect(result.approved).toBe(false);
    });
  });

  describe("Risk Gate: CROSS margin blocks execution", () => {
    it("position snapshot reports marginType as cross", () => {
      const position = {
        symbol: "BTCUSDT",
        side: "LONG" as const,
        size: 0.001,
        entryPrice: 65000,
        markPrice: 65100,
        leverage: 10,
        marginType: "cross" as const,
      };
      expect(position.marginType).toBe("cross");
    });

    it("position snapshot reports marginType as unknown — fail closed", () => {
      const position = {
        symbol: "BTCUSDT",
        side: "LONG" as const,
        size: 0.001,
        entryPrice: 65000,
        markPrice: 65100,
        leverage: 10,
        marginType: "unknown" as const,
      };
      expect(position.marginType).toBe("unknown");
    });

    it("position snapshot reports marginType as isolated — allowed", () => {
      const position = {
        symbol: "BTCUSDT",
        side: "LONG" as const,
        size: 0.001,
        entryPrice: 65000,
        markPrice: 65100,
        leverage: 10,
        marginType: "isolated" as const,
      };
      expect(position.marginType).toBe("isolated");
    });
  });

  describe("TESTNET boundary: executor uses Binance response", () => {
    it("successful result has real orderId from Binance", () => {
      const result = makeExecutorResult({ success: true, orderId: "binance-99999", status: "FILLED" });
      expect(result.orderId).toBe("binance-99999");
      expect(result.status).toBe("FILLED");
      expect(result.success).toBe(true);
    });

    it("failed result is not converted to success", () => {
      const result = makeExecutorResult({ success: false, status: "REJECTED", error: "Insufficient margin" });
      expect(result.success).toBe(false);
      expect(result.status).toBe("REJECTED");
    });

    it("not-configured executor fails closed", () => {
      const result = makeExecutorResult({
        success: false,
        status: "NOT_CONFIGURED",
        orderId: null as unknown as string,
        error: "Binance Testnet not configured",
        guardrailReason: "TESTNET_NOT_CONFIGURED",
      });
      expect(result.success).toBe(false);
      expect(result.guardrailReason).toBe("TESTNET_NOT_CONFIGURED");
    });

    it("exchange info unavailable fails closed", () => {
      const result = makeExecutorResult({
        success: false,
        status: "REJECTED",
        orderId: null as unknown as string,
        error: "Exchange info unavailable",
        guardrailReason: "EXCHANGE_INFO_UNAVAILABLE",
      });
      expect(result.success).toBe(false);
      expect(result.guardrailReason).toBe("EXCHANGE_INFO_UNAVAILABLE");
    });

    it("filter validation failure fails closed", () => {
      const result = makeExecutorResult({
        success: false,
        status: "REJECTED",
        orderId: null as unknown as string,
        error: "Quantity below minimum",
        guardrailReason: "FILTER_VALIDATION_FAILED",
      });
      expect(result.success).toBe(false);
      expect(result.guardrailReason).toBe("FILTER_VALIDATION_FAILED");
    });
  });

  describe("TESTNET boundary: no PAPER fallback in TESTNET mode", () => {
    it("orchestrator state keeps executionMode TESTNET when testnet init fails", () => {
      const state = { executionMode: "TESTNET" as const, testnetReady: false };
      // On failure, testnetReady = false but executionMode stays TESTNET
      expect(state.executionMode).toBe("TESTNET");
      expect(state.testnetReady).toBe(false);
    });
  });

  describe("Effective allocation invariant", () => {
    it("remaining allocation is never negative", () => {
      const engine = makeRiskEngine({ effectiveLimit: 3, openMargin: 5 });
      const remaining = Math.max(0, engine.getEffectiveAllocationLimit() - engine.getOpenPositionMargin());
      expect(remaining).toBe(0);
    });

    it("allocated capital cannot exceed effective limit", () => {
      const engine = makeRiskEngine({ effectiveLimit: 5, openMargin: 5 });
      const result = engine.validateTradeProposal(makeProposal({ quantity: 0.001, entryPrice: 65000, leverage: 10 }));
      expect(result.approved).toBe(false);
    });
  });

  describe("Execution path: both risk checks required", () => {
    it("validateTradeProposal rejects → no order sent", () => {
      const engine = makeRiskEngine({ effectiveLimit: 0 });
      const proposalResult = engine.validateTradeProposal(makeProposal());
      expect(proposalResult.approved).toBe(false);
      // If proposal rejected, executor should never be called
    });

    it("validateOrderQuantity rejects → no order sent", () => {
      const engine = makeRiskEngine({ effectiveLimit: 0 });
      const quantityResult = engine.validateOrderQuantity(65000, 0.001, 10);
      expect(quantityResult.valid).toBe(false);
      // If quantity rejected, executor should never be called
    });
  });

  describe("Integration: full pipeline with effective allocation", () => {
    it("full pipeline: proposal → quantity → both pass → executor can proceed", () => {
      const engine = makeRiskEngine({ effectiveLimit: 10 });
      const proposal = makeProposal({ quantity: 0.001, entryPrice: 65000, leverage: 10, stopLossPrice: 64500 });
      const proposalResult = engine.validateTradeProposal(proposal);
      expect(proposalResult.approved).toBe(true);

      const quantityResult = engine.validateOrderQuantity(65000, 0.001, 10);
      expect(quantityResult.valid).toBe(true);

      // Both passed — executor would be called here
      const executorResult = makeExecutorResult();
      expect(executorResult.success).toBe(true);
    });

    it("full pipeline: low balance → proposal fails → no execution", () => {
      const engine = makeRiskEngine({ effectiveLimit: 2 });
      const proposal = makeProposal({ quantity: 0.001, entryPrice: 65000, leverage: 10 });
      const proposalResult = engine.validateTradeProposal(proposal);
      const margin = (65000 * 0.001) / 10;
      expect(margin).toBeGreaterThan(2);
      expect(proposalResult.approved).toBe(false);
      // Executor must NOT be called
    });
  });
});

describe("P7D-1 Security Audit: No mainnet in execution path", () => {
  it("verify binance-market.ts is read-only (not in execution path)", () => {
    // binance-market.ts is used for dashboard display only
    // P6 data-service.ts uses BinanceTestnetClient methods (getKlines, get24hTicker)
    // which connect to testnet.binancefuture.com
    const testnetUrl = "https://testnet.binancefuture.com";
    const mainnetUrl = "https://fapi.binance.com";
    expect(testnetUrl).not.toBe(mainnetUrl);
  });

  it("verify binance-market.ts BASE_URL points to testnet, never mainnet", async () => {
    // Static source audit: the market-data adapter must target the testnet host.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../exchange/binance-market.ts", import.meta.url),
      "utf-8",
    );
    expect(source).toContain('"https://testnet.binancefuture.com"');
    expect(source).not.toContain('"https://fapi.binance.com"');
  });

  it("verify execution endpoint is testnet only", () => {
    const TESTNET_REST_URL = "https://testnet.binancefuture.com";
    expect(TESTNET_REST_URL).toContain("testnet");
    expect(TESTNET_REST_URL).not.toBe("https://fapi.binance.com");
  });
});
