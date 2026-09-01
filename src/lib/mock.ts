/** Static mock data for the trading command center UI. No live trading. */

export type Candle = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function makeCandles(count = 70, start = 63250): Candle[] {
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

export const candles = makeCandles();

export const equityCurve = Array.from({ length: 40 }, (_, i) => {
  const rnd = seeded(7 + i)();
  return {
    d: `D${i + 1}`,
    equity: Math.round(100000 + i * 1180 + (rnd - 0.5) * 5200),
    benchmark: Math.round(100000 + i * 420 + (rnd - 0.5) * 2600),
  };
});

export const overview = {
  balance: 148_392.44,
  equity: 151_007.18,
  dailyPnl: 2_614.74,
  dailyPnlPct: 1.79,
  totalPnl: 48_392.44,
  totalPnlPct: 48.39,
  winRate: 68.4,
  profitFactor: 2.34,
  maxDrawdown: -7.8,
  currentDrawdown: -1.2,
  status: "ACTIVE" as const,
  uptime: "14d 06h 22m",
  sharpe: 2.11,
  trades: 1_284,
};

export const aiIntel = {
  confidence: 87,
  regime: "TRENDING — BULL EXPANSION",
  regimeConfidence: 74,
  decision: "OPEN LONG",
  decisionSize: "0.42 BTC · 5x",
  strategy: "MOMENTUM BREAKOUT v4.2",
  strategyEdge: 1.42,
  marketAnalysis: [
    "Spot CVD diverging positive against perp funding — accumulation bias.",
    "Order book imbalance 61/39 favoring bids within 0.4% band.",
    "Open interest +12.4% over 8h with stable funding at 0.011%.",
    "Correlated majors (ETH, SOL) confirming directional agreement.",
  ],
  technical: [
    { name: "RSI (14)", value: "61.4", state: "bull" },
    { name: "MACD", value: "+184.2", state: "bull" },
    { name: "EMA 50/200", value: "Golden", state: "bull" },
    { name: "ATR (14)", value: "742.10", state: "neutral" },
    { name: "Bollinger %B", value: "0.84", state: "warn" },
    { name: "VWAP Dev", value: "+0.62%", state: "bull" },
    { name: "Stoch RSI", value: "78.9", state: "warn" },
    { name: "ADX", value: "31.2", state: "bull" },
  ] as { name: string; value: string; state: "bull" | "bear" | "neutral" | "warn" }[],
  signals: [
    { label: "Momentum", v: 82 },
    { label: "Trend", v: 74 },
    { label: "Volatility", v: 46 },
    { label: "Liquidity", v: 68 },
    { label: "Sentiment", v: 59 },
    { label: "Risk", v: 31 },
  ],
};

export const position = {
  symbol: "BTCUSDT",
  side: "LONG" as const,
  leverage: "5x",
  size: "0.42 BTC",
  entry: 63_112.4,
  mark: 63_884.9,
  liquidation: 54_980.2,
  takeProfit: 65_400.0,
  stopLoss: 62_180.0,
  pnl: 324.45,
  pnlPct: 1.22,
  openedAt: "07:15 UTC",
  margin: 5_301.44,
};

export const recentTrades = [
  { id: "TX-8841", sym: "BTCUSDT", side: "LONG", entry: 62410.2, exit: 63180.5, pnl: 431.2, pct: 1.23, dur: "42m", strat: "Momentum v4.2" },
  { id: "TX-8840", sym: "ETHUSDT", side: "SHORT", entry: 3412.8, exit: 3388.1, pnl: 118.6, pct: 0.72, dur: "18m", strat: "Mean Revert v2" },
  { id: "TX-8839", sym: "SOLUSDT", side: "LONG", entry: 184.42, exit: 181.9, pnl: -96.4, pct: -1.37, dur: "1h 05m", strat: "Breakout v3" },
  { id: "TX-8838", sym: "BTCUSDT", side: "LONG", entry: 61980.0, exit: 62740.4, pnl: 512.9, pct: 1.23, dur: "2h 11m", strat: "Momentum v4.2" },
  { id: "TX-8837", sym: "BNBUSDT", side: "SHORT", entry: 612.4, exit: 604.2, pnl: 204.1, pct: 1.34, dur: "36m", strat: "Range Fade v1" },
  { id: "TX-8836", sym: "ETHUSDT", side: "LONG", entry: 3344.9, exit: 3331.2, pnl: -84.0, pct: -0.41, dur: "27m", strat: "Momentum v4.2" },
  { id: "TX-8835", sym: "BTCUSDT", side: "SHORT", entry: 63820.1, exit: 63290.7, pnl: 388.4, pct: 0.83, dur: "51m", strat: "Mean Revert v2" },
];

export const strategies = [
  { name: "Momentum Breakout", ver: "v4.2", alloc: 38, win: 71.2, pf: 2.61, trades: 412, pnl: 21840, state: "ACTIVE" },
  { name: "Mean Reversion", ver: "v2.0", alloc: 24, win: 66.8, pf: 2.02, trades: 388, pnl: 12410, state: "ACTIVE" },
  { name: "Range Fade", ver: "v1.4", alloc: 18, win: 63.1, pf: 1.74, trades: 244, pnl: 8120, state: "ACTIVE" },
  { name: "Volatility Squeeze", ver: "v3.1", alloc: 12, win: 58.4, pf: 1.41, trades: 156, pnl: 4310, state: "PROBATION" },
  { name: "Funding Arbitrage", ver: "v0.9", alloc: 8, win: 74.9, pf: 1.22, trades: 84, pnl: 1712, state: "SHADOW" },
];

export const experiences = [
  { id: "EXP-2291", tag: "PATTERN", title: "Low-liquidity breakouts fail near session rollover", conf: 91, impact: "+0.18 PF" },
  { id: "EXP-2287", tag: "RISK", title: "Correlated longs across majors amplify drawdown", conf: 84, impact: "-32% DD" },
  { id: "EXP-2284", tag: "TIMING", title: "Best entries cluster 12–40m after volume spike", conf: 77, impact: "+4.1% WR" },
  { id: "EXP-2279", tag: "EXIT", title: "Trailing stop at 1.4 ATR beats fixed TP in trends", conf: 88, impact: "+0.24 PF" },
  { id: "EXP-2271", tag: "REGIME", title: "Mean reversion degrades when ADX > 34", conf: 82, impact: "+2.6% WR" },
];

export const lessons = [
  { text: "Reduce size by 40% when funding exceeds 0.03% — carry cost erodes edge.", cycle: 118 },
  { text: "Skip entries where spread > 1.8 bps; slippage removes ~0.3R.", cycle: 114 },
  { text: "Regime classifier confidence below 55% → stand down, do not trade.", cycle: 109 },
  { text: "Post-news volatility windows favor fades over breakouts for 20 minutes.", cycle: 103 },
];

export const timeline = [
  { cycle: "CYCLE 121", when: "Today 06:40", title: "Retrained regime classifier", detail: "Added order-flow imbalance feature. Val accuracy 79.4% → 83.1%." },
  { cycle: "CYCLE 118", when: "Yesterday", title: "Deprecated Grid Scalper v1", detail: "Profit factor fell under 1.05 for 60 sessions. Capital reallocated." },
  { cycle: "CYCLE 114", when: "2 days ago", title: "Adaptive position sizing", detail: "Kelly-fraction cap set to 0.35. Max drawdown improved by 2.1pp." },
  { cycle: "CYCLE 109", when: "5 days ago", title: "New exit policy", detail: "ATR trailing stop replaced fixed take-profit in trending regimes." },
  { cycle: "CYCLE 101", when: "9 days ago", title: "Strategy promoted", detail: "Momentum Breakout v4.2 out of shadow mode into live allocation." },
];

export const improvement = Array.from({ length: 24 }, (_, i) => ({
  cycle: `C${99 + i}`,
  accuracy: 62 + i * 0.85 + (seeded(i + 3)() - 0.5) * 3,
  pf: 1.2 + i * 0.05 + (seeded(i + 11)() - 0.5) * 0.12,
}));

export const auditMonths = [
  { m: "Mar", win: 61.2, pf: 1.68, dd: -9.4, quality: 71 },
  { m: "Apr", win: 63.8, pf: 1.82, dd: -8.1, quality: 74 },
  { m: "May", win: 62.1, pf: 1.74, dd: -11.2, quality: 70 },
  { m: "Jun", win: 65.9, pf: 2.01, dd: -7.6, quality: 79 },
  { m: "Jul", win: 67.2, pf: 2.18, dd: -6.9, quality: 83 },
  { m: "Aug", win: 68.4, pf: 2.34, dd: -7.8, quality: 86 },
];

export const evolution = [
  { gen: "GEN 1", label: "Rule-based signals", score: 42 },
  { gen: "GEN 2", label: "Indicator ensemble", score: 58 },
  { gen: "GEN 3", label: "Regime-aware routing", score: 71 },
  { gen: "GEN 4", label: "Self-critique loop", score: 83 },
  { gen: "GEN 5", label: "Adaptive risk sizing", score: 89 },
];

export const risk = {
  dailyProfitLimit: 5000,
  dailyProfitUsed: 2614.74,
  dailyLossLimit: 3000,
  dailyLossUsed: 640.2,
  exposure: 18420.6,
  exposureCap: 45000,
  leverage: 5,
  leverageCap: 10,
  status: "NOMINAL" as const,
  emergencyStop: "ARMED — NOT TRIGGERED",
  openPositions: 3,
  marginRatio: 12.4,
};

export const systemNodes = [
  { name: "Market Data Feed", state: "ONLINE", latency: "42 ms", detail: "WSS · 4 streams" },
  { name: "Inference Engine", state: "ONLINE", latency: "118 ms", detail: "Model orbit-7b" },
  { name: "Execution Router", state: "ONLINE", latency: "61 ms", detail: "Simulated venue" },
  { name: "Risk Guardian", state: "ONLINE", latency: "9 ms", detail: "All limits armed" },
  { name: "Learning Pipeline", state: "TRAINING", latency: "—", detail: "Cycle 121 · 68%" },
  { name: "Archive Store", state: "ONLINE", latency: "24 ms", detail: "1.24M records" },
];
