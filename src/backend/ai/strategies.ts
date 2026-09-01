/**
 * Strategy Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Modular strategy components that evaluate MarketState
 * and produce candidate signals.
 *
 * Strategies:
 * 1. Trend Following
 * 2. Momentum
 * 3. Breakout
 * 4. Pullback
 * 5. Mean Reversion
 *
 * Each strategy is independent and produces a signal.
 * The AI Decision Engine aggregates signals into a decision.
 */

import type { MarketState } from "../runtime/types";
import type { StrategySignal, StrategyName, StrategyEvaluation, DecisionDirection } from "./types";

// ─── Strategy Interface ───────────────────────────────────────────────

interface Strategy {
  name: StrategyName;
  evaluate(state: MarketState): StrategySignal;
}

// ─── Trend Following ──────────────────────────────────────────────────

const TrendFollowing: Strategy = {
  name: "TREND_FOLLOWING",

  evaluate(state: MarketState): StrategySignal {
    let direction: DecisionDirection = "NO_TRADE";
    let strength = 0;
    const reasons: string[] = [];

    // Strong uptrend
    if (state.trend === "UP" && state.trendStrength > 60 && state.momentumScore > 55) {
      direction = "LONG";
      strength = Math.min(1, state.trendStrength / 100 * 0.6 + state.momentumScore / 100 * 0.4);
      reasons.push(`Trend UP with strength ${state.trendStrength}`);
      reasons.push(`Momentum score ${state.momentumScore}`);
    }
    // Strong downtrend
    else if (state.trend === "DOWN" && state.trendStrength > 60 && state.momentumScore < 45) {
      direction = "SHORT";
      strength = Math.min(1, state.trendStrength / 100 * 0.6 + (100 - state.momentumScore) / 100 * 0.4);
      reasons.push(`Trend DOWN with strength ${state.trendStrength}`);
      reasons.push(`Momentum score ${state.momentumScore}`);
    }
    else {
      reasons.push("No clear trend signal");
    }

    return {
      strategy: "TREND_FOLLOWING",
      direction,
      strength,
      reasoning: reasons.join("; "),
    };
  },
};

// ─── Momentum ─────────────────────────────────────────────────────────

const Momentum: Strategy = {
  name: "MOMENTUM",

  evaluate(state: MarketState): StrategySignal {
    let direction: DecisionDirection = "NO_TRADE";
    let strength = 0;
    const reasons: string[] = [];

    // Strong bullish momentum
    if (state.momentum === "STRONG" && state.momentumScore > 65) {
      direction = state.trend === "DOWN" ? "SHORT" : "LONG";
      strength = state.momentumScore / 100;
      reasons.push(`Strong momentum, score ${state.momentumScore}`);
    }
    // Moderate momentum with trend alignment
    else if (state.momentum === "MODERATE" && state.trend !== "FLAT") {
      direction = state.trend === "UP" ? "LONG" : "SHORT";
      strength = state.momentumScore / 100 * 0.7;
      reasons.push(`Moderate momentum aligned with ${state.trend} trend`);
    }
    else {
      reasons.push("Insufficient momentum signal");
    }

    return {
      strategy: "MOMENTUM",
      direction,
      strength,
      reasoning: reasons.join("; "),
    };
  },
};

// ─── Breakout ─────────────────────────────────────────────────────────

const Breakout: Strategy = {
  name: "BREAKOUT",

  evaluate(state: MarketState): StrategySignal {
    let direction: DecisionDirection = "NO_TRADE";
    let strength = 0;
    const reasons: string[] = [];

    if (state.marketRegime === "BREAKOUT") {
      // Determine breakout direction from trend
      if (state.trend === "UP" && state.volatilityPercent > 1.5) {
        direction = "LONG";
        strength = 0.7;
        reasons.push("Breakout detected in UP trend");
      } else if (state.trend === "DOWN" && state.volatilityPercent > 1.5) {
        direction = "SHORT";
        strength = 0.7;
        reasons.push("Breakout detected in DOWN trend");
      } else {
        reasons.push("Breakout but unclear direction");
      }
    } else {
      reasons.push("No breakout regime detected");
    }

    return {
      strategy: "BREAKOUT",
      direction,
      strength,
      reasoning: reasons.join("; "),
    };
  },
};

// ─── Pullback ─────────────────────────────────────────────────────────

const Pullback: Strategy = {
  name: "PULLBACK",

  evaluate(state: MarketState): StrategySignal {
    let direction: DecisionDirection = "NO_TRADE";
    let strength = 0;
    const reasons: string[] = [];

    // In an uptrend, look for pullback to buy
    if (state.trend === "UP" && state.momentum === "WEAK" && state.volatilityPercent < 2) {
      direction = "LONG";
      strength = 0.6;
      reasons.push("Pullback in uptrend — potential buy");
    }
    // In a downtrend, look for pullback to sell
    else if (state.trend === "DOWN" && state.momentum === "WEAK" && state.volatilityPercent < 2) {
      direction = "SHORT";
      strength = 0.6;
      reasons.push("Pullback in downtrend — potential sell");
    }
    else {
      reasons.push("No pullback opportunity");
    }

    return {
      strategy: "PULLBACK",
      direction,
      strength,
      reasoning: reasons.join("; "),
    };
  },
};

// ─── Mean Reversion ───────────────────────────────────────────────────

const MeanReversion: Strategy = {
  name: "MEAN_REVERSION",

  evaluate(state: MarketState): StrategySignal {
    let direction: DecisionDirection = "NO_TRADE";
    let strength = 0;
    const reasons: string[] = [];

    if (state.marketRegime === "RANGING") {
      // In ranging market, fade extremes
      if (state.trendStrength < 30 && state.volatilityPercent < 1.5) {
        direction = state.trend === "UP" ? "SHORT" : "LONG"; // Fade
        strength = 0.5;
        reasons.push("Mean reversion in ranging market");
      } else {
        reasons.push("Ranging but conditions not ideal for mean reversion");
      }
    } else {
      reasons.push("Not in ranging regime");
    }

    return {
      strategy: "MEAN_REVERSION",
      direction,
      strength,
      reasoning: reasons.join("; "),
    };
  },
};

// ─── All Strategies ───────────────────────────────────────────────────

const ALL_STRATEGIES: Strategy[] = [
  TrendFollowing,
  Momentum,
  Breakout,
  Pullback,
  MeanReversion,
];

// ─── Strategy Evaluation ──────────────────────────────────────────────

export function evaluateAllStrategies(state: MarketState): StrategyEvaluation[] {
  return ALL_STRATEGIES.map(strategy => ({
    strategy: strategy.name,
    signal: strategy.evaluate(state),
    marketState: state,
    timestamp: Date.now(),
  }));
}

export function getBestSignal(state: MarketState): StrategyEvaluation | null {
  const evaluations = evaluateAllStrategies(state);

  // Filter out NO_TRADE signals
  const actionable = evaluations.filter(e => e.signal.direction !== "NO_TRADE");

  if (actionable.length === 0) return null;

  // Sort by strength descending
  actionable.sort((a, b) => b.signal.strength - a.signal.strength);

  return actionable[0]!;
}

export function getStrategyByName(name: StrategyName): Strategy | undefined {
  return ALL_STRATEGIES.find(s => s.name === name);
}

export function getAllStrategyNames(): StrategyName[] {
  return ALL_STRATEGIES.map(s => s.name);
}
