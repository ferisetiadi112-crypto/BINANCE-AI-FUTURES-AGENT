/**
 * PHASE 3.8-D.7-LIVE-PROBE-2 — read-only diagnostic. No trading, no key output.
 * Uses the app's real getAvailableProviders() + runChatProviders() path.
 */
import { getAvailableProviders } from "../src/backend/ai/llm/providers";
import { runChatProviders } from "../src/backend/api/chat-agent-providers";
import { runLLMProbe } from "../src/backend/diagnostics/llm-probe";

const NAMES = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
] as const;

const env = Object.fromEntries(
  NAMES.map((k) => [k, (process.env[k] ?? "").length > 0 ? "SET" : "NOT_SET"]),
);

const providers = getAvailableProviders();

const prompt = JSON.stringify({
  system:
    "You are a diagnostic endpoint of an AI trading system. This request is NOT a trading request. " +
    "Respond ONLY with a JSON object with keys: direction (\"NO_TRADE\"), action (\"WAIT\"), " +
    "confidence (number 0-1), strategy (\"DIAGNOSTIC\"), reasoning (short text).",
  user: 'Reply with exactly: LIVE_OK — then return JSON: {"direction":"NO_TRADE","action":"WAIT","confidence":0.0,"strategy":"DIAGNOSTIC","reasoning":"LIVE_OK"}',
});

const chatOutcome = await runChatProviders(prompt);
const probe = await runLLMProbe();

// Non-secret HTTP reachability check per provider using the app's own provider config + env key (never printed).
const { providers: allCfg } = await import("../src/backend/ai/llm/providers/index.ts");
const httpStatus: Record<string, string> = {};
for (const p of getAvailableProviders()) {
  try {
    const key = process.env[p.config.apiKeyEnvVar] ?? "";
    const isGemini = p.config.apiKeyEnvVar === "GEMINI_API_KEY";
    const url = isGemini
      ? `${p.config.baseUrl}/models`
      : `${p.config.baseUrl}/models`;
    const res = await fetch(url, {
      headers: isGemini
        ? { "x-goog-api-key": key }
        : { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    const bodyText = await res.text().catch(() => "");
    // Never print the key; only coarse, non-sensitive error snippets.
    const snippet = !res.ok ? bodyText.replace(/[A-Za-z0-9_\-]{20,}/g, "[REDACTED]").slice(0, 160) : "";
    httpStatus[p.name] = `HTTP ${res.status}${snippet ? " — " + snippet : ""}`;
  } catch (e) {
    httpStatus[p.name] = `NETWORK_ERROR: ${(e as Error).name}`;
  }
}

// Direct generateContent against each provider's configured model — same path as provider.generateDecision.
const chatStatus: Record<string, string> = {};
for (const p of getAvailableProviders()) {
  try {
    const key = process.env[p.config.apiKeyEnvVar] ?? "";
    const isGemini = p.config.apiKeyEnvVar === "GEMINI_API_KEY";
    const url = isGemini
      ? `${p.config.baseUrl}/models/${p.config.model}:generateContent`
      : `${p.config.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let body: string;
    if (isGemini) {
      headers["x-goog-api-key"] = key;
      body = JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: LIVE_OK' }] }],
        generationConfig: { maxOutputTokens: 32 },
      });
    } else {
      headers["Authorization"] = `Bearer ${key}`;
      body = JSON.stringify({
        model: p.config.model,
        messages: [{ role: "user", content: "Reply with exactly: LIVE_OK" }],
        max_tokens: 32,
      });
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(20000),
    });
    const bodyText = await res.text().catch(() => "");
    const snippet = !res.ok ? bodyText.replace(/[A-Za-z0-9_\-]{20,}/g, "[REDACTED]").slice(0, 200) : "";
    chatStatus[p.name] = `HTTP ${res.status}${snippet ? " — " + snippet : ""}`;
  } catch (e) {
    chatStatus[p.name] = `NETWORK_ERROR: ${(e as Error).name}`;
  }
}

console.log(
  JSON.stringify(
    {
      chatStatus,
      httpStatus,
      env,
      availableProviders: providers.map((p) => p.name),
      chat: chatOutcome
        ? {
            provider: chatOutcome.provider,
            modelVersion: chatOutcome.modelVersion,
            reply: chatOutcome.reply.slice(0, 300),
            latencyMs: chatOutcome.latencyMs,
            fallbackIndex: chatOutcome.fallbackIndex,
            isSafeFallback: false,
          }
        : { isSafeFallback: true },
      probe: {
        chain: probe.chain,
        attempts: probe.attempts,
        success: probe.success,
        provider: probe.provider,
        modelVersion: probe.modelVersion,
        latencyMs: probe.latencyMs,
        errorCategory: probe.errorCategory,
        tradingEnabled: probe.tradingEnabled,
      },
    },
    null,
    2,
  ),
);
