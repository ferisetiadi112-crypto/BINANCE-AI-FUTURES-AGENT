/**
 * Binance Futures Market Data Adapter — READ-ONLY
 *
 * Fetches market data from Binance Futures public endpoints.
 * No API key required for public market data.
 *
 * Endpoints used:
 * - GET /fapi/v1/ticker/24hr — 24h price statistics
 * - GET /fapi/v1/klines — Candlestick data
 * - GET /fapi/v1/fundingRate — Funding rate history
 * - GET /fapi/v1/openInterest — Open interest
 * - GET /fapi/v1/depth — Order book depth
 *
 * IMPORTANT: This adapter is READ-ONLY. It cannot place orders.
 */

import { logger } from "../logger";

const BASE_URL = "https://fapi.binance.com";
const REQUEST_TIMEOUT = 10000;

export type BinanceTicker = {
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  weightedAvgPrice: number;
  lastPrice: number;
  lastQty: number;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
};

export type BinanceKline = [
  number, // openTime
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime
  string, // quoteVolume
  number, // trades
  string, // takerBuyBaseVolume
  string, // takerBuyQuoteVolume
  string, // ignore
];

export type BinanceFundingRate = {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
};

export type BinanceOpenInterest = {
  symbol: string;
  openInterest: number;
  sumOpenInterest: number;
  sumOpenInterestValue: number;
};

export type BinanceDepth = {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
};

// ─── Generic Fetcher ──────────────────────────────────────────────────

async function fetchJson<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(endpoint, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Binance API request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Public Market Data Methods ───────────────────────────────────────

export async function getTicker24h(symbol: string): Promise<BinanceTicker> {
  logger.debug("binance-market", `Fetching 24h ticker for ${symbol}`);
  return fetchJson<BinanceTicker>("/fapi/v1/ticker/24hr", { symbol });
}

export async function getAllTickers(): Promise<BinanceTicker[]> {
  logger.debug("binance-market", "Fetching all tickers");
  return fetchJson<BinanceTicker[]>("/fapi/v1/ticker/24hr");
}

export async function getKlines(
  symbol: string,
  interval: string,
  limit = 100,
): Promise<BinanceKline[]> {
  logger.debug("binance-market", `Fetching klines for ${symbol} ${interval}`);
  return fetchJson<BinanceKline[]>("/fapi/v1/klines", {
    symbol,
    interval,
    limit: String(limit),
  });
}

export async function getFundingRate(
  symbol: string,
  limit = 1,
): Promise<BinanceFundingRate[]> {
  logger.debug("binance-market", `Fetching funding rate for ${symbol}`);
  return fetchJson<BinanceFundingRate[]>("/fapi/v1/fundingRate", {
    symbol,
    limit: String(limit),
  });
}

export async function getOpenInterest(symbol: string): Promise<BinanceOpenInterest> {
  logger.debug("binance-market", `Fetching open interest for ${symbol}`);
  return fetchJson<BinanceOpenInterest>("/fapi/v1/openInterest", { symbol });
}

export async function getDepth(symbol: string, limit = 20): Promise<BinanceDepth> {
  logger.debug("binance-market", `Fetching order book depth for ${symbol}`);
  return fetchJson<BinanceDepth>("/fapi/v1/depth", {
    symbol,
    limit: String(limit),
  });
}

// ─── Combined Market Data ─────────────────────────────────────────────

export type MarketSnapshot = {
  symbol: string;
  ticker: BinanceTicker;
  klines: BinanceKline[];
  fundingRate: BinanceFundingRate;
  openInterest: BinanceOpenInterest;
  timestamp: number;
};

export async function getMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
  const [ticker, klines, fundingRateArr, openInterest] = await Promise.all([
    getTicker24h(symbol),
    getKlines(symbol, "15m", 100),
    getFundingRate(symbol, 1),
    getOpenInterest(symbol),
  ]);

  return {
    symbol,
    ticker,
    klines,
    fundingRate: fundingRateArr[0] || { symbol, fundingRate: 0, fundingTime: Date.now() },
    openInterest,
    timestamp: Date.now(),
  };
}

// ─── Multi-Symbol Batch Fetching ─────────────────────────────────────

/** Maximum concurrent requests to respect Binance rate limits */
const MAX_CONCURRENT = 3;
const INTER_SYMBOL_DELAY_MS = 200;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch tickers for multiple symbols with rate limiting.
 * Returns results keyed by symbol; failed symbols are omitted.
 */
export async function getTickersForSymbols(symbols: string[]): Promise<Map<string, BinanceTicker>> {
  const results = new Map<string, BinanceTicker>();
  for (let i = 0; i < symbols.length; i += MAX_CONCURRENT) {
    const batch = symbols.slice(i, i + MAX_CONCURRENT);
    const outcomes = await Promise.allSettled(batch.map(s => getTicker24h(s)));
    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j]!;
      if (outcome.status === "fulfilled") {
        results.set(batch[j]!, outcome.value);
      } else {
        logger.warn("binance-market", `Failed to fetch ticker for ${batch[j]}: ${outcome.reason}`);
      }
    }
    if (i + MAX_CONCURRENT < symbols.length) {
      await sleep(INTER_SYMBOL_DELAY_MS);
    }
  }
  logger.info("binance-market", `Fetched tickers for ${results.size}/${symbols.length} symbols`);
  return results;
}

/**
 * Fetch klines for multiple symbols with rate limiting.
 * Returns results keyed by symbol; failed symbols are omitted.
 */
export async function getKlinesForSymbols(
  symbols: string[],
  interval = "15m",
  limit = 100,
): Promise<Map<string, BinanceKline[]>> {
  const results = new Map<string, BinanceKline[]>();
  for (let i = 0; i < symbols.length; i += MAX_CONCURRENT) {
    const batch = symbols.slice(i, i + MAX_CONCURRENT);
    const outcomes = await Promise.allSettled(batch.map(s => getKlines(s, interval, limit)));
    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j]!;
      if (outcome.status === "fulfilled") {
        results.set(batch[j]!, outcome.value);
      } else {
        logger.warn("binance-market", `Failed to fetch klines for ${batch[j]}: ${outcome.reason}`);
      }
    }
    if (i + MAX_CONCURRENT < symbols.length) {
      await sleep(INTER_SYMBOL_DELAY_MS);
    }
  }
  logger.info("binance-market", `Fetched klines for ${results.size}/${symbols.length} symbols`);
  return results;
}

export type MultiSymbolSnapshot = {
  symbols: string[];
  tickers: Map<string, BinanceTicker>;
  timestamp: number;
  successCount: number;
  failCount: number;
};

/**
 * Batch-fetch tickers for a list of symbols. Returns a combined snapshot.
 */
export async function getMultiSymbolSnapshot(symbols: string[]): Promise<MultiSymbolSnapshot> {
  const tickers = await getTickersForSymbols(symbols);
  return {
    symbols,
    tickers,
    timestamp: Date.now(),
    successCount: tickers.size,
    failCount: symbols.length - tickers.size,
  };
}

// ─── Connection Health ────────────────────────────────────────────────

export async function checkConnection(): Promise<boolean> {
  try {
    await getTicker24h("BTCUSDT");
    return true;
  } catch {
    return false;
  }
}
