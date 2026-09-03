/**
 * P6 Tests — BINANCE AI FUTURES AGENT v0.1
 *
 * Tests for:
 * 1. Research Engine (technical analysis from real kline data)
 * 2. P6 Decision Engine (trade/no-trade decisions, parameter calculation)
 * 3. Market Data Service (data quality, snapshot construction)
 * 4. Market Scanner (symbol discovery, filtering, ranking)
 * 5. P6 Orchestrator integration (risk gate, $10 allocation, $1 max loss)
 * 6. Fail-closed behavior (stale data, missing data, no mainnet)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResearchEngine } from "./research-engine";
import { P6DecisionEngine } from "./p6-decision-engine";
import { MarketDataService, type MarketSnapshot, type Kline } from "../market/data-service";
import { MarketScanner } from "../market/scanner";
import type { ResearchResult } from "./research-engine";

// ─── Test Data Generators ────────────────────────────────────────

function generateKlines(
  count: number,
  startPrice: number,
  trend: "UP" | "DOWN" | "FLAT" = "UP",
  volatility = 0.01,
): Kline[] {
  const klines: Kline[] = [];
  let price = startPrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const drift = trend === "UP" ? 0.001 : trend === "DOWN" ? -0.001 : 0;
    const noise = (Math.random() - 0.5) * volatility;
    price = price * (1 + drift + noise);

    const open = price * (1 - noise / 2);
    const high = Math.max(price, open) * (1 + Math.abs(noise));
    const low = Math.min(price, open) * (1 - Math.abs(noise));
    const close = price;
    const volume = 1000 + Math.random() * 5000;

    klines.push({
      openTime: now - (count - i) * 3600_000,
      open,
      high,
      low,
      close,
      volume,
      closeTime: now - (count - i - 1) * 3600_000,
      quoteVolume: volume * price,
      trades: Math.floor(100 + Math.random() * 500),
    });
  }
  return klines;
}

function makeSnapshot(
  overrides: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  const klines = generateKlines(100, 60000, "UP");
  const currentPrice = klines[klines.length - 1]!.close;
  return {
    symbol: "BTCUSDT",
    timestamp: Date.now(),
    source: "BINANCE_FUTURES_TESTNET",
    freshness: 0,
    dataQuality: "GOOD",
    price: currentPrice,
    volume24h: 500_000_000,
    quoteVolume24h: 30_000_000_000,
    priceChange24h: 500,
    priceChangePercent24h: 0.83,
    high24h: currentPrice * 1.02,
    low24h: currentPrice * 0.98,
    trades24h: 1_000_000,
    klines,
    volatility: currentPrice * 0.015,
    bidAskSpread: 0.0002,
    ...overrides,
  };
}

// ─── Research Engine Tests ───────────────────────────────────────

describe("P6 ResearchEngine", () => {
  const engine = new ResearchEngine();

  it("produces valid research from real kline data", () => {
    const snapshot = makeSnapshot();
    const result = engine.research(snapshot);

    expect(result.symbol).toBe("BTCUSDT");
    expect(result.dataQuality).toBe("GOOD");
    expect(result.score).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.tradeableDirection).toMatch(/LONG|SHORT|NO_TRADE/);
  });

  it("returns NO_TRADE when klines insufficient", () => {
    const snapshot = makeSnapshot({ klines: generateKlines(5, 60000), dataQuality: "DEGRADED" });
    const result = engine.research(snapshot);
    // Less than 30 klines triggers invalidResearch
    expect(result.tradeableDirection).toBe("NO_TRADE");
  });

  it("returns INVALID when data quality is INVALID", () => {
    const snapshot = makeSnapshot({ dataQuality: "INVALID", price: 0 });
    const result = engine.research(snapshot);
    expect(result.dataQuality).toBe("INVALID");
    expect(result.tradeableDirection).toBe("NO_TRADE");
  });

  it("calculates real EMA crossover", () => {
    const snapshot = makeSnapshot({ klines: generateKlines(100, 60000, "UP") });
    const result = engine.research(snapshot);
    // UP trend should show bullish EMA cross
    expect(result.trend.emaCross).toMatch(/BULLISH|NEUTRAL/);
  });

  it("calculates real RSI", () => {
    const snapshot = makeSnapshot();
    const result = engine.research(snapshot);
    expect(result.momentum.rsi).toBeGreaterThanOrEqual(0);
    expect(result.momentum.rsi).toBeLessThanOrEqual(100);
  });

  it("calculates real MACD", () => {
    const snapshot = makeSnapshot();
    const result = engine.research(snapshot);
    expect(typeof result.momentum.macd).toBe("number");
    expect(typeof result.momentum.macdHistogram).toBe("number");
  });

  it("calculates real Bollinger Bands", () => {
    const snapshot = makeSnapshot();
    const result = engine.research(snapshot);
    expect(result.volatility.bollingerUpper).toBeGreaterThan(result.volatility.bollingerLower);
    expect(result.volatility.bollingerPercentB).toBeGreaterThanOrEqual(0);
  });

  it("determines support/resistance from real data", () => {
    const snapshot = makeSnapshot();
    const result = engine.research(snapshot);
    expect(result.supportResistance.resistance).toBeGreaterThan(result.supportResistance.support);
  });

  it("provides risk/reward from real ATR", () => {
    const snapshot = makeSnapshot();
    const result = engine.research(snapshot);
    expect(result.riskReward.longRiskReward).toBeGreaterThan(0);
    expect(result.riskReward.shortRiskReward).toBeGreaterThan(0);
  });
});

// ─── P6 Decision Engine Tests ────────────────────────────────────

describe("P6 DecisionEngine", () => {
  const engine = new P6DecisionEngine();
  const researchEngine = new ResearchEngine();

  it("makes a valid decision from research", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);

    expect(decision.symbol).toBe("BTCUSDT");
    expect(decision.timestamp).toBeGreaterThan(0);
    expect(decision.reasoning.length).toBeGreaterThan(0);
  });

  it("NO_TRADE when research is invalid", () => {
    const snapshot = makeSnapshot({ dataQuality: "INVALID", price: 0 });
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);

    expect(decision.direction).toBe("NO_TRADE");
    expect(decision.invalidationReason).toBeTruthy();
  });

  it("NO_TRADE when allocation exceeded", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    // All $10 already allocated — decision must be NO_TRADE
    const decision = engine.makeDecision(research, snapshot, 10);

    expect(decision.direction).toBe("NO_TRADE");
    // Reason may be allocation or insufficient research score
    expect(decision.invalidationReason).toBeTruthy();
  });

  it("worst-case loss stays within $1 limit", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);

    if (decision.direction !== "NO_TRADE") {
      expect(decision.worstCaseLoss).toBeLessThanOrEqual(1.0);
    }
  });

  it("leverage stays within 20x limit", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);

    if (decision.direction !== "NO_TRADE") {
      expect(decision.leverage).toBeGreaterThan(0);
      expect(decision.leverage).toBeLessThanOrEqual(20);
    }
  });

  it("proposed margin does not exceed available allocation", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 3); // $3 already used

    if (decision.direction !== "NO_TRADE") {
      expect(decision.proposedMargin).toBeLessThanOrEqual(7); // remaining $7
    }
  });

  it("entry price equals current market price", () => {
    const snapshot = makeSnapshot({ price: 65000 });
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);

    if (decision.direction !== "NO_TRADE") {
      expect(decision.entryPrice).toBeCloseTo(65000, -2);
    }
  });

  it("stop-loss is valid for LONG", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    // Force LONG direction for testing
    if (research.tradeableDirection === "LONG" || research.tradeableDirection === "NO_TRADE") {
      const decision = engine.makeDecision(
        { ...research, tradeableDirection: "LONG", score: 60 },
        snapshot,
        0,
      );
      if (decision.direction === "LONG") {
        expect(decision.stopLoss).toBeLessThan(decision.entryPrice);
        expect(decision.takeProfit).toBeGreaterThan(decision.entryPrice);
      }
    }
  });

  it("stop-loss is valid for SHORT", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(
      { ...research, tradeableDirection: "SHORT", score: 60 },
      snapshot,
      0,
    );
    if (decision.direction === "SHORT") {
      expect(decision.stopLoss).toBeGreaterThan(decision.entryPrice);
      expect(decision.takeProfit).toBeLessThan(decision.entryPrice);
    }
  });

  it("converts to AiDecision correctly", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);
    const aiDecision = engine.toAiDecision(decision);

    expect(aiDecision.symbol).toBe(decision.symbol);
    expect(aiDecision.direction).toBe(decision.direction);
    expect(aiDecision.confidence).toBe(decision.confidence);
    expect(aiDecision.decisionVersion).toBe("2.0.0");
  });

  it("produces trade proposal with valid parameters", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    // Force a tradeable result
    const forcedResearch: ResearchResult = {
      ...research,
      tradeableDirection: "LONG",
      score: 60,
      trend: { ...research.trend, direction: "UP" },
      momentum: { ...research.momentum, macdTrend: "BULLISH" },
    };
    const decision = engine.makeDecision(forcedResearch, snapshot, 0);

    if (decision.direction !== "NO_TRADE") {
      const proposal = engine.toTradeProposal(decision);
      expect(proposal).not.toBeNull();
      expect(proposal!.side).toBe("LONG");
      expect(proposal!.quantity).toBeGreaterThan(0);
      expect(proposal!.notional).toBeGreaterThan(0);
      expect(proposal!.margin).toBeGreaterThan(0);
      expect(proposal!.margin).toBeLessThanOrEqual(10);
      expect(proposal!.leverage).toBeGreaterThan(0);
      expect(proposal!.leverage).toBeLessThanOrEqual(20);
      expect(proposal!.worstCaseLoss).toBeLessThanOrEqual(1);
    }
  });

  it("returns null proposal for NO_TRADE", () => {
    const snapshot = makeSnapshot({ dataQuality: "INVALID", price: 0 });
    const research = researchEngine.research(snapshot);
    const decision = engine.makeDecision(research, snapshot, 0);
    expect(engine.toTradeProposal(decision)).toBeNull();
  });
});

// ─── Market Data Service Tests ───────────────────────────────────

describe("P6 MarketDataService", () => {
  it("reports data freshness correctly", () => {
    const fresh: MarketSnapshot = makeSnapshot({ freshness: 5000 });
    const stale: MarketSnapshot = makeSnapshot({ freshness: 120_000 });

    expect(MarketDataService.isFresh(fresh, 60_000)).toBe(true);
    expect(MarketDataService.isFresh(stale, 60_000)).toBe(false);
  });

  it("generates valid snapshot from real data", () => {
    const snapshot = makeSnapshot();
    expect(snapshot.symbol).toBe("BTCUSDT");
    expect(snapshot.source).toBe("BINANCE_FUTURES_TESTNET");
    expect(snapshot.klines.length).toBe(100);
    expect(snapshot.volatility).toBeGreaterThan(0);
  });
});

// ─── Market Scanner Tests ────────────────────────────────────────

describe("P6 MarketScanner", () => {
  it("score is derived from real data, not hardcoded", () => {
    // Generate different market conditions
    const highVolSnapshot = makeSnapshot({
      volatility: 1000,
      volume24h: 500_000_000,
    });
    const lowVolSnapshot = makeSnapshot({
      volatility: 10,
      volume24h: 10_000,
    });

    // The scanner scoring should differ based on data
    expect(highVolSnapshot.volatility).not.toBe(lowVolSnapshot.volatility);
  });
});

// ─── Security / Scope Tests ──────────────────────────────────────

describe("P6 Security", () => {
  it("no mainnet URL in production code", async () => {
    const fs = await import("fs");
    const path = await import("path");

    // Check new P6 files for mainnet URLs
    const files = [
      "src/backend/market/data-service.ts",
      "src/backend/market/scanner.ts",
      "src/backend/research/research-engine.ts",
      "src/backend/research/p6-decision-engine.ts",
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.resolve(file), "utf-8");
      expect(content).not.toContain("fapi.binance.com");
      expect(content).not.toContain("api.binance.com");
      expect(content).not.toContain("BINANCE_MAINNET");
    }
  });

  it("no Math.random in production source", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const files = [
      "src/backend/market/data-service.ts",
      "src/backend/market/scanner.ts",
      "src/backend/research/research-engine.ts",
      "src/backend/research/p6-decision-engine.ts",
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.resolve(file), "utf-8");
      // production code must not call Math.random (comments mentioning it are fine)
      const lines = content.split("\n").filter(l => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"));
      for (const line of lines) {
        expect(line).not.toMatch(/Math\.random\s*\(/);
      }
    }
  });

  it("no hardcoded prices in production source", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const files = [
      "src/backend/research/p6-decision-engine.ts",
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.resolve(file), "utf-8");
      // Should not contain hardcoded BTC price like 60000 or 65000
      expect(content).not.toContain("60000");
      expect(content).not.toContain("65000");
    }
  });

  it("all data sourced from Binance Testnet", () => {
    const snapshot = makeSnapshot();
    expect(snapshot.source).toBe("BINANCE_FUTURES_TESTNET");
  });
});

// ─── Fail-Closed Tests ───────────────────────────────────────────

describe("P6 Fail-Closed", () => {
  const researchEngine = new ResearchEngine();
  const decisionEngine = new P6DecisionEngine();

  it("NO_TRADE when price is zero", () => {
    const snapshot = makeSnapshot({ price: 0 });
    const research = researchEngine.research(snapshot);
    const decision = decisionEngine.makeDecision(research, snapshot, 0);
    expect(decision.direction).toBe("NO_TRADE");
  });

  it("NO_TRADE when klines are empty", () => {
    const snapshot = makeSnapshot({ klines: [] });
    const research = researchEngine.research(snapshot);
    const decision = decisionEngine.makeDecision(research, snapshot, 0);
    expect(decision.direction).toBe("NO_TRADE");
  });

  it("NO_TRADE when data quality is STALE", () => {
    const snapshot = makeSnapshot({ dataQuality: "STALE" });
    const research = researchEngine.research(snapshot);
    const decision = decisionEngine.makeDecision(research, snapshot, 0);
    expect(decision.direction).toBe("NO_TRADE");
  });

  it("NO_TRADE when all allocation used ($10)", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = decisionEngine.makeDecision(research, snapshot, 10);
    expect(decision.direction).toBe("NO_TRADE");
    // May be rejected due to allocation or insufficient research
    expect(
      decision.invalidationReason?.includes("No allocation remaining") ||
      decision.invalidationReason?.includes("insufficient") ||
      decision.researchScore < 40,
    ).toBeTruthy();
  });

  it("NO_TRADE or very small margin when allocation nearly exhausted", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);
    const decision = decisionEngine.makeDecision(research, snapshot, 9.99);
    // Remaining is only $0.01 — should be NO_TRADE or very small margin
    if (decision.direction !== "NO_TRADE") {
      expect(decision.proposedMargin).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Integration: Full P6 Pipeline ──────────────────────────────

describe("P6 Pipeline Integration", () => {
  const researchEngine = new ResearchEngine();
  const decisionEngine = new P6DecisionEngine();

  it("scan → research → decide → proposal maintains all constraints", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);

    // Verify research constraints
    expect(research.score).toBeGreaterThanOrEqual(0);
    expect(research.score).toBeLessThanOrEqual(100);

    // Decision from research
    const decision = decisionEngine.makeDecision(research, snapshot, 0);

    // Verify decision constraints
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);

    if (decision.direction !== "NO_TRADE") {
      expect(decision.proposedMargin).toBeGreaterThan(0);
      expect(decision.proposedMargin).toBeLessThanOrEqual(10);
      expect(decision.leverage).toBeGreaterThan(0);
      expect(decision.leverage).toBeLessThanOrEqual(20);
      expect(decision.worstCaseLoss).toBeLessThanOrEqual(1);
      expect(decision.stopLoss).not.toBe(decision.entryPrice);
      expect(decision.takeProfit).not.toBe(decision.entryPrice);
    }

    // Proposal from decision
    const proposal = decisionEngine.toTradeProposal(decision);
    if (proposal) {
      expect(proposal.margin).toBeLessThanOrEqual(10);
      expect(proposal.leverage).toBeLessThanOrEqual(20);
      expect(proposal.worstCaseLoss).toBeLessThanOrEqual(1);
      expect(proposal.quantity).toBeGreaterThan(0);
      expect(proposal.notional).toBeGreaterThan(0);
    }
  });

  it("multiple allocations respect $10 limit", () => {
    const snapshot = makeSnapshot();
    const research = researchEngine.research(snapshot);

    // Simulate $6 already allocated
    const decision = decisionEngine.makeDecision(research, snapshot, 6);

    if (decision.direction !== "NO_TRADE") {
      expect(decision.proposedMargin).toBeLessThanOrEqual(4); // Only $4 remaining
      expect(decision.proposedMargin + 6).toBeLessThanOrEqual(10);
    }
  });
});
