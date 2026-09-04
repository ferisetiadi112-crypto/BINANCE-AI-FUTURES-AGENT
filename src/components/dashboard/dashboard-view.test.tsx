/**
 * DashboardView (three-card control room) — SSR render tests.
 *
 * Verifies the acceptance-critical structure with node-side static
 * rendering: exactly three primary cards, honest empty states, and no
 * fabricated content. All inputs come from the real agent-status payload.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "./DashboardView";
import type { AgentStatusPayload } from "@/backend/api";

function makeStatus(overrides: Partial<AgentStatusPayload> = {}): AgentStatusPayload {
  return {
    status: "RUNNING",
    executionMode: "PAPER",
    tradingEnabled: false,
    currentTask: "Analyzing BTCUSDT",
    finding: "UP trend, STRONG momentum (TRENDING_UP regime)",
    decision: "WAIT",
    reason: "Confidence below threshold",
    action: "No trade executed",
    confidence: 42,
    position: null,
    pnlToday: 0,
    tradeCountToday: 0,
    lastUpdate: new Date().toISOString(),
    error: null,
    recentActivity: [],
    journal: [],
    ...overrides,
  };
}

const render = (status: AgentStatusPayload | null, opts: { connecting?: boolean; error?: boolean } = {}) =>
  renderToStaticMarkup(
    <DashboardView status={status} connecting={opts.connecting ?? false} error={opts.error ?? false} />,
  );

describe("DashboardView — three-card structure", () => {
  it("renders exactly the three primary cards (STATUS, JOURNAL, REASONING)", () => {
    const html = render(makeStatus());
    expect(html).toContain("Status");
    expect(html).toContain("Journal");
    expect(html).toContain("Reasoning");
    expect(html).toContain("AI FUTURES AGENT");
    // Bloat sections are gone:
    expect(html).not.toContain("Current Reasoning");
    expect(html).not.toContain("Last Completed Work");
    expect(html).not.toContain("Recent Completed Work");
    expect(html).not.toContain("In Development");
    expect(html).not.toContain("Performance");
    expect(html).not.toContain("Market Data");
  });

  it("STATUS contains current work, finding, decision, action, position, today PnL/trades, last update", () => {
    const html = render(makeStatus());
    expect(html).toContain("Current Work");
    expect(html).toContain("Finding");
    expect(html).toContain("Decision");
    expect(html).toContain("Action");
    expect(html).toContain("Position");
    expect(html).toContain("NONE");
    expect(html).toContain("Trades:");
    expect(html).toContain("Last Update");
  });

  it("STATUS shows real values from the payload", () => {
    const html = render(
      makeStatus({
        currentTask: "Analyzing ETHUSDT",
        finding: "DOWN trend, WEAK momentum (RANGING regime)",
        decision: "SHORT",
        position: {
          symbol: "BTCUSDT",
          side: "LONG",
          size: 0.001,
          entryPrice: 63000,
          markPrice: 63100,
          unrealizedPnl: 0.1,
          leverage: 5,
        },
        pnlToday: 1.25,
        tradeCountToday: 3,
      }),
    );
    expect(html).toContain("Analyzing ETHUSDT");
    expect(html).toContain("DOWN trend, WEAK momentum");
    expect(html).toContain("SHORT");
    expect(html).toContain("BTCUSDT");
    expect(html).toContain("$1.25");
    expect(html).toContain("Trades: 3");
  });
});

describe("DashboardView — honest empty states, no fabrication", () => {
  it("shows honest states when the agent has no data yet", () => {
    const html = render(
      makeStatus({
        status: "STARTING",
        currentTask: null,
        finding: null,
        decision: null,
        action: null,
        reason: null,
        lastUpdate: null,
      }),
    );
    expect(html).toContain("Waiting for activity");
    expect(html).toContain("Data unavailable");
  });

  it("shows agent-offline state when the runtime is offline", () => {
    const html = render(makeStatus({ status: "OFFLINE", currentTask: null, finding: null }));
    expect(html).toContain("AGENT OFFLINE");
  });

  it("shows Connecting while the first request is in flight", () => {
    const html = render(null, { connecting: true });
    expect(html).toContain("CONNECTING");
    expect(html).toContain("Connecting");
  });

  it("JOURNAL shows waiting state when no completed work exists", () => {
    const html = render(makeStatus({ journal: [] }));
    expect(html).toContain("Waiting for activity");
  });

  it("REASONING shows 'Reasoning unavailable' when no live activity exists", () => {
    const html = render(makeStatus({ recentActivity: [] }));
    expect(html).toContain("Reasoning unavailable");
  });

  it("REASONING shows agent-offline when runtime is down", () => {
    const html = render(makeStatus({ status: "OFFLINE", recentActivity: [] }));
    expect(html).toContain("Agent offline");
  });
});

describe("DashboardView — JOURNAL renders real completed work", () => {
  it("renders one entry per completed activity with real fields only", () => {
    const html = render(
      makeStatus({
        journal: [
          {
            timestamp: Date.parse("2026-09-04T12:00:00Z"),
            eventType: "TRADE_OPENED",
            symbol: "BTCUSDT",
            message: "Position opened: LONG BTCUSDT @ $63000.00 (margin: $5.00, leverage: 5x)",
            decision: "LONG",
            action: "Position opened via paper engine",
            pnl: null,
            position: { symbol: "BTCUSDT", side: "LONG", entryPrice: 63000, margin: 5, leverage: 5 },
          },
        ],
      }),
    );
    expect(html).toContain("BTCUSDT · TRADE OPENED");
    expect(html).toContain("Position opened: LONG BTCUSDT");
    expect(html).toContain("LONG");
    expect(html).toContain("$63000.00");
    expect(html).toContain("Position opened via paper engine");
  });

  it("internal events never appear (payload carries none by construction)", () => {
    const html = render(
      makeStatus({
        journal: [
          {
            timestamp: Date.now(),
            eventType: "TRADE_CLOSED",
            symbol: "ETHUSDT",
            message: "Position closed: SHORT ETHUSDT | PnL: $0.25 (TAKE_PROFIT)",
            decision: null,
            action: "Position closed: TAKE_PROFIT",
            pnl: 0.25,
            position: null,
          },
        ],
      }),
    );
    expect(html).toContain("Position closed: TAKE_PROFIT");
    expect(html).toContain("PnL: $0.25");
    expect(html).not.toContain("RISK_CHECK");
    expect(html).not.toContain("MARKET_SCAN");
  });
});

describe("DashboardView — REASONING live stream", () => {
  it("renders up to 5 real activity lines, newest last, excluding internal events", () => {
    const activity = [
      { timestamp: 1, eventType: "MARKET_SCAN", message: "Market scan: BTCUSDT (quality: GOOD)" },
      { timestamp: 2, eventType: "RISK_CHECK", message: "Risk check: LONG BTCUSDT" },
      { timestamp: 3, eventType: "TRADE_PROPOSED", message: "Trade proposed: LONG BTCUSDT" },
      { timestamp: 4, eventType: "SYSTEM_STARTED", message: "Trading system started" },
      { timestamp: 5, eventType: "TRADE_APPROVED", message: "Trade approved: LONG BTCUSDT" },
      { timestamp: 6, eventType: "TRADE_OPENED", message: "Position opened: LONG BTCUSDT" },
    ];
    const html = render(makeStatus({ recentActivity: activity }));
    expect(html).toContain("Trade proposed: LONG BTCUSDT");
    expect(html).toContain("Trade approved: LONG BTCUSDT");
    expect(html).toContain("Position opened: LONG BTCUSDT");
    expect(html).not.toContain("Market scan: BTCUSDT");
    expect(html).not.toContain("Risk check: LONG BTCUSDT");
  });

  it("drops lines beyond the 5-line cap", () => {
    const activity = Array.from({ length: 9 }, (_, i) => ({
      timestamp: i + 1,
      eventType: "TRADE_APPROVED",
      message: `Event number ${i + 1}`,
    }));
    const html = render(makeStatus({ recentActivity: activity }));
    expect(html).not.toContain("Event number 1");
    expect(html).not.toContain("Event number 4");
    expect(html).toContain("Event number 5");
    expect(html).toContain("Event number 9");
  });
});

describe("DashboardView — error banner", () => {
  it("surfaces a real server-side error message", () => {
    const html = render(makeStatus({ error: "Exchange sync failing: timeout" }));
    expect(html).toContain("Exchange sync failing: timeout");
  });

  it("shows unreachable banner when the query errors with no payload", () => {
    const html = render(null, { error: true });
    expect(html).toContain("Cannot reach the agent server.");
  });
});
