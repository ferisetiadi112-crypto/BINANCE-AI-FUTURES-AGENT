/**
 * Cerebras Provider — BINANCE AI FUTURES AGENT v0.1
 *
 * Uses Cerebras' OpenAI-compatible API with wafer-scale inference.
 * Env var: CEREBRAS_API_KEY
 */

import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ProviderConfig } from "../types";

const CEREBRAS_CONFIG: ProviderConfig = {
  name: "cerebras",
  baseUrl: "https://api.cerebras.ai/v1",
  model: "llama-3.3-70b",
  apiKeyEnvVar: "CEREBRAS_API_KEY",
  maxTokens: 512,
  temperature: 0.3,
};

export class CerebrasProvider extends OpenAICompatibleProvider {
  constructor() {
    super(CEREBRAS_CONFIG);
  }
}
