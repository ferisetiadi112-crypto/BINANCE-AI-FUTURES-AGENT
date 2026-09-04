/**
 * P7D-5.5 — dashboard shell render tests (node environment, react-dom/server).
 *
 * The dashboard view is prop-driven: we feed it derived models for the
 * scenarios below (no backend yet, Binance offline, AI offline, market
 * unavailable, stale data) and assert the rendered shell — i.e. that a
 * failing subsystem never blanks or blocks the rest of the UI.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView, type DashboardModel } from "./DashboardView";
import {
  buildAccountCard,
  buildAiCard,
  buildBinanceCard,
  buildDecisionCard,
  buildFeedCard,
  buildMarketCard,
  buildPositionCard,
  buildRiskCard,
  type MarketPayload,
  type RuntimePayload,
  type TestnetPayload,
} from "@/lib/ui-state";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const ago = (ms: number) => NOW - ms;

function makeModel(opts: {
  testnet?: TestnetPayload | null;
  testnetPending?: boolean;
  testnetFailed?: boolean;
  runtime?: RuntimePayload | null;
  runtimePending?: boolean;
  runtimeFailed?: boolean;
  market?: MarketPayload | null;
  marketPending?: boolean;
  journalCount?: number;
} = {}): DashboardModel {
  const tq = { pending: opts.testnetPending ?? false, failed: opts.testnetFailed ?? false };
  const rq = { pending: opts.runtimePending ?? false, failed: opts.runtimeFailed ?? false };
  const mq = { pending: opts.marketPending ?? false, failed: false };

  return {
    binance: buildBinanceCard(tq, opts.testnet, NOW),
    ai: buildAiCard(rq, opts.runtime, NOW),
    market: buildMarketCard(mq, opts.market, NOW),
    account: buildAccountCard(tq, opts.testnet, NOW),
    position: buildPositionCard(tq, opts.testnet),
    risk: buildRiskCard({ pending: false, failed: false }, {
      dailyPnl: 0,
      sessionPnl: 0,
      isLocked: false,
      lockReason: "",
      cooldownActive: false,
      cooldownEndsAt: null,
      hardCapReached: false,
    }),
    decision: buildDecisionCard(rq, opts.runtime),
    reviews: buildFeedCard({ pending: false, failed: false }, 0),
    journal: buildFeedCard({ pending: false, failed: false }, opts.journalCount ?? 0),
    journalEvents: [],
    reviewsItems: [],
    tradingEnabled: false,
    executionMode: "PAPER",
  };
}

const render = (model: DashboardModel) => renderToStaticMarkup(<DashboardView model={model} />);

describe("DashboardView — instant first paint", () => {
  it("renders the full shell before any backend data arrives", () => {
    const html = render(
      makeModel({
        testnetPending: true,
        runtimePending: true,
        marketPending: true,
      }),
    );

    expect(html).toContain("AI Futures Trading Observatory");
    expect(html).toContain("BINANCE FUTURES TESTNET");
    expect(html).toContain("Connecting to Binance Testnet");
    expect(html).toContain("AI ENGINE");
    expect(html).toContain("MARKET DATA");
    expect(html).toContain("Account");
    expect(html).toContain("Risk State");
    expect(html).toContain("Active Position");
    expect(html).toContain("AI Decision Journal");
    // No page-wide “Loading entire application…” placeholder.
    expect(html).not.toContain("Loading entire application");
  });
});

describe("DashboardView — Binance offline never blocks the UI", () => {
  const offlineModel = () =>
    makeModel({
      testnet: {
        configured: true,
        connected: false,
        connectionStatus: "OFFLINE",
        lastSyncTimestamp: null,
        stale: true,
        paperTrading: false,
      },
      runtime: {
        running: true,
        stats: { lastTickAt: ago(4_000), startedAt: ago(60_000), executionMode: "TESTNET" },
        recentEvents: [
          { timestamp: ago(4_000), symbol: "BTCUSDT", decision: "NO_TRADE", executionResult: "NO_TRADE" },
        ],
      },
    });

  it("shows BINANCE FUTURES TESTNET OFFLINE prominently", () => {
    const html = render(offlineModel());
    expect(html).toContain("BINANCE FUTURES TESTNET OFFLINE");
  });

  it("still renders AI, market, account, risk and position cards", () => {
    const html = render(offlineModel());
    expect(html).toContain("AI ENGINE");
    expect(html).toContain("MARKET DATA");
    expect(html).toContain("ACCOUNT DATA UNAVAILABLE");
    expect(html).toContain("POSITION DATA UNAVAILABLE");
    expect(html).toContain("Risk State");
    expect(html).not.toContain("Loading entire application");
  });

  it("AI stays ONLINE/ANALYZING while Binance is offline", () => {
    const html = render(offlineModel());
    expect(html).toContain("ONLINE");
    expect(html).toContain("MONITORING");
  });
});

describe("DashboardView — AI unavailable never blocks the UI", () => {
  const aiOfflineModel = () =>
    makeModel({
      testnet: {
        configured: false,
        connected: false,
        connectionStatus: "OFFLINE",
        paperTrading: true,
      },
      runtime: { running: false, stats: null, recentEvents: [] },
      market: {
        connectionStatus: "CONNECTED",
        lastUpdateAt: ago(1_000),
        dataFreshness: "FRESH",
        ticks: [{ symbol: "BTCUSDT", lastPrice: 60_000, bid: 59_999, ask: 60_001, priceChangePercent24h: 0.5 }],
      },
    });

  it("labels the AI engine OFFLINE and keeps the dashboard alive", () => {
    const html = render(aiOfflineModel());
    expect(html).toContain("AI ENGINE");
    expect(html).toContain("AI scheduler not running");
    expect(html).toContain("AI Futures Trading Observatory");
    expect(html).toContain("No decision yet");
  });

  it("shows market data FRESH while AI is down (isolation)", () => {
    const html = render(aiOfflineModel());
    expect(html).toContain("BTCUSDT");
    expect(html).toContain("FRESH");
  });
});

describe("DashboardView — market data unavailable", () => {
  it("shows the UNAVAILABLE state with the waiting message", () => {
    const html = render(
      makeModel({
        testnet: { configured: true, connected: true, connectionStatus: "CONNECTED", lastSyncTimestamp: ago(2_000) },
        market: { connectionStatus: "OFFLINE", lastUpdateAt: 0, dataFreshness: "UNAVAILABLE", ticks: [] },
        journalCount: 3,
      }),
    );
    expect(html).toContain("UNAVAILABLE");
    expect(html).toContain("Waiting for Binance Testnet");
    // Binance connection itself is fine — only market degraded.
    expect(html).toContain("CONNECTED");
  });
});

describe("DashboardView — stale data UX", () => {
  it("marks 48s-old market ticks as STALE with the age shown", () => {
    const html = render(
      makeModel({
        testnet: { configured: true, connected: true, connectionStatus: "CONNECTED", lastSyncTimestamp: ago(2_000) },
        market: {
          connectionStatus: "CONNECTED",
          lastUpdateAt: ago(48_000),
          dataFreshness: "STALE",
          ticks: [{ symbol: "ETHUSDT", lastPrice: 3_400, priceChangePercent24h: -0.2 }],
        },
      }),
    );
    expect(html).toContain("STALE");
    expect(html).toContain("48s ago");
    expect(html).toContain("ETHUSDT");
  });

  it("marks fresh data as FRESH with a recent age", () => {
    const html = render(
      makeModel({
        testnet: { connected: true, connectionStatus: "CONNECTED", lastSyncTimestamp: ago(1_000) },
        market: {
          connectionStatus: "CONNECTED",
          lastUpdateAt: ago(2_000),
          dataFreshness: "FRESH",
          ticks: [{ symbol: "SOLUSDT", lastPrice: 180, priceChangePercent24h: 1.1 }],
        },
      }),
    );
    expect(html).toContain("FRESH");
    expect(html).toContain("2s ago");
    expect(html).toContain("SOLUSDT");
  });
});

describe("DashboardView — account unavailable shows only that card", () => {
  it("shows account unavailable while the position/market cards remain intact", () => {
    const html = render(
      makeModel({
        testnet: { connected: false, connectionStatus: "OFFLINE", lastSyncTimestamp: null, positions: [] },
        market: {
          connectionStatus: "CONNECTED",
          lastUpdateAt: ago(1_000),
          dataFreshness: "FRESH",
          ticks: [{ symbol: "BNBUSDT", lastPrice: 600, priceChangePercent24h: 0.2 }],
        },
        journalCount: 2,
      }),
    );
    expect(html).toContain("ACCOUNT DATA UNAVAILABLE");
    expect(html).toContain("Waiting for Binance Testnet");
    expect(html).toContain("BNBUSDT");
    expect(html).toContain("AI Decision Journal");
  });
});

describe("DashboardView — no credentials reach the client markup", () => {
  it("drops apiKey/apiSecret-shaped fields even if a payload carries them", () => {
    // Simulating an over-broad backend payload that happens to carry
    // credential-shaped fields the client must never serialize.
    const poisoned = {
      configured: true,
      connected: true,
      connectionStatus: "CONNECTED",
      lastSyncTimestamp: ago(1_000),
      apiKey: "sk-super-secret",
      apiSecret: "ss-super-secret",
      secretToken: "token-leak",
    } as TestnetPayload;
    const model = makeModel({
      testnet: poisoned,
      market: { connectionStatus: "OFFLINE", lastUpdateAt: 0, dataFreshness: "UNAVAILABLE", ticks: [] },
    });

    const html = render(model);
    expect(html).not.toContain("sk-super-secret");
    expect(html).not.toContain("ss-super-secret");
    expect(html).not.toContain("token-leak");

    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("apiSecret");
    expect(serialized).not.toContain("secretToken");
  });
});
