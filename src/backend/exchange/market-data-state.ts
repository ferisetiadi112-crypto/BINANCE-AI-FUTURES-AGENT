/**
 * Market Data State — P7D-5.3
 *
 * Single source of truth for realtime Binance Futures Testnet market data.
 * Provides cached, WebSocket-updated market ticks for AI analysis.
 *
 * Architecture:
 *   Binance Market WebSocket (ticker stream) ──┐
 *   REST polling (fallback)                    ──┤──→ MarketDataState ──→ AI Market Context
 *   Initial REST snapshot                      ──┘
 *
 * SAFETY:
 * - This module is READ-ONLY — it never places orders
 * - Only market price/ticker data from Binance Futures Testnet
 * - WebSocket is primary; REST is fallback only
 * - No mainnet fallback — TESTNET ONLY
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

export type MarketConnectionStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DEGRADED"
  | "DISCONNECTED"
  | "ERROR"
  | "OFFLINE";

export type MarketDataFreshness = "FRESH" | "STALE" | "UNAVAILABLE";

/** Per-symbol realtime market tick data */
export type SymbolMarketTick = {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  quoteVolume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  trades24h: number;
  updatedAt: number; // epoch ms
};

/** Bounded kline/candle data for a symbol */
export type KlineData = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
};

/** Complete market data snapshot — single read method for all consumers */
export type MarketDataSnapshot = {
  connectionStatus: MarketConnectionStatus;
  lastUpdateAt: number;
  dataFreshness: MarketDataFreshness;
  errorCount: number;
  subscribedSymbols: string[];
  symbols: Record<string, SymbolMarketTick>;
  klines: Record<string, KlineData[]>;
};

// ─── Constants ──────────────────────────────────────────────────────

const TESTNET_WS_URL = "wss://fstream.binancefuture.com";
const TESTNET_REST_URL = "https://testnet.binancefuture.com";

const STALE_THRESHOLD_MS = 30_000; // 30 seconds
const REST_POLL_INTERVAL_MS = 15_000; // 15 seconds — fallback only
const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;
const MAX_KLINE_HISTORY = 500; // bounded kline memory per symbol
const KLINE_INTERVAL = "15m";
const KLINE_LIMIT = 100;

// ─── Singleton State ────────────────────────────────────────────────

let _connectionStatus: MarketConnectionStatus = "OFFLINE";
let _lastUpdateAt = 0;
let _errorCount = 0;
let _subscribedSymbols: string[] = [];
let _ticks: Record<string, SymbolMarketTick> = {};
let _klines: Record<string, KlineData[]> = {};

let _ws: WebSocket | null = null;
let _wsReconnectAttempts = 0;
let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _restPollTimer: ReturnType<typeof setInterval> | null = null;
let _intentionalClose = false;
let _initialized = false;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get the current market data snapshot.
 * Primary read method — consistent snapshot at a single point in time.
 */
export function getMarketSnapshot(): MarketDataSnapshot {
  const now = Date.now();
  let dataFreshness: MarketDataFreshness = "UNAVAILABLE";

  if (_lastUpdateAt > 0) {
    const age = now - _lastUpdateAt;
    if (age < STALE_THRESHOLD_MS) {
      dataFreshness = "FRESH";
    } else if (age < STALE_THRESHOLD_MS * 4) {
      dataFreshness = "STALE";
    }
    // else UNAVAILABLE (too old)
  }

  return {
    connectionStatus: _connectionStatus,
    lastUpdateAt: _lastUpdateAt,
    dataFreshness,
    errorCount: _errorCount,
    subscribedSymbols: [..._subscribedSymbols],
    symbols: { ..._ticks },
    klines: { ..._klines },
  };
}

/**
 * Initialize market data state.
 * Call once on server startup.
 */
export async function initializeMarketDataState(symbols?: string[]): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  // Determine symbols to subscribe
  if (symbols && symbols.length > 0) {
    _subscribedSymbols = symbols;
  } else {
    // Use default configured symbols
    try {
      const { getEnabledSymbolsSync } = await import("../market/symbols");
      _subscribedSymbols = getEnabledSymbolsSync().map((s) => s.symbol);
    } catch {
      _subscribedSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
    }
  }

  logger.info(
    "market-data-state",
    `Initializing: ${_subscribedSymbols.length} symbols [${_subscribedSymbols.join(", ")}]`,
  );

  // Initial REST snapshot
  _connectionStatus = "CONNECTING";
  await performRestSnapshot();

  // Connect WebSocket market stream
  connectMarketStream();

  // Start REST polling as fallback
  startRestPoll();

  logger.info(
    "market-data-state",
    `Initialized: status=${_connectionStatus}, symbols=${Object.keys(_ticks).length}`,
  );
}

