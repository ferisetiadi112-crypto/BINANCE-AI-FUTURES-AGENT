/**
 * Read-only diagnostic: reports SET/NOT_SET status of key env vars.
 * Never prints values. Used by Phase 3.8-E.1 runtime boot audit.
 */
const names = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "MISTRAL_API_KEY",
  "DATABASE_URL",
  "TRADING_ENABLED",
];
for (const n of names) console.log(`${n}=${process.env[n] ? "SET" : "NOT_SET"}`);
