/**
 * PHASE 3.5-L — Live WebSocket test (READ-ONLY).
 *
 * Connects to wss://fstream.binancefuture.com via the project's existing
 * BinanceStream transport, subscribes to BTCUSDT@ticker, waits for real
 * messages, validates them, then closes cleanly. No trading capability —
 * public market stream only.
 *
 * Run: bun scripts/ws-live-test.mjs
 */
import { BinanceStream } from "../src/backend/exchange/binance-stream";

const WS_URL = "wss://fstream.binancefuture.com"; // TESTNET only
const SYMBOL = "BTCUSDT";
const TIMEOUT_MS = 30_000;

const stream = new BinanceStream({ symbols: [SYMBOL], intervals: [] });

let messages = 0;
let last: { event: string; symbol: string; price: number; eventTime: number } | null = null;
const statuses: string[] = [];

const result: Record<string, unknown> = { url: WS_URL, symbol: SYMBOL, pass: false, error: null, messages: 0, sample: null, statuses };

stream.on("statusChange", ({ to }: { to: string }) => statuses.push(to));
stream.on("ticker", (msg: { e: string; s: string; c: string; E: number }) => {
  messages++;
  if (msg.e === "24hrTicker" && msg.s === SYMBOL && Number(msg.c) > 0) {
    last = { event: msg.e, symbol: msg.s, price: Number(msg.c), eventTime: msg.E };
  }
});
stream.on("error", (e: unknown) => { result.error = String(e); });

stream.connect();

await new Promise((resolve) => {
  const started = Date.now();
  const iv = setInterval(() => {
    if (messages >= 3 || Date.now() - started > TIMEOUT_MS) { clearInterval(iv); resolve(null); }
  }, 250);
});

stream.disconnect();

result.messages = messages;
result.sample = last;
result.statuses = statuses;
result.pass = messages > 0 && last !== null && statuses.includes("ONLINE");

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
