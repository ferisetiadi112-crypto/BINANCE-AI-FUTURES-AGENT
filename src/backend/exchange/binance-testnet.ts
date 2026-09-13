/**
 * Binance Futures Testnet Client — BINANCE AI FUTURES AGENT v0.1
 *
 * Real REST API client for Binance Futures Testnet.
 * All endpoints point to https://testnet.binancefuture.com.
 *
 * Features:
 * - HMAC-SHA-256 request signing
 * - Balance fetching
 * - Order placement (LONG/SHORT with leverage)
 * - Position querying
 * - Automatic recvWindow enforcement
 * - Rate limit awareness
 *
 * SAFETY:
 * - Only operates on testnet — never touches production
 * - All orders validated against $5 capital limit
 * - Every execution logged to database
 */

import { createHmac, createHash } from "crypto";
import { logger } from "../logger";
import { walletRepository } from "../repositories/wallet";
import {
  executeWithRestPolicy,
  getCircuitState,
  allowHalfOpenProbe,
  probeSucceeded,
  probeFailed,
  BinanceRestSuppressedError,
  CACHE_TTL_TICKER_MS,
  CACHE_TTL_KLINES_MS,
  CACHE_TTL_ACCOUNT_MS,
  CACHE_TTL_OPEN_ORDERS_MS,
  CACHE_TTL_EXCHANGE_INFO_MS,
} from "./rest-policy";

// ─── Configuration ──────────────────────────────────────────────────

const TESTNET_REST_URL = "https://testnet.binancefuture.com";
const REQUEST_TIMEOUT = 15_000;
const MAX_RECV_WINDOW = 10_000;

export type BinanceTestnetConfig = {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  recvWindow?: number;
};

// ─── API Response Types ─────────────────────────────────────────────

export type TestnetBalanceResponse = {
  accountAlias: string;
  asset: string;
  balance: string;
  crossWalletBalance: string;
  crossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTimestamp: number;
};

export type TestnetAccountResponse = {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  totalCrossWalletBalance: string;
  totalCrossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  canTrade: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  updateTimestamp: number;
  assets: Array<{
    asset: string;
    walletBalance: string;
    unrealizedProfit: string;
    marginBalance: string;
    availableBalance: string;
    crossWalletBalance: string;
    crossUnPnl: string;
  }>;
  positions: Array<{
    symbol: string;
    // Real Binance /fapi/v2/account field name (NOT "positionAmount")
    positionAmt: string;
    entryPrice: string;
    markPrice: string;
    unRealizedProfit: string;
    leverage: string;
    positionSide: "LONG" | "SHORT" | "BOTH";
    openOrderInitialMargin: string;
    positionInitialMargin: string;
    notional: string;
    isolatedMargin: string;
    bidNotional: string;
    askNotional: string;
    breakEvenPrice: string;
    marginType: string;
    isolatedWallet: string;
    updateTimestamp: number;
  }>;
};

export type TestnetOrderResponse = {
  orderId: number;
  symbol: string;
  pair: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
  timeInForce: string;
  origQty: string;
  price: string;
  cummulativeQuoteQty: string;
  averagePrice: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  transactTime: number;
  updateTime: number;
  isReduceOnly: boolean;
  workingType: string;
  commissionAsset: string;
  commission: string;
};

export type TestnetPositionResponse = {
  symbol: string;
  // Real Binance field name (NOT "positionAmount")
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  leverage: string;
  positionSide: "LONG" | "SHORT" | "BOTH";
  openOrderInitialMargin: string;
  positionInitialMargin: string;
  notional: string;
  isolatedMargin: string;
  bidNotional: string;
  askNotional: string;
  breakEvenPrice: string;
  marginType: string;
  isolatedWallet: string;
  updateTimestamp: number;
};

export type TestnetTradeRecord = {
  id: number;
  symbol: string;
  orderId: number;
  side: "BUY" | "SELL";
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
};

// ─── Exchange Info Types (P4-FIX) ─────────────────────────────────

export type ExchangeFilter = {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  notional?: string;
  limit?: string;
};

