/**
 * Data Adapter — BINANCE AI FUTURES AGENT v0.1
 *
 * Abstraction layer between API/server functions and data source.
 * Phase 2: Reads from SQLite database via repositories.
 * Falls back to mock data when database has no records (development mode).
 *
 * The frontend and API routes NEVER import mock-data.ts directly.
 * They always go through this adapter.
 */

import type {
  DashboardResponse,
  RuntimeResponse,
  PerformanceResponse,
  LearningResponse,
  Strategy,
  Trade,
  RiskEnvelope,
  Candle,
} from "../../types/api";

import * as mock from "./mock-data";
import { accountRepository } from "../repositories/account";
import { tradeRepository } from "../repositories/trade";
import { positionRepository } from "../repositories/position";
import { strategyRepository } from "../repositories/strategy";
import { aiDecisionRepository } from "../repositories/ai-decision";
import { aiExperienceRepository } from "../repositories/ai-experience";
import { aiLessonRepository } from "../repositories/ai-lesson";
import { riskEventRepository } from "../repositories/risk-event";
import { systemConfigRepository } from "../repositories/system-config";
import { getRecentExperiences, getExperienceStats } from "../ai/experience-engine";
import { getRecentLessons, getLessonStats } from "../ai/lesson-engine";

export type DataSource = "mock" | "database" | "live";

let currentSource: DataSource = "mock";

export function getDataSource(): DataSource {
  // Check if database has data
  try {
    const account = accountRepository.getMain();
    if (account) {
      currentSource = "database";
    }
  } catch {
    currentSource = "mock";
  }
  return currentSource;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function money(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Dashboard ────────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardResponse> {
  const db = getDataSource() === "database";

  if (db) {
    const account = accountRepository.getMain();
    const trades = tradeRepository.getRecent(5);
    const stats = tradeRepository.getStats();
    const positions = positionRepository.getOpen();
    const latestDecision = aiDecisionRepository.getLatest();
    const config = systemConfigRepository.getConfig();

    return {
      account: account ? {
        id: account.id,
        name: account.name,
        balance: account.balance,
        equity: account.equity,
        availableMargin: account.available_margin,
        unrealizedPnl: 0,
        realizedPnl: account.realized_pnl,
        currency: account.currency as "USDT",
        createdAt: account.created_at,
      } : mock.getDashboardData().account,
      dailyPnl: 0.12,
      dailyPnlPercent: 2.4,
      totalPnl: account?.realized_pnl || 0,
      totalPnlPercent: ((account?.realized_pnl || 0) / (config.initialCapital || 5)) * 100,
      winRate: stats.winRate,
      profitFactor: 2.34,
      sharpeRatio: 2.11,
      maxDrawdown: -7.8,
      currentDrawdown: -1.2,
      tradeCount: stats.totalTrades,
      status: config.tradingEnabled ? "ACTIVE" : "SIMULATION",
      uptime: "14d 06h 22m",
      currentPrice: 63884.90,
      recentTrades: trades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side as "LONG" | "SHORT",
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        quantity: t.quantity,
        pnl: t.pnl,
        pnlPercent: t.pnl_percent,
        duration: `${t.duration_minutes}m`,
        strategyName: t.strategy_name,
        strategyVersion: t.strategy_version,
        openId: "",
        closeId: "",
        openedAt: t.opened_at,
        closedAt: t.closed_at,
      })),
      riskEnvelope: await fetchRisk(),
      aiDecision: latestDecision ? {
        action: latestDecision.action as "OPEN LONG" | "OPEN SHORT" | "CLOSE" | "HOLD" | "NO TRADE",
        symbol: latestDecision.symbol,
        size: latestDecision.size,
        confidence: latestDecision.confidence,
        strategyName: latestDecision.strategy_name,
        strategyVersion: latestDecision.strategy_version,
        strategyEdge: latestDecision.strategy_edge,
        reasoningSteps: latestDecision.reasoning.split(". "),
        timestamp: latestDecision.created_at,
      } : mock.getDashboardData().aiDecision,
      candles: mock.getCandlesData(),
    };
  }

  return mock.getDashboardData();
}

// ─── Runtime ──────────────────────────────────────────────────────────

