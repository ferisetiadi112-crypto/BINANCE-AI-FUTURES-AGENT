/**
 * P7D-5.5 — UI state derivation tests.
 *
 * Covers: freshness thresholds (P7D-5.3), explicit per-card states,
 * backend-failure isolation (offline Binance / unavailable AI / missing
 * market data never leak into other cards), and stale-data display.
 */

import { describe, it, expect } from "vitest";
import {
  FRESH_AGE_MS,
  STALE_AGE_MS,
  ageLabel,
  buildAccountCard,
  buildAiCard,
  buildBinanceCard,
  buildDecisionCard,
  buildFeedCard,
  buildMarketCard,
  buildPositionCard,
  buildRiskCard,
  freshnessFor,
  type MarketPayload,
  type RuntimePayload,
  type TestnetPayload,
} from "./ui-state";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const ago = (ms: number) => NOW - ms;

describe("freshnessFor — P7D-5.3 thresholds", () => {
  it("is UNAVAILABLE when never synced", () => {
    expect(freshnessFor(undefined, NOW)).toBe("UNAVAILABLE");
    expect(freshnessFor(null, NOW)).toBe("UNAVAILABLE");
    expect(freshnessFor(0, NOW)).toBe("UNAVAILABLE");
  });

  it("is FRESH below 30s", () => {
    expect(freshnessFor(ago(1_000), NOW)).toBe("FRESH");
    expect(freshnessFor(ago(FRESH_AGE_MS - 1), NOW)).toBe("FRESH");
  });

  it("is STALE between 30s and 120s", () => {
    expect(freshnessFor(ago(FRESH_AGE_MS), NOW)).toBe("STALE");
    expect(freshnessFor(ago(48_000), NOW)).toBe("STALE");
    expect(freshnessFor(ago(STALE_AGE_MS), NOW)).toBe("STALE");
  });

  it("is UNAVAILABLE beyond 120s", () => {
    expect(freshnessFor(ago(STALE_AGE_MS + 1), NOW)).toBe("UNAVAILABLE");
    expect(freshnessFor(ago(600_000), NOW)).toBe("UNAVAILABLE");
  });
});

describe("ageLabel", () => {
  it("returns 'never' without a timestamp", () => {
    expect(ageLabel(null, NOW)).toBe("never");
    expect(ageLabel(0, NOW)).toBe("never");
  });

  it("renders seconds / minutes", () => {
    expect(ageLabel(ago(2_000), NOW)).toBe("2s ago");
    expect(ageLabel(ago(48_000), NOW)).toBe("48s ago");
    expect(ageLabel(ago(192_000), NOW)).toBe("3m 12s ago");
  });
});

describe("buildBinanceCard", () => {
  it("LOADING while the first request is pending — with an informative label", () => {
    const card = buildBinanceCard({ pending: true, failed: false }, null, NOW);
    expect(card.phase).toBe("LOADING");
    expect(card.headline).toBe("CONNECTING");
    expect(card.statusText).toContain("Connecting to Binance Testnet");
  });

  it("never blocks on a request error", () => {
    const card = buildBinanceCard({ pending: false, failed: true }, null, NOW);
    expect(card.phase).toBe("ERROR");
    expect(card.banner).toBe("BINANCE FUTURES TESTNET OFFLINE");
  });

  it("reports OFFLINE with the required banner when Binance Testnet is offline", () => {
    const payload: TestnetPayload = {
      configured: true,
      connected: false,
      paperTrading: false,
      connectionStatus: "OFFLINE",
      lastSyncTimestamp: null,
      stale: true,
    };
    const card = buildBinanceCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("OFFLINE");
    expect(card.headline).toBe("OFFLINE");
    expect(card.banner).toBe("BINANCE FUTURES TESTNET OFFLINE");
  });

  it("treats ERROR connection status as an offline state, not a hang", () => {
    const payload: TestnetPayload = {
      configured: true,
      connected: false,
      connectionStatus: "ERROR",
      lastError: "Cannot connect to Binance Futures Testnet",
    };
    const card = buildBinanceCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("OFFLINE");
    expect(card.banner).toBe("BINANCE FUTURES TESTNET OFFLINE");
    expect(card.lastError).toContain("Cannot connect");
  });

  it("shows CONNECTED + FRESH after a recent sync", () => {
    const payload: TestnetPayload = {
      configured: true,
      connected: true,
      connectionStatus: "CONNECTED",
      lastSyncTimestamp: ago(1_000),
      stale: false,
    };
    const card = buildBinanceCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("READY");
    expect(card.headline).toBe("CONNECTED");
    expect(card.freshness).toBe("FRESH");
  });

  it("degrades when connected but the last sync is stale", () => {
    const payload: TestnetPayload = {
      configured: true,
      connected: true,
      connectionStatus: "CONNECTED",
      lastSyncTimestamp: ago(90_000),
      stale: true,
    };
    const card = buildBinanceCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("DEGRADED");
    expect(card.freshness).toBe("STALE");
  });
});