export type SymbolInfo = {
  symbol: string;
  status: string; // "TRADING" | "BREAK" etc.
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  filters: ExchangeFilter[];
  orderTypes: string[];
  timeInForce: string[];
};

export type ExchangeInfoResponse = {
  timezone: string;
  serverTime: number;
  rateLimits: Array<{
    rateLimitType: string;
    interval: string;
    intervalNum: number;
    limit: number;
  }>;
  symbols: SymbolInfo[];
};

// ─── Binance Testnet Client ───────────────────────────────────────

/**
 * Safe parse of a Binance positionAmt string.
 * Only finite, non-zero amounts count as an open position — guards against
 * undefined/missing/invalid fields producing NaN and being treated as open.
 */
export function parsePositionAmount(
  positionAmt: string | undefined | null,
): { amt: number; isOpen: boolean; side: "LONG" | "SHORT" } {
  const amt = Number.parseFloat(positionAmt ?? "");
  const isOpen = Number.isFinite(amt) && amt !== 0;
  return { amt, isOpen, side: amt > 0 ? "LONG" : "SHORT" };
}

export class BinanceTestnetClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private recvWindow: number;
  private connected = false;

  constructor(config: BinanceTestnetConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || TESTNET_REST_URL;
    this.recvWindow = config.recvWindow || MAX_RECV_WINDOW;

    if (!this.apiKey || !this.apiSecret) {
      logger.warn("binance-testnet", "Missing API keys — client will not function");
    }

    logger.info("binance-testnet", `Initialized with testnet: ${this.baseUrl}`);
  }

  // ─── Connection ──────────────────────────────────────────────────

  async connect(): Promise<boolean> {
    try {
      // Test connectivity with a simple ping
      const response = await fetch(`${this.baseUrl}/fapi/v1/ping`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        this.connected = true;
        logger.info("binance-testnet", "Connected to Binance Futures Testnet");
        return true;
      }
      logger.error("binance-testnet", `Ping failed: ${response.status}`);
      return false;
    } catch (err) {
      logger.error("binance-testnet", `Connection failed: ${err}`);
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── HMAC Signature ──────────────────────────────────────────────

  sign(queryString: string): string {
    return createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  // ─── Generic Request ─────────────────────────────────────────────

  async request<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, string> = {},
    signed = true,
  ): Promise<T> {
    // E.2-FIX-D.6: every Binance REST request passes through the centralized
    // circuit-breaker gate. While OPEN, all REST is suppressed (WS continues);
    // during HALF_OPEN exactly one probe request may pass.
    const circuit = getCircuitState();
    if (circuit === "OPEN" || circuit === "HALF_OPEN") {
      if (allowHalfOpenProbe()) {
        // Single half-open probe proceeds; all others stay suppressed.
        try {
          const result = await this._doRequest<T>(method, endpoint, params, signed);
          probeSucceeded();
          return result;
        } catch (err) {
          probeFailed(err);
          throw err;
        }
      }
      throw new BinanceRestSuppressedError(
        `REST suppressed — Binance circuit ${circuit} (rate limit / IP ban cooldown)`,
      );
    }

    return this._doRequest<T>(method, endpoint, params, signed);
  }

  private async _doRequest<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, string> = {},
    signed = true,
  ): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    if (signed) {
      params["timestamp"] = String(Date.now());
      params["recvWindow"] = String(this.recvWindow);
    }

    const queryString = new URLSearchParams(params).toString();

    let fullUrl: string;
    let headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (signed) {
      headers["X-MBX-APIKEY"] = this.apiKey;
    }

    if (method === "GET" || method === "DELETE") {
      fullUrl = `${url}?${queryString}`;
    } else {
      fullUrl = url.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const body = method === "POST" ? queryString : null;
      const signedUrl = signed ? `${url}?${queryString}&signature=${this.sign(queryString)}` : fullUrl;
      const finalUrl = method === "POST" ? fullUrl : signedUrl;

      const response = await fetch(finalUrl, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        let errorMsg: string;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = `Code ${errorJson.code}: ${errorJson.msg}`;
        } catch {
          errorMsg = `${response.status}: ${errorText.slice(0, 200)}`;
        }

        // Rate limit handling
        if (response.status === 429) {
          logger.warn("binance-testnet", `Rate limited — ${errorMsg}`);
          throw new BinanceTestnetError("RATE_LIMITED", errorMsg, response.status);
        }

        throw new BinanceTestnetError("API_ERROR", errorMsg, response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BinanceTestnetError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BinanceTestnetError("TIMEOUT", "Request timeout", 0);
      }
      throw new BinanceTestnetError("NETWORK_ERROR", String(error), 0);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Account & Balance ───────────────────────────────────────────

  /**
   * E.2-FIX-D.6: cached shared account snapshot.
   * Full /fapi/v2/account is capped at 1 request / 60s regardless of how many
   * symbols or subsystems need it. Concurrent callers dedup onto one request.
   * Trade-critical paths (placeMarketOrder balance validation) still read from
   * this snapshot — freshness of 60s is acceptable for pre-trade checks and
   * Binance itself re-validates the order.
   */
  async getAccountInfo(): Promise<TestnetAccountResponse> {
    logger.debug("binance-testnet", "Fetching account info");
    return executeWithRestPolicy<TestnetAccountResponse>({
      key: "account:/fapi/v2/account",
      ttlMs: CACHE_TTL_ACCOUNT_MS,
      execute: async () => ({
        value: await this._doRequest<TestnetAccountResponse>("GET", "/fapi/v2/account"),
      }),
    });
  }

  async getBalance(): Promise<TestnetBalanceResponse[]> {
    logger.debug("binance-testnet", "Fetching balance");
    // E.2-FIX-D.14: /fapi/v2/balance (weight 5) previously bypassed the REST
    // policy and was called per-tick via syncBalance() (weight 5) IN ADDITION
    // to the /fapi/v2/account snapshot (weight 5) already used by
    // getAccountInfo()/getPositions()/getAccountSnapshot(). Both endpoints
    // return identical balance data. Routing getBalance through the shared
    // policy under the same 60s account-snapshot TTL lets both paths share
    // ONE request per TTL instead of two — eliminating the -1003 storm.
    return executeWithRestPolicy<TestnetBalanceResponse[]>({
      key: "account:/fapi/v2/balance:usdt-mirror",
      ttlMs: CACHE_TTL_ACCOUNT_MS,
      execute: async () => ({
        // Mirror of the /fapi/v2/account payload — served from the SAME
        // cached account snapshot (dedup key shared with getAccountInfo).
        value: this.accountToBalances(
          await this.getAccountInfo(),
        ),
      }),
    });
  }

  /** Convert the /fapi/v2/account payload into /fapi/v2/balance-shaped rows. */
  private accountToBalances(account: TestnetAccountResponse): TestnetBalanceResponse[] {
    return (account.assets ?? []).map((a) => ({
      accountAlias: "binance-testnet",
      asset: a.asset,
      balance: a.walletBalance,
      crossWalletBalance: a.crossWalletBalance,
      crossUnPnl: a.crossUnPnl,
      availableBalance: a.availableBalance,
      maxWithdrawAmount: a.availableBalance,
      marginAvailable: true,
      updateTimestamp: account.updateTimestamp ?? 0,
    }));
  }

  async getUSDTBalance(): Promise<number> {
    const balances = await this.getBalance();
    const usdt = balances.find((b) => b.asset === "USDT");
    return usdt ? parseFloat(usdt.availableBalance) : 0;
  }

  /**
   * P7: REAL USDⓈ-M Futures available balance from /fapi/v2/account.
   * This is the authoritative source for AI effective allocation.
   */
  async getRealAvailableBalance(): Promise<number> {
    const account = await this.getAccountInfo();
    const available = parseFloat(account.availableBalance);
    if (!Number.isFinite(available) || available < 0) {
      throw new BinanceTestnetError(
        "INVALID_ACCOUNT_STATE",
        `Invalid available balance from Binance: ${account.availableBalance}`,
        0,
      );
    }
    return available;
  }

  // ─── Positions ───────────────────────────────────────────────────

  async getPositions(): Promise<TestnetPositionResponse[]> {
    logger.debug("binance-testnet", "Fetching positions");
    const account = await this.getAccountInfo();
    return account.positions.filter(
      (p) => parsePositionAmount(p.positionAmt).isOpen,
    );
  }

  async getOpenPositions(symbol?: string): Promise<TestnetPositionResponse[]> {
    const positions = await this.getPositions();
    if (symbol) {
      return positions.filter((p) => p.symbol === symbol);
    }
    return positions;
  }

  // ─── Leverage ────────────────────────────────────────────────────

  async setLeverage(symbol: string, leverage: number): Promise<{ leverage: number }> {
    logger.info("binance-testnet", `Setting leverage: ${symbol} → ${leverage}x`);
    return this.request<{ leverage: number }>("POST", "/fapi/v1/leverage", {
      symbol,
      leverage: String(leverage),
    });
  }

  // ─── Margin Mode (P7) ─────────────────────────────────────────────

  /**
   * P7: Determine the symbol's ACTUAL margin mode from Binance.
   * Returns "isolated" | "cross" | "unknown".
   * "unknown" when the symbol has no position/open order data, or on API failure
   * (caller must fail closed).
   */
  async getMarginType(
    symbol: string,
  ): Promise<"isolated" | "cross" | "unknown"> {
    try {
      const result = await this.request<Array<{ symbol: string; marginType: string }>>(
        "GET",
        "/fapi/v1/positionRisk",
        { symbol },
      );
      const entry = result.find((p) => p.symbol === symbol);
      if (!entry) return "unknown";
      const mt = String(entry.marginType || "").toLowerCase();
      if (mt === "isolated") return "isolated";
      if (mt === "cross") return "cross";
      return "unknown";
    } catch (err) {
      logger.warn("binance-testnet", `Cannot determine margin type for ${symbol}: ${err}`);
      return "unknown";
    }
  }

  /**
   * P7: Set the symbol margin type. Deterministic, symbol-specific.
   * Used ONLY for symbols with no existing position/open order (pre-trade
   * configuration). Never used to convert an existing CROSS position.
   */
  async setMarginType(
    symbol: string,
    marginType: "ISOLATED" | "CROSS",
  ): Promise<{ code: number; msg: string }> {
    logger.info("binance-testnet", `Setting margin type: ${symbol} → ${marginType}`);
    return this.request<{ code: number; msg: string }>("POST", "/fapi/v1/marginType", {
      symbol,
      marginType,
    });
  }

  // ─── Orders ──────────────────────────────────────────────────────

  async placeMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<TestnetOrderResponse> {
    logger.info("binance-testnet", `Market order: ${side} ${quantity} ${symbol}`);

    // P7D-2A: Removed sandbox wallet pre-flight check.
    // Balance validation is enforced by RiskEngine via effectiveAllocationLimit
    // which uses real Binance Futures account data. The executor should not
    // maintain a separate wallet check against a different data source.

    const result = await this.request<TestnetOrderResponse>("POST", "/fapi/v1/order", {
      symbol,
      side,
      type: "MARKET",
      quantity: String(quantity),
    });

    // Log successful order
    await walletRepository.logGuardrailEvent(
      "TRADE_ALLOWED",
      "INFO",
      `Testnet order executed: ${side} ${quantity} ${symbol} (orderId: ${result.orderId})`,
      { orderId: result.orderId, symbol, side, quantity, status: result.status },
      0,
    );

    return result;
  }

  async placeLimitOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
    price: number,
    timeInForce: "GTC" | "IOC" | "FOK" = "GTC",
  ): Promise<TestnetOrderResponse> {
    logger.info("binance-testnet", `Limit order: ${side} ${quantity} ${symbol} @ $${price}`);

    return this.request<TestnetOrderResponse>("POST", "/fapi/v1/order", {
      symbol,
      side,
      type: "LIMIT",
      quantity: String(quantity),
      price: String(price),
      timeInForce,
    });
  }

  async cancelOrder(symbol: string, orderId: number): Promise<{ orderId: number; status: string }> {
    logger.info("binance-testnet", `Cancel order: ${symbol} #${orderId}`);
    return this.request<{ orderId: number; status: string }>("DELETE", "/fapi/v1/order", {
      ["symbol"]: symbol,
      ["orderId"]: String(orderId),
    });
  }

  async getOpenOrders(symbol?: string): Promise<TestnetOrderResponse[]> {
    // E.2-FIX-D.9: openOrders (no symbol) is a high-weight (~40) request and was
    // previously uncached/undeduped, hit on every dashboard poll by BOTH the
    // diagnostics builder and the testnet-status enrichment. Now it passes
    // through the centralized REST policy: cache (30s), in-flight dedup,
    // concurrency limiter, backoff, circuit breaker, weight monitoring.
    // The symbol-specific variant (weight 1) is used only by closePosition
    // protection-order cancellation and is deliberately left uncached —
    // it must reflect the exact live order book at cancel time.
    const params: Record<string, string> = {};
    if (symbol) params["symbol"] = symbol;
    if (symbol) {
      return this.request<TestnetOrderResponse[]>("GET", "/fapi/v1/openOrders", params);
    }
    return executeWithRestPolicy<TestnetOrderResponse[]>({
      key: "openOrders:/fapi/v1/openOrders",
      ttlMs: CACHE_TTL_OPEN_ORDERS_MS,
      execute: async () => ({
        value: await this.request<TestnetOrderResponse[]>("GET", "/fapi/v1/openOrders", params),
      }),
    });
  }

  async getAllOrders(symbol: string, limit = 50): Promise<TestnetOrderResponse[]> {
    return this.request<TestnetOrderResponse[]>("GET", "/fapi/v1/allOrders", {
      symbol,
      limit: String(limit),
    });
  }

  // ─── Trade History ───────────────────────────────────────────────

  async getRecentTrades(symbol: string, limit = 50): Promise<TestnetTradeRecord[]> {
    return this.request<TestnetTradeRecord[]>("GET", "/fapi/v1/userTrades", {
      symbol,
      limit: String(limit),
    });
  }

  // ─── Exchange Info (P4-FIX) ─────────────────────────────────────

  private exchangeInfoCache: { data: ExchangeInfoResponse; fetchedAt: number } | null = null;
  private static readonly EXCHANGE_INFO_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Get Binance Futures exchange information (symbol filters, precision, etc.).
   * Cached for 1 hour to avoid excessive API calls.
   * Falls back to stale cache if API fails.
   */
  async getExchangeInfo(): Promise<ExchangeInfoResponse> {
    const now = Date.now();

    // Return cached data if still valid
    if (
      this.exchangeInfoCache &&
      now - this.exchangeInfoCache.fetchedAt < BinanceTestnetClient.EXCHANGE_INFO_TTL_MS
    ) {
      return this.exchangeInfoCache.data;
    }

    try {
      const data = await this.request<ExchangeInfoResponse>("GET", "/fapi/v1/exchangeInfo", {}, false);
      this.exchangeInfoCache = { data, fetchedAt: now };
      logger.info("binance-testnet", `Exchange info fetched: ${data.symbols.length} symbols`);
      return data;
    } catch (err) {
      logger.warn("binance-testnet", `Failed to fetch exchange info: ${err}`);
      // Return stale cache if available
      if (this.exchangeInfoCache) {
        logger.warn("binance-testnet", "Using stale exchange info cache");
        return this.exchangeInfoCache.data;
      }
      throw err;
    }
  }

  /**
   * Get symbol info for a specific symbol.
   * Returns null if symbol not found.
   */
  async getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
    const exchangeInfo = await this.getExchangeInfo();
    return exchangeInfo.symbols.find((s) => s.symbol === symbol) || null;
  }

  // ─── Market Data (P6) ──────────────────────────────────────────

  /**
   * Get kline/candlestick data for a symbol.
   * E.2-FIX-D.6: cached (60s TTL) + in-flight dedup + circuit breaker.
   */
  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit = 100,
  ): Promise<Array<{
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    quoteVolume: number;
    trades: number;
  }>> {
    type Kline = {
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
    return executeWithRestPolicy<Kline[]>({
      key: `klines:${symbol}:${interval}:${limit}`,
      ttlMs: CACHE_TTL_KLINES_MS,
      execute: async () => {
        const raw = await this.request<Array<[
          number, string, string, string, string, string, number, string, number,
        ]>>("GET", "/fapi/v1/klines", {
          symbol,
          interval,
          limit: String(limit),
        }, false);

        return {
          value: raw.map((c) => ({
            openTime: c[0],
            open: parseFloat(c[1]!),
            high: parseFloat(c[2]!),
            low: parseFloat(c[3]!),
            close: parseFloat(c[4]!),
            volume: parseFloat(c[5]!),
            closeTime: c[6]!,
            quoteVolume: parseFloat(c[7]!),
            trades: c[8]!,
          })),
        };
      },
    });
  }

  /**
   * Get 24h ticker stats for a symbol or all symbols.
   *
   * Binance returns a single ticker OBJECT for a symbol-scoped request and an
   * ARRAY for an all-symbols request. Normalize both into a deterministic
   * array so callers never call .map() on an object (E.2-FIX-A).
   */
  async get24hTicker(symbol?: string): Promise<Array<{
    symbol: string;
    lastPrice: number;
    priceChange: number;
    priceChangePercent: number;
    highPrice: number;
    lowPrice: number;
    volume: number;
    quoteVolume: number;
    trades: number;
  }>> {
    const params: Record<string, string> = {};
    if (symbol) params["symbol"] = symbol;

    type RawTicker = {
      symbol: string;
      lastPrice: string;
      priceChange: string;
      priceChangePercent: string;
      highPrice: string;
      lowPrice: string;
      volume: string;
      quoteVolume: string;
      trades: number;
    };

    // E.2-FIX-D.6: cached (15s TTL) + in-flight dedup + circuit breaker.
    return executeWithRestPolicy<Array<{
      symbol: string;
      lastPrice: number;
      priceChange: number;
      priceChangePercent: number;
      highPrice: number;
      lowPrice: number;
      volume: number;
      quoteVolume: number;
      trades: number;
    }>>({
      key: `ticker24h:${symbol ?? "ALL"}`,
      ttlMs: CACHE_TTL_TICKER_MS,
      execute: async () => {
        const raw = await this.request<RawTicker | RawTicker[]>(
          "GET",
          "/fapi/v1/ticker/24hr",
          params,
          false,
        );

        // Normalize: single object → one-element array; array → as-is.
        const list: RawTicker[] = Array.isArray(raw) ? raw : raw != null ? [raw] : [];

        if (
          list.length === 0 ||
          !list.every(
            (t) =>
              t != null &&
              typeof t === "object" &&
              typeof t.symbol === "string" &&
              t.symbol.length > 0,
          )
        ) {
          throw new BinanceTestnetError(
            "API_ERROR",
            `Unexpected 24h ticker response shape${symbol ? ` for ${symbol}` : ""}`,
            0,
          );
        }

        return {
          value: list.map((t) => ({
            symbol: t.symbol,
            lastPrice: parseFloat(t.lastPrice),
            priceChange: parseFloat(t.priceChange),
            priceChangePercent: parseFloat(t.priceChangePercent),
            highPrice: parseFloat(t.highPrice),
            lowPrice: parseFloat(t.lowPrice),
            volume: parseFloat(t.volume),
            quoteVolume: parseFloat(t.quoteVolume),
            trades: t.trades,
          })),
        };
      },
    });
  }

  // ─── Income (PnL) ───────────────────────────────────────────────

  async getIncomeHistory(
    symbol?: string,
    incomeType?: string,
    limit = 50,
  ): Promise<Array<{
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    time: number;
    tradeId: number;
    info: string;
  }>> {
    const params: Record<string, string> = { limit: String(limit) };
    if (symbol) params["symbol"] = symbol;
    if (incomeType) params["incomeType"] = incomeType;
    return this.request("GET", "/fapi/v1/income", params);
  }

  /**
   * P7D-3-FIX-REALIZED-PNL: Fetch total realized PnL from Binance Futures Testnet.
   * Uses GET /fapi/v1/income with incomeType=REALIZED_PNL.
   * Sums all REALIZED_PNL income records to produce the total.
   *
   * @param startTime - Optional start time filter (ms since epoch)
   * @param endTime - Optional end time filter (ms since epoch)
   * @returns RealizedPnlResult with status, value, source, and error info.
   *          CRITICAL: status is SUCCESS even when value is 0 (real zero).
   *          status is ERROR only on API failure — NEVER returns value=0 for errors.
   */
  async getRealizedPnl(startTime?: number, endTime?: number): Promise<
    import("./types").RealizedPnlResult
  > {
    try {
      const params: Record<string, string> = {
        incomeType: "REALIZED_PNL",
        limit: "1000",
      };
      if (startTime) params["startTime"] = String(startTime);
      if (endTime) params["endTime"] = String(endTime);

      const income = await this.request<Array<{
        symbol: string;
        incomeType: string;
        income: string;
        asset: string;
        time: number;
        tradeId: number;
        info: string;
      }>>("GET", "/fapi/v1/income", params);

      let totalPnl = 0;
      const records: Array<{ symbol: string; income: number; time: number }> = [];

      for (const record of income) {
        if (record.incomeType === "REALIZED_PNL") {
          const amount = parseFloat(record.income);
          if (Number.isFinite(amount)) {
            totalPnl += amount;
            records.push({ symbol: record.symbol, income: amount, time: record.time });
          }
        }
      }

      logger.debug(
        "binance-testnet",
        `Realized PnL: $${totalPnl.toFixed(4)} from ${records.length} records`,
      );

      // P7D-3-FIX-REALIZED-PNL-2: Binance responded successfully.
      // value=0 here is REAL ZERO — not an error.
      return {
        status: "SUCCESS",
        value: totalPnl,
        source: "binance",
        recordCount: records.length,
        lastUpdated: new Date().toISOString(),
      };
    } catch (err) {
      // P7D-3-FIX-REALIZED-PNL-2: Binance request FAILED.
      // NEVER return 0 here — return null so frontend shows "unavailable".
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn("binance-testnet", `Failed to fetch realized PnL: ${errMsg}`);
      return {
        status: "ERROR",
        value: null,
        source: "unavailable",
        recordCount: 0,
        error: errMsg,
      };
    }
  }
}

