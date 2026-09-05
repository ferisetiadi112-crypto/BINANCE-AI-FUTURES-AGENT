/**
 * Phase 3.5-S — Testnet display-state resolution tests.
 *
 * Verifies the Command Center card lifecycle:
 *   A. initial loading  → "Checking Binance Testnet..." (never NOT CONFIGURED)
 *   B. timeout/error    → "Binance data temporarily unavailable" (never NOT CONFIGURED)
 *   C. authenticated=false → NOT CONFIGURED (real diagnostics)
 *   D. credentials absent  → NOT CONFIGURED (real diagnostics)
 *   E. prev LIVE data + refetch pending → LIVE data remains
 *   F. prev LIVE data + refetch error  → LIVE data remains + banner
 *   G. successful diagnostics → LIVE + balance + position + orders
 *   H. malformed position → no NaN
 */
import { describe, expect, it } from "vitest";
import { resolveTestnetDisplayState } from "./testnet-card-mapping";

const livePayload = {
  diagnostics: {
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
  },
};

describe("resolveTestnetDisplayState (Phase 3.5-S)", () => {
  it("A: initial loading → Checking Binance Testnet..., never NOT CONFIGURED", () => {
    const d = resolveTestnetDisplayState({ state: "pending", payload: undefined });
    expect(d.status).toBe("pending");
    expect(d.banner).toBe("Checking Binance Testnet...");
    expect(JSON.stringify(d)).not.toContain("NOT CONFIGURED");
  });

  it("B: error without previous data → temporarily unavailable, never NOT CONFIGURED", () => {
    const d = resolveTestnetDisplayState({ state: "error", payload: undefined });
    expect(d.status).toBe("error");
    expect(d.banner).toBe("Binance data temporarily unavailable");
    expect(d.card).toBeNull();
    expect(JSON.stringify(d)).not.toContain("NOT CONFIGURED");
  });

  it("C: authenticated=false → NOT CONFIGURED (from real diagnostics)", () => {
    const d = resolveTestnetDisplayState({
      state: "ok",
      payload: {
        diagnostics: {
          ...livePayload.diagnostics,
          binance: { mode: "TESTNET", authenticated: false },
        },
      },
    });
    expect(d.status).toBe("ok");
    expect(d.card!.statusLabel).toBe("NOT CONFIGURED");
  });

  it("D: credentials absent → NOT CONFIGURED (from real diagnostics)", () => {
    const d = resolveTestnetDisplayState({
      state: "ok",
      payload: {
        diagnostics: {
          ...livePayload.diagnostics,
          environment: { apiKeyConfigured: false, secretConfigured: false },
          // auth cannot be verified without credentials
          binance: { mode: "UNAVAILABLE", authenticated: null },
        },
      },
    });
    expect(d.card!.statusLabel).toBe("NOT CONFIGURED");
  });

  it("D2: credentials absent but auth succeeded → LIVE wins (auth is authoritative)", () => {
    const d = resolveTestnetDisplayState({ state: "ok", payload: livePayload });
    expect(d.card!.statusLabel).toBe("LIVE");
  });

  it("E: previous LIVE payload + pending refetch → payload intact (keepPreviousData path)", () => {
    // With React Query keeping the previous payload during a background
    // refetch, state stays "ok" and the LIVE card is preserved.
    const d = resolveTestnetDisplayState({ state: "ok", payload: livePayload });
    expect(d.status).toBe("ok");
    expect(d.card!.statusLabel).toBe("LIVE");
    expect(d.card!.balance).toBe(5000);
  });

  it("F: previous LIVE payload + error → LIVE card retained + non-blocking banner", () => {
    const d = resolveTestnetDisplayState({ state: "error", payload: livePayload });
    expect(d.status).toBe("error");
    expect(d.banner).toBe("Binance data temporarily unavailable");
    if (d.status === "error") {
      expect(d.lastKnownGood).toBe(true);
    }
    expect(d.card!.statusLabel).toBe("LIVE");
    expect(d.card!.balance).toBe(5000);
    expect(d.card!.position!.quantity).toBe(7);
    expect(d.card!.openOrderCount).toBe(0);
  });

  it("G: successful diagnostics → LIVE + balance + position + orders", () => {
    const d = resolveTestnetDisplayState({ state: "ok", payload: livePayload });
    expect(d.card!.statusLabel).toBe("LIVE");
    expect(d.card!.balance).toBe(5000);
    expect(d.card!.position).toEqual({
      symbol: "SNTUSDT",
      side: "SHORT",
      quantity: 7,
      unrealizedPnl: -1.23,
    });
    expect(d.card!.openOrderCount).toBe(0);
  });

  it("H: malformed position quantity → no NaN, safe unavailable position", () => {
    const d = resolveTestnetDisplayState({
      state: "ok",
      payload: {
        diagnostics: {
          ...livePayload.diagnostics,
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
      },
    });
    expect(d.card!.position).toBeNull();
    expect(JSON.stringify(d.card)).not.toContain("NaN");
  });
});
