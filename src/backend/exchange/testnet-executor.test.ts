/**
 * TestnetExecutor Tests — BINANCE AI FUTURES AGENT v0.1 (P4-FIX)
 *
 * Tests for:
 * - TestnetExecutor with mocked Binance client
 * - Order confirmation (FILLED vs REJECTED)
 * - Idempotency (client order IDs)
 * - SL/TP protection orders
 * - Position monitoring & reconciliation
 * - Trade close with actual PnL
 * - Exchange info validation
 * - Symbol/quantity/price filter validation
 * - Error handling (timeout, rejection, network)
 * - Fail closed behavior
 * - Mainnet URL rejection
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TestnetExecutor,
  type TestnetExecutionResult,
} from "./testnet-executor";
import type { SymbolInfo } from "./binance-testnet";

// ─── Mock Binance Client Factory ────────────────────────────────────

function createMockSymbolInfo(overrides?: Partial<SymbolInfo>): SymbolInfo {
  return {
    symbol: "BTCUSDT",
    status: "TRADING",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    pricePrecision: 2,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quoteAssetPrecision: 8,
    filters: [
      { filterType: "PRICE_FILTER", minPrice: "0.10", maxPrice: "100000.00", tickSize: "0.10" },
      { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000.000", stepSize: "0.001" },
      { filterType: "MARKET_LOT_SIZE", limit: "100.000" },
      { filterType: "MIN_NOTIONAL", minNotional: "5.00" },
    ],
    orderTypes: ["LIMIT", "MARKET", "STOP_MARKET", "TAKE_PROFIT_MARKET"],
    timeInForce: ["GTC", "IOC", "FOK"],
    ...overrides,
  };
}

function createMockClient(overrides?: {
  connectResult?: boolean;
  placeOrderResult?: any;
  getSymbolInfoResult?: SymbolInfo | null;
  getOpenPositionsResult?: any[];
  getAccountInfoResult?: any;
  setLeverageResult?: any;
  getUSDTBalanceResult?: number;
  getIncomeHistoryResult?: any[];
  getOpenOrdersResult?: any[];
}) {
  const defaults = {
    connectResult: true,
    placeOrderResult: {
      orderId: 12345,
      symbol: "BTCUSDT",
      pair: "BTCUSDT",
      side: "BUY" as const,
      type: "MARKET" as const,
      timeInForce: "GTC",
      origQty: "0.001",
      price: "0",
      cummulativeQuoteQty: "63.00",
      averagePrice: "63000.00",
      status: "FILLED" as const,
      transactTime: Date.now(),
      updateTime: Date.now(),
      isReduceOnly: false,
      workingType: "MARKET_PRICE",
      commissionAsset: "USDT",
      commission: "0.0252",
    },
    getSymbolInfoResult: createMockSymbolInfo() as SymbolInfo | null,
    getOpenPositionsResult: [] as any[],
    getAccountInfoResult: {
      totalWalletBalance: "10.00",
      totalUnrealizedProfit: "0.00",
      totalMarginBalance: "10.00",
      totalCrossWalletBalance: "10.00",
      totalCrossUnPnl: "0.00",
      availableBalance: "10.00",
      maxWithdrawAmount: "10.00",
      canTrade: true,
      canDeposit: true,
      canWithdraw: true,
      updateTimestamp: Date.now(),
      assets: [],
      positions: [],
    },
    setLeverageResult: { leverage: 5 },
    getUSDTBalanceResult: 10.0,
    getIncomeHistoryResult: [] as any[],
    getOpenOrdersResult: [] as any[],
  };

  const config = { ...defaults, ...overrides };

  return {
    connect: vi.fn().mockResolvedValue(config.connectResult),
    isConnected: vi.fn().mockReturnValue(true),
    placeMarketOrder: vi.fn().mockResolvedValue(config.placeOrderResult),
    setLeverage: vi.fn().mockResolvedValue(config.setLeverageResult),
    getSymbolInfo: vi.fn().mockResolvedValue(config.getSymbolInfoResult),
    getOpenPositions: vi.fn().mockResolvedValue(config.getOpenPositionsResult),
    getAccountInfo: vi.fn().mockResolvedValue(config.getAccountInfoResult),
    getUSDTBalance: vi.fn().mockResolvedValue(config.getUSDTBalanceResult),
    getIncomeHistory: vi.fn().mockResolvedValue(config.getIncomeHistoryResult),
    getOpenOrders: vi.fn().mockResolvedValue(config.getOpenOrdersResult),
    cancelOrder: vi.fn().mockResolvedValue({ orderId: 1, status: "CANCELED" }),
    request: vi.fn().mockImplementation(async (method: string, endpoint: string, params: any) => {
      if (endpoint.includes("/fapi/v1/order") && params.type === "STOP_MARKET") {
        return { orderId: 99001, status: "NEW" };
      }
      if (endpoint.includes("/fapi/v1/order") && params.type === "TAKE_PROFIT_MARKET") {
        return { orderId: 99002, status: "NEW" };
      }
      return {};
    }),
  };
}

// ─── Test Helper ─────────────────────────────────────────────────────

function createExecutorWithMock(mockClient: any): TestnetExecutor {
  const executor = new TestnetExecutor();
  // Inject mock client by accessing private field via any
  (executor as any).client = mockClient;
  return executor;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("TestnetExecutor — Order Confirmation", () => {
  it("succeeds when order is FILLED", async () => {
    const mockClient = createMockClient({
      placeOrderResult: {
        orderId: 12345,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        status: "FILLED",
        averagePrice: "63000.00",
        origQty: "0.001",
        cummulativeQuoteQty: "63.00",
      },
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-001",
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe(12345);
    expect(result.price).toBeCloseTo(63000, 0);
    expect(result.status).toBe("FILLED");
    expect(mockClient.placeMarketOrder).toHaveBeenCalled();
  });

  it("fails when order is REJECTED", async () => {
    const mockClient = createMockClient({
      placeOrderResult: {
        orderId: 12346,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        status: "REJECTED",
        averagePrice: "0",
        origQty: "0.001",
        cummulativeQuoteQty: "0",
      },
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-002",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("REJECTED");
    expect(result.error).toContain("not filled");
  });

  it("fails when order is CANCELED", async () => {
    const mockClient = createMockClient({
      placeOrderResult: {
        orderId: 12347,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        status: "CANCELED",
        averagePrice: "0",
        origQty: "0.001",
        cummulativeQuoteQty: "0",
      },
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-003",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("CANCELED");
  });

  it("fails when order is EXPIRED", async () => {
    const mockClient = createMockClient({
      placeOrderResult: {
        orderId: 12348,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        status: "EXPIRED",
        averagePrice: "0",
        origQty: "0.001",
        cummulativeQuoteQty: "0",
      },
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-004",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("EXPIRED");
  });
});

describe("TestnetExecutor — Client Order ID (Idempotency)", () => {
  it("generates deterministic client order IDs", () => {
    const executor = new TestnetExecutor();
    const id1 = executor.generateClientOrderId("BTCUSDT", "BUY");
    const id2 = executor.generateClientOrderId("BTCUSDT", "BUY");

    expect(id1).toMatch(/^P4-BTCUSDT-BUY-\d+-\d+$/);
    expect(id2).toMatch(/^P4-BTCUSDT-BUY-\d+-\d+$/);
    expect(id1).not.toBe(id2); // Counter increments
  });

  it("different sides produce different IDs", () => {
    const executor = new TestnetExecutor();
    const buyId = executor.generateClientOrderId("BTCUSDT", "BUY");
    const sellId = executor.generateClientOrderId("BTCUSDT", "SELL");

    expect(buyId).toContain("BUY");
    expect(sellId).toContain("SELL");
  });
});

describe("TestnetExecutor — Exchange Info Validation", () => {
  it("rejects when exchange info is unavailable", async () => {
    const mockClient = createMockClient({
      getSymbolInfoResult: null,
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "INVALIDUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-005",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("SYMBOL_INVALID");
    expect(result.error).toContain("not found");
  });

  it("rejects when exchange info throws", async () => {
    const mockClient = createMockClient();
    mockClient.getSymbolInfo.mockRejectedValue(new Error("Network error"));
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-006",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("EXCHANGE_INFO_UNAVAILABLE");
  });

  it("rejects inactive symbol", async () => {
    const mockClient = createMockClient({
      getSymbolInfoResult: createMockSymbolInfo({ status: "BREAK" }),
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-007",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("SYMBOL_INVALID");
  });
});

describe("TestnetExecutor — Filter Validation", () => {
  it("rejects invalid quantity", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.0001, // Below minQty of 0.001
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-008",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("FILTER_VALIDATION_FAILED");
    expect(result.error).toContain("below minimum");
    expect(mockClient.placeMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects invalid price", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 0, // Invalid price
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-009",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("FILTER_VALIDATION_FAILED");
    expect(mockClient.placeMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects invalid stop loss price", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: -1, // Invalid
      takeProfitPrice: 65520,
      decisionId: "DEC-010",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("FILTER_VALIDATION_FAILED");
    expect(mockClient.placeMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects notional below minimum", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    // 0.001 * 1 = $0.001 — well below $5 minimum notional
    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 1,
      leverage: 5,
      stopLossPrice: 0.9,
      takeProfitPrice: 1.1,
      decisionId: "DEC-011",
    });

    expect(result.success).toBe(false);
    expect(result.guardrailReason).toBe("FILTER_VALIDATION_FAILED");
    expect(mockClient.placeMarketOrder).not.toHaveBeenCalled();
  });

  it("normalizes quantity to step size", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.0015, // Should be normalized to 0.001
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-012",
    });

    // Order should execute with normalized quantity
    expect(mockClient.placeMarketOrder).toHaveBeenCalledWith(
      "BTCUSDT",
      "BUY",
      0.001, // Normalized to step size
    );
  });
});

describe("TestnetExecutor — Not Configured", () => {
  it("fails when client is null", async () => {
    const executor = new TestnetExecutor();
    // Client is null when no API keys are set
    // We test by checking isConfigured
    expect(executor.isConfigured()).toBe(false);

    // executeTrade with no client should fail gracefully
    // (client is null in constructor if no env vars)
    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-013",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.guardrailReason).toBe("TESTNET_NOT_CONFIGURED");
  });
});

describe("TestnetExecutor — Error Handling", () => {
  it("handles BinanceTestnetError gracefully", async () => {
    const mockClient = createMockClient();
    mockClient.placeMarketOrder.mockRejectedValue(
      new (await import("./binance-testnet")).BinanceTestnetError(
        "INSUFFICIENT_FUNDS",
        "Not enough balance",
        400,
      ),
    );
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-014",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("Not enough balance");
  });

  it("handles generic errors gracefully", async () => {
    const mockClient = createMockClient();
    mockClient.placeMarketOrder.mockRejectedValue(new Error("Unexpected error"));
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-015",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("ERROR");
    expect(result.error).toContain("Unexpected error");
  });
});

describe("TestnetExecutor — SL/TP Protection", () => {
  it("places STOP_MARKET and TAKE_PROFIT_MARKET orders after fill", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-016",
    });

    // Verify SL/TP orders were placed via request()
    expect(mockClient.request).toHaveBeenCalledWith(
      "POST",
      "/fapi/v1/order",
      expect.objectContaining({
        type: "STOP_MARKET",
        stopPrice: "61740",
      }),
    );
    expect(mockClient.request).toHaveBeenCalledWith(
      "POST",
      "/fapi/v1/order",
      expect.objectContaining({
        type: "TAKE_PROFIT_MARKET",
        stopPrice: "65520",
      }),
    );
  });

  it("continues execution even if SL order fails", async () => {
    const mockClient = createMockClient();
    // Make SL fail
    mockClient.request.mockImplementation(async (method: string, endpoint: string, params: any) => {
      if (params.type === "STOP_MARKET") {
        throw new Error("SL placement failed");
      }
      if (params.type === "TAKE_PROFIT_MARKET") {
        return { orderId: 99002, status: "NEW" };
      }
      return {};
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-017",
    });

    // Main order should still succeed
    expect(result.success).toBe(true);
  });
});

describe("TestnetExecutor — SHORT Direction", () => {
  it("uses SELL side for SHORT", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "SHORT",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 64260,
      takeProfitPrice: 60480,
      decisionId: "DEC-018",
    });

    expect(result.success).toBe(true);
    expect(result.side).toBe("SELL");
    expect(mockClient.placeMarketOrder).toHaveBeenCalledWith(
      "BTCUSDT",
      "SELL",
      0.001,
    );
  });
});

describe("TestnetExecutor — Position Reconciliation", () => {
  it("detects remote-only positions", async () => {
    const mockClient = createMockClient({
      getOpenPositionsResult: [
        {
          symbol: "ETHUSDT",
          positionAmount: "0.01",
          entryPrice: "3200",
          markPrice: "3250",
          unRealizedProfit: "0.50",
          leverage: "5",
          positionSide: "LONG",
          positionInitialMargin: "6.40",
        },
      ],
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.reconcilePositions([]);

    expect(result.consistent).toBe(false);
    expect(result.remoteOnly).toHaveLength(1);
    expect(result.remoteOnly[0]!.symbol).toBe("ETHUSDT");
  });

  it("detects local-only positions", async () => {
    const mockClient = createMockClient({
      getOpenPositionsResult: [],
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.reconcilePositions([
      { symbol: "BTCUSDT", side: "LONG", size: 0.001 },
    ]);

    expect(result.consistent).toBe(false);
    expect(result.localOnly).toHaveLength(1);
    expect(result.localOnly[0]!.symbol).toBe("BTCUSDT");
  });

  it("reports consistent when all positions match", async () => {
    const mockClient = createMockClient({
      getOpenPositionsResult: [
        {
          symbol: "BTCUSDT",
          positionAmount: "0.001",
          entryPrice: "63000",
          markPrice: "63500",
          unRealizedProfit: "0.50",
          leverage: "5",
          positionSide: "LONG",
          positionInitialMargin: "12.60",
        },
      ],
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.reconcilePositions([
      { symbol: "BTCUSDT", side: "LONG", size: 0.001 },
    ]);

    expect(result.consistent).toBe(true);
    expect(result.matched).toHaveLength(1);
  });
});

describe("TestnetExecutor — Trade Close", () => {
  it("closes position and returns actual PnL", async () => {
    const mockClient = createMockClient({
      getIncomeHistoryResult: [
        { symbol: "BTCUSDT", incomeType: "REALIZED_PNL", income: "0.42", asset: "USDT", time: Date.now(), tradeId: 1, info: "" },
      ],
      placeOrderResult: {
        orderId: 20001,
        symbol: "BTCUSDT",
        side: "SELL",
        type: "MARKET",
        status: "FILLED",
        averagePrice: "63420.00",
        origQty: "0.001",
        cummulativeQuoteQty: "63.42",
      },
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.closePosition("BTCUSDT", "LONG", 0.001);

    expect(result.success).toBe(true);
    expect(result.realizedPnl).toBeCloseTo(0.42, 2);
    expect(result.exitPrice).toBeCloseTo(63420, 0);
  });

  it("handles close failure", async () => {
    const mockClient = createMockClient();
    mockClient.placeMarketOrder.mockRejectedValue(new Error("Close failed"));
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.closePosition("BTCUSDT", "LONG", 0.001);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Close failed");
  });

  it("cancels SL/TP orders before closing", async () => {
    const mockClient = createMockClient({
      getOpenOrdersResult: [
        { orderId: 99001, type: "STOP_MARKET", symbol: "BTCUSDT" },
        { orderId: 99002, type: "TAKE_PROFIT_MARKET", symbol: "BTCUSDT" },
      ],
    });
    const executor = createExecutorWithMock(mockClient);

    await executor.closePosition("BTCUSDT", "LONG", 0.001);

    expect(mockClient.cancelOrder).toHaveBeenCalledWith("BTCUSDT", 99001);
    expect(mockClient.cancelOrder).toHaveBeenCalledWith("BTCUSDT", 99002);
  });
});

describe("TestnetExecutor — Startup Validation", () => {
  it("validates when config is correct", async () => {
    const mockClient = createMockClient({
      connectResult: true,
      getUSDTBalanceResult: 10.0,
    });
    const executor = createExecutorWithMock(mockClient);

    // Set env vars for validation
    process.env["BINANCE_TESTNET_API_KEY"] = "test-api-key";
    process.env["BINANCE_TESTNET_SECRET"] = "test-api-secret";

    const result = await executor.validateTestnetConfig();

    expect(result.valid).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.balance).toBe(10.0);
    expect(result.errors).toHaveLength(0);

    // Cleanup
    delete process.env["BINANCE_TESTNET_API_KEY"];
    delete process.env["BINANCE_TESTNET_SECRET"];
  });

  it("fails when API keys are missing", async () => {
    const executor = new TestnetExecutor();

    const originalKey = process.env["BINANCE_TESTNET_API_KEY"];
    const originalSecret = process.env["BINANCE_TESTNET_SECRET"];
    delete process.env["BINANCE_TESTNET_API_KEY"];
    delete process.env["BINANCE_TESTNET_SECRET"];

    const result = await executor.validateTestnetConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("BINANCE_TESTNET_API_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("BINANCE_TESTNET_SECRET"))).toBe(true);

    // Restore
    if (originalKey) process.env["BINANCE_TESTNET_API_KEY"] = originalKey;
    if (originalSecret) process.env["BINANCE_TESTNET_SECRET"] = originalSecret;
  });

  it("fails when cannot connect", async () => {
    const mockClient = createMockClient({ connectResult: false });
    const executor = createExecutorWithMock(mockClient);

    process.env["BINANCE_TESTNET_API_KEY"] = "test-key";
    process.env["BINANCE_TESTNET_SECRET"] = "test-secret";

    const result = await executor.validateTestnetConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cannot connect"))).toBe(true);

    delete process.env["BINANCE_TESTNET_API_KEY"];
    delete process.env["BINANCE_TESTNET_SECRET"];
  });

  it("fails when balance is insufficient", async () => {
    const mockClient = createMockClient({
      connectResult: true,
      getUSDTBalanceResult: 0.10, // Below MIN_WALLET_BALANCE of 0.50
    });
    const executor = createExecutorWithMock(mockClient);

    process.env["BINANCE_TESTNET_API_KEY"] = "test-key";
    process.env["BINANCE_TESTNET_SECRET"] = "test-secret";

    const result = await executor.validateTestnetConfig();

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Insufficient"))).toBe(true);

    delete process.env["BINANCE_TESTNET_API_KEY"];
    delete process.env["BINANCE_TESTNET_SECRET"];
  });
});

describe("TestnetExecutor — Actual Margin Calculation", () => {
  it("calculates actual margin from fill price and quantity", async () => {
    const mockClient = createMockClient({
      placeOrderResult: {
        orderId: 12345,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        status: "FILLED",
        averagePrice: "63000.00",
        origQty: "0.001",
        cummulativeQuoteQty: "63.00",
      },
    });
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 5,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-019",
    });

    expect(result.success).toBe(true);
    // actualMargin = (fillPrice * quantity) / leverage = (63000 * 0.001) / 5 = 12.6
    expect(result.actualMargin).toBeCloseTo(12.6, 2);
    expect(result.actualLeverage).toBe(5);
  });
});

describe("TestnetExecutor — Leverage Setting", () => {
  it("attempts to set leverage before order", async () => {
    const mockClient = createMockClient();
    const executor = createExecutorWithMock(mockClient);

    await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 10,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-020",
    });

    expect(mockClient.setLeverage).toHaveBeenCalledWith("BTCUSDT", 10);
  });

  it("continues if leverage setting fails", async () => {
    const mockClient = createMockClient();
    const { BinanceTestnetError } = await import("./binance-testnet");
    mockClient.setLeverage.mockRejectedValue(
      new BinanceTestnetError("MAX_LEVERAGE_EXCEEDED", "Leverage too high", 400),
    );
    const executor = createExecutorWithMock(mockClient);

    const result = await executor.executeTrade({
      direction: "LONG",
      symbol: "BTCUSDT",
      quantity: 0.001,
      price: 63000,
      leverage: 125,
      stopLossPrice: 61740,
      takeProfitPrice: 65520,
      decisionId: "DEC-021",
    });

    // Should still try to place the order
    expect(mockClient.placeMarketOrder).toHaveBeenCalled();
  });
});
