/**
 * Chat provider chain walker — extracted from chat-agent.ts for testability.
 *
 * Walks the EXISTING provider registry (Gemini → Groq → OpenRouter →
 * Cerebras → Mistral) with the same semantics as the trading router:
 * first schema-validated success wins; all failures → null (safe fallback).
 * No credentials are ever read or logged here — provider keys stay inside
 * the existing provider implementations.
 */

import { getAvailableProviders } from "../ai/llm/providers";
import { logger } from "../logger";

export type ProviderOutcome = {
  reply: string;
  provider: string;
  modelVersion: string;
  latencyMs: number;
  fallbackIndex: number;
};

export async function runChatProviders(prompt: string): Promise<ProviderOutcome | null> {
  const providers = getAvailableProviders();
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const started = Date.now();
    try {
      const decision = await provider.generateDecision(prompt);
      // Honest provenance: llm-<provider> only after schema-validated success.
      return {
        reply: decision.reasoning,
        provider: provider.name,
        modelVersion: `llm-${provider.name}`,
        latencyMs: Date.now() - started,
        fallbackIndex: i,
      };
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "PROVIDER_ERROR";
      logger.warn(
        "chat-agent",
        `Provider ${provider.name} failed (fallbackIndex=${i}) category=${code}`,
      );
    }
  }
  return null;
}
