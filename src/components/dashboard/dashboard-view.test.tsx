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

type JournalFixture = import("@/backend/api").AgentJournalPayload | null;

const render = (
  status: AgentStatusPayload | null,
  _opts: { connecting?: boolean; error?: boolean } = {},
  journalOverrides: Partial<NonNullable<JournalFixture>> = {},
  renderOpts: { connecting?: boolean; journalError?: boolean } = {},
) =>
  renderToStaticMarkup(
    <DashboardView
      status={status}
      connecting={renderOpts.connecting ?? _opts.connecting ?? false}
      error={_opts.error ?? false}
      journal={
        "workLog" in journalOverrides || Object.keys(journalOverrides).length > 0
          ? {
              availableDates: [],
              days: [],
              workLog: [],
              fetchedAt: new Date().toISOString(),
              ...journalOverrides,
            }
          : null
      }
      journalConnecting={false}
      journalError={renderOpts.journalError ?? false}
    />,
  );

describe("DashboardView — three-card structure", () => {
  it("renders exactly the three primary cards (STATUS, JOURNAL, REASONING)", () => {
    const html = render(makeStatus());
    expect(html).toContain("Status");
    expect(html).toContain("Journal");
    expect(html).toContain("Live Work Log");
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

  it("JOURNAL shows waiting state only when no work exists anywhere (live fallback)", () => {
    const html = render(makeStatus({ journal: [] }));
    expect(html).toContain("Waiting for activity");
  });

  it("LIVE WORK LOG shows honest empty state when the database has zero events", () => {
    const html = render(makeStatus({ recentActivity: [] }));
    expect(html).toContain("No agent events recorded yet");
  });

  it("LIVE WORK LOG falls back to PERSISTED meta when runtime is down", () => {
    const html = render(makeStatus({ status: "OFFLINE", recentActivity: [] }));
    expect(html).toContain("AGENT OFFLINE");
    expect(html).toContain("PERSISTED");
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

describe("DashboardView — LIVE WORK LOG (persistent, DB-backed)", () => {
  it("renders categorized persisted work-log events with [CATEGORY] prefix, oldest last", () => {
    const html = render(
      makeStatus(),
      {},
      {
        workLog: [
          {
            id: "w1",
            timestamp: 1,
            date: "2026-09-05",
            time: "09:47:29",
            eventType: "MARKET_SCAN",
            category: "MARKET",
            symbol: "BTCUSDT",
            action: null,
            message: "Market scan: BTCUSDT",
            status: null,
            pnl: null,
            position: null,
          },
          {
            id: "w2",
            timestamp: 2,
            date: "2026-09-05",
            time: "09:47:31",
            eventType: "RISK_CHECK",
            category: "RISK",
            symbol: "BTCUSDT",
            action: null,
            message: "Risk check: LONG BTCUSDT",
            status: "APPROVED",
            pnl: null,
            position: null,
          },
        ],
      },
    );
    expect(html).toContain("[MARKET]");
    expect(html).toContain("[RISK]");
    expect(html).toContain("Market scan: BTCUSDT");
    expect(html).toContain("Risk check: LONG BTCUSDT");
  });

  it("shows stored work-log events even when the agent is offline (reconnection-safe)", () => {
    const html = render(
      makeStatus({ status: "OFFLINE" }),
      {},
      {
        workLog: [
          {
            id: "w1",
            timestamp: 1,
            date: "2026-09-05",
            time: "09:47:29",
            eventType: "POSITION_OPENED",
            category: "ACTION",
            symbol: "TROUSDT",
            action: null,
            message: "Position opened: SHORT TROUSDT",
            status: null,
            pnl: null,
            position: null,
          },
        ],
      },
    );
    // Historical data must remain visible — never replaced by an offline state.
    expect(html).toContain("Position opened: SHORT TROUSDT");
    expect(html).not.toContain("Reasoning unavailable");
  });

  it("shows reconnecting status without clearing stored work-log data", () => {
    const html = render(
      makeStatus(),
      {},
      {
        workLog: [
          {
            id: "w1",
            timestamp: 1,
            date: "2026-09-05",
            time: "09:47:29",
            eventType: "POSITION_OPENED",
            category: "ACTION",
            symbol: "TROUSDT",
            action: null,
            message: "Position opened: SHORT TROUSDT",
            status: null,
            pnl: null,
            position: null,
          },
        ],
      },
      { journalError: true, connecting: true },
    );
    expect(html).toContain("Reconnecting");
    expect(html).toContain("Position opened: SHORT TROUSDT");
  });

  it("shows empty state only when the database genuinely has zero events", () => {
    const html = render(makeStatus());
    expect(html).toContain("No agent events recorded yet");
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
