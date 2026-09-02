/**
 * Provider Registry — BINANCE AI FUTURES AGENT v0.1
 *
 * Dynamically initializes AI providers based on available environment variables.
 * Only providers with configured API keys are instantiated and used.
 *
 * Active providers (Phase 9C):
 *   1. Groq (fast inference, free tier — GROQ_API_KEY)
 *   2. Gemini (stable, Google infrastructure — GEMINI_API_KEY)
 *   3. OpenRouter (multi-model fallback — OPENROUTER_API_KEY)
 *
 * Inactive providers (keys not provisioned):
 *   Cerebras, Mistral — omitted until their keys are configured.
 */

import { GroqProvider } from "./groq";
import { CerebrasProvider } from "./cerebras";
import { GeminiProvider } from "./gemini";
import { OpenRouterProvider } from "./openrouter";
import { MistralProvider } from "./mistral";
import type { AIProvider, AIProviderName } from "../types";
import { logger } from "../../../logger";

/**
 * Get all available providers in fallback priority order.
 * Providers are only included when their API key env var is present and non-empty.
 * Missing keys are silently skipped — never causes a runtime crash.
 */
export function getAvailableProviders(): AIProvider[] {
  const allProviders: AIProvider[] = [
    new GroqProvider(),    // 1. Speed — GROQ_API_KEY
    new GeminiProvider(),  // 2. Stability — GEMINI_API_KEY
    new OpenRouterProvider(), // 3. Fallback — OPENROUTER_API_KEY
  ];

  const available = allProviders.filter((p) => {
    const key = process.env[p.config.apiKeyEnvVar];
    return key !== undefined && key.length > 0;
  });

  if (available.length > 0) {
    logger.info(
      "provider-registry",
      `Active providers: ${available.map((p) => p.name).join(" → ")}`,
    );
  } else {
    logger.warn("provider-registry", "No AI providers configured — all LLM calls will use safe fallback");
  }

  return available;
}

/**
 * Get all providers with configuration status (for API/status endpoint).
 * Returns every provider regardless of whether its key is configured.
 */
export function getProviderRegistry(): Array<AIProvider & { isConfigured: () => boolean }> {
  const all = [
    new GroqProvider(),
    new GeminiProvider(),
    new CerebrasProvider(),
    new OpenRouterProvider(),
    new MistralProvider(),
  ];

  return all.map((p) => {
    const configured = (() => {
      const key = process.env[p.config.apiKeyEnvVar];
      return key !== undefined && key.length > 0;
    })();

    return {
      name: p.name,
      config: p.config,
      generateDecision: p.generateDecision.bind(p),
      isConfigured: () => configured,
    } satisfies AIProvider & { isConfigured: () => boolean };
  });
}

/**
 * Get a specific provider by name.
 * Returns undefined if the provider's API key is not configured.
 */
export function getProviderByName(name: AIProviderName): AIProvider | undefined {
  const providers = getAvailableProviders();
  return providers.find((p) => p.name === name);
}

export { GroqProvider } from "./groq";
export { CerebrasProvider } from "./cerebras";
export { GeminiProvider } from "./gemini";
export { OpenRouterProvider } from "./openrouter";
export { MistralProvider } from "./mistral";
