/**
 * Mock Data Adapter — BINANCE AI FUTURES AGENT v0.1
 *
 * This module provides all API responses using static mock data.
 * It mirrors the shape of src/lib/mock.ts but routes through a
 * service interface so the frontend never couples to raw mock files.
 *
 * Future phases replace functions here with real database queries
 * and live market data. The frontend sees no difference.
 */

import type {
  Account,
  Candle,
  DashboardResponse,
  RuntimeResponse,
  PerformanceResponse,
  LearningResponse,
  Strategy,
  AiIntelligence,
  AiExperience,
  AiLesson,
  AiTimelineEvent,
  AiImprovementData,
  AuditMonth,
  AiEvolution,
  RiskEnvelope,
  SystemNode,
  SystemConfig,
  Trade,
  Position,
  MarketTicker,
  OrderBookLevel,
  CorrelationData,
  RiskEvent,
  AiExperiment,
  AiModel,
  PaperStatusResponse,
} from "../../types/api";

// ─── Helpers ──────────────────────────────────────────────────────────

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeCandles(count = 70, start = 63250): Candle[] {
  const rnd = seeded(42);
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    const drift = (rnd() - 0.46) * 260;
    const o = price;
    const c = Math.max(100, o + drift);
    const h = Math.max(o, c) + rnd() * 130;
    const l = Math.min(o, c) - rnd() * 130;
    const d = new Date(Date.UTC(2026, 8, 1, 0, 0) - (count - i) * 15 * 60000);
    out.push({
      t: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
      o,
      h,
      l,
      c,
      v: 400 + rnd() * 1600,
    });
    price = c;
  }
  return out;
}

// ─── Static Mock Data ─────────────────────────────────────────────────

const mockAccount: Account = {
  id: "ACC-001",
  name: "Main Futures Account",
  balance: 148_392.44,
  equity: 151_007.18,
  availableMargin: 132_586.56,
  unrealizedPnl: 2_614.74,
  realizedPnl: 48_392.44,
  currency: "USDT",
  createdAt: "2026-01-15T00:00:00Z",
};

const mockCandles: Candle[] = makeCandles();

const mockEquityCurve = Array.from({ length: 40 }, (_, i) => {
  const rnd = seeded(7 + i)();
  return {
    date: `D${i + 1}`,
    equity: Math.round(100_000 + i * 1180 + (rnd - 0.5) * 5200),
    benchmark: Math.round(100_000 + i * 420 + (rnd - 0.5) * 2600),
  };
});

const mockRecentTrades: Trade[] = [
  { id: "TX-8841", symbol: "BTCUSDT", side: "LONG", entryPrice: 62410.2, exitPrice: 63180.5, quantity: 0.15, pnl: 431.2, pnlPercent: 1.23, duration: "42m", strategyName: "Momentum Breakout", strategyVersion: "v4.2", openId: "O-8841", closeId: "C-8841", openedAt: "2026-08-31T14:20:00Z", closedAt: "2026-08-31T15:02:00Z" },
  { id: "TX-8840", symbol: "ETHUSDT", side: "SHORT", entryPrice: 3412.8, exitPrice: 3388.1, quantity: 2.0, pnl: 118.6, pnlPercent: 0.72, duration: "18m", strategyName: "Mean Reversion", strategyVersion: "v2.0", openId: "O-8840", closeId: "C-8840", openedAt: "2026-08-31T13:45:00Z", closedAt: "2026-08-31T14:03:00Z" },
  { id: "TX-8839", symbol: "SOLUSDT", side: "LONG", entryPrice: 184.42, exitPrice: 181.9, quantity: 50.0, pnl: -96.4, pnlPercent: -1.37, duration: "1h 05m", strategyName: "Range Fade", strategyVersion: "v1.4", openId: "O-8839", closeId: "C-8839", openedAt: "2026-08-31T12:30:00Z", closedAt: "2026-08-31T13:35:00Z" },
  { id: "TX-8838", symbol: "BTCUSDT", side: "LONG", entryPrice: 61980.0, exitPrice: 62740.4, quantity: 0.22, pnl: 512.9, pnlPercent: 1.23, duration: "2h 11m", strategyName: "Momentum Breakout", strategyVersion: "v4.2", openId: "O-8838", closeId: "C-8838", openedAt: "2026-08-31T10:00:00Z", closedAt: "2026-08-31T12:11:00Z" },
  { id: "TX-8837", symbol: "BNBUSDT", side: "SHORT", entryPrice: 612.4, exitPrice: 604.2, quantity: 8.0, pnl: 204.1, pnlPercent: 1.34, duration: "36m", strategyName: "Range Fade", strategyVersion: "v1.4", openId: "O-8837", closeId: "C-8837", openedAt: "2026-08-31T09:15:00Z", closedAt: "2026-08-31T09:51:00Z" },
];

