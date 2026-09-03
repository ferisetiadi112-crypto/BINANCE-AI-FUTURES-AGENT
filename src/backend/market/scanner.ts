/**
 * Market Scanner — BINANCE AI FUTURES AGENT v0.1 (P6)
 *
 * Discovers and ranks potentially tradable symbols using
 * REAL Binance Futures Testnet data.
 *
 * No hardcoded symbol lists — discovers from exchange info.
 * Ranking based on actual volume, volatility, and liquidity.
 * No fabricated scores or dummy data.
 */

import { MarketDataService, type MarketSnapshot } from "./data-service";
import { getTestnetClient } from "../exchange/binance-testnet";
import { validateSymbol, type SymbolValidationResult } from "../exchange/filters";
import { logger } from "../logger";

// ─── Types ───────────────────────────────────────────────────────

export type SymbolCandidate = {
  symbol: string;
  score: number; // 0-100 based on real data
  price: number;
  volume24h: number;
  volatility: number;
  priceChangePercent24h: number;
  liquidityScore: number; // 0-100
  volatilityScore: number; // 0-100
  momentumScore: number; // 0-100
  filterValid: boolean;
  filterErrors: string[];
};

export type ScanResult = {
  timestamp: number;
  symbolsScanned: number;
  candidates: SymbolCandidate[];
  eligibleSymbols: string[];
  rejectedSymbols: Array<{ symbol: string; reason: string }>;
  dataQuality: "GOOD" | "DEGRADED" | "INVALID";
};

// ─── Configuration ───────────────────────────────────────────────

const MAX_SYMBOLS_TO_SCAN = 30; // Limit API calls per scan cycle
const MIN_VOLUME_USDT = 10_000_000; // $10M minimum 24h volume
const MIN_TRADES_24H = 1_000; // Minimum trade count
const MIN_VOLATILITY = 0.001; // Minimum ATR% to be interesting

// ─── Market Scanner ──────────────────────────────────────────────

export class MarketScanner {
  private dataService: MarketDataService;

  constructor(dataService?: MarketDataService) {
    this.dataService = dataService ?? new MarketDataService();
  }

  /**
   * Full scan: discover symbols, fetch data, validate filters, rank.
   * Returns structured result with all real data.
   */
  async scan(): Promise<ScanResult> {
    const startTime = Date.now();
    const timestamp = startTime;

    // 1. Discover tradable symbols from exchange info
    const tradableSymbols = await this.dataService.getTradableSymbols();
    if (tradableSymbols.length === 0) {
      return {
        timestamp,
        symbolsScanned: 0,
        candidates: [],
        eligibleSymbols: [],
        rejectedSymbols: [{ symbol: "ALL", reason: "No tradable symbols discovered" }],
        dataQuality: "INVALID",
      };
    }

    logger.info(
      "scanner",
      `Discovered ${tradableSymbols.length} tradable USDT symbols from exchange info`,
    );

    // 2. Fetch 24h ticker for ALL symbols (single API call)
    const allTickers = await this.dataService.getMultiTicker(tradableSymbols);

    // 3. Pre-filter by volume and activity
    const activeSymbols = allTickers
      .filter(
        (t) =>
          t.quoteVolume >= MIN_VOLUME_USDT &&
          t.trades >= MIN_TRADES_24H &&
          t.lastPrice > 0,
      )
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, MAX_SYMBOLS_TO_SCAN);

    logger.info(
      "scanner",
      `${activeSymbols.length} symbols passed volume/activity filter (of ${allTickers.length} tickers)`,
    );

    if (activeSymbols.length === 0) {
      return {
        timestamp,
        symbolsScanned: allTickers.length,
        candidates: [],
        eligibleSymbols: [],
        rejectedSymbols: tradableSymbols.map((s) => ({
          symbol: s,
          reason: "Below minimum volume/activity threshold",
        })),
        dataQuality: "DEGRADED",
      };
    }

    // 4. Fetch klines for top candidates (limit API calls)
    const candidateSymbols = activeSymbols.map((t) => t.symbol);
    const snapshots: MarketSnapshot[] = [];
    const rejectedSymbols: Array<{ symbol: string; reason: string }> = [];

