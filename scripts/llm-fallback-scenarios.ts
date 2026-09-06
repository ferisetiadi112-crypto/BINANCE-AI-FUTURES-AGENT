/**
 * Read-only fallback chain scenario test. Walks the real chain in order and
 * records which provider succeeds at each fallback index. Also simulates
 * head-provider failure scenarios (non-destructive, runtime-only).
 */
import { getAvailableProviders } from "../src/backend/ai/llm/providers";
import type { AIProvider } from "../ai/llm/types";

const SYSTEM =
  'Respond ONLY with a JSON object: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"<short text>"}. ' +
  "strategy MUST be one of: TREND_FOLLOWING, MOMENTUM, BREAKOUT, PULLBACK, MEAN_REVERSION.";
const USER = 'Reply with exactly: LIVE_OK — then return JSON only: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"LIVE_OK"}';

const prompt = JSON.stringify({ system: SYSTEM, user: USER });

async function tryChain(providers: AIProvider[], label: string) {
  const attempts: Array<{ fallbackIndex: number; provider: string; result: string; latencyMs?: number }> = [];
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const started = Date.now();
    try {
      await p.generateDecision(prompt);
      attempts.push({ fallbackIndex: i, provider: p.name, result: "SUCCESS", latencyMs: Date.now() - started });
      break;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const raw = String(e.message ?? err);
      let cat = "OTHER";
      if (raw.includes("Rate limited")) cat = "RATE_LIMITED";
      else if (/HTTP 4\d\d/.test(raw)) cat = "HTTP_CLIENT_ERROR";
      else if (/HTTP 5\d\d/.test(raw)) cat = "HTTP_SERVER_ERROR";
      else if (raw.includes("timed out")) cat = "TIMEOUT";
      else if (raw.includes("invalid JSON")) cat = "INVALID_JSON";
      else if (raw.includes("validation")) cat = "VALIDATION_ERROR";
      attempts.push({ fallbackIndex: i, provider: p.name, result: `FAIL(${cat})`, latencyMs: Date.now() - started });
    }
  }
  const last = attempts[attempts.length - 1]!;
  const success = last.result === "SUCCESS";
  console.log(`\n## ${label}`);
  for (const a of attempts) console.log(`  [${a.fallbackIndex}] ${a.provider}: ${a.result} (${a.latencyMs}ms)`);
  console.log(`  final provenance: ${success ? `llm-${last.provider}` : "safe_fallback"}`);
  return { attempts, success, provenance: success ? `llm-${last.provider}` : "safe_fallback" };
}

const all = getAvailableProviders();
console.log(`chain: ${all.map((p) => p.name).join(" → ")} → SAFE_FALLBACK`);

// Scenario A-E: progressively disable head providers (runtime-only, non-destructive)
for (let skip = 0; skip <= all.length; skip++) {
  const subset = all.slice(skip);
  await tryChain(subset.length ? subset : [], skip === 0 ? "A: full chain" : `Scenario: first ${skip} provider(s) forced-failed (runtime-only simulation)`);
}
