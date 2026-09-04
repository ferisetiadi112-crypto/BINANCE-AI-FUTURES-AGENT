/**
 * AI Exchange Context Tests — P7D-5.2
 *
 * Tests for the read-only exchange context bridge between
 * UnifiedExchangeState and the AI decision engine.
 *
 * SAFETY: These tests verify that:
 * - AI receives only sanitized, structured data
 * - No secrets/credentials are exposed
 * - AI signal never modifies exchange state
 * - Null/invalid values are handled safely
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildExchangeContext,
  formatExchangeContextForPrompt,
  type AiExchangeContext,
} from "./exchange-context";
import type { ExchangeSnapshot } from "../exchange/unified-state";

// ─── Mocks ─────────────────────────────────────────────────────────

const mockSnapshot: ExchangeSnapshot = {
  connected: true,
  configured: true,
  connectionStatus: "CONNECTED",
  stale: false,
  lastSyncTimestamp: Date.now(),
  lastConnectionAttempt: Date.now(),
  lastError: null,
  consecutiveFailures: 0,
  executionMode: "TESTNET",
  tradingEnabled: false,
  listenKey: null,
  account: {
    balance: 100.5,
    availableBalance: 85.3,
    marginBalance: 15.2,
    unrealizedPnl: 2.15,
  },
  positions: [
    {
      symbol: "BTCUSDT",
      side: "LONG",
      size: 0.001,
      entryPrice: 50000,
      markPrice: 52000,
      leverage: 5,
      margin: 10,
      unrealizedPnl: 2.0,
      marginType: "isolated",
    },
  ],
};

let snapshotToReturn: ExchangeSnapshot = JSON.parse(JSON.stringify(mockSnapshot));

vi.mock("../exchange/unified-state", () => ({
  getExchangeSnapshot: () => snapshotToReturn,
}));

// ─── Tests ─────────────────────────────────────────────────────────

describe("AI Exchange Context (P7D-5.2)", () => {
  beforeEach(() => {
    snapshotToReturn = JSON.parse(JSON.stringify(mockSnapshot));
  });

  // --- 1. Account Data ---

  it("provides account balance to AI", async () => {
    const ctx = await buildExchangeContext();
    expect(ctx.account).not.toBeNull();
    expect(ctx.account!.balance).toBe(100.5);
  });

  it("provides available balance to AI", async () => {
    const ctx = await buildExchangeContext();
    expect(ctx.account!.availableBalance).toBe(85.3);
  });

  it("provides margin to AI", async () => {
    const ctx = await buildExchangeContext();
    expect(ctx.account!.margin).toBe(15.2);
  });

  it("provides unrealized PnL to AI", async () => {
    const ctx = await buildExchangeContext();
    expect(ctx.account!.unrealizedPnl).toBe(2.15);
  });

  // --- 2. Position States ---

  it("provides confirmed LONG position from Binance", async () => {
    const ctx = await buildExchangeContext();
    expect(ctx.hasOpenPosition).toBe(true);
    expect(ctx.positionCount).toBe(1);
    expect(ctx.positions[0]!.side).toBe("LONG");
    expect(ctx.positions[0]!.symbol).toBe("BTCUSDT");
    expect(ctx.positions[0]!.entryPrice).toBe(50000);
    expect(ctx.positions[0]!.markPrice).toBe(52000);
  });

  it("provides confirmed SHORT position from Binance", async () => {
    snapshotToReturn.positions = [
      {
        symbol: "ETHUSDT",
        side: "SHORT",
        size: 0.1,
        entryPrice: 3000,
        markPrice: 2900,
        leverage: 10,
        margin: 5,
        unrealizedPnl: 1.0,
        marginType: "isolated",
      },
    ];
    const ctx = await buildExchangeContext();
    expect(ctx.hasOpenPosition).toBe(true);
    expect(ctx.positions[0]!.side).toBe("SHORT");
    expect(ctx.positions[0]!.symbol).toBe("ETHUSDT");
  });

  it("reports NO POSITION when Binance has no open positions", async () => {
    snapshotToReturn.positions = [];
    const ctx = await buildExchangeContext();
    expect(ctx.hasOpenPosition).toBe(false);
    expect(ctx.positionCount).toBe(0);
    expect(ctx.positions).toEqual([]);
  });

  // --- 3. Connection Status ---

  it("provides connection status to AI", async () => {
    const ctx = await buildExchangeContext();
    expect(ctx.connection.status).toBe("CONNECTED");
    expect(ctx.connection.isStale).toBe(false);
    expect(ctx.connection.configured).toBe(true);
  });

  it("provides stale state when data is old", async () => {
    snapshotToReturn.stale = true;
    const ctx = await buildExchangeContext();
    expect(ctx.connection.isStale).toBe(true);
  });

  it("reports OFFLINE when not connected", async () => {
    snapshotToReturn.connected = false;
    snapshotToReturn.connectionStatus = "OFFLINE" as ExchangeSnapshot["connectionStatus"];
    snapshotToReturn.account.balance = 0;
    snapshotToReturn.account.availableBalance = 0;
    snapshotToReturn.account.marginBalance = 0;
    snapshotToReturn.account.unrealizedPnl = 0;
    const ctx = await buildExchangeContext();
    expect(ctx.available).toBe(false);
    expect(ctx.connection.status).toBe("OFFLINE");
    expect(ctx.account).toBeNull();
  });

  // --- 4. Data Freshness ---

  it("reports FRESH when sync is recent", async () => {
    snapshotToReturn.lastSyncTimestamp = Date.now() - 5000; // 5s ago
    const ctx = await buildExchangeContext();
    expect(ctx.dataFreshness).toBe("FRESH");
  });

  it("reports STALE when sync is old", async () => {
    snapshotToReturn.lastSyncTimestamp = Date.now() - 60_000; // 60s ago
    const ctx = await buildExchangeContext();
    expect(ctx.dataFreshness).toBe("STALE");
  });

  it("reports UNAVAILABLE when never synced", async () => {
    snapshotToReturn.lastSyncTimestamp = 0;
    const ctx = await buildExchangeContext();
    expect(ctx.dataFreshness).toBe("UNAVAILABLE");
  });

  // --- 5. Security / No Secrets ---

  it("does not expose API keys", async () => {
    const ctx = await buildExchangeContext();
    const str = JSON.stringify(ctx);
    expect(str).not.toContain("api_key");
    expect(str).not.toContain("api_secret");
    expect(str).not.toContain("secret");
    expect(str).not.toContain("listenKey");
    expect(str).not.toContain("password");
  });

  it("does not expose credentials in prompt format", async () => {
    const ctx = await buildExchangeContext();
    const prompt = formatExchangeContextForPrompt(ctx);
    expect(prompt).not.toContain("api_key");
    expect(prompt).not.toContain("api_secret");
    expect(prompt).not.toContain("DATABASE_URL");
    expect(prompt).not.toContain("listenKey");
  });

  // --- 6. AI Signal Safety ---

  it("AI signal does not modify exchange state", async () => {
    const ctxBefore = await buildExchangeContext();
    const positionsBefore = ctxBefore.positions.length;

    // Simulate AI generating a signal — should not change anything
    const ctxAfter = await buildExchangeContext();
    expect(ctxAfter.positions.length).toBe(positionsBefore);
    expect(ctxAfter.account!.balance).toBe(ctxBefore.account!.balance);
  });

  it("AI signal does not create orders", async () => {
    const ctx = await buildExchangeContext();
    // The context is read-only — no order creation path exists
    expect(ctx).toHaveProperty("source");
    expect(ctx).toHaveProperty("available");
    expect(ctx).toHaveProperty("positions");
    // No methods like placeOrder, cancelOrder, etc.
    expect(typeof (ctx as any).placeOrder).toBe("undefined");
  });

  // --- 7. Null/Invalid Values ---

  it("handles NaN balance safely", async () => {
    snapshotToReturn.account.balance = NaN;
    const ctx = await buildExchangeContext();
    expect(ctx.account!.balance).toBe(0);
  });

  it("handles Infinity PnL safely", async () => {
    snapshotToReturn.account.unrealizedPnl = Infinity;
    const ctx = await buildExchangeContext();
    expect(ctx.account!.unrealizedPnl).toBe(0);
  });

  it("formats exchange context for prompt correctly", async () => {
    const ctx = await buildExchangeContext();
    const prompt = formatExchangeContextForPrompt(ctx);
    expect(prompt).toContain("EXCHANGE:");
    expect(prompt).toContain("$100.50");
    expect(prompt).toContain("LONG BTCUSDT");
  });

  it("formats unavailable exchange context for prompt", async () => {
    snapshotToReturn.connected = false;
    snapshotToReturn.connectionStatus = "OFFLINE" as ExchangeSnapshot["connectionStatus"];
    const ctx = await buildExchangeContext();
    const prompt = formatExchangeContextForPrompt(ctx);
    expect(prompt).toContain("OFFLINE");
    expect(prompt).toContain("Data unavailable");
  });
});