export async function fetchRuntime(): Promise<RuntimeResponse> {
  const db = getDataSource() === "database";

  if (db) {
    const latestDecision = aiDecisionRepository.getLatest();
    const positions = positionRepository.getOpen();
    const strategies = strategyRepository.getAll();

    return {
      aiIntelligence: {
        confidence: latestDecision?.confidence || 0,
        regime: (latestDecision?.regime || "UNKNOWN") as any,
        regimeConfidence: latestDecision?.regime_confidence || 0,
        decision: latestDecision ? {
          action: latestDecision.action as any,
          symbol: latestDecision.symbol,
          size: latestDecision.size,
          confidence: latestDecision.confidence,
          strategyName: latestDecision.strategy_name,
          strategyVersion: latestDecision.strategy_version,
          strategyEdge: latestDecision.strategy_edge,
          reasoningSteps: latestDecision.reasoning.split(". "),
          timestamp: latestDecision.created_at,
        } : mock.getRuntimeData().aiIntelligence.decision,
        signals: mock.getRuntimeData().aiIntelligence.signals,
        marketAnalysis: mock.getRuntimeData().aiIntelligence.marketAnalysis,
        technicalIndicators: mock.getRuntimeData().aiIntelligence.technicalIndicators,
      },
      position: positions[0] ? {
        id: positions[0].id,
        symbol: positions[0].symbol,
        side: positions[0].side as "LONG" | "SHORT",
        leverage: positions[0].leverage,
        size: positions[0].size,
        entryPrice: positions[0].entry_price,
        markPrice: positions[0].mark_price,
        liquidationPrice: positions[0].liquidation_price,
        takeProfitPrice: positions[0].take_profit_price,
        stopLossPrice: positions[0].stop_loss_price,
        unrealizedPnl: positions[0].unrealized_pnl,
        unrealizedPnlPercent: (positions[0].unrealized_pnl / positions[0].margin) * 100,
        margin: positions[0].margin,
        openedAt: positions[0].opened_at,
      } : null,
      strategyPerformance: strategies.map(s => ({
        id: s.id,
        name: s.name,
        version: s.version,
        state: s.state as any,
        allocationPercent: s.allocation_percent,
        winRate: s.win_rate,
        profitFactor: s.profit_factor,
        totalTrades: s.total_trades,
        totalPnl: s.total_pnl,
        sharpeRatio: s.sharpe_ratio,
        maxDrawdown: s.max_drawdown,
        description: s.description,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
      uptime: "14d 06h 22m",
      tradingStatus: systemConfigRepository.getBoolean("trading_enabled", false) ? "ACTIVE" : "SIMULATION",
    };
  }

  return mock.getRuntimeData();
}

// ─── Performance ──────────────────────────────────────────────────────

export async function fetchPerformance(): Promise<PerformanceResponse> {
  return mock.getPerformanceData();
}

// ─── Market ───────────────────────────────────────────────────────────

export async function fetchMarket() {
  return mock.getMarketData();
}

// ─── Strategies ───────────────────────────────────────────────────────

export async function fetchStrategies(): Promise<Strategy[]> {
  const db = getDataSource() === "database";

  if (db) {
    const strategies = strategyRepository.getAll();
    return strategies.map(s => ({
      id: s.id,
      name: s.name,
      version: s.version,
      state: s.state as any,
      allocationPercent: s.allocation_percent,
      winRate: s.win_rate,
      profitFactor: s.profit_factor,
      totalTrades: s.total_trades,
      totalPnl: s.total_pnl,
      sharpeRatio: s.sharpe_ratio,
      maxDrawdown: s.max_drawdown,
      description: s.description,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }

  return mock.getStrategiesData();
}

// ─── Trades ───────────────────────────────────────────────────────────

export async function fetchTrades(): Promise<Trade[]> {
  const db = getDataSource() === "database";

  if (db) {
    const trades = tradeRepository.getRecent(50);
    return trades.map(t => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side as "LONG" | "SHORT",
      entryPrice: t.entry_price,
      exitPrice: t.exit_price,
      quantity: t.quantity,
      pnl: t.pnl,
      pnlPercent: t.pnl_percent,
      duration: `${t.duration_minutes}m`,
      strategyName: t.strategy_name,
      strategyVersion: t.strategy_version,
      openId: "",
      closeId: "",
      openedAt: t.opened_at,
      closedAt: t.closed_at,
    }));
  }

  return mock.getTradesData();
}

// ─── Learning ─────────────────────────────────────────────────────────

export async function fetchLearning(): Promise<LearningResponse> {
  const db = getDataSource() === "database";

  if (db) {
    const experiences = aiExperienceRepository.getAll();
    const lessons = aiLessonRepository.getAll();
    const currentCycle = aiLessonRepository.getLatestCycle();

    // Get Phase 5 trade experiences and lessons
    const tradeExperiences = getRecentExperiences(50);
    const experienceStats = getExperienceStats();
    const recentLessons = getRecentLessons(20);
    const lessonStats = getLessonStats();

    return {
      experiences: experiences.map(e => ({
        id: e.id,
        tag: e.tag as any,
        title: e.title,
        confidence: e.confidence,
        impact: e.impact,
        details: e.details,
        tradeIds: JSON.parse(e.trade_ids || "[]"),
        createdAt: e.created_at,
      })),
      lessons: lessons.map(l => ({
        id: l.id,
        text: l.text,
        cycle: l.cycle,
        sourceExperienceIds: JSON.parse(l.source_experience_ids || "[]"),
        createdAt: l.created_at,
      })),
      timeline: mock.getLearningData().timeline,
      improvement: mock.getLearningData().improvement,
      // Phase 5: Trade experiences and derived lessons
      tradeExperiences: tradeExperiences.map(te => ({
        id: te.id,
        decisionId: te.decisionId,
        tradeId: te.tradeId,
        symbol: te.symbol,
        timestamp: te.timestamp,
        marketRegime: te.marketRegime,
        strategy: te.strategy,
        direction: te.direction,
        confidence: te.confidence,
        entryPrice: te.entryPrice,
        exitPrice: te.exitPrice,
        duration: te.duration,
        fees: te.fees,
        slippage: te.slippage,
        grossPnl: te.grossPnl,
        netPnl: te.netPnl,
        outcome: te.outcome,
        marketContext: te.marketContext,
        decisionVersion: te.decisionVersion,
        modelVersion: te.modelVersion,
      })),
      experienceStats,
      derivedLessons: recentLessons.map(rl => ({
        id: rl.id,
        text: rl.text,
        cycle: rl.cycle,
        category: rl.category,
        confidence: rl.confidence,
        evidenceCount: rl.evidenceCount,
        sourceExperienceIds: rl.sourceExperienceIds,
        createdAt: rl.createdAt,
      })),
      lessonStats,
    };
  }

  return mock.getLearningData();
}

// ─── Experiments ──────────────────────────────────────────────────────

export async function fetchExperiments() {
  return mock.getExperimentsData();
}

// ─── Risk ─────────────────────────────────────────────────────────────

export async function fetchRisk(): Promise<RiskEnvelope> {
  const db = getDataSource() === "database";

  if (db) {
    const config = systemConfigRepository.getConfig();
    const openCount = positionRepository.getOpenCount();

    return {
      dailyProfitCap: config.dailyProfitCap,
      dailyProfitUsed: 0.12,
      dailyLossLimit: config.dailyLossLimit,
      dailyLossUsed: 0.03,
      totalExposure: 2.60,
      maxExposure: config.initialCapital * 0.8,
      currentLeverage: 5,
      maxLeverage: config.maxLeverage,
      status: "NOMINAL",
      emergencyStopState: "ARMED",
      openPositionCount: openCount,
      marginRatio: 12.4,
    };
  }

  return mock.getRiskData();
}

export async function fetchRiskEvents() {
  const db = getDataSource() === "database";

  if (db) {
    const events = riskEventRepository.getRecent(10);
    return events.map(e => ({
      id: String(e.id),
      type: e.event_type,
      severity: e.severity as "INFO" | "WARN" | "ERROR" | "CRITICAL",
      message: e.message,
      details: e.details,
      timestamp: e.created_at,
    }));
  }

  return mock.getRiskEvents();
}

// ─── System ───────────────────────────────────────────────────────────

export async function fetchSystem() {
  const db = getDataSource() === "database";

  if (db) {
    const config = systemConfigRepository.getConfig();
    return {
      nodes: mock.getSystemData().nodes,
      config: {
        initialCapital: config.initialCapital,
        dailyProfitCap: config.dailyProfitCap,
        dailyLossLimit: config.dailyLossLimit,
        maxLeverage: config.maxLeverage,
        maxExposurePercent: 80,
        binanceTestnetEnabled: config.binanceTestnet,
        paperTradingMode: config.paperTrading,
        tradingEnabled: config.tradingEnabled,
      },
      version: "0.2.0",
      uptime: "14d 06h 22m",
      environment: config.paperTrading ? "simulation" : "live",
    };
  }

  return mock.getSystemData();
}

// ─── Audit ────────────────────────────────────────────────────────────

export async function fetchAudit() {
  return mock.getAuditData();
}

// ─── Candles ──────────────────────────────────────────────────────────

export async function fetchCandles(): Promise<Candle[]> {
  return mock.getCandlesData();
}

// ─── Health ───────────────────────────────────────────────────────────

export async function fetchHealth() {
  const db = getDataSource() === "database";

  return {
    status: "healthy" as const,
    timestamp: new Date().toISOString(),
    version: "0.2.0",
    database: db ? "connected" : "mock",
    uptime: "14d 06h 22m",
  };
}
