/**
 * Groq Provider — BINANCE AI FUTURES AGENT v0.1
 *
 * Uses Groq's OpenAI-compatible API with fast inference.
 * Env var: GROQ_API_KEY
 */

import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ProviderConfig } from "../types";

const GROQ_CONFIG: ProviderConfig = {
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.3-70b-versatile",
  apiKeyEnvVar: "GROQ_API_KEY",
  maxTokens: 512,
  temperature: 0.3,
};

export class GroqProvider extends OpenAICompatibleProvider {
  constructor() {
    super(GROQ_CONFIG);
  }
}
