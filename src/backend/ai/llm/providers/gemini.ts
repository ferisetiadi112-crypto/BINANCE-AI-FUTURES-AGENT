/**
 * Gemini Provider — BINANCE AI FUTURES AGENT v0.1
 *
 * Uses Google's generativelanguage API (native format, not OpenAI-compatible).
 * Env var: GEMINI_API_KEY
 */

import { AIDecisionSchema, type AIDecisionOutput, type ProviderConfig, type ProviderError } from "../types";
import { logger } from "../../../logger";

const GEMINI_CONFIG: ProviderConfig = {
  name: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-2.0-flash",
  apiKeyEnvVar: "GEMINI_API_KEY",
  maxTokens: 512,
  temperature: 0.3,
};

type GeminiContent = {
  parts: Array<{ text: string }>;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  error?: {
    message: string;
    code: number;
  };
};

export class GeminiProvider {
  readonly name = "gemini" as const;
  readonly config: ProviderConfig = GEMINI_CONFIG;

  async generateDecision(prompt: string): Promise<AIDecisionOutput> {
    const { system, user } = JSON.parse(prompt) as { system: string; user: string };

    const apiKey = process.env[this.config.apiKeyEnvVar];
    if (!apiKey) {
      throw this.createError(
        `Missing API key: ${this.config.apiKeyEnvVar}`,
        "MISSING_API_KEY",
        false,
      );
    }

    const contents: GeminiContent[] = [
      { parts: [{ text: user }] },
    ];

    const body = {
      contents,
      systemInstruction: {
        parts: [{ text: system }],
      },
      generationConfig: {
        temperature: this.config.temperature ?? 0.3,
        maxOutputTokens: this.config.maxTokens ?? 512,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            direction: { type: "STRING", enum: ["LONG", "SHORT", "NO_TRADE"] },
            confidence: { type: "NUMBER" },
            strategy: {
              type: "STRING",
              enum: [
                "TREND_FOLLOWING",
                "MOMENTUM",
                "BREAKOUT",
                "PULLBACK",
                "MEAN_REVERSION",
              ],
            },
            reasoning: { type: "STRING" },
          },
          required: ["direction", "confidence", "strategy", "reasoning"],
        },
      },
    };

    const response = await fetch(
      `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw this.createError(
        `Rate limited by gemini${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
        "RATE_LIMITED",
        true,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw this.createError(
        `gemini HTTP ${response.status}: ${text.slice(0, 200)}`,
        "HTTP_ERROR",
        response.status === 429,
      );
    }

    const data = (await response.json()) as GeminiGenerateResponse;

    if (data.error) {
      throw this.createError(
        `gemini API error: ${data.error.message}`,
        String(data.error.code),
        false,
      );
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw this.createError(
        "gemini returned empty response",
        "EMPTY_RESPONSE",
        false,
      );
    }

    return this.parseAndValidate(content);
  }

  private parseAndValidate(raw: string): AIDecisionOutput {
    const cleaned = raw
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw this.createError(
        "gemini returned invalid JSON",
        "INVALID_JSON",
        false,
      );
    }

    const result = AIDecisionSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join("; ");
      throw this.createError(
        `gemini output failed validation: ${issues}`,
        "VALIDATION_ERROR",
        false,
      );
    }

    logger.debug("gemini", `Valid decision: ${result.data.direction} (${result.data.confidence}) via ${result.data.strategy}`);
    return result.data;
  }

  private createError(
    message: string,
    code: string,
    rateLimited: boolean,
  ): ProviderError {
    return { provider: this.name, message, code, rateLimited };
  }
}
