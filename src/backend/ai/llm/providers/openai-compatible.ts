/**
 * OpenAI-Compatible Provider Base — BINANCE AI FUTURES AGENT v0.1
 *
 * Shared implementation for providers that use the OpenAI chat completions API:
 * Groq, Cerebras, OpenRouter, and Mistral.
 *
 * Handles HTTP requests, response parsing, rate-limit detection,
 * and Zod validation of the output.
 */

import { AIDecisionSchema, type AIDecisionOutput, type ProviderConfig, type ProviderError } from "../types";
import { logger } from "../../../logger";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatCompletionResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
    code?: string;
  };
};

/**
 * Base class for OpenAI-compatible chat completion providers.
 */
export abstract class OpenAICompatibleProvider {
  readonly name: ProviderConfig["name"];
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * Send a prompt to the provider and return a validated AI decision.
   */
  async generateDecision(prompt: string): Promise<AIDecisionOutput> {
    const { system, user } = JSON.parse(prompt) as { system: string; user: string };
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    const body = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.3,
      max_tokens: this.config.maxTokens ?? 512,
      response_format: { type: "json_object" as const },
    };

    const apiKey = process.env[this.config.apiKeyEnvVar];
    if (!apiKey) {
      throw this.createError(
        `Missing API key: ${this.config.apiKeyEnvVar}`,
        "MISSING_API_KEY",
        false,
      );
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw this.createError(
        `Rate limited by ${this.name}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
        "RATE_LIMITED",
        true,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw this.createError(
        `${this.name} HTTP ${response.status}: ${text.slice(0, 200)}`,
        "HTTP_ERROR",
        response.status === 429,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;

    if (data.error) {
      throw this.createError(
        `${this.name} API error: ${data.error.message}`,
        data.error.code ?? "API_ERROR",
        false,
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw this.createError(
        `${this.name} returned empty response`,
        "EMPTY_RESPONSE",
        false,
      );
    }

    return this.parseAndValidate(content);
  }

  /**
   * Parse raw LLM response text and validate against AIDecisionSchema.
   */
  protected parseAndValidate(raw: string): AIDecisionOutput {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw this.createError(
        `${this.name} returned invalid JSON`,
        "INVALID_JSON",
        false,
      );
    }

    const result = AIDecisionSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join("; ");
      throw this.createError(
        `${this.name} output failed validation: ${issues}`,
        "VALIDATION_ERROR",
        false,
      );
    }

    logger.debug(this.name, `Valid decision: ${result.data.direction} (${result.data.confidence}) via ${result.data.strategy}`);
    return result.data;
  }

  protected createError(
    message: string,
    code: string,
    rateLimited: boolean,
  ): ProviderError {
    return { provider: this.name, message, code, rateLimited };
  }
}
