/**
 * NVIDIA NIM Provider — BINANCE AI FUTURES AGENT v0.1
 *
 * Uses NVIDIA NIM's OpenAI-compatible API (integrate.api.nvidia.com).
 * Env var: NVIDIA_NIM_API_KEY
 */

import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ProviderConfig } from "../types";

const NVIDIA_NIM_CONFIG: ProviderConfig = {
  name: "nvidia-nim",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  model: "meta/llama-3.2-11b-vision-instruct",
  apiKeyEnvVar: "NVIDIA_NIM_API_KEY",
  maxTokens: 512,
  temperature: 0.3,
};

export class NvidiaNimProvider extends OpenAICompatibleProvider {
  constructor() {
    super(NVIDIA_NIM_CONFIG);
  }
}
