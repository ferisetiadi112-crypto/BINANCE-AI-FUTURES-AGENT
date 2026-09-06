/**
 * Read-only OpenRouter audit: list free models with actual availability
 * (endpoint count, context length), then test chat/completions on candidates.
 * No key printed.
 */
const key = process.env["OPENROUTER_API_KEY"] ?? "";
const BASE = "https://openrouter.ai/api/v1";

interface ModelInfo {
  id: string;
  context_length?: number;
  architecture?: { modality?: string };
  pricing?: { prompt?: string; completion?: string };
}

const res = await fetch(`${BASE}/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(15000),
});
if (!res.ok) {
  console.log(`models list: HTTP ${res.status}`);
  process.exit(1);
}
const data = (await res.json()) as { data: ModelInfo[] };

const free = data.data
  .filter((m) => m.id.endsWith(":free") && (m.architecture?.modality ?? "").includes("text"))
  .map((m) => ({
    id: m.id,
    context: m.context_length ?? 0,
    promptPrice: m.pricing?.prompt ?? "?",
  }));

console.log(`free text models: ${free.length}`);
for (const m of free) console.log(`  ${m.id}  ctx=${m.context}`);

// Test chat/completions for given candidates (arg) or top few
const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : free.slice(0, 5).map((m) => m.id);

for (const model of candidates) {
  const started = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: LIVE_OK" }],
      max_tokens: 32,
    }),
    signal: AbortSignal.timeout(25000),
  });
  const body = await r.text().catch(() => "");
  const snippet = !r.ok
    ? body.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 150)
    : "";
  console.log(`\n[${model}] HTTP ${r.status} (${Date.now() - started}ms)${snippet ? "\n  " + snippet : ""}`);
  if (r.ok) {
    try {
      const j = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
      console.log(`  content: ${j.choices?.[0]?.message?.content?.slice(0, 80)}`);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
}