/**
 * Shut down the market data state.
 */
export function shutdownMarketDataState(): void {
  _intentionalClose = true;

  if (_ws) {
    _ws.close(1000, "Shutdown");
    _ws = null;
  }
  if (_wsReconnectTimer) {
    clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = null;
  }
  if (_restPollTimer) {
    clearInterval(_restPollTimer);
    _restPollTimer = null;
  }

  _connectionStatus = "OFFLINE";
  _initialized = false;
}

// ─── REST Snapshot ──────────────────────────────────────────────────

async function performRestSnapshot(): Promise<void> {
  try {
    const { getTestnetClient } = await import("./binance-testnet");
    const client = getTestnetClient();

    if (!client) {
      _errorCount++;
      if (_connectionStatus === "OFFLINE") {
        _connectionStatus = "ERROR";
      }
      return;
    }

    // Fetch 24h ticker for all subscribed symbols
    const tickers = await client.get24hTicker();

    for (const ticker of tickers) {
      if (!_subscribedSymbols.includes(ticker.symbol)) continue;

      const lastPrice = ticker.lastPrice;
      // Estimate bid/ask from last price (Binance 24hr ticker doesn't provide bid/ask directly)
      // For a more accurate bid/ask, we'd need /fapi/v1/ticker/bookTicker
      const bid = lastPrice * 0.9999; // conservative estimate
      const ask = lastPrice * 1.0001;
      const spread = ask - bid;

      _ticks[ticker.symbol] = {
        symbol: ticker.symbol,
        lastPrice,
        bid,
        ask,
        spread,
        volume24h: ticker.volume,
        quoteVolume24h: ticker.quoteVolume,
        priceChange24h: ticker.priceChange,
        priceChangePercent24h: ticker.priceChangePercent,
        high24h: ticker.highPrice,
        low24h: ticker.lowPrice,
        trades24h: 0, // ticker doesn't provide trade count in this format
        updatedAt: Date.now(),
      };
    }

    _lastUpdateAt = Date.now();
    _errorCount = 0;

    if (
      _connectionStatus !== "CONNECTED" &&
      _connectionStatus !== "RECONNECTING"
    ) {
      _connectionStatus = "CONNECTED";
    }

    logger.debug(
      "market-data-state",
      `REST snapshot: ${Object.keys(_ticks).length} symbols updated`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _errorCount++;

    if (_connectionStatus === "CONNECTED") {
      _connectionStatus = "DEGRADED";
      logger.warn("market-data-state", `REST snapshot failed (was connected): ${msg}`);
    } else if (_connectionStatus === "OFFLINE" || _connectionStatus === "ERROR") {
      _connectionStatus = "ERROR";
      logger.error("market-data-state", `REST snapshot failed: ${msg}`);
    }
  }
}

// ─── WebSocket Market Stream ────────────────────────────────────────

function connectMarketStream(): void {
  if (_intentionalClose) return;

  _connectionStatus = "CONNECTING";

  // Build stream names: <symbol>@ticker for each symbol
  const streams = _subscribedSymbols.map((s) => `${s.toLowerCase()}@ticker`);
  const url = `${TESTNET_WS_URL}/stream?streams=${streams.join("/")}`;

  logger.info("market-data-state", `WebSocket connecting to ${streams.length} streams`);

  try {
    _ws = new WebSocket(url);

    _ws.onopen = () => {
      logger.info("market-data-state", "WebSocket connected");
      _connectionStatus = "CONNECTED";
      _wsReconnectAttempts = 0;
    };

    _ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.data) {
          handleTickerMessage(data.data);
        }
      } catch {
        // ignore parse errors
      }
    };

    _ws.onerror = () => {
      _errorCount++;
    };

    _ws.onclose = (event) => {
      logger.info(
        "market-data-state",
        `WebSocket closed: code=${event.code} reason=${event.reason}`,
      );

      if (!_intentionalClose) {
        _connectionStatus = "RECONNECTING";
        scheduleWsReconnect();
      } else {
        _connectionStatus = "OFFLINE";
      }
    };
  } catch (error) {
    logger.error("market-data-state", `WebSocket connection failed: ${error}`);
    _connectionStatus = "ERROR";
    scheduleWsReconnect();
  }
}

