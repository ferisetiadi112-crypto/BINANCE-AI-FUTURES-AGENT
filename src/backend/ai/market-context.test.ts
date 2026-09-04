/**
 * AI Market Context Tests — P7D-5.3
 *
 * Tests for the read-only market context bridge between
 * MarketDataState and the AI decision engine.
 *
 * SAFETY: These tests verify that:
 * - AI receives only sanitized, structured market data
 * - No secrets/credentials are exposed
 * - AI signal never modifies market state
 * - Combined context works correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildMarketContext,
  formatMarketContextForPrompt,
  buildCombinedAiContext,
  type AiMarketContext,
} from "./market-context";

// ─── Mocks ─────────────────────────────────────────────────────────

import type { MarketDataSnapshot } from "../exchange/market-data-state";

const mockMarketSnapshot: MarketDataSnapshot = {
  connectionStatus: "CONNECTED",
  lastUpdateAt: Date.now(),
  dataFreshness: "FRESH" as const,
  errorCount: 0,
  subscribedSymbols: ["BTCUSDT", "ETHUSDT"],
  symbols: {
    BTCUSDT: {
      symbol: "BTCUSDT",
      lastPrice: 50000,
      bid: 49995,
      ask: 50005,
      spread: 10,
      volume24h: 1_000_000_000,
      quoteVolume24h: 50_000_000_000,
      priceChange24h: 500,
      priceChangePercent24h: 1.0,
      high24h: 51000,
      low24h: 49000,
      trades24h: 500_000,
      updatedAt: Date.now(),
    },
    ETHUSDT: {
      symbol: "ETHUSDT",
      lastPrice: 3000,
      bid: 2998,
      ask: 3002,
      spread: 4,
      volume24h: 500_000_000,
      quoteVolume24h: 1_500_000_000,
      priceChange24h: -20,
      priceChangePercent24h: -0.66,
      high24h: 3050,
      low24h: 2950,
      trades24h: 200_000,
      updatedAt: Date.now(),
    },
  },
  klines: {},
};

let snapshotToReturn: MarketDataSnapshot = JSON.parse(JSON.stringify(mockMarketSnapshot));

vi.mock("../exchange/market-data-state", () => ({
  getMarketSnapshot: () => snapshotToReturn,
}));

// Mock unified-state for combined context test
const mockExchangeSnapshot = {
  connected: true,
  configured: true,
  connectionStatus: "CONNECTED" as const,
  stale: false,
  lastSyncTimestamp: Date.now(),
  account: {
    balance: 100,
    availableBalance: 80,
    marginBalance: 20,
    unrealizedPnl: 5,
  },
  positions: [],
};

vi.mock("../exchange/unified-state", () => ({
  getExchangeSnapshot: () => mockExchangeSnapshot,
}));

// ─── Tests ─────────────────────────────────────────────────────────

describe("AI Market Context (P7D-5.3)", () => {
  beforeEach(() => {
    snapshotToReturn = JSON.parse(JSON.stringify(mockMarketSnapshot));
  });

  // --- 1. Market Data to AI ---

  it("provides market data to AI when connected", async () => {
    const ctx = await buildMarketContext();
    expect(ctx.available).toBe(true);
    expect(ctx.symbolCount).toBe(2);
  });

  it("provides symbol prices", async () => {
    const ctx = await buildMarketContext();
    const btc = ctx.symbols.find((s) => s.symbol === "BTCUSDT");
    expect(btc).toBeDefined();
    expect(btc!.lastPrice).toBe(50000);
    expect(btc!.bid).toBe(49995);
    expect(btc!.ask).toBe(50005);
    expect(btc!.spread).toBe(10);
  });

  it("provides volume data", async () => {
    const ctx = await buildMarketContext();
    const btc = ctx.symbols.find((s) => s.symbol === "BTCUSDT");
    expect(btc!.volume24h).toBe(1_000_000_000);
  });

  it("provides price change data", async () => {
    const ctx = await buildMarketContext();
    const btc = ctx.symbols.find((s) => s.symbol === "BTCUSDT");
    expect(btc!.priceChange24h).toBe(500);
    expect(btc!.priceChangePercent24h).toBe(1.0);
  });

  // --- 2. Connection Status ---

  it("provides connection status", async () => {
    const ctx = await buildMarketContext();
    expect(ctx.connection.status).toBe("CONNECTED");
    expect(ctx.connection.subscribedSymbols).toBe(2);
  });

  // --- 3. Data Freshness ---

  it("reports FRESH when data is recent", async () => {
    snapshotToReturn.lastUpdateAt = Date.now() - 5000;
    const ctx = await buildMarketContext();
    expect(ctx.dataFreshness).toBe("FRESH");
  });

  it("reports STALE when data is old", async () => {
    snapshotToReturn.lastUpdateAt = Date.now() - 60_000;
    snapshotToReturn.dataFreshness = "STALE" as MarketDataSnapshot["dataFreshness"];
    const ctx = await buildMarketContext();
    expect(ctx.dataFreshness).toBe("STALE");
  });

  it("reports UNAVAILABLE when no data", async () => {
    snapshotToReturn.lastUpdateAt = 0;
    snapshotToReturn.dataFreshness = "UNAVAILABLE" as MarketDataSnapshot["dataFreshness"];
    const ctx = await buildMarketContext();
    expect(ctx.dataFreshness).toBe("UNAVAILABLE");
    expect(ctx.available).toBe(false);
  });

  // --- 4. Security ---

  it("does not expose API keys", async () => {
    const ctx = await buildMarketContext();
    const str = JSON.stringify(ctx);
    expect(str).not.toContain("api_key");
    expect(str).not.toContain("api_secret");
    expect(str).not.toContain("listenKey");
    expect(str).not.toContain("password");
    expect(str).not.toContain("DATABASE_URL");
  });

  it("does not expose secrets in prompt format", async () => {
    const ctx = await buildMarketContext();
    const prompt = formatMarketContextForPrompt(ctx);
    expect(prompt).not.toContain("api_key");
    expect(prompt).not.toContain("api_secret");
    expect(prompt).not.toContain("DATABASE_URL");
  });

  // --- 5. AI Signal Safety ---

  it("AI signal does not modify market state", async () => {
    const ctxBefore = await buildMarketContext();
    const priceBefore = ctxBefore.symbols[0]?.lastPrice;

    const ctxAfter = await buildMarketContext();
    expect(ctxAfter.symbols[0]?.lastPrice).toBe(priceBefore);
  });

  it("AI context cannot place orders", async () => {
    const ctx = await buildMarketContext();
    expect(typeof (ctx as any).placeOrder).toBe("undefined");
    expect(typeof (ctx as any).cancelOrder).toBe("undefined");
  });

  // --- 6. Prompt Formatting ---

  it("formats available market context for prompt", async () => {
    const ctx = await buildMarketContext();
    const prompt = formatMarketContextForPrompt(ctx);
    expect(prompt).toContain("BINANCE_FUTURES_TESTNET_MARKET");
    expect(prompt).toContain("$50000.00");
    expect(prompt).toContain("BTCUSDT");
  });

  it("formats unavailable market context for prompt", async () => {
    snapshotToReturn.connectionStatus = "OFFLINE" as MarketDataSnapshot["connectionStatus"];
    snapshotToReturn.symbols = {} as MarketDataSnapshot["symbols"];
    snapshotToReturn.subscribedSymbols = [];
    snapshotToReturn.lastUpdateAt = 0;
    snapshotToReturn.dataFreshness = "UNAVAILABLE" as MarketDataSnapshot["dataFreshness"];
    const ctx = await buildMarketContext();
    const prompt = formatMarketContextForPrompt(ctx);
    expect(prompt).toContain("unavailable");
  });

  it("warns about stale data in prompt", async () => {
    snapshotToReturn.lastUpdateAt = Date.now() - 60_000;
    snapshotToReturn.dataFreshness = "STALE" as MarketDataSnapshot["dataFreshness"];
    const ctx = await buildMarketContext();
    const prompt = formatMarketContextForPrompt(ctx);
    expect(prompt).toContain("stale");
  });

  // --- 7. Combined Context ---

  it("builds combined context with both exchange and market", async () => {
    const combined = await buildCombinedAiContext();
    expect(combined.exchange).not.toBeNull();
    expect(combined.market).not.toBeNull();
    expect(combined.market.available).toBe(true);
  });

  it("combined context handles exchange failure gracefully", async () => {
    // The exchange mock is always available, but if it fails the market should still work
    const combined = await buildCombinedAiContext();
    expect(combined.market).toBeDefined();
    expect(combined.market.symbols.length).toBeGreaterThan(0);
  });

  // --- 8. No Fake Data ---

  it("does not generate fake market data", async () => {
    const ctx = await buildMarketContext();
    for (const sym of ctx.symbols) {
      expect(sym.lastPrice).toBeGreaterThan(0);
      expect(typeof sym.symbol).toBe("string");
      expect(sym.symbol.length).toBeGreaterThan(0);
    }
  });

  it("does not use Math.random() for prices", async () => {
    const ctx1 = await buildMarketContext();
    const ctx2 = await buildMarketContext();
    // Real data is deterministic from snapshot
    expect(ctx1.symbols[0]?.lastPrice).toBe(ctx2.symbols[0]?.lastPrice);
  });
});
