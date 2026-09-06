/**
 * Read-only OpenRouter raw probe: shows actual model content for the JSON
 * diagnostic prompt, mimicking the app's request shape. No key printed.
 */
const key = process.env["OPENROUTER_API_KEY"] ?? "";
const model = process.argv[2] ?? "minimax/minimax-m3:free";

const body = {
  model,
  messages: [
    {
      role: "system",
      content:
        "You are a diagnostic endpoint of an AI trading system. This request is NOT a trading request. " +
        'Respond ONLY with a JSON object: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"<short text>"}. ' +
        "strategy MUST be one of: TREND_FOLLOWING, MOMENTUM, BREAKOUT, PULLBACK, MEAN_REVERSION.",
    },
    {
      role: "user",
      content:
        'Reply with exactly: LIVE_OK — then return JSON only: {"direction":"NO_TRADE","confidence":0.0,"strategy":"TREND_FOLLOWING","reasoning":"LIVE_OK"}',
    },
  ],
  temperature: 0.3,
  max_tokens: 512,
  response_format: { type: "json_object" },
};

for (let i = 1; i <= 3; i++) {
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    console.log(`run ${i}: HTTP ${res.status} (${Date.now() - started}ms) ${text.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 200)}`);
  } else {
    const j = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    console.log(`run ${i}: HTTP ${res.status} (${Date.now() - started}ms) content=${JSON.stringify(j.choices?.[0]?.message?.content?.slice(0, 200))}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