// ─── Error Type ─────────────────────────────────────────────────────

/**
 * E.2-FIX-D.9: safe, non-credential error summary for logs/diagnostics.
 * Preserves the category, Binance numeric code (Code -XXXX) and HTTP status
 * when available. Never includes API key/secret/signature or raw messages.
 */
export function safeBinanceErrorSummary(err: unknown): string {
  if (err instanceof BinanceTestnetError) {
    const codeMatch = err.message.match(/Code (-?\d+)/);
    const code = codeMatch ? ` ${codeMatch[0]}` : "";
    const status = err.httpStatus ? ` HTTP ${err.httpStatus}` : "";
    return `[${err.code}]${code}${status}`;
  }
  if (err instanceof Error) {
    const m = err.message.match(/^\[([A-Z_]+)\]/);
    return m?.[1] ?? err.name;
  }
  return "UNKNOWN_ERROR";
}

export class BinanceTestnetError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(`[${code}] ${message}`);
    this.name = "BinanceTestnetError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  get isRateLimited(): boolean {
    return this.code === "RATE_LIMITED";
  }

  get isInsufficientFunds(): boolean {
    return this.code === "INSUFFICIENT_FUNDS";
  }

  get isNetworkError(): boolean {
    return this.code === "NETWORK_ERROR" || this.code === "TIMEOUT";
  }
}

// ─── Singleton Factory ──────────────────────────────────────────────

let clientInstance: BinanceTestnetClient | null = null;

/**
 * Get or create the Binance Testnet client singleton.
 * Returns null if API keys are not configured.
 */
export function getTestnetClient(): BinanceTestnetClient | null {
  const apiKey = process.env["BINANCE_TESTNET_API_KEY"];
  const apiSecret = process.env["BINANCE_TESTNET_SECRET"];

  if (!apiKey || !apiSecret) {
    return null;
  }

  if (!clientInstance) {
    clientInstance = new BinanceTestnetClient({ apiKey, apiSecret });
  }

  return clientInstance;
}

/**
 * Check if testnet is configured and ready.
 */
export function isTestnetConfigured(): boolean {
  return getTestnetClient() !== null;
}
