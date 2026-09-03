/**
 * Market Data Service — BINANCE AI FUTURES AGENT v0.1 (P6)
 *
 * Fetches REAL data from Binance Futures Testnet.
 * Every data point originates from the actual testnet REST API.
 * NO fabricated data. NO dummy values. NO Math.random().
 *
 * If data is unavailable:
 *   dataQuality is set to STALE/INVALID and callers must reject trades.
 */

import { getTestnetClient, type BinanceTestnetClient } from "../exchange/binance-testnet";
import { logger } from "../logger";

// ─── Types ───────────────────────────────────────────────────────

export type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
};

export type TickerData = {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  trades: number;
};

export type MarketSnapshot = {
  symbol: string;
  timestamp: number;
  source: "BINANCE_FUTURES_TESTNET";
  freshness: number; // ms since data fetched
  dataQuality: "GOOD" | "DEGRADED" | "STALE" | "INVALID";
  price: number;
  volume24h: number;
  quoteVolume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  trades24h: number;
  klines: Kline[];
  volatility: number; // ATR-based from klines
  bidAskSpread: number; // estimated from kline data
};

// ─── ATR Calculation ─────────────────────────────────────────────

function calculateATR(klines: Kline[], period = 14): number {
  if (klines.length < 2) return 0;

  const trValues: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1]!;
    const curr = klines[i]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trValues.push(tr);
  }

  // Use last `period` TR values for ATR
  const slice = trValues.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ─── Market Data Service ─────────────────────────────────────────

export class MarketDataService {
  private client: BinanceTestnetClient | null;

  constructor(client?: BinanceTestnetClient) {
    this.client = client ?? getTestnetClient();
  }

  /**
   * Fetch a complete market snapshot for a single symbol.
   * All data comes from Binance Futures Testnet REST API.
   */
  async getSnapshot(symbol: string): Promise<MarketSnapshot> {
    if (!this.client) {
      return this.invalidSnapshot(symbol, "Binance Testnet client not configured") as MarketSnapshot;
    }

    try {
      const [tickerRaw, klinesRaw] = await Promise.all([
        this.client.get24hTicker(symbol).catch((err) => {
          logger.warn("data-service", `24h ticker failed for ${symbol}: ${err}`);
          return null;
        }),
        this.client.getKlines(symbol, "1h", 100).catch((err) => {
          logger.warn("data-service", `Klines failed for ${symbol}: ${err}`);
          return null;
        }),
      ]);

      const ticker = tickerRaw?.[0];
      if (!ticker) {
        return this.invalidSnapshot(symbol, "Ticker data unavailable") as MarketSnapshot;
      }

      if (!klinesRaw || klinesRaw.length === 0) {
        return this.degradedSnapshot(symbol, ticker, "Klines unavailable") as MarketSnapshot;
      }

      const volatility = calculateATR(klinesRaw);

      // Estimate bid-ask spread from recent klines
      const recent = klinesRaw.slice(-5);
      const avgHigh = recent.reduce((s, k) => s + k.high, 0) / recent.length;
      const avgLow = recent.reduce((s, k) => s + k.low, 0) / recent.length;
      const spread = avgHigh > 0 ? (avgHigh - avgLow) / avgHigh : 0;

      const now = Date.now();

      return {
        symbol,
        timestamp: now,
        source: "BINANCE_FUTURES_TESTNET",
        freshness: 0,
        dataQuality: "GOOD",
        price: ticker.lastPrice,
        volume24h: ticker.volume,
        quoteVolume24h: ticker.quoteVolume,
        priceChange24h: ticker.priceChange,
        priceChangePercent24h: ticker.priceChangePercent,
        high24h: ticker.highPrice,
        low24h: ticker.lowPrice,
        trades24h: ticker.trades,
        klines: klinesRaw,
        volatility,
        bidAskSpread: spread,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("data-service", `Snapshot failed for ${symbol}: ${msg}`);
      return this.invalidSnapshot(symbol, msg) as MarketSnapshot;
    }
  }

  /**
   * Fetch ticker data for multiple symbols in parallel.
   * Returns only symbols with valid data.
   */
  async getMultiTicker(symbols: string[]): Promise<TickerData[]> {
    if (!this.client) {
      logger.warn("data-service", "Client not configured — returning empty tickers");
      return [];
    }

    // Fetch all tickers at once (single API call for all USDT pairs)
    try {
      const allTickers = await this.client.get24hTicker();
      const symbolSet = new Set(symbols);
      return allTickers.filter((t) => symbolSet.has(t.symbol));
    } catch (err) {
      logger.error("data-service", `Multi-ticker fetch failed: ${err}`);
      return [];
    }
  }

  /**
   * Get all USDT perpetual futures symbols from exchange info.
   * Only returns symbols with status "TRADING".
   */
  async getTradableSymbols(): Promise<string[]> {
    if (!this.client) return [];

    try {
      const exchangeInfo = await this.client.getExchangeInfo();
      return exchangeInfo.symbols
        .filter(
          (s) =>
            s.status === "TRADING" &&
            s.quoteAsset === "USDT" &&
            s.symbol.endsWith("USDT"),
        )
        .map((s) => s.symbol);
    } catch (err) {
      logger.error("data-service", `Failed to get tradable symbols: ${err}`);
      return [];
    }
  }

  /**
   * Check data freshness. Returns false if data is older than maxAgeMs.
   */
  static isFresh(snapshot: MarketSnapshot, maxAgeMs = 60_000): boolean {
    return snapshot.freshness < maxAgeMs;
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private invalidSnapshot(symbol: string, _reason: string): MarketSnapshot {
    return {
      symbol,
      timestamp: Date.now(),
      source: "BINANCE_FUTURES_TESTNET",
      freshness: 0,
      dataQuality: "INVALID",
      price: 0,
      volume24h: 0,
      quoteVolume24h: 0,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      high24h: 0,
      low24h: 0,
      trades24h: 0,
      klines: [],
      volatility: 0,
      bidAskSpread: 0,
    };
  }

  private degradedSnapshot(
    symbol: string,
    ticker: TickerData,
    _reason: string,
  ): MarketSnapshot {
    return {
      symbol,
      timestamp: Date.now(),
      source: "BINANCE_FUTURES_TESTNET",
      freshness: 0,
      dataQuality: "DEGRADED",
      price: ticker.lastPrice,
      volume24h: ticker.volume,
      quoteVolume24h: ticker.quoteVolume,
      priceChange24h: ticker.priceChange,
      priceChangePercent24h: ticker.priceChangePercent,
      high24h: ticker.highPrice,
      low24h: ticker.lowPrice,
      trades24h: ticker.trades,
      klines: [],
      volatility: 0,
      bidAskSpread: 0,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────

let _instance: MarketDataService | null = null;

export function getMarketDataService(): MarketDataService {
  if (!_instance) {
    _instance = new MarketDataService();
  }
  return _instance;
}
