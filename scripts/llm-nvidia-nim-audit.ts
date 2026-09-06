/**
 * Read-only NVIDIA NIM audit: check key, list models, test candidates.
 * No key/secret printed; snippets redacted.
 */
const key = process.env["NVIDIA_NIM_API_KEY"] ?? "";
if (!key) {
  console.log("NVIDIA_NIM_API_KEY: NOT_SET in runtime env");
  process.exit(0);
}
console.log("NVIDIA_NIM_API_KEY: SET (length > 0)");

// NVIDIA NIM uses an OpenAI-compatible API at integrate.api.nvidia.com/v1
const BASE = "https://integrate.api.nvidia.com/v1";

const listRes = await fetch(`${BASE}/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(15000),
});
console.log(`\n[1] /models: HTTP ${listRes.status}`);
if (!listRes.ok) {
  const t = await listRes.text().catch(() => "");
  console.log(`    ${t.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 300)}`);
  process.exit(1);
}
const data = (await listRes.json()) as { data?: Array<{ id?: string }> };
const ids = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
console.log(`    models (${ids.length})`);
console.log(ids.join("\n"));

// Test a few chat candidates relevant for JSON generation
const preferred = ids.filter((id) => /nemotron|llama-3\.1-8b|llama-3\.3|mistral-small|qwen/i.test(id));
const candidates = (process.argv.slice(2).length ? process.argv.slice(2) : preferred).slice(0, 6);

for (const model of candidates) {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            'Respond ONLY with a JSON object: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"<short text>"}. ' +
            "strategy MUST be one of: TREND_FOLLOWING, MOMENTUM, BREAKOUT, PULLBACK, MEAN_REVERSION.",
        },
        { role: "user", content: 'Reply with exactly: LIVE_OK — then return JSON only: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"LIVE_OK"}' },
      ],
      max_tokens: 128,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text().catch(() => "");
  const snippet = !res.ok ? body.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 200) : "";
  console.log(`\n[${model}] HTTP ${res.status} (${Date.now() - started}ms)${snippet ? "\n  " + snippet : ""}`);
  if (res.ok) {
    try {
      const j = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
      console.log(`  content: ${j.choices?.[0]?.message?.content?.slice(0, 150)}`);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}
