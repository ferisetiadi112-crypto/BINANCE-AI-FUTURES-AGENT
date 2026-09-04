/**
 * LLM Integration Types — BINANCE AI FUTURES AGENT v0.1
 *
 * Defines strict Zod schemas for LLM output validation,
 * provider interfaces, and configuration types.
 *
 * Safety: All LLM output is validated against AIDecisionSchema.
 * Malformed or out-of-bounds responses are rejected.
 */

import { z } from "zod";

// ─── AI Decision Output Schema (Zod) ─────────────────────────────────

/**
 * Phase 2: AI actions — what the AI wants to DO next.
 * OPEN requires a complete tradePlan; HOLD/CLOSE require an open position.
 */
export const AIActionSchema = z.enum(["RESEARCH_MORE", "WAIT", "OPEN", "HOLD", "CLOSE"]);
export type AIAction = z.infer<typeof AIActionSchema>;

/**
 * Phase 2: AI-proposed trade plan. Required when action = OPEN.
 * All values are proposals only — the Risk Engine remains the final authority.
 */
export const AITradePlanSchema = z.object({
  direction: z.enum(["LONG", "SHORT"]),
  entry: z.number().positive("Entry must be > 0"),
  stopLoss: z.number().positive("Stop loss must be > 0"),
  takeProfit: z.number().positive("Take profit must be > 0"),
  margin: z.number().positive("Margin must be > 0"),
  leverage: z.number().min(1, "Leverage must be >= 1").max(20, "Leverage must be <= 20"),
});
export type AITradePlan = z.infer<typeof AITradePlanSchema>;

/**
 * Strict Zod schema for AI-generated trading decisions.
 * Every LLM response is validated against this schema.
 * Returns that fail validation are treated as the safe fallback.
 */
export const AIDecisionSchema = z.object({
  action: AIActionSchema.default("WAIT"),
  direction: z.enum(["LONG", "SHORT", "NO_TRADE"]),
  confidence: z
    .number()
    .min(0, "Confidence must be >= 0")
    .max(1, "Confidence must be <= 1"),
  strategy: z.enum([
    "TREND_FOLLOWING",
    "MOMENTUM",
    "BREAKOUT",
    "PULLBACK",
    "MEAN_REVERSION",
  ]),
  reasoning: z.string().min(1, "Reasoning must not be empty"),
  /** Required when action = OPEN; ignored otherwise. */
  tradePlan: AITradePlanSchema.optional(),
});

export type AIDecisionOutput = z.infer<typeof AIDecisionSchema>;

// ─── Provider Error ───────────────────────────────────────────────────

export type ProviderError = {
  provider: AIProviderName;
  message: string;
  code?: string;
  rateLimited: boolean;
};

// ─── Provider Names ───────────────────────────────────────────────────

export type AIProviderName =
  | "gemini"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "mistral";

// ─── Provider Configuration ───────────────────────────────────────────

export type ProviderConfig = {
  name: AIProviderName;
  baseUrl: string;
  model: string;
  apiKeyEnvVar: string;
  maxTokens?: number;
  temperature?: number;
};

// ─── Provider Interface ───────────────────────────────────────────────

/**
 * Every AI provider must implement this interface.
 * Providers use OpenAI-compatible chat completion APIs
 * (or specific Gemini format).
 */
export interface AIProvider {
  readonly name: AIProviderName;
  readonly config: ProviderConfig;

  /**
   * Send a prompt to the provider and return a validated AI decision.
   * Throws ProviderError on failure or rate limiting.
   */
  generateDecision(prompt: string): Promise<AIDecisionOutput>;
}

// ─── Safe Fallback ────────────────────────────────────────────────────

/**
 * The ultimate safety fallback when ALL providers fail.
 * Returns a WAIT decision with zero confidence — never a fabricated trade.
 */
export const SAFE_FALLBACK: AIDecisionOutput = {
  action: "WAIT",
  direction: "NO_TRADE",
  confidence: 0,
  strategy: "TREND_FOLLOWING",
  reasoning: "All AI providers failed or returned invalid output. Safe fallback: wait.",
};
