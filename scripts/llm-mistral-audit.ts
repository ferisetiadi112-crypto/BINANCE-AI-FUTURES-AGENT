/**
 * Read-only Mistral audit: list live models and test candidates for quota.
 * No key printed.
 */
const key = process.env["MISTRAL_API_KEY"] ?? "";
const BASE = "https://api.mistral.ai/v1";

const listRes = await fetch(`${BASE}/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(10000),
});
console.log(`[1] /models: HTTP ${listRes.status}`);
let textModelIds: string[] = [];
if (listRes.ok) {
  const data = (await listRes.json()) as { data?: Array<{ id?: string; capabilities?: { completion_chat?: boolean } }> };
  const models = data.data ?? [];
  textModelIds = models
    .filter((m) => m.capabilities?.completion_chat)
    .map((m) => m.id ?? "")
    .filter(Boolean);
  console.log(`    chat-capable models: ${textModelIds.length}`);
  console.log(`    ${textModelIds.join(", ")}`);
} else {
  const t = await listRes.text().catch(() => "");
  console.log(`    ${t.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 300)}`);
  process.exit(1);
}

// Test a few candidates (small/cheap chat models) for quota accessibility
const candidates = ["mistral-small-latest", "ministral-8b-latest", "ministral-3b-latest"];
for (const model of candidates) {
  if (!textModelIds.includes(model)) {
    console.log(`\n[${model}] NOT in live model list — skip`);
    continue;
  }
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: LIVE_OK" }],
      max_tokens: 32,
    }),
    signal: AbortSignal.timeout(20000),
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
  await new Promise((r) => setTimeout(r, 2000));
}
