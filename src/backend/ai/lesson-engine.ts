/**
 * AI Lesson Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Derives structured lessons from trade experiences.
 * Lessons are evidence-based observations that improve decision-making.
 *
 * Architecture:
 *   Trade Experiences
 *     → Pattern Analysis
 *       → Lesson Generation
 *         → Database (ai_lessons)
 *           → Dashboard
 *
 * Key Principle:
 *   AI must learn from evidence, not just from trade count.
 *   Every lesson must be grounded in actual experience data.
 *
 * Database: Async via PostgreSQL adapter (dbQuery/dbExecute).
 */

import type { TradeExperience, TradeOutcome } from "./experience-engine";
import { getRecentExperiences, getExperienceStats } from "./experience-engine";
import { dbQuery, dbQueryOne, dbExecute } from "../database";
import { logger } from "../logger";

// ─── Lesson Types ───────────────────────────────────────────────────

export type LessonCategory =
  | "REGIME"
  | "STRATEGY"
  | "CONFIDENCE"
  | "RISK"
  | "TIMING"
  | "EXIT"
  | "GENERAL";

export type Lesson = {
  id: string;
  text: string;
  cycle: number;
  category: LessonCategory;
  confidence: number;
  evidenceCount: number;
  sourceExperienceIds: string[];
  createdAt: string;
};

// ─── Lesson Engine ──────────────────────────────────────────────────

let lessonCycle = 0;

export async function deriveLessons(
  recentExperiences: TradeExperience[],
  minExperiences: number = 5,
): Promise<Lesson[]> {
  const lessons: Lesson[] = [];

  if (recentExperiences.length < minExperiences) {
    logger.info(
      "lesson-engine",
      `Insufficient experiences for lesson derivation: ${recentExperiences.length}/${minExperiences}`
    );
    return lessons;
  }

  lessonCycle++;

  // Derive regime-based lessons
  const regimeLessons = deriveRegimeLessons(recentExperiences);
  lessons.push(...regimeLessons);

  // Derive strategy-based lessons
  const strategyLessons = deriveStrategyLessons(recentExperiences);
  lessons.push(...strategyLessons);

  // Derive confidence-based lessons
  const confidenceLessons = deriveConfidenceLessons(recentExperiences);
  lessons.push(...confidenceLessons);

  // Derive risk-based lessons
  const riskLessons = deriveRiskLessons(recentExperiences);
  lessons.push(...riskLessons);

  // Derive timing lessons
  const timingLessons = deriveTimingLessons(recentExperiences);
  lessons.push(...timingLessons);

  // Persist lessons
  for (const lesson of lessons) {
    await persistLesson(lesson);
  }

  logger.info(
    "lesson-engine",
    `Derived ${lessons.length} lessons from ${recentExperiences.length} experiences (cycle ${lessonCycle})`
  );

  return lessons;
}

// ─── Regime-Based Lessons ───────────────────────────────────────────

function deriveRegimeLessons(experiences: TradeExperience[]): Lesson[] {
  const lessons: Lesson[] = [];

  const byRegime = new Map<string, TradeExperience[]>();
  for (const exp of experiences) {
    const regime = exp.marketRegime;
    if (!byRegime.has(regime)) {
      byRegime.set(regime, []);
    }
    byRegime.get(regime)!.push(exp);
  }

  for (const [regime, regimeExps] of byRegime) {
    if (regimeExps.length < 3) continue;

    const wins = regimeExps.filter(e => e.outcome === "WIN").length;
    const winRate = (wins / regimeExps.length) * 100;

    if (winRate >= 70) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-REGIME-${regime}`,
        text: `${regime} regime shows strong performance (${winRate.toFixed(1)}% win rate over ${regimeExps.length} trades). Consider increasing allocation in this regime.`,
        cycle: lessonCycle,
        category: "REGIME",
        confidence: Math.min(0.9, 0.5 + (regimeExps.length / 20)),
        evidenceCount: regimeExps.length,
        sourceExperienceIds: regimeExps.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    } else if (winRate <= 30 && regimeExps.length >= 5) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-REGIME-${regime}`,
        text: `${regime} regime shows poor performance (${winRate.toFixed(1)}% win rate over ${regimeExps.length} trades). Consider reducing allocation or avoiding this regime.`,
        cycle: lessonCycle,
        category: "REGIME",
        confidence: Math.min(0.9, 0.5 + (regimeExps.length / 20)),
        evidenceCount: regimeExps.length,
        sourceExperienceIds: regimeExps.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    }
  }

  return lessons;
}