const mockStrategies: Strategy[] = [
  { id: "STRAT-001", name: "Momentum Breakout", version: "v4.2", state: "ACTIVE", allocationPercent: 38, winRate: 71.2, profitFactor: 2.61, totalTrades: 412, totalPnl: 21840, sharpeRatio: 2.34, maxDrawdown: -5.8, description: "Trend-following breakout strategy for high-momentum regimes", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" },
  { id: "STRAT-002", name: "Mean Reversion", version: "v2.0", state: "ACTIVE", allocationPercent: 24, winRate: 66.8, profitFactor: 2.02, totalTrades: 388, totalPnl: 12410, sharpeRatio: 1.89, maxDrawdown: -7.2, description: "Contrarian mean reversion for ranging markets", createdAt: "2026-03-15T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" },
  { id: "STRAT-003", name: "Range Fade", version: "v1.4", state: "ACTIVE", allocationPercent: 18, winRate: 63.1, profitFactor: 1.74, totalTrades: 244, totalPnl: 8120, sharpeRatio: 1.52, maxDrawdown: -8.4, description: "Fade overextended moves in range-bound conditions", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" },
  { id: "STRAT-004", name: "Volatility Squeeze", version: "v3.1", state: "PROBATION", allocationPercent: 12, winRate: 58.4, profitFactor: 1.41, totalTrades: 156, totalPnl: 4310, sharpeRatio: 1.12, maxDrawdown: -11.2, description: "Exploit volatility compression breakouts", createdAt: "2026-05-10T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" },
  { id: "STRAT-005", name: "Funding Arbitrage", version: "v0.9", state: "SHADOW", allocationPercent: 8, winRate: 74.9, profitFactor: 1.22, totalTrades: 84, totalPnl: 1712, sharpeRatio: 0.95, maxDrawdown: -4.1, description: "Exploit funding rate dislocations between perpetual and spot", createdAt: "2026-06-20T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z" },
];

const mockPosition: Position = {
  id: "POS-001",
  symbol: "BTCUSDT",
  side: "LONG",
  leverage: 5,
  size: 0.42,
  entryPrice: 63112.4,
  markPrice: 63884.9,
  liquidationPrice: 54980.2,
  takeProfitPrice: 65400.0,
  stopLossPrice: 62180.0,
  unrealizedPnl: 324.45,
  unrealizedPnlPercent: 1.22,
  margin: 5301.44,
  openedAt: "2026-08-31T07:15:00Z",
};

const mockAiIntelligence: AiIntelligence = {
  confidence: 87,
  regime: "TRENDING — BULL EXPANSION",
  regimeConfidence: 74,
  decision: {
    action: "OPEN LONG",
    symbol: "BTCUSDT",
    size: "0.42 BTC · 5x",
    confidence: 87,
    strategyName: "Momentum Breakout",
    strategyVersion: "v4.2",
    strategyEdge: 1.42,
    reasoningSteps: [
      "Regime classifier returns TRENDING at 74% — trend sleeve enabled.",
      "Momentum Breakout v4.2 ranked first by expected R (1.42).",
      "Risk guardian approved: exposure 41% of cap, leverage under limit.",
      "Entry staged on retest of breakout level with 1.4 ATR trailing stop.",
    ],
    timestamp: "2026-08-31T07:15:00Z",
  },
  signals: [
    { label: "Momentum", value: 82 },
    { label: "Trend", value: 74 },
    { label: "Volatility", value: 46 },
    { label: "Liquidity", value: 68 },
    { label: "Sentiment", value: 59 },
    { label: "Risk", value: 31 },
  ],
  marketAnalysis: [
    "Spot CVD diverging positive against perp funding — accumulation bias.",
    "Order book imbalance 61/39 favoring bids within 0.4% band.",
    "Open interest +12.4% over 8h with stable funding at 0.011%.",
    "Correlated majors (ETH, SOL) confirming directional agreement.",
  ],
  technicalIndicators: [
    { name: "RSI (14)", value: "61.4", state: "bull" },
    { name: "MACD", value: "+184.2", state: "bull" },
    { name: "EMA 50/200", value: "Golden", state: "bull" },
    { name: "ATR (14)", value: "742.10", state: "neutral" },
    { name: "Bollinger %B", value: "0.84", state: "warn" },
    { name: "VWAP Dev", value: "+0.62%", state: "bull" },
    { name: "Stoch RSI", value: "78.9", state: "warn" },
    { name: "ADX", value: "31.2", state: "bull" },
  ],
};

const mockExperiences: AiExperience[] = [
  { id: "EXP-2291", tag: "PATTERN", title: "Low-liquidity breakouts fail near session rollover", confidence: 91, impact: "+0.18 PF", details: "Breakouts within 15min of session rollover show 68% failure rate.", tradeIds: ["TX-8801", "TX-8756"], createdAt: "2026-08-30T00:00:00Z" },
  { id: "EXP-2287", tag: "RISK", title: "Correlated longs across majors amplify drawdown", confidence: 84, impact: "-32% DD", details: "Simultaneous longs in BTC+ETH+SOL increase max drawdown by 32%.", tradeIds: ["TX-8790"], createdAt: "2026-08-28T00:00:00Z" },
  { id: "EXP-2284", tag: "TIMING", title: "Best entries cluster 12-40m after volume spike", confidence: 77, impact: "+4.1% WR", details: "Entries delayed 12-40min after volume spike improve win rate.", tradeIds: ["TX-8780", "TX-8775"], createdAt: "2026-08-26T00:00:00Z" },
  { id: "EXP-2279", tag: "EXIT", title: "Trailing stop at 1.4 ATR beats fixed TP in trends", confidence: 88, impact: "+0.24 PF", details: "ATR-based trailing stop outperforms fixed take-profit in trending regimes.", tradeIds: ["TX-8760"], createdAt: "2026-08-24T00:00:00Z" },
  { id: "EXP-2271", tag: "REGIME", title: "Mean reversion degrades when ADX > 34", confidence: 82, impact: "+2.6% WR", details: "Mean reversion strategies underperform when ADX exceeds 34.", tradeIds: ["TX-8740"], createdAt: "2026-08-22T00:00:00Z" },
];

const mockLessons: AiLesson[] = [
  { id: "LES-118", text: "Reduce size by 40% when funding exceeds 0.03% — carry cost erodes edge.", cycle: 118, sourceExperienceIds: ["EXP-2287"], createdAt: "2026-08-28T00:00:00Z" },
  { id: "LES-114", text: "Skip entries where spread > 1.8 bps; slippage removes ~0.3R.", cycle: 114, sourceExperienceIds: ["EXP-2284"], createdAt: "2026-08-26T00:00:00Z" },
  { id: "LES-109", text: "Regime classifier confidence below 55% → stand down, do not trade.", cycle: 109, sourceExperienceIds: ["EXP-2271"], createdAt: "2026-08-22T00:00:00Z" },
  { id: "LES-103", text: "Post-news volatility windows favor fades over breakouts for 20 minutes.", cycle: 103, sourceExperienceIds: ["EXP-2291"], createdAt: "2026-08-20T00:00:00Z" },
];

const mockTimeline: AiTimelineEvent[] = [
  { id: "TL-121", cycle: "CYCLE 121", timestamp: "2026-08-31T06:40:00Z", title: "Retrained regime classifier", detail: "Added order-flow imbalance feature. Val accuracy 79.4% → 83.1%." },
  { id: "TL-118", cycle: "CYCLE 118", timestamp: "2026-08-30T00:00:00Z", title: "Deprecated Grid Scalper v1", detail: "Profit factor fell under 1.05 for 60 sessions. Capital reallocated." },
  { id: "TL-114", cycle: "CYCLE 114", timestamp: "2026-08-29T00:00:00Z", title: "Adaptive position sizing", detail: "Kelly-fraction cap set to 0.35. Max drawdown improved by 2.1pp." },
  { id: "TL-109", cycle: "CYCLE 109", timestamp: "2026-08-26T00:00:00Z", title: "New exit policy", detail: "ATR trailing stop replaced fixed take-profit in trending regimes." },
  { id: "TL-101", cycle: "CYCLE 101", timestamp: "2026-08-22T00:00:00Z", title: "Strategy promoted", detail: "Momentum Breakout v4.2 out of shadow mode into live allocation." },
];

const mockImprovement: AiImprovementData[] = Array.from({ length: 24 }, (_, i) => ({
  cycle: `C${99 + i}`,
  accuracy: 62 + i * 0.85 + (seeded(i + 3)() - 0.5) * 3,
  profitFactor: 1.2 + i * 0.05 + (seeded(i + 11)() - 0.5) * 0.12,
}));

const mockAuditMonths: AuditMonth[] = [
  { month: "Mar", winRate: 61.2, profitFactor: 1.68, maxDrawdown: -9.4, decisionQuality: 71 },
  { month: "Apr", winRate: 63.8, profitFactor: 1.82, maxDrawdown: -8.1, decisionQuality: 74 },
  { month: "May", winRate: 62.1, profitFactor: 1.74, maxDrawdown: -11.2, decisionQuality: 70 },
  { month: "Jun", winRate: 65.9, profitFactor: 2.01, maxDrawdown: -7.6, decisionQuality: 79 },
  { month: "Jul", winRate: 67.2, profitFactor: 2.18, maxDrawdown: -6.9, decisionQuality: 83 },
  { month: "Aug", winRate: 68.4, profitFactor: 2.34, maxDrawdown: -7.8, decisionQuality: 86 },
];

const mockEvolution: AiEvolution[] = [
  { generation: "GEN 1", label: "Rule-based signals", score: 42 },
  { generation: "GEN 2", label: "Indicator ensemble", score: 58 },
  { generation: "GEN 3", label: "Regime-aware routing", score: 71 },
  { generation: "GEN 4", label: "Self-critique loop", score: 83 },
  { generation: "GEN 5", label: "Adaptive risk sizing", score: 89 },
];

const mockRisk: RiskEnvelope = {
  dailyProfitCap: 0.50,
  dailyProfitUsed: 0.12,
  dailyLossLimit: 0.50,
  dailyLossUsed: 0.03,
  totalExposure: 2.10,
  maxExposure: 4.00,
  currentLeverage: 5,
  maxLeverage: 10,
  status: "NOMINAL",
  emergencyStopState: "ARMED",
  openPositionCount: 1,
  marginRatio: 12.4,
};

const mockSystemNodes: SystemNode[] = [
  { name: "Market Data Feed", state: "ONLINE", latency: "42 ms", detail: "WSS · 4 streams" },
  { name: "Inference Engine", state: "ONLINE", latency: "118 ms", detail: "Model orbit-7b" },
  { name: "Execution Router", state: "ONLINE", latency: "61 ms", detail: "Simulated venue" },
  { name: "Risk Guardian", state: "ONLINE", latency: "9 ms", detail: "All limits armed" },
  { name: "Learning Pipeline", state: "TRAINING", latency: "—", detail: "Cycle 121 · 68%" },
  { name: "Archive Store", state: "ONLINE", latency: "24 ms", detail: "1.24M records" },
];

const mockSystemConfig: SystemConfig = {
  initialCapital: 5.00,
  dailyProfitCap: 0.50,
  dailyLossLimit: 0.50,
  maxLeverage: 10,
  maxExposurePercent: 80,
  binanceTestnetEnabled: false,
  paperTradingMode: true,
  tradingEnabled: false,
};

const mockTickers: MarketTicker[] = [
  { symbol: "BTCUSDT", price: 63884.90, change24h: 785.20, changePercent24h: 1.24, volume24h: 28432.1, fundingRate: 0.00011, nextFundingTime: "2026-09-01T08:00:00Z", openInterest: 682341.2, openInterestChange: 12.4 },
  { symbol: "ETHUSDT", price: 3402.15, change24h: 28.92, changePercent24h: 0.86, volume24h: 184291.5, fundingRate: 0.00008, nextFundingTime: "2026-09-01T08:00:00Z", openInterest: 1423891.0, openInterestChange: 8.2 },
  { symbol: "SOLUSDT", price: 182.44, change24h: -0.77, changePercent24h: -0.42, volume24h: 91823.4, fundingRate: 0.00015, nextFundingTime: "2026-09-01T08:00:00Z", openInterest: 384291.0, openInterestChange: -2.1 },
  { symbol: "BNBUSDT", price: 608.20, change24h: 1.88, changePercent24h: 0.31, volume24h: 21843.8, fundingRate: 0.00006, nextFundingTime: "2026-09-01T08:00:00Z", openInterest: 98234.0, openInterestChange: 4.3 },
];

const mockOrderBook: OrderBookLevel[] = [
  { price: 64100, bid: 12, ask: 78 },
  { price: 64000, bid: 22, ask: 61 },
  { price: 63900, bid: 44, ask: 40 },
  { price: 63800, bid: 71, ask: 22 },
  { price: 63700, bid: 84, ask: 15 },
  { price: 63600, bid: 66, ask: 9 },
];

const mockCorrelations: CorrelationData[] = [
  { symbol: "ETHUSDT", correlation: 0.91 },
  { symbol: "SOLUSDT", correlation: 0.84 },
  { symbol: "BNBUSDT", correlation: 0.78 },
  { symbol: "GOLD", correlation: 0.21 },
  { symbol: "DXY", correlation: -0.62 },
  { symbol: "NASDAQ", correlation: 0.57 },
];

const mockExperiments: AiExperiment[] = [
  { id: "EXP-001", name: "ATR trailing vs fixed TP", hypothesis: "ATR trailing stop outperforms fixed TP by >0.15R in trending regimes", state: "COMPLETED", startDate: "2026-07-01T00:00:00Z", endDate: "2026-08-15T00:00:00Z", sampleSize: 244, controlWinRate: 63.2, treatmentWinRate: 68.4, confidence: 0.94, conclusion: "Confirmed: ATR trailing outperforms by 0.24 PF in trending regimes." },
  { id: "EXP-002", name: "Regime-aware position sizing", hypothesis: "Dynamic Kelly sizing reduces drawdown by >15% vs fixed sizing", state: "RUNNING", startDate: "2026-08-15T00:00:00Z", endDate: null, sampleSize: 89, controlWinRate: 65.1, treatmentWinRate: 67.8, confidence: 0.72, conclusion: null },
];

const mockModels: AiModel[] = [
  { id: "MODEL-001", name: "Orbit-7B", version: "v7.2", state: "ACTIVE", accuracy: 83.1, profitFactor: 2.34, trainingCycles: 121, createdAt: "2026-02-01T00:00:00Z" },
  { id: "MODEL-002", name: "Orbit-7B", version: "v7.3-candidate", state: "CANDIDATE", accuracy: 84.7, profitFactor: 2.28, trainingCycles: 5, createdAt: "2026-08-31T00:00:00Z" },
];

// ─── API Adapter Functions ────────────────────────────────────────────

export function getDashboardData(): DashboardResponse {
  return {
    account: mockAccount,
    dailyPnl: 0.12,
    dailyPnlPercent: 2.4,
    totalPnl: 0.12,
    totalPnlPercent: 2.4,
    winRate: 68.4,
    profitFactor: 2.34,
    sharpeRatio: 2.11,
    maxDrawdown: -7.8,
    currentDrawdown: -1.2,
    tradeCount: 1284,
    status: "ACTIVE",
    uptime: "14d 06h 22m",
    currentPrice: 63884.90,
    recentTrades: mockRecentTrades.slice(0, 5),
    riskEnvelope: mockRisk,
    aiDecision: mockAiIntelligence.decision,
    candles: mockCandles,
  };
}

export function getRuntimeData(): RuntimeResponse {
  return {
    aiIntelligence: mockAiIntelligence,
    position: mockPosition,
    strategyPerformance: mockStrategies,
    uptime: "14d 06h 22m",
    tradingStatus: "ACTIVE",
  };
}

export function getPerformanceData(): PerformanceResponse {
  return {
    equityCurve: mockEquityCurve,
    monthlyAudit: mockAuditMonths,
    aiEvolution: mockEvolution,
    improvementData: mockImprovement,
  };
}

export function getMarketData() {
  return {
    tickers: mockTickers,
    candles: mockCandles,
    orderBook: mockOrderBook,
    correlations: mockCorrelations,
    bookImbalance: { bid: 61, ask: 39 },
    openInterestChange: 12.4,
    fundingRate: 0.011,
    realizedVolatility: 42.8,
  };
}

export function getStrategiesData(): Strategy[] {
  return mockStrategies;
}

export function getTradesData(): Trade[] {
  return mockRecentTrades;
}

export function getLearningData(): LearningResponse {
  return {
    experiences: mockExperiences,
    lessons: mockLessons,
    timeline: mockTimeline,
    improvement: mockImprovement,
  };
}

export function getExperimentsData() {
  return {
    experiments: mockExperiments,
    models: mockModels,
  };
}

export function getRiskData(): RiskEnvelope {
  return mockRisk;
}

export function getRiskEvents(): RiskEvent[] {
  return [
    { id: "RE-001", type: "DAILY_LOSS_LIMIT", severity: "INFO", message: "Daily loss limit monitoring active", details: "Current usage: $0.03 / $0.50", timestamp: "2026-08-31T00:00:00Z" },
    { id: "RE-002", type: "LEVERAGE_CHECK", severity: "INFO", message: "Leverage within bounds", details: "Current: 5x / Max: 10x", timestamp: "2026-08-31T07:15:00Z" },
    { id: "RE-003", type: "EXPOSURE_WARNING", severity: "WARN", message: "Exposure approaching 60% of cap", details: "Current: $2.10 / $4.00 (52.5%)", timestamp: "2026-08-31T08:00:00Z" },
  ];
}

export function getSystemData() {
  return {
    nodes: mockSystemNodes,
    config: mockSystemConfig,
    version: "0.1.0",
    uptime: "14d 06h 22m",
    environment: "simulation",
  };
}

export function getAuditData() {
  return {
    monthlyAudit: mockAuditMonths,
    aiEvolution: mockEvolution,
    improvementData: mockImprovement,
    models: mockModels,
    experiments: mockExperiments,
  };
}

export function getCandlesData(): Candle[] {
  return mockCandles;
}

export function getPaperStatus(): PaperStatusResponse {
  return {
    mode: "PAPER",
    capital: mockAccount.balance,
    initialCapital: mockSystemConfig.initialCapital,
    totalPnl: mockRecentTrades.reduce((s, t) => s + t.pnl, 0),
    dailyPnl: 0.12,
    totalTrades: 1284,
    winRate: 68.4,
    profitFactor: 2.34,
    maxDrawdown: -7.8,
    activePosition: {
      symbol: "BTCUSDT",
      side: "LONG",
      size: 0.42,
      entryPrice: 63112.4,
      markPrice: 63884.9,
      unrealizedPnl: 324.45,
      unrealizedPnlPercent: 1.22,
      leverage: 5,
      margin: 5301.44,
      openedAt: "2026-08-31T07:15:00Z",
      durationMinutes: 480,
    },
    recentTrades: mockRecentTrades.map(t => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.pnl,
      outcome: t.pnl > 0 ? "WIN" as const : t.pnl < 0 ? "LOSS" as const : "BREAKEVEN" as const,
      closedAt: t.closedAt,
      strategyName: t.strategyName,
    })),
    feedState: "ONLINE" as const,
    feedSymbols: [
      { symbol: "BTCUSDT", feedState: "ONLINE" as const, lastUpdate: Date.now() - 2000, dataAgeMs: 2000, candleCount: 100, trend: "UP", price: 63884.90, change24h: 785.20 },
      { symbol: "ETHUSDT", feedState: "ONLINE" as const, lastUpdate: Date.now() - 3000, dataAgeMs: 3000, candleCount: 100, trend: "UP", price: 3402.15, change24h: 28.92 },
      { symbol: "SOLUSDT", feedState: "ONLINE" as const, lastUpdate: Date.now() - 4000, dataAgeMs: 4000, candleCount: 100, trend: "DOWN", price: 182.44, change24h: -0.77 },
      { symbol: "BNBUSDT", feedState: "ONLINE" as const, lastUpdate: Date.now() - 5000, dataAgeMs: 5000, candleCount: 100, trend: "FLAT", price: 608.20, change24h: 1.88 },
    ],
    lastAiDecision: {
      action: mockAiIntelligence.decision.action,
      symbol: mockAiIntelligence.decision.symbol,
      confidence: mockAiIntelligence.decision.confidence,
      strategyName: mockAiIntelligence.decision.strategyName,
      timestamp: mockAiIntelligence.decision.timestamp,
    },
    riskEngineStatus: "PAPER",
    emergencyStopState: "ARMED",
    noRealTrading: true,
  };
}

export function getMarketFeedStatus() {
  return mockTickers.map(t => ({
    symbol: t.symbol,
    feedState: "ONLINE" as const,
    lastUpdate: Date.now() - 3000,
    dataAgeMs: 3000,
    candleCount: 100,
    trend: t.changePercent24h > 0 ? "UP" : t.changePercent24h < -0.5 ? "DOWN" : "FLAT",
    price: t.price,
    change24h: t.change24h,
  }));
}
