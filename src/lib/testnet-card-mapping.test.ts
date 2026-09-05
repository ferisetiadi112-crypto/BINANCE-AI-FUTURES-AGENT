/**
 * Phase 3.5-N — Command Center testnet card mapping tests.
 *
 * Verifies the diagnostics-first mapping with safe fallbacks:
 *   A. authenticated diagnostics → LIVE + balance + position
 *   B. diagnostics unavailable → safe unavailable state, no fake $0.00
 *   C. authenticated=false → NOT CONFIGURED
 *   3.5-Q: live position mapping — NaN/quantity/PnL (Cases A–F)
 */
import { describe, expect, it } from "vitest";
import { buildTestnetCardData } from "./testnet-card-mapping";

const liveDiagnostics = {
  environment: { apiKeyConfigured: true, secretConfigured: true },
  binance: { mode: "TESTNET", authenticated: true },
  account: { balanceReadable: true, balance: 5000 },
  position: {
    readable: true,
    hasPosition: true,
    symbol: "SNTUSDT",
    side: "SHORT",
    quantity: 7,
    entryPrice: 0.5,
    unrealizedPnl: -1.23,
  },
  orders: { readable: true, openOrderCount: 0 },
};

describe("buildTestnetCardData", () => {
  it("CASE A: authenticated diagnostics → LIVE, balance 5000, SNTUSDT SHORT 7", () => {
    const card = buildTestnetCardData({ diagnostics: liveDiagnostics });

    expect(card.statusLabel).toBe("LIVE");
    expect(card.statusTone).toBe("gain");
    expect(card.balance).toBe(5000);
    expect(card.balanceAvailable).toBe(true);
    expect(card.positionCount).toBe(1);
    expect(card.position).toEqual({
      symbol: "SNTUSDT",
      side: "SHORT",
      quantity: 7,
      unrealizedPnl: -1.23,
    });
    expect(card.unrealizedPnl).toBe(-1.23);
    expect(card.openOrderCount).toBe(0);
  });

  it("CASE B: diagnostics unavailable + empty snapshot → safe unavailable, no fake $0.00", () => {
    // Serverless cold start: snapshot empty, no diagnostics.
    const card = buildTestnetCardData({
      configured: false,
      connected: false,
      balance: 0,
      positions: [],
    });

    expect(card.statusLabel).toBe("NOT CONFIGURED");
    expect(card.balanceAvailable).toBe(false);
    expect(card.balance).toBeNull(); // never presents $0.00 as live Binance data
    expect(card.positionCount).toBeNull();
    expect(card.unrealizedPnl).toBeNull();
  });

  it("CASE B2: fully undefined payload → safe unavailable", () => {
    const card = buildTestnetCardData(null);
    expect(card.statusLabel).toBe("NOT CONFIGURED");
    expect(card.balance).toBeNull();
    expect(card.balanceAvailable).toBe(false);
  });

  it("CASE C: authenticated=false → NOT CONFIGURED, no trading capability implied", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        binance: { mode: "TESTNET", authenticated: false },
      },
    });

    expect(card.statusLabel).toBe("NOT CONFIGURED");
    expect(card.statusTone).toBe("warn");
    expect(card.balanceAvailable).toBe(false);
    expect(card.balance).toBeNull();
    expect(card.position).toBeNull();
    expect(card.unrealizedPnl).toBeNull();
  });

  it("CASE D: credentials present but not yet authenticated → CONFIGURED (warn), no balance", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        binance: { mode: "TESTNET", authenticated: null },
      },
    });

    expect(card.statusLabel).toBe("CONFIGURED");
    expect(card.balance).toBeNull();
    expect(card.balanceAvailable).toBe(false);
  });

  it("Phase 3.5-P: testnet error payload (no data) → explicit unavailable, no fake $0.00", () => {
    // Simulates the component passing undefined when the testnet query errored
    // — must never present $0.00 as a live Binance balance.
    const card = buildTestnetCardData(undefined);
    expect(card.balanceAvailable).toBe(false);
    expect(card.balance).toBeNull();
    expect(card.statusLabel).toBe("NOT CONFIGURED");
  });

  it("Phase 3.5-P: mapping is independent of wallet/audit payloads (isolation)", () => {
    // The mapping only receives the testnet payload — wallet/audit loading or
    // errors cannot change its output by construction.
    const card = buildTestnetCardData({ diagnostics: liveDiagnostics });
    expect(card.statusLabel).toBe("LIVE");
    expect(card.balance).toBe(5000);
    // Same input, same output — no hidden dependency on other query states.
    expect(buildTestnetCardData({ diagnostics: liveDiagnostics })).toEqual(card);
  });

  it("falls back to a genuinely connected snapshot when diagnostics is absent", () => {
    const card = buildTestnetCardData({
      configured: true,
      connected: true,
      balance: 4200,
      positions: [{ unrealizedPnl: 12.5 }],
    });

    expect(card.statusLabel).toBe("LIVE");
    expect(card.balance).toBe(4200);
    expect(card.positionCount).toBe(1);
    expect(card.unrealizedPnl).toBe(12.5);
  });

  // ─── Phase 3.5-Q — live position mapping (NaN / PnL) ───────────────

  it("CASE A (3.5-Q): live SHORT position with finite PnL renders correctly", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        position: {
          readable: true,
          hasPosition: true,
          symbol: "SNTUSDT",
          side: "SHORT",
          quantity: 7,
          entryPrice: 0.5,
          unrealizedPnl: -2.34,
        },
      },
    });

    expect(card.statusLabel).toBe("LIVE");
    expect(card.position).toEqual({
      symbol: "SNTUSDT",
      side: "SHORT",
      quantity: 7,
      unrealizedPnl: -2.34,
    });
    expect(card.unrealizedPnl).toBe(-2.34);
    expect(Number.isFinite(card.position!.quantity)).toBe(true);
  });

  it("CASE B (3.5-Q): no position → 0 open positions, no fabricated PnL", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        position: {
          readable: true,
          hasPosition: false,
          symbol: null,
          side: null,
          quantity: null,
          entryPrice: null,
          unrealizedPnl: null,
        },
      },
    });

    expect(card.positionCount).toBe(0);
    expect(card.position).toBeNull();
    expect(card.unrealizedPnl).toBeNull();
  });

  it("CASE C (3.5-Q): malformed/missing quantity → safe unavailable, NEVER NaN", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        position: {
          readable: true,
          hasPosition: true,
          symbol: "SNTUSDT",
          side: "SHORT",
          quantity: NaN,
          entryPrice: null,
          unrealizedPnl: NaN,
        },
      },
    });

    expect(card.position).toBeNull();
    expect(card.positionCount).toBe(0);
    expect(card.unrealizedPnl).toBeNull();
  });

  it("CASE D (3.5-Q): quantity as numeric string \"7\" → 7, not NaN", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        position: {
          readable: true,
          hasPosition: true,
          symbol: "SNTUSDT",
          side: "SHORT",
          quantity: "7" as unknown as number,
          entryPrice: null,
          unrealizedPnl: "-1.5" as unknown as number,
        },
      },
    });

    expect(card.position).toEqual({
      symbol: "SNTUSDT",
      side: "SHORT",
      quantity: 7,
      unrealizedPnl: -1.5,
    });
  });

  it("CASE E (3.5-Q): signed positionAmt (negative = SHORT) → absolute quantity, side preserved", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        position: {
          readable: true,
          hasPosition: true,
          symbol: "SNTUSDT",
          side: "SHORT",
          quantity: -7,
          entryPrice: null,
          unrealizedPnl: 3.21,
        },
      },
    });

    expect(card.position!.quantity).toBe(7);
    expect(card.position!.side).toBe("SHORT");
    expect(card.unrealizedPnl).toBe(3.21);
  });

  it("CASE F (3.5-Q): missing PnL → null (unavailable), never fabricated $0.00-as-live", () => {
    const card = buildTestnetCardData({
      diagnostics: {
        ...liveDiagnostics,
        position: {
          readable: true,
          hasPosition: true,
          symbol: "SNTUSDT",
          side: "SHORT",
          quantity: 7,
          entryPrice: null,
          unrealizedPnl: null,
        },
      },
    });

    expect(card.position).not.toBeNull();
    expect(card.position!.quantity).toBe(7);
    expect(card.unrealizedPnl).toBeNull();
  });
});