// ─── Strategy-Based Lessons ─────────────────────────────────────────

function deriveStrategyLessons(experiences: TradeExperience[]): Lesson[] {
  const lessons: Lesson[] = [];

  const byStrategy = new Map<string, TradeExperience[]>();
  for (const exp of experiences) {
    const strategy = exp.strategy;
    if (!byStrategy.has(strategy)) {
      byStrategy.set(strategy, []);
    }
    byStrategy.get(strategy)!.push(exp);
  }

  for (const [strategy, strategyExps] of byStrategy) {
    if (strategyExps.length < 3) continue;

    const wins = strategyExps.filter(e => e.outcome === "WIN").length;
    const winRate = (wins / strategyExps.length) * 100;
    const totalPnl = strategyExps.reduce((sum, e) => sum + (e.netPnl || 0), 0);

    if (winRate >= 65 && totalPnl > 0) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-STRAT-${strategy}`,
        text: `${strategy} strategy shows consistent profitability (${winRate.toFixed(1)}% win rate, PnL: $${totalPnl.toFixed(4)} over ${strategyExps.length} trades). Strong candidate for allocation increase.`,
        cycle: lessonCycle,
        category: "STRATEGY",
        confidence: Math.min(0.85, 0.4 + (strategyExps.length / 15)),
        evidenceCount: strategyExps.length,
        sourceExperienceIds: strategyExps.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    } else if (winRate <= 40 && strategyExps.length >= 5) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-STRAT-${strategy}`,
        text: `${strategy} strategy underperforming (${winRate.toFixed(1)}% win rate over ${strategyExps.length} trades). Review parameters or consider deactivation.`,
        cycle: lessonCycle,
        category: "STRATEGY",
        confidence: Math.min(0.8, 0.4 + (strategyExps.length / 15)),
        evidenceCount: strategyExps.length,
        sourceExperienceIds: strategyExps.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    }
  }

  return lessons;
}

// ─── Confidence-Based Lessons ───────────────────────────────────────

function deriveConfidenceLessons(experiences: TradeExperience[]): Lesson[] {
  const lessons: Lesson[] = [];

  const highConf = experiences.filter(e => e.confidence >= 0.7);
  const lowConf = experiences.filter(e => e.confidence < 0.4);

  if (highConf.length >= 5) {
    const wins = highConf.filter(e => e.outcome === "WIN").length;
    const winRate = (wins / highConf.length) * 100;

    if (winRate >= 60) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-CONF-HIGH`,
        text: `High confidence decisions (${(winRate).toFixed(1)}% win rate over ${highConf.length} trades) show reliable performance. Confidence threshold calibration appears effective.`,
        cycle: lessonCycle,
        category: "CONFIDENCE",
        confidence: Math.min(0.8, 0.4 + (highConf.length / 20)),
        evidenceCount: highConf.length,
        sourceExperienceIds: highConf.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (lowConf.length >= 5) {
    const wins = lowConf.filter(e => e.outcome === "WIN").length;
    const winRate = (wins / lowConf.length) * 100;

    if (winRate <= 40) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-CONF-LOW`,
        text: `Low confidence decisions underperform (${winRate.toFixed(1)}% win rate over ${lowConf.length} trades). Consider raising confidence threshold or improving signal quality.`,
        cycle: lessonCycle,
        category: "CONFIDENCE",
        confidence: Math.min(0.8, 0.4 + (lowConf.length / 20)),
        evidenceCount: lowConf.length,
        sourceExperienceIds: lowConf.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    }
  }

  return lessons;
}

// ─── Risk-Based Lessons ─────────────────────────────────────────────

