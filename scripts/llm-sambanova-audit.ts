/**
 * Read-only SambaNova audit: check key, list models, test candidates.
 * No key printed.
 */
const key = process.env["SAMBANOVA_API_KEY"] ?? "";
if (!key) {
  console.log("SAMBANOVA_API_KEY: NOT_SET in runtime env");
  console.log("ACTION REQUIRED: add SAMBANOVA_API_KEY via Freebuff Settings → Environment");
  process.exit(0);
}
console.log("SAMBANOVA_API_KEY: SET (length > 0)");

const BASE = "https://api.sambanova.ai/v1";

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
console.log(`    models (${ids.length}): ${ids.join(", ")}`);

// Test candidates: prefer small/fast free-tier-looking models
const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      ...ids.filter((id) => /fast|mini|small|8b|nano/i.test(id)),
      ...ids.filter((id) => !/fast|mini|small|8b|nano/i.test(id)),
    ].slice(0, 5);

for (const model of candidates) {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: LIVE_OK" }],
      max_tokens: 32,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text().catch(() => "");
  const snippet = !res.ok ? body.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 200) : "";
  console.log(`\n[${model}] HTTP ${res.status} (${Date.now() - started}ms)${snippet ? "\n  " + snippet : ""}`);
  if (res.ok) {
    try {
      const j = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
      console.log(`  content: ${j.choices?.[0]?.message?.content?.slice(0, 80)}`);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
}
