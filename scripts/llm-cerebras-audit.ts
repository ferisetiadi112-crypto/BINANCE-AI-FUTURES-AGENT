/**
 * Read-only Cerebras audit: diagnose 402 root cause and list available models.
 * No key printed.
 */
const key = process.env["CEREBRAS_API_KEY"] ?? "";
const BASE = "https://api.cerebras.ai/v1";

// 1. List models
const listRes = await fetch(`${BASE}/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(10000),
});
console.log(`[1] /models: HTTP ${listRes.status}`);
if (listRes.ok) {
  const data = (await listRes.json()) as { data?: Array<{ id?: string }> };
  console.log(`    models: ${(data.data ?? []).map((m) => m.id).join(", ")}`);
} else {
  const t = await listRes.text().catch(() => "");
  console.log(`    ${t.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 300)}`);
}

// 2. Test each model with a minimal completion to see which are quota-accessible
const models = ["gpt-oss-120b", "qwen-3.8-27b", "gemma-4-31b"];
for (const model of models) {
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
  await new Promise((r) => setTimeout(r, 1500));
}