function deriveRiskLessons(experiences: TradeExperience[]): Lesson[] {
  const lessons: Lesson[] = [];

  const noTrades = experiences.filter(e => e.direction === "NO_TRADE");
  const trades = experiences.filter(e => e.direction !== "NO_TRADE");

  if (noTrades.length >= 3 && trades.length >= 3) {
    const tradeLosses = trades.filter(e => e.outcome === "LOSS").length;
    const tradeLossRate = (tradeLosses / trades.length) * 100;

    if (tradeLossRate > 50) {
      lessons.push({
        id: `LESSON-${Date.now()}-${lessonCycle}-RISK-NO_TRADE`,
        text: `Trading loss rate is high (${tradeLossRate.toFixed(1)}%). NO_TRADE decisions (${noTrades.length} instances) may be appropriately conservative. Risk engine effectiveness validated.`,
        cycle: lessonCycle,
        category: "RISK",
        confidence: Math.min(0.7, 0.3 + (noTrades.length / 10)),
        evidenceCount: noTrades.length,
        sourceExperienceIds: noTrades.map(e => e.id),
        createdAt: new Date().toISOString(),
      });
    }
  }

  const rejected = experiences.filter(e => e.outcome === "CANCELLED");
  if (rejected.length >= 3) {
    lessons.push({
      id: `LESSON-${Date.now()}-${lessonCycle}-RISK-REJECTED`,
      text: `Risk engine rejected ${rejected.length} decisions. These rejections prevented potential losses. Risk controls are functioning as intended.`,
      cycle: lessonCycle,
      category: "RISK",
      confidence: Math.min(0.8, 0.4 + (rejected.length / 10)),
      evidenceCount: rejected.length,
      sourceExperienceIds: rejected.map(e => e.id),
      createdAt: new Date().toISOString(),
    });
  }

  return lessons;
}

// ─── Timing-Based Lessons ───────────────────────────────────────────

function deriveTimingLessons(experiences: TradeExperience[]): Lesson[] {
  const lessons: Lesson[] = [];

  const tradesWithDuration = experiences.filter(e => e.duration !== null && e.duration > 0);

  if (tradesWithDuration.length >= 5) {
    const wins = tradesWithDuration.filter(e => e.outcome === "WIN");
    const losses = tradesWithDuration.filter(e => e.outcome === "LOSS");

    if (wins.length > 0 && losses.length > 0) {
      const avgWinDuration = wins.reduce((sum, e) => sum + (e.duration || 0), 0) / wins.length;
      const avgLossDuration = losses.reduce((sum, e) => sum + (e.duration || 0), 0) / losses.length;

      if (avgLossDuration > avgWinDuration * 1.5) {
        lessons.push({
          id: `LESSON-${Date.now()}-${lessonCycle}-TIMING-DURATION`,
          text: `Losing trades average ${(avgLossDuration / 60000).toFixed(1)}min vs winning trades ${(avgWinDuration / 60000).toFixed(1)}min. Consider tighter time-based exits or improved stop loss placement.`,
          cycle: lessonCycle,
          category: "TIMING",
          confidence: Math.min(0.7, 0.3 + (tradesWithDuration.length / 15)),
          evidenceCount: tradesWithDuration.length,
          sourceExperienceIds: tradesWithDuration.map(e => e.id),
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return lessons;
}

// ─── Database Persistence ───────────────────────────────────────────

async function persistLesson(lesson: Lesson): Promise<void> {
  try {
    await dbExecute(
      `INSERT INTO ai_lessons (id, text, cycle, source_experience_ids)
       VALUES ($1, $2, $3, $4)`,
      [lesson.id, lesson.text, lesson.cycle, JSON.stringify(lesson.sourceExperienceIds)],
    );
  } catch (error) {
    logger.error("lesson-engine", `Failed to persist lesson: ${error}`);
  }
}

// ─── Query Functions ────────────────────────────────────────────────

export async function getRecentLessons(limit: number = 20): Promise<Lesson[]> {
  try {
    const rows = await dbQuery(
      `SELECT * FROM ai_lessons ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );

    return rows.map(row => ({
      id: row['id'] as string,
      text: row['text'] as string,
      cycle: row['cycle'] as number,
      category: "GENERAL" as LessonCategory,
      confidence: 0.5,
      evidenceCount: 0,
      sourceExperienceIds: JSON.parse(row['source_experience_ids'] as string || "[]"),
      createdAt: row['created_at'] as string,
    }));
  } catch (error) {
    logger.error("lesson-engine", `Failed to get lessons: ${error}`);
    return [];
  }
}

export async function getLessonStats(): Promise<{
  totalLessons: number;
  latestCycle: number;
  byCategory: Record<string, number>;
}> {
  try {
    const total = await dbQueryOne("SELECT COUNT(*) as count FROM ai_lessons");
    const latest = await dbQueryOne("SELECT MAX(cycle) as cycle FROM ai_lessons");

    return {
      totalLessons: (total?.['count'] as number) || 0,
      latestCycle: (latest?.['cycle'] as number) || 0,
      byCategory: {},
    };
  } catch (error) {
    logger.error("lesson-engine", `Failed to get stats: ${error}`);
    return {
      totalLessons: 0,
      latestCycle: 0,
      byCategory: {},
    };
  }
}
