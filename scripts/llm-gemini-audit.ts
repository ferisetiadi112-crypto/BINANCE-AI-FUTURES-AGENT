/**
 * Read-only Gemini audit: distinguishes account-level quota (429 on /models),
 * per-model availability, and actual generateContent success. No key printed.
 */
const key = process.env["GEMINI_API_KEY"] ?? "";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const model = process.argv[2] ?? "gemini-3.6-flash";

// 1. Account-level: list models (429 here = account quota exhausted)
const listRes = await fetch(`${BASE}/models?pageSize=5`, {
  headers: { "x-goog-api-key": key },
  signal: AbortSignal.timeout(10000),
});
console.log(`[1] account /models: HTTP ${listRes.status}`);

if (listRes.ok) {
  // 2. Model-specific generateContent
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with exactly: LIVE_OK' }] }],
      generationConfig: { maxOutputTokens: 64 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text().catch(() => "");
  const redacted = body.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 400);
  console.log(`[2] ${model}:generateContent → HTTP ${res.status}`);
  if (!res.ok) console.log(`    error: ${redacted}`);
  else console.log(`    ok: ${redacted}`);
} else {
  const body = await listRes.text().catch(() => "");
  console.log(`    error: ${body.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 300)}`);
}
