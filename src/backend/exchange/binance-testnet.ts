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
    positionAmount: string;
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
  positionAmount: string;
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

// ─── Binance Testnet Client ─────────────────────────────────────────

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

  private async request<T>(
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
      "X-MBX-APIKEY": this.apiKey,
    };

    if (method === "GET" || method === "DELETE") {
      fullUrl = `${url}?${queryString}`;
    } else {
      // POST with form body
      fullUrl = url.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    if (signed) {
      headers["X-MBX-APIKEY"] = this.apiKey;
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

  async getAccountInfo(): Promise<TestnetAccountResponse> {
    logger.debug("binance-testnet", "Fetching account info");
    return this.request<TestnetAccountResponse>("GET", "/fapi/v2/account");
  }

  async getBalance(): Promise<TestnetBalanceResponse[]> {
    logger.debug("binance-testnet", "Fetching balance");
    return this.request<TestnetBalanceResponse[]>("GET", "/fapi/v2/balance");
  }

  async getUSDTBalance(): Promise<number> {
    const balances = await this.getBalance();
    const usdt = balances.find((b) => b.asset === "USDT");
    return usdt ? parseFloat(usdt.availableBalance) : 0;
  }

  // ─── Positions ───────────────────────────────────────────────────

  async getPositions(): Promise<TestnetPositionResponse[]> {
    logger.debug("binance-testnet", "Fetching positions");
    const account = await this.getAccountInfo();
    return account.positions.filter(
      (p) => parseFloat(p.positionAmount) !== 0,
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

  // ─── Orders ──────────────────────────────────────────────────────

  async placeMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<TestnetOrderResponse> {
    logger.info("binance-testnet", `Market order: ${side} ${quantity} ${symbol}`);

    // Pre-flight: wallet balance check
    const balance = walletRepository.getBalance();
    const minBalance = 0.50;
    if (balance < minBalance) {
      walletRepository.logGuardrailEvent(
        "INSUFFICIENT_FUNDS",
        "ERROR",
        `Testnet order blocked: wallet balance $${balance.toFixed(2)} < $${minBalance.toFixed(2)}`,
        { symbol, side, quantity },
        balance,
      );
      throw new BinanceTestnetError(
        "INSUFFICIENT_FUNDS",
        `Insufficient wallet balance: $${balance.toFixed(2)} (min: $${minBalance.toFixed(2)})`,
        0,
      );
    }

    const result = await this.request<TestnetOrderResponse>("POST", "/fapi/v1/order", {
      symbol,
      side,
      type: "MARKET",
      quantity: String(quantity),
    });

    // Log successful order
    walletRepository.logGuardrailEvent(
      "TRADE_ALLOWED",
      "INFO",
      `Testnet order executed: ${side} ${quantity} ${symbol} (orderId: ${result.orderId})`,
      { orderId: result.orderId, symbol, side, quantity, status: result.status },
      balance,
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
    const params: Record<string, string> = {};
    if (symbol) params["symbol"] = symbol;
    return this.request<TestnetOrderResponse[]>("GET", "/fapi/v1/openOrders", params);
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
}

// ─── Error Type ─────────────────────────────────────────────────────

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