    for (const symbol of candidateSymbols) {
      try {
        const snapshot = await this.dataService.getSnapshot(symbol);
        if (snapshot.dataQuality === "INVALID") {
          rejectedSymbols.push({ symbol, reason: "Invalid data quality" });
        } else {
          snapshots.push(snapshot);
        }
      } catch (err) {
        rejectedSymbols.push({ symbol, reason: `Fetch error: ${err}` });
      }
    }

    // 5. Validate exchange filters for each candidate
    const client = getTestnetClient();
    const candidates: SymbolCandidate[] = [];

    for (const snapshot of snapshots) {
      const ticker = activeSymbols.find((t) => t.symbol === snapshot.symbol);
      if (!ticker) continue;

      // Filter validation
      let filterResult: SymbolValidationResult = { valid: true, errors: [], symbolInfo: null };
      if (client) {
        try {
          const symbolInfo = await client.getSymbolInfo(snapshot.symbol);
          filterResult = validateSymbol(symbolInfo, snapshot.symbol);
        } catch {
          // Filter check failed — mark as invalid
          filterResult = { valid: false, errors: ["Filter validation failed"], symbolInfo: null };
        }
      }

      // Calculate scores from REAL data
      const volatilityScore = calculateVolatilityScore(snapshot);
      const liquidityScore = calculateLiquidityScore(ticker);
      const momentumScore = calculateMomentumScore(snapshot);

      // Composite score (weighted by importance)
      const score =
        liquidityScore * 0.4 +
        volatilityScore * 0.3 +
        momentumScore * 0.2 +
        (filterResult.valid ? 10 : 0);

      candidates.push({
        symbol: snapshot.symbol,
        score,
        price: snapshot.price,
        volume24h: snapshot.volume24h,
        volatility: snapshot.volatility,
        priceChangePercent24h: snapshot.priceChangePercent24h,
        liquidityScore,
        volatilityScore,
        momentumScore,
        filterValid: filterResult.valid,
        filterErrors: filterResult.errors,
      });
    }

    // 6. Sort by score (best first)
    candidates.sort((a, b) => b.score - a.score);

    // 7. Determine eligible symbols (filter-valid, minimum volatility)
    const eligibleSymbols = candidates
      .filter(
        (c) =>
          c.filterValid &&
          c.volatility > MIN_VOLATILITY &&
          c.score > 20,
      )
      .map((c) => c.symbol);

    const dataQuality =
      candidates.length > 0
        ? eligibleSymbols.length > 0
          ? "GOOD"
          : "DEGRADED"
        : "INVALID";

    const elapsed = Date.now() - startTime;
    logger.info(
      "scanner",
      `Scan complete: ${eligibleSymbols.length} eligible of ${candidates.length} candidates ` +
        `(${elapsed}ms, data quality: ${dataQuality})`,
    );

    return {
      timestamp,
      symbolsScanned: allTickers.length,
      candidates,
      eligibleSymbols,
      rejectedSymbols,
      dataQuality,
    };
  }
}

// ─── Scoring Functions (derived from REAL data) ──────────────────

function calculateVolatilityScore(snapshot: MarketSnapshot): number {
  // Higher volatility = more opportunity (but also more risk)
  // Score 0-50: based on ATR relative to price
  if (snapshot.price <= 0) return 0;
  const atrPercent = snapshot.volatility / snapshot.price;
  // Scale: 0.5% ATR → 50, 2% ATR → 100 (capped)
  const raw = Math.min(atrPercent * 2500, 100);
  return Math.max(0, Math.min(50, raw));
}

function calculateLiquidityScore(ticker: {
  quoteVolume: number;
  trades: number;
}): number {
  // Based on actual quote volume and trade count
  // $100M+ volume → 50, $10M → 25, etc.
  const volumeScore = Math.min(ticker.quoteVolume / 2_000_000, 50);
  const tradeScore = Math.min(ticker.trades / 20, 50);
  return Math.min(volumeScore + tradeScore, 100);
}

function calculateMomentumScore(snapshot: MarketSnapshot): number {
  // Based on actual 24h price change
  // Larger moves = more momentum (scored 0-50)
  const absChange = Math.abs(snapshot.priceChangePercent24h);
  return Math.min(absChange * 5, 50);
}
