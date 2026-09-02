/**
 * Mistral Provider — BINANCE AI FUTURES AGENT v0.1
 *
 * Uses Mistral's OpenAI-compatible API.
 * Env var: MISTRAL_API_KEY
 */

import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ProviderConfig } from "../types";

const MISTRAL_CONFIG: ProviderConfig = {
  name: "mistral",
  baseUrl: "https://api.mistral.ai/v1",
  model: "mistral-small-latest",
  apiKeyEnvVar: "MISTRAL_API_KEY",
  maxTokens: 512,
  temperature: 0.3,
};

export class MistralProvider extends OpenAICompatibleProvider {
  constructor() {
    super(MISTRAL_CONFIG);
  }
}
