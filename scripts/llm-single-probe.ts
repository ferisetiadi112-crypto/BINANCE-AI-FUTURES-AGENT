/**
 * Read-only diagnostic: probe a single provider's generateDecision with a
 * schema-valid prompt (strategy enum from AIDecisionSchema).
 * Usage: bun scripts/llm-single-probe.ts <providerName>
 */
import { getProviderByName } from "../src/backend/ai/llm/providers";

const name = process.argv[2] ?? "";
const provider = getProviderByName(name as never);
if (!provider) {
  console.log(JSON.stringify({ provider: name, available: false }));
  process.exit(1);
}

const prompt = JSON.stringify({
  system:
    "You are a diagnostic endpoint of an AI trading system. This request is NOT a trading request. " +
    'Respond ONLY with a JSON object: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"<short text>"}. ' +
    "strategy MUST be one of: TREND_FOLLOWING, MOMENTUM, BREAKOUT, PULLBACK, MEAN_REVERSION.",
  user:
    'Reply with exactly: LIVE_OK — then return JSON only: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"LIVE_OK"}',
});

const started = Date.now();
try {
  const decision = await provider.generateDecision(prompt);
  console.log(
    JSON.stringify({
      provider: provider.name,
      model: provider.config.model,
      latencyMs: Date.now() - started,
      success: true,
      decision,
    }),
  );
} catch (err) {
  const e = err as { code?: string; message?: string };
  const msg = (e.message ?? String(err)).replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 300);
  console.log(
    JSON.stringify({
      provider: provider.name,
      model: provider.config.model,
      latencyMs: Date.now() - started,
      success: false,
      code: e.code ?? "PROVIDER_ERROR",
      message: msg,
    }),
  );
}
