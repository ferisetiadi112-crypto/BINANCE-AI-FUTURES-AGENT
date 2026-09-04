/**
 * AI Router — BINANCE AI FUTURES AGENT v0.1
 *
 * Implements sequential fallback routing across 3 AI providers:
 *   1. Groq (speed) → 2. Gemini (stability) → 3. OpenRouter (fallback)
 *
 * Safety guarantees:
 * - If a provider throws (error, rate limit, invalid output), the next provider is tried.
 * - If ALL providers fail, a safe fallback returns NO_TRADE with confidence 0.
 * - This ensures the system NEVER crashes on provider failure.
 * - Paper trading and Risk Engine boundaries remain intact regardless of provider state.
 */

import type { AIDecisionOutput, AIProvider, AIProviderName, ProviderError } from "./types";
import { SAFE_FALLBACK } from "./types";
import { buildTradingPrompt, type ExchangeContextForPrompt, type MarketContextForPrompt } from "./prompt";
import { getAvailableProviders } from "./providers";
import type { MarketState } from "../../runtime/types";
import { logger } from "../../logger";

export type RouterResult = {
  decision: AIDecisionOutput;
  provider: AIProviderName | "safe_fallback";
  providerAttempts: number;
  errors: ProviderError[];
  elapsedMs: number;
};

/**
 * AIRouter handles sequential fallback across all configured providers.
 *
 * Usage:
 *   const router = new AIRouter();
 *   const result = await router.route(marketState);
 *   if (result.decision.direction === "NO_TRADE" && result.provider === "safe_fallback") {
 *     // All providers failed — exercise maximum caution
 *   }
 */
export class AIRouter {
  private maxRetries: number;
  private providersOverride: AIProvider[] | undefined;

  constructor(options?: { maxRetries?: number; providers?: AIProvider[] }) {
    this.maxRetries = options?.maxRetries ?? 1;
    this.providersOverride = options?.providers;
  }

  /**
   * Route a market state through the provider chain with fallback.
   * Returns a validated AIDecisionOutput or the safe fallback.
   *
   * @param marketState - Market data from runtime intelligence
   * @param exchangeContext - Optional P7D-5.2 exchange context for AI awareness
   * @param marketContext - Optional P7D-5.3 realtime market context for AI awareness
   */
  async route(
    marketState: MarketState,
    exchangeContext?: ExchangeContextForPrompt | null,
    marketContext?: MarketContextForPrompt | null,
  ): Promise<RouterResult> {
    const startTime = Date.now();
    const prompt = buildTradingPrompt(marketState, exchangeContext, marketContext);
    const promptStr = JSON.stringify(prompt);

    const providers = this.providersOverride ?? getAvailableProviders();

    if (providers.length === 0) {
      logger.warn("ai-router", "No AI providers configured — returning safe fallback");
      return {
        decision: SAFE_FALLBACK,
        provider: "safe_fallback",
        providerAttempts: 0,
        errors: [],
        elapsedMs: Date.now() - startTime,
      };
    }

    const errors: ProviderError[] = [];
    let lastProvider: AIProviderName = providers[0]!.name;

    for (const provider of providers) {
      lastProvider = provider.name;

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const decision = await provider.generateDecision(promptStr);
          const elapsed = Date.now() - startTime;

          logger.info(
            "ai-router",
            `Decision via ${provider.name}: ${decision.direction} (${decision.confidence}) [${elapsed}ms]`,
          );

          return {
            decision,
            provider: provider.name,
            providerAttempts: errors.length + 1,
            errors,
            elapsedMs: elapsed,
          };
        } catch (err) {
          const providerError = err as ProviderError;
          errors.push(providerError);
          logger.warn(
            "ai-router",
            `Provider ${provider.name} attempt ${attempt + 1} failed: ${providerError.message}`,
          );

          // Don't retry on rate limits — move to next provider immediately
          if (providerError.rateLimited) {
            break;
          }
        }
      }
    }

    // All providers failed — safe fallback
    const elapsed = Date.now() - startTime;
    logger.error(
      "ai-router",
      `All ${providers.length} providers failed (${elapsed}ms). Returning safe fallback.`,
    );

    return {
      decision: SAFE_FALLBACK,
      provider: "safe_fallback",
      providerAttempts: providers.length,
      errors,
      elapsedMs: elapsed,
    };
  }
}