describe("buildAccountCard", () => {
  it("shows a card-local LOADING state without blocking the page", () => {
    const card = buildAccountCard({ pending: true, failed: false }, null, NOW);
    expect(card.phase).toBe("LOADING");
    expect(card.values.balance).toBeNull();
  });

  it("shows an explicit unavailable state when Binance is offline and never synced", () => {
    const card = buildAccountCard(
      { pending: false, failed: false },
      { connected: false, connectionStatus: "OFFLINE", lastSyncTimestamp: null },
      NOW,
    );
    expect(card.phase).toBe("OFFLINE");
    expect(card.message).toBe("Waiting for Binance Testnet");
  });

  it("keeps last known values flagged DEGRADED when Binance drops after a sync", () => {
    const card = buildAccountCard(
      {
        pending: false,
        failed: false,
      },
      {
        connected: false,
        connectionStatus: "OFFLINE",
        lastSyncTimestamp: ago(60_000),
        balance: 123.45,
        availableBalance: 100,
        marginBalance: 23.45,
        unrealizedPnl: 1.5,
      },
      NOW,
    );
    expect(card.phase).toBe("DEGRADED");
    expect(card.values.balance).toBe(123.45);
    expect(card.values.unrealizedPnl).toBe(1.5);
  });

  it("is READY with fresh values when connected and recently synced", () => {
    const card = buildAccountCard(
      { pending: false, failed: false },
      {
        connected: true,
        connectionStatus: "CONNECTED",
        lastSyncTimestamp: ago(2_000),
        balance: 50,
        availableBalance: 40,
        marginBalance: 10,
        unrealizedPnl: 0,
      },
      NOW,
    );
    expect(card.phase).toBe("READY");
    expect(card.freshness).toBe("FRESH");
  });
});

describe("buildPositionCard", () => {
  const position = {
    symbol: "BTCUSDT",
    side: "LONG" as const,
    size: 0.001,
    entryPrice: 60_000,
    markPrice: 60_500,
    unrealizedPnl: 0.5,
    leverage: 5,
    margin: 2,
  };

  it("shows NO_POSITION when connected without positions", () => {
    const card = buildPositionCard(
      { pending: false, failed: false },
      { connected: true, connectionStatus: "CONNECTED", positions: [] },
    );
    expect(card.state).toBe("NO_POSITION");
    expect(card.phase).toBe("EMPTY");
  });

  it("reports position data unavailable (not a hang) when Binance is offline", () => {
    const card = buildPositionCard(
      { pending: false, failed: false },
      { connected: false, connectionStatus: "OFFLINE", positions: [] },
    );
    expect(card.state).toBe("OFFLINE");
    expect(card.message).toBe("Waiting for Binance Testnet");
  });

  it("keeps last known positions flagged DEGRADED when the feed drops", () => {
    const card = buildPositionCard(
      { pending: false, failed: false },
      { connected: false, connectionStatus: "ERROR", positions: [position] },
    );
    expect(card.state).toBe("DEGRADED");
    expect(card.positions?.[0]?.symbol).toBe("BTCUSDT");
  });

  it("shows the live position when connected with data", () => {
    const card = buildPositionCard(
      { pending: false, failed: false },
      { connected: true, connectionStatus: "CONNECTED", positions: [position] },
    );
    expect(card.state).toBe("LONG");
    expect(card.phase).toBe("READY");
  });

  it("shows card-local LOADING while connecting (never page-wide)", () => {
    const card = buildPositionCard(
      { pending: true, failed: false },
      null,
    );
    expect(card.state).toBe("LOADING");
  });
});

describe("buildMarketCard — P7D-5.3 freshness in the UI", () => {
  const tick = {
    symbol: "BTCUSDT",
    lastPrice: 60_000,
    bid: 59_999,
    ask: 60_001,
    priceChangePercent24h: 1.2,
  };

  it("shows FRESH + ticks on a recent update", () => {
    const payload: MarketPayload = {
      connectionStatus: "CONNECTED",
      lastUpdateAt: ago(2_000),
      dataFreshness: "FRESH",
      ticks: [tick],
    };
    const card = buildMarketCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("READY");
    expect(card.freshness).toBe("FRESH");
    expect(card.ticks?.[0]?.symbol).toBe("BTCUSDT");
    expect(card.ageText).toContain("2s ago");
  });

  it("shows STALE (not an error) for 48s-old ticks", () => {
    const payload: MarketPayload = {
      connectionStatus: "CONNECTED",
      lastUpdateAt: ago(48_000),
      dataFreshness: "STALE",
      ticks: [tick],
    };
    const card = buildMarketCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("DEGRADED");
    expect(card.freshness).toBe("STALE");
    expect(card.ticks?.length).toBe(1);
    expect(card.ageText).toContain("48s ago");
  });

  it("shows UNAVAILABLE / waiting for Binance when no ticks ever arrived", () => {
    const payload: MarketPayload = {
      connectionStatus: "OFFLINE",
      lastUpdateAt: 0,
      dataFreshness: "UNAVAILABLE",
      ticks: [],
    };
    const card = buildMarketCard({ pending: false, failed: false }, payload, NOW);
    expect(card.freshness).toBe("UNAVAILABLE");
    expect(card.phase).toBe("OFFLINE");
    expect(card.statusText).toBe("Waiting for Binance Testnet");
  });

  it("degrades only the market card on market failure", () => {
    const card = buildMarketCard({ pending: false, failed: true }, null, NOW);
    expect(card.phase).toBe("ERROR");
    expect(card.statusText).toContain("Market status service unreachable");
  });
});

