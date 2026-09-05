/**
 * Phase 3.8-B.3 — LLM Provider Probe (READ-ONLY, diagnostic)
 *
 * Proves which LLM providers the current runtime can actually reach,
 * using the EXISTING provider abstraction (getAvailableProviders() →
 * provider.generateDecision()). No second HTTP implementation, no new
 * provider, no direct API key access, no secrets in output.
 *
 * The probe prompt is a trivial, non-trading diagnostic request that the
 * existing AIDecisionSchema can validate — it never requests market or
 * trading content and its output never reaches the executor, risk engine,
 * journal, or any trading path.
 *
 * HARD SAFETY:
 * - GET-style diagnostic only; no mutation anywhere.
 * - Credentials are only used internally by the existing providers via env.
 * - Output contains safe metadata only: provider, modelVersion, latencyMs,
 *   fallbackIndex, errorCategory. Never key values, headers, or raw payloads.
 */

import { getAvailableProviders } from "../ai/llm/providers";
import { logger } from "../logger";

export type LLMProbeAttempt = {
  provider: string;
  fallbackIndex: number;
  success: boolean;
  modelVersion: string | null;
  latencyMs: number | null;
  errorCategory: string | null;
};

export type LLMProbeResult = {
  timestamp: string;
  runtime: "node";
  tradingEnabled: false;
  chain: string[];
  providersConfigured: number;
  attempts: LLMProbeAttempt[];
  success: boolean;
  provider: string | null;
  modelVersion: string | null;
  latencyMs: number | null;
  errorCategory: string | null;
};

/** Map an unknown provider error to a coarse, non-sensitive category. */
function categorize(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (typeof code === "string" && code.length > 0) return code;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "TIMEOUT";
    return "PROVIDER_ERROR";
  }
  return "UNKNOWN_ERROR";
}

/**
 * A minimal, non-trading diagnostic prompt shaped exactly like what the
 * existing providers expect ({ system, user }), asking only for a schema
 * conforming diagnostic acknowledgement. Confidence is the schema's numeric
 * field — the schema requires direction/action/strategy, so we answer with
 * NO_TRADE/WAIT semantics purely to satisfy validation, never to trade.
 */
const PROBE_PROMPT = JSON.stringify({
  system:
    "You are a diagnostic endpoint of an AI trading system. This request is NOT a trading request. " +
    "Respond ONLY with a JSON object with keys: direction (\"NO_TRADE\"), action (\"WAIT\"), " +
    "confidence (number 0-1), strategy (\"DIAGNOSTIC\"), reasoning (short text). " +
    'Example: {"direction":"NO_TRADE","action":"WAIT","confidence":0.0,"strategy":"DIAGNOSTIC","reasoning":"provider reachable"}',
  user:
    'Respond with a short diagnostic confirmation that the AI provider is reachable. ' +
    'Return JSON containing only: {"direction":"NO_TRADE","action":"WAIT","confidence":0.0,"strategy":"DIAGNOSTIC","reasoning":"ok"}',
});

export async function runLLMProbe(): Promise<LLMProbeResult> {
  const providers = getAvailableProviders();
  const attempts: LLMProbeAttempt[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const started = Date.now();
    try {
      const decision = await provider.generateDecision(PROBE_PROMPT);
      attempts.push({
        provider: provider.name,
        fallbackIndex: i,
        success: true,
        // Honest provenance: only the real provider's own name.
        modelVersion: `llm-${provider.name}`,
        latencyMs: Date.now() - started,
        errorCategory: null,
      });
      // First success ends the probe (mirrors router behavior). Decision is
      // discarded — this is a diagnostic, not a trading decision.
      logger.info("llm-probe", `Provider ${provider.name} reachable (fallbackIndex=${i})`);
      return buildResult(providers, attempts, true, provider.name, `llm-${provider.name}`, attempts[i]!.latencyMs, null);
    } catch (err) {
      const category = categorize(err);
      attempts.push({
        provider: provider.name,
        fallbackIndex: i,
        success: false,
        modelVersion: null,
        latencyMs: Date.now() - started,
        errorCategory: category,
      });
      logger.warn("llm-probe", `Provider ${provider.name} failed (fallbackIndex=${i}) category=${category}`);
    }
  }

  const none = providers.length === 0;
  return buildResult(
    providers,
    attempts,
    false,
    none ? null : "safe_fallback",
    none ? null : "safe_fallback",
    null,
    none ? "NO_PROVIDERS_CONFIGURED" : "ALL_PROVIDERS_FAILED",
  );
}

function buildResult(
  providers: ReturnType<typeof getAvailableProviders>,
  attempts: LLMProbeAttempt[],
  success: boolean,
  provider: string | null,
  modelVersion: string | null,
  latencyMs: number | null,
  errorCategory: string | null,
): LLMProbeResult {
  return {
    timestamp: new Date().toISOString(),
    runtime: "node",
    tradingEnabled: false, // probe never reads or changes TRADING_ENABLED
    chain: providers.map((p) => p.name),
    providersConfigured: providers.length,
    attempts,
    success,
    provider,
    modelVersion,
    latencyMs,
    errorCategory,
  };
}