function handleTickerMessage(data: {
  e?: string;
  s?: string;
  c?: string;
  b?: string;
  a?: string;
  v?: string;
  q?: string;
  p?: string;
  P?: string;
  h?: string;
  l?: string;
  n?: number;
}): void {
  const symbol = data.s;
  if (!symbol || !_subscribedSymbols.includes(symbol)) return;

  const lastPrice = parseFloat(data.c || "0");
  const bid = parseFloat(data.b || "0");
  const ask = parseFloat(data.a || "0");

  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;

  const spread = ask > 0 && bid > 0 ? ask - bid : 0;

  _ticks[symbol] = {
    symbol,
    lastPrice,
    bid: bid > 0 ? bid : lastPrice * 0.9999,
    ask: ask > 0 ? ask : lastPrice * 1.0001,
    spread,
    volume24h: parseFloat(data.v || "0"),
    quoteVolume24h: parseFloat(data.q || "0"),
    priceChange24h: parseFloat(data.p || "0"),
    priceChangePercent24h: parseFloat(data.P || "0"),
    high24h: parseFloat(data.h || "0"),
    low24h: parseFloat(data.l || "0"),
    trades24h: data.n || 0,
    updatedAt: Date.now(),
  };

  _lastUpdateAt = Date.now();
}

// ─── Reconnect ──────────────────────────────────────────────────────

function scheduleWsReconnect(): void {
  _wsReconnectAttempts++;
  const delay = Math.min(
    WS_RECONNECT_BASE_MS * Math.pow(2, _wsReconnectAttempts - 1),
    WS_RECONNECT_MAX_MS,
  );

  logger.info(
    "market-data-state",
    `Reconnecting in ${delay}ms (attempt ${_wsReconnectAttempts})`,
  );

  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null;
    connectMarketStream();
  }, delay);
}

// ─── REST Polling (Fallback) ────────────────────────────────────────

function startRestPoll(): void {
  if (_restPollTimer) return;

  _restPollTimer = setInterval(async () => {
    if (_intentionalClose) return;

    // Only poll REST if WebSocket is not connected
    // When WebSocket is healthy, REST is not the primary source
    if (_connectionStatus === "CONNECTED") return;

    await performRestSnapshot();
  }, REST_POLL_INTERVAL_MS);
}

// ─── Kline Management ──────────────────────────────────────────────

/**
 * Store kline data for a symbol (bounded memory).
 * Can be called from kline REST snapshots.
 */
export function storeKlines(symbol: string, klines: KlineData[]): void {
  if (!klines || klines.length === 0) return;

  const existing = _klines[symbol] || [];
  const merged = [...existing, ...klines];

  // Deduplicate by openTime, keep latest
  const seen = new Map<number, KlineData>();
  for (const k of merged) {
    seen.set(k.openTime, k);
  }

  // Sort by openTime and cap at MAX_KLINE_HISTORY
  const sorted = Array.from(seen.values())
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-MAX_KLINE_HISTORY);

  _klines[symbol] = sorted;
}

/**
 * Fetch initial klines for all subscribed symbols via REST.
 */
export async function fetchInitialKlines(): Promise<void> {
  try {
    const { getTestnetClient } = await import("./binance-testnet");
    const client = getTestnetClient();

    if (!client) return;

    for (const symbol of _subscribedSymbols) {
      try {
        const rawKlines = await client.getKlines(symbol, KLINE_INTERVAL, KLINE_LIMIT);
        const klines: KlineData[] = rawKlines.map((k) => ({
          openTime: k.openTime,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
          closeTime: k.closeTime,
          quoteVolume: k.quoteVolume,
        }));
        storeKlines(symbol, klines);
      } catch (err) {
        logger.warn("market-data-state", `Failed to fetch klines for ${symbol}: ${err}`);
      }
    }

    logger.debug("market-data-state", `Fetched klines for ${_subscribedSymbols.length} symbols`);
  } catch (err) {
    logger.warn("market-data-state", `Failed to fetch initial klines: ${err}`);
  }
}
