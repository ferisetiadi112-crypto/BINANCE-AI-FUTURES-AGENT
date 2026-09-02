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
 * Strict Zod schema for AI-generated trading decisions.
 * Every LLM response is validated against this schema.
 * Returns that fail validation are treated as NO_TRADE.
 */
export const AIDecisionSchema = z.object({
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
 * Returns a NO_TRADE decision with zero confidence.
 */
export const SAFE_FALLBACK: AIDecisionOutput = {
  direction: "NO_TRADE",
  confidence: 0,
  strategy: "TREND_FOLLOWING",
  reasoning: "All AI providers failed or returned invalid output. Safe fallback: no trade.",
};
