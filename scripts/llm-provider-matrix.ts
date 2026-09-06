/**
 * Read-only diagnostic: tests EACH provider individually with a prompt that
 * requests a schema-valid strategy enum. No app changes, no secrets printed.
 */
import { getProviderByName, getAvailableProviders } from "../src/backend/ai/llm/providers";
import type { AIDecisionOutput } from "../src/backend/ai/llm/types";

const names = ["gemini", "groq", "openrouter", "cerebras", "mistral"] as const;

const SYSTEM =
  "You are a diagnostic endpoint of an AI trading system. This request is NOT a trading request. " +
  'Respond ONLY with a JSON object: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"<short text>"}';

const USER = 'Reply with exactly: LIVE_OK. Then respond with JSON only: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"LIVE_OK"}';

const results: unknown[] = [];

for (const name of names) {
  const provider = getProviderByName(name);
  const keySet = (() => {
    const p = getAvailableProviders().find((x) => x.name === name);
    return Boolean(p);
  })();
  if (!provider) {
    results.push({ provider: name, apiKeyDetected: keySet, finalResult: "NOT WORKING", errorCategory: "ENDPOINT", error: "provider not in registry" });
    continue;
  }
  const prompt = JSON.stringify({ system: SYSTEM, user: USER });
  const started = Date.now();
  try {
    const decision: AIDecisionOutput = await provider.generateDecision(prompt);
    results.push({
      provider: provider.name,
      apiKeyDetected: keySet,
      model: provider.config.model,
      endpoint: provider.config.baseUrl,
      requestSent: true,
      httpStatus: 200,
      latencyMs: Date.now() - started,
      rawProviderResult: "SUCCESS",
      schemaValidation: "PASS",
      finalResult: "WORKING",
      decision: {
        direction: decision.direction,
        confidence: decision.confidence,
        strategy: decision.strategy,
        reasoning: decision.reasoning?.slice(0, 120),
      },
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const raw = String(e.message ?? err);
    // Classify
    let category = "UNKNOWN";
    let httpStatus: string | number = "n/a";
    const statusMatch = raw.match(/HTTP (\d{3})/);
    if (statusMatch) {
      httpStatus = Number(statusMatch[1]);
      const code = Number(statusMatch[1]);
      if (code === 401 || code === 403) category = "AUTHENTICATION";
      else if (code === 402) category = "QUOTA/BILLING";
      else if (code === 429) category = "RATE_LIMITED";
      else if (code === 404) category = "MODEL_UNAVAILABLE";
      else if (code >= 500) category = "ENDPOINT";
      else category = "UNKNOWN";
    } else if (raw.startsWith("Rate limited") || raw.includes("Rate limited")) {
      category = "RATE_LIMITED";
    } else if (e.code === 23 || raw.includes("timed out") || raw.includes("Timeout")) {
      category = "TIMEOUT";
      httpStatus = "n/a";
    } else if (raw.includes("validation") || raw.includes("Validation")) {
      category = "VALIDATION";
    } else if (raw.includes("invalid JSON") || raw.includes("INVALID_JSON")) {
      category = "VALIDATION";
    } else if (raw.includes("fetch failed") || raw.includes("ECONNREFUSED") || raw.includes("ENOTFOUND")) {
      category = "NETWORK";
    }
    const safe = raw.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 220);
    results.push({
      provider: provider.name,
      apiKeyDetected: keySet,
      model: provider.config.model,
      endpoint: provider.config.baseUrl,
      requestSent: true,
      httpStatus,
      latencyMs: Date.now() - started,
      rawProviderResult: "FAIL",
      schemaValidation: "FAIL",
      finalResult: "NOT WORKING",
      errorCategory: category,
      error: safe,
    });
  }
}

console.log(JSON.stringify(results, null, 2));