describe("buildAiCard — independent of Binance state", () => {
  it("is OFFLINE (not loading) when the scheduler is not running", () => {
    const payload: RuntimePayload = { running: false, stats: null, recentEvents: [] };
    const card = buildAiCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("OFFLINE");
    expect(card.headline).toBe("OFFLINE");
  });

  it("reports ONLINE with an activity when a cycle ran recently", () => {
    const payload: RuntimePayload = {
      running: true,
      stats: { lastTickAt: ago(5_000), startedAt: ago(60_000), executionMode: "TESTNET", tickCount: 4, totalErrors: 0 },
      recentEvents: [
        {
          timestamp: ago(5_000),
          symbol: "BTCUSDT",
          decision: "NO_TRADE",
          executionResult: "NO_TRADE",
        },
      ],
    };
    const card = buildAiCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("READY");
    expect(card.headline).toBe("ONLINE");
    expect(card.activity).toBe("MONITORING");
  });

  it("degrades (instead of spinning) when cycles stopped recently", () => {
    const payload: RuntimePayload = {
      running: true,
      stats: { lastTickAt: ago(300_000), startedAt: ago(600_000), executionMode: "TESTNET" },
      recentEvents: [],
    };
    const card = buildAiCard({ pending: false, failed: false }, payload, NOW);
    expect(card.phase).toBe("DEGRADED");
  });

  it("keeps the dashboard functional when the AI status endpoint errors", () => {
    const card = buildAiCard({ pending: false, failed: true }, null, NOW);
    expect(card.phase).toBe("ERROR");
    expect(card.statusText).toContain("AI engine status unavailable");
  });
});

describe("buildDecisionCard", () => {
  it("shows EMPTY 'No decision yet' instead of endless loading", () => {
    const payload: RuntimePayload = { running: true, stats: null, recentEvents: [] };
    const card = buildDecisionCard({ pending: false, failed: false }, payload);
    expect(card.phase).toBe("EMPTY");
    expect(card.event).toBeNull();
  });

  it("resolves to READY after the first event arrives (loading resolves after success)", () => {
    const payload: RuntimePayload = {
      running: true,
      stats: null,
      recentEvents: [{ timestamp: NOW, symbol: "ETHUSDT", decision: "LONG", confidence: 0.71, strategy: "MOMENTUM", executionResult: "NO_TRADE" }],
    };
    const card = buildDecisionCard({ pending: false, failed: false }, payload);
    expect(card.phase).toBe("READY");
    expect(card.event?.symbol).toBe("ETHUSDT");
  });

  it("resolves loading after an endpoint error", () => {
    const card = buildDecisionCard({ pending: false, failed: true }, null);
    expect(card.phase).toBe("ERROR");
    expect(card.message).toContain("Decision feed unavailable");
  });
});

describe("buildRiskCard", () => {
  it("is card-local LOADING before the orchestrator reports", () => {
    const card = buildRiskCard({ pending: true, failed: false }, null);
    expect(card.phase).toBe("LOADING");
    expect(card.risk).toBeNull();
  });

  it("degrades (never blanks the page) when risk state cannot be fetched", () => {
    const card = buildRiskCard({ pending: false, failed: true }, null);
    expect(card.phase).toBe("DEGRADED");
    expect(card.message).toContain("Risk engine state unavailable");
  });

  it("is READY with lock state once reported", () => {
    const card = buildRiskCard(
      { pending: false, failed: false },
      { dailyPnl: 0.2, sessionPnl: 0.2, isLocked: false, lockReason: "", cooldownActive: false, cooldownEndsAt: null, hardCapReached: false },
    );
    expect(card.phase).toBe("READY");
    expect(card.risk?.isLocked).toBe(false);
  });
});

describe("buildFeedCard (journal/reviews)", () => {
  it("shows per-card loading while pending", () => {
    const card = buildFeedCard({ pending: true, failed: false }, null);
    expect(card.phase).toBe("LOADING");
  });

  it("shows EMPTY for a legitimate zero count", () => {
    expect(buildFeedCard({ pending: false, failed: false }, 0).phase).toBe("EMPTY");
    expect(buildFeedCard({ pending: false, failed: false }, 5).phase).toBe("READY");
  });
});
