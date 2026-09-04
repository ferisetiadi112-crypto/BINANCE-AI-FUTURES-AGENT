/**
 * Memory Context — Phase 1 (AI Brain connected)
 *
 * Builds a SMALL, bounded, relevant memory context for the LLM prompt from
 * the EXISTING memory stores (ai_lessons + trade_experiences). Read-only:
 * no new storage, no schema change, no writing.
 *
 * Bounded: max 5 lessons + 3 relevant experiences, hard character cap.
 * Relevant: lessons filtered by symbol/regime when possible; experiences
 * filtered to the same symbol first, then most recent overall.
 * If nothing exists, returns an explicitly-empty context.
 */

import type { MarketState } from "../runtime/types";
import { getRecentExperiences, type TradeExperience } from "./experience-engine";
import { getRecentLessons, type Lesson } from "./lesson-engine";
import { logger } from "../logger";

export type MemoryContextForPrompt = {
  available: boolean;
  lessonCount: number;
  experienceCount: number;
  lessons: string[];
  experiences: string[];
  /** Human/LLM-readable block, empty string when no memory exists. */
  formatted: string;
};

const MAX_LESSONS = 5;
const MAX_EXPERIENCES = 3;
const MAX_CHARS = 1200;

function formatLesson(l: Lesson): string {
  return `- ${l.text} (confidence ${l.confidence.toFixed(2)})`;
}

function formatExperience(e: TradeExperience): string {
  const pnl =
    e.netPnl !== null ? `$${e.netPnl.toFixed(2)}` : "open/no-trade";
  return `- ${e.symbol} ${e.direction} (${e.strategy}, ${e.outcome}, ${pnl})`;
}

/**
 * Build bounded memory context for a decision on `marketState.symbol`.
 * Never throws — DB failures degrade to empty context (honest state).
 */
export async function buildMemoryContext(
  marketState: MarketState,
): Promise<MemoryContextForPrompt> {
  const empty: MemoryContextForPrompt = {
    available: false,
    lessonCount: 0,
    experienceCount: 0,
    lessons: [],
    experiences: [],
    formatted: "",
  };

  try {
    const [allLessons, recentExperiences] = await Promise.all([
      getRecentLessons(MAX_LESSONS),
      getRecentExperiences(20),
    ]);

    // Relevance filter: prefer same-symbol experiences, keep the rest as
    // recency fallback. Lessons are global but bounded to MAX_LESSONS.
    const sameSymbol = recentExperiences.filter(
      (e) => e.symbol === marketState.symbol,
    );
    const others = recentExperiences.filter(
      (e) => e.symbol !== marketState.symbol,
    );
    const selected = [...sameSymbol, ...others].slice(0, MAX_EXPERIENCES);

    const lessons = allLessons.slice(0, MAX_LESSONS);

    const available = lessons.length > 0 || selected.length > 0;
    if (!available) return empty;

    const lines: string[] = [
      `MEMORY (from ${lessons.length} lessons, ${selected.length} recent experiences — same-symbol first):`,
    ];
    for (const l of lessons) lines.push(formatLesson(l));
    for (const e of selected) lines.push(formatExperience(e));

    let formatted = lines.join("\n");
    if (formatted.length > MAX_CHARS) {
      formatted = formatted.slice(0, MAX_CHARS - 3) + "...";
    }

    return {
      available: true,
      lessonCount: lessons.length,
      experienceCount: selected.length,
      lessons: lessons.map((l) => l.text),
      experiences: selected.map(formatExperience),
      formatted,
    };
  } catch (err) {
    logger.warn("memory-context", `Failed to build memory context: ${err}`);
    return empty;
  }
}
