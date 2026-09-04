/**
 * Phase 3.5-E — Testnet Runtime Diagnostics Tests (READ-ONLY)
 *
 * Covers the 15 required scenarios with mocks (no real credentials):
 * 1-3.  Missing key/secret/both → credentials FAIL, auth SKIPPED
 * 4.    Authenticated testnet success → PASS chain
 * 5.    Authentication failure → honest FAIL, no raw error leaked
 * 6.    Balance read success
 * 7-8.  Position empty / position exists
 * 9.    Open orders read
 * 10.   Market data read
 * 11.   Mainnet URL rejected by assertTestnetUrl
 * 12.   TRADING_ENABLED=false remains false in diagnostics
 * 13.   Diagnostics builder never executes a trade
 * 14.   Credential values never appear anywhere in the response
 * 15.   Mainnet can never become a fallback (assertTestnetUrl fail-closed)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { buildTestnetDiagnostics, assertTestnetUrl } from "./testnet-diagnostics";
import * as executorModule from "../exchange/testnet-executor";
import { getTestnetExecutor } from "../exchange/testnet-executor";

// Never put real credentials in fixtures — obviously fake values only.
const FAKE_KEY = "TESTFAKEKEY0000000000000000000000000000000000";
const FAKE_SECRET = "testfakesecret000000000000000000000000000000";

type ExecutorClient = NonNullable<ReturnType<ReturnType<typeof getTestnetExecutor>["getClient"]>>;

const accountOk = {
  totalWalletBalance: "15.5",
  totalUnrealizedProfit: "0.01",
  totalMarginBalance: "15.51",
  totalCrossWalletBalance: "15.5",
  totalCrossUnPnl: "0",
  availableBalance: "15.5",
  maxWithdrawAmount: "15",
  canTrade: true,
  canDeposit: true,
  canWithdraw: true,
  updateTimestamp: Date.now(),
  assets: [
    { asset: "USDT", walletBalance: "15.5", unrealizedProfit: "0.01", marginBalance: "15.51", availableBalance: "15.5", crossWalletBalance: "15.5", crossUnPnl: "0" },
  ],
  positions: [
    // zero-amount position entries must be filtered out
    { symbol: "BTCUSDT", positionAmount: "0", entryPrice: "0", markPrice: "0", unRealizedProfit: "0", leverage: "5", positionSide: "BOTH" as const, openOrderInitialMargin: "0", positionInitialMargin: "0", notional: "0", isolatedMargin: "0", bidNotional: "0", askNotional: "0", breakEvenPrice: "0", marginType: "cross", isolatedWallet: "0", updateTimestamp: 0 },
  ],
};

describe("Phase 3.5-E — testnet diagnostics (read-only)", () => {
  let envSpies: MockInstance[] = [];
  let execSpies: MockInstance[] = [];

  function setEnv(key: string, value: string | undefined) {
    const store = process.env as unknown as Record<string, string | undefined>;
    const prev = store[key];
    if (value === undefined) delete store[key];
    else store[key] = value;
    envSpies.push({ mockRestore: () => { if (prev === undefined) delete store[key]; else store[key] = prev; } } as unknown as MockInstance);
  }

  function mockClient(overrides: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
    const fakeClient: Record<string, ReturnType<typeof vi.fn>> = {
      connect: vi.fn().mockResolvedValue(true),
      getAccountInfo: vi.fn().mockResolvedValue(accountOk),
      getOpenOrders: vi.fn().mockResolvedValue([]),
      getKlines: vi.fn().mockResolvedValue([
        { openTime: Date.now(), open: 63000, high: 63100, low: 62900, close: 63050, volume: 100, closeTime: Date.now(), quoteVolume: 6305000, trades: 500 },
      ]),
      ...overrides,
    };
    execSpies.push(
      vi.spyOn(executorModule, "getTestnetExecutor").mockReturnValue({
        getClient: () => fakeClient,
        validateTestnetConfig: vi.fn(),
      } as never),
    );
    return fakeClient;
  }

  beforeEach(() => {
    envSpies = [];
    execSpies = [];
  });

  afterEach(() => {
    envSpies.forEach((s) => s.mockRestore());
    execSpies.forEach((s) => s.mockRestore());
    delete process.env["BINANCE_TESTNET_API_KEY"];
    delete process.env["BINANCE_TESTNET_SECRET"];
  });

  it("API key missing → credentials FAIL, auth/balance/position/orders SKIPPED (1)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", undefined);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.environment.apiKeyConfigured).toBe(false);
    expect(d.checks["credentials"]).toBe("FAIL");
    expect(d.checks["authentication"]).toBe("SKIPPED");
    expect(d.binance.authError).toBe("CREDENTIALS_NOT_CONFIGURED");
  });

  it("Secret missing → credentials FAIL, auth SKIPPED (2)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", undefined);
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.environment.secretConfigured).toBe(false);
    expect(d.checks["credentials"]).toBe("FAIL");
    expect(d.checks["authentication"]).toBe("SKIPPED");
  });

  it("Both credentials missing → everything authenticated SKIPPED, market still checked (3)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", undefined);
    setEnv("BINANCE_TESTNET_SECRET", undefined);
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.checks["credentials"]).toBe("FAIL");
    expect(d.checks["authentication"]).toBe("SKIPPED");
    expect(d.checks["balance"]).toBe("SKIPPED");
    // Market data is public — independent of credentials
    expect(d.checks["market"]).toBe("PASS");
    expect(d.market.readable).toBe(true);
    expect(d.market.price).toBeGreaterThan(0);
  });

  it("Authenticated testnet success → PASS chain, ok=true (4)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    const fake = mockClient();
    const d = await buildTestnetDiagnostics();
    expect(fake["connect"]!).toHaveBeenCalled();
    expect(fake["getAccountInfo"]!).toHaveBeenCalled();
    expect(d.binance.mode).toBe("TESTNET");
    expect(d.binance.authenticated).toBe(true);
    expect(d.checks["authentication"]).toBe("PASS");
    expect(d.checks["balance"]).toBe("PASS");
    expect(d.checks["position"]).toBe("PASS");
    expect(d.checks["orders"]).toBe("PASS");
    expect(d.ok).toBe(true);
  });

  it("Authentication failure → honest FAIL, no raw error text leaked (5)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    const err = new Error("[API_ERROR] -2015 Invalid API-key, IP, or permissions for action.");
    mockClient({ connect: vi.fn().mockResolvedValue(true), getAccountInfo: vi.fn().mockRejectedValue(err) });
    const d = await buildTestnetDiagnostics();
    expect(d.binance.authenticated).toBe(false);
    expect(d.checks["authentication"]).toBe("FAIL");
    expect(d.binance.authError).toBe("API_ERROR");
    // Raw message must never appear in the diagnostics payload
    expect(JSON.stringify(d)).not.toContain("-2015");
    expect(JSON.stringify(d)).not.toContain("Invalid API-key");
  });

  it("Balance read success (6)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.account.balanceReadable).toBe(true);
    expect(d.account.balance).toBeCloseTo(15.5);
  });

  it("Position empty when only zero-amount entries exist (7)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.position.readable).toBe(true);
    expect(d.position.hasPosition).toBe(false);
    expect(d.position.symbol).toBeNull();
  });

  it("Position exists → safe fields reported (8)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    const acct = {
      ...accountOk,
      positions: [
        { symbol: "ETHUSDT", positionAmount: "0.5", entryPrice: "2450.10", markPrice: "2449.00", unRealizedProfit: "-0.55", leverage: "5", positionSide: "BOTH" as const, openOrderInitialMargin: "0", positionInitialMargin: "0", notional: "1225", isolatedMargin: "0", bidNotional: "0", askNotional: "0", breakEvenPrice: "0", marginType: "cross", isolatedWallet: "0", updateTimestamp: 0 },
      ],
    };
    mockClient({ getAccountInfo: vi.fn().mockResolvedValue(acct) });
    const d = await buildTestnetDiagnostics();
    expect(d.position.hasPosition).toBe(true);
    expect(d.position.symbol).toBe("ETHUSDT");
    expect(d.position.side).toBe("LONG");
    expect(d.position.quantity).toBeCloseTo(0.5);
    expect(d.position.entryPrice).toBeCloseTo(2450.1);
    expect(d.position.unrealizedPnl).toBeCloseTo(-0.55);
  });

  it("Open orders read → count reported (9)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    const order = { orderId: 1, symbol: "BTCUSDT", side: "SELL", type: "STOP_MARKET", price: "61000", origQty: "0.001", status: "NEW" };
    mockClient({ getOpenOrders: vi.fn().mockResolvedValue([order, order]) });
    const d = await buildTestnetDiagnostics();
    expect(d.orders.readable).toBe(true);
    expect(d.orders.openOrderCount).toBe(2);
  });

  it("Market data read via existing client klines (10)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", undefined);
    setEnv("BINANCE_TESTNET_SECRET", undefined);
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.checks["market"]).toBe("PASS");
    expect(d.market.symbol).toBe("BTCUSDT");
    expect(d.market.price).toBeCloseTo(63050);
  });

  it("Mainnet URL rejected by testnet assertion (11, 15)", async () => {
    expect(assertTestnetUrl("https://fapi.binance.com/fapi/v1/ping")).toBe(false);
    expect(assertTestnetUrl("https://api.binance.com/api/v3/ping")).toBe(false);
    expect(assertTestnetUrl("wss://fstream.binance.com/stream")).toBe(false);
    expect(assertTestnetUrl("https://www.binance.com")).toBe(false);
    // Testnet endpoints pass
    expect(assertTestnetUrl("https://testnet.binancefuture.com")).toBe(true);
    expect(assertTestnetUrl("wss://fstream.binancefuture.com/ws")).toBe(true);
    expect(assertTestnetUrl(null)).toBe(false);
    expect(assertTestnetUrl("")).toBe(false);
  });

  it("TRADING_ENABLED=false remains false in diagnostics (12)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    setEnv("TRADING_ENABLED", "false");
    mockClient();
    const d = await buildTestnetDiagnostics();
    expect(d.trading.enabled).toBe(false);
  });

  it("Diagnostics never executes a trade — only GET reads are called (13)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    const fake = mockClient();
    await buildTestnetDiagnostics();
    // Only read methods should have been invoked
    expect(fake["connect"]!.mock.calls.length).toBe(1);
    expect(fake["getAccountInfo"]!.mock.calls.length).toBe(1);
    expect(fake["getOpenOrders"]!.mock.calls.length).toBe(1);
  });

  it("Credential values never appear anywhere in the response (14)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    mockClient();
    const d = await buildTestnetDiagnostics();
    const json = JSON.stringify(d);
    expect(json).not.toContain(FAKE_KEY);
    expect(json).not.toContain(FAKE_SECRET);
    // Only presence booleans are exposed
    expect(d.environment.apiKeyConfigured).toBe(true);
    expect(d.environment.secretConfigured).toBe(true);
  });

  it("Executor client missing → honest SKIPPED, no crash (edge)", async () => {
    setEnv("BINANCE_TESTNET_API_KEY", FAKE_KEY);
    setEnv("BINANCE_TESTNET_SECRET", FAKE_SECRET);
    execSpies.push(
      vi.spyOn(executorModule, "getTestnetExecutor").mockReturnValue({
        getClient: () => null,
        validateTestnetConfig: vi.fn(),
      } as never),
    );
    const d = await buildTestnetDiagnostics();
    expect(d.checks["authentication"]).toBe("SKIPPED");
    expect(d.binance.authError).toBe("CLIENT_NOT_INITIALIZED");
    expect(d.checks["market"]).toBe("FAIL");
  });
});
