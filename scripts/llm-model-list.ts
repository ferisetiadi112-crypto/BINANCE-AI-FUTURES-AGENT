/**
 * Read-only diagnostic: list live models available to each configured key.
 * Never prints key values. Output: provider → candidate model IDs.
 */
import { getAvailableProviders } from "../src/backend/ai/llm/providers";

const providers = getAvailableProviders();

for (const p of providers) {
  const key = process.env[p.config.apiKeyEnvVar] ?? "";
  const isGemini = p.config.apiKeyEnvVar === "GEMINI_API_KEY";
  const url = `${p.config.baseUrl}/models${isGemini ? "?pageSize=1000" : ""}`;
  try {
    const res = await fetch(url, {
      headers: isGemini
        ? { "x-goog-api-key": key }
        : { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`\n## ${p.name}: HTTP ${res.status}`);
      console.log(text.replace(/[A-Za-z0-9_\-]{25,}/g, "[REDACTED]").slice(0, 300));
      continue;
    }
    const data = JSON.parse(text) as {
      models?: Array<{ name?: string; id?: string; supported_generation_methods?: string[]; supported_generation_methods?: unknown[] }>;
      data?: Array<{ id?: string }>;
    };
    let ids: string[] = [];
    if (data.models) {
      ids = data.models
        .filter((m) => {
          const methods = (m as { supported_generation_methods?: string[] }).supported_generation_methods;
          return !methods || methods.includes("generateContent");
        })
        .map((m) => (m.name ?? "").replace(/^models\//, "") || (m.id ?? ""))
        .filter(Boolean);
    } else if (data.data) {
      ids = data.data.map((m) => m.id ?? "").filter(Boolean);
    }
    console.log(`\n## ${p.name} (HTTP ${res.status}) — ${ids.length} models`);
    console.log(ids.slice(0, 60).join("\n"));
  } catch (e) {
    console.log(`\n## ${p.name}: NETWORK_ERROR ${(e as Error).name}`);
  }
}
