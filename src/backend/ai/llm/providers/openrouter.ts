/**
 * OpenRouter Provider — BINANCE AI FUTURES AGENT v0.1
 *
 * Uses OpenRouter's OpenAI-compatible API for multi-model routing.
 * Env var: OPENROUTER_API_KEY
 */

import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ProviderConfig } from "../types";

const OPENROUTER_CONFIG: ProviderConfig = {
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "anthropic/claude-3.5-haiku",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  maxTokens: 512,
  temperature: 0.3,
};

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor() {
    super(OPENROUTER_CONFIG);
  }
}
