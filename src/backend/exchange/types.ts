/**
 * Exchange Adapter Types — BINANCE AI FUTURES AGENT v0.1
 *
 * Interfaces for exchange integration. These define the contract
 * that any exchange adapter must implement.
 *
 * Phase 1: Interface only — no real API calls.
 * Phase 4: Binance Futures adapter implementation.
 *
 * Architecture:
 *   ExchangeAdapter (interface)
 *     └── BinanceFuturesAdapter (Phase 4)
 *           ├── MarketDataService (WebSocket + REST)
 *           ├── OrderService (place, cancel, query)
 *           └── AccountService (balance, positions, margins)
 */

export type ExchangeId = "binance-futures";

export type OrderSide = "BUY" | "SELL";

export type ExchangeOrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";

export type ExchangeOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED";

// ─── Exchange Order Request ───────────────────────────────────────────

export type ExchangeOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: ExchangeOrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
  reduceOnly?: boolean;
  clientOrderId?: string;
};

// ─── Exchange Order Response ──────────────────────────────────────────

export type ExchangeOrderResponse = {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: ExchangeOrderType;
  price: number;
  quantity: number;
  status: ExchangeOrderStatus;
  fills: Array<{
    price: number;
    qty: number;
    commission: number;
    commissionAsset: string;
  }>;
  transactTime: number;
};

// ─── Exchange Account Info ────────────────────────────────────────────

export type ExchangeAccountInfo = {
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
  availableBalance: number;
  totalCrossWalletBalance: number;
  totalCrossPnl: number;
  positions: Array<{
    symbol: string;
    positionAmount: number;
    entryPrice: number;
    markPrice: number;
    unRealizedProfit: number;
    leverage: number;
    positionSide: "LONG" | "SHORT" | "BOTH";
  }>;
};

// ─── Exchange Ticker ──────────────────────────────────────────────────

export type ExchangeTicker = {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  quoteVolume: number;
  openInterest: number;
  fundingRate: number;
  nextFundingTime: number;
};

// ─── Exchange Kline ───────────────────────────────────────────────────

export type ExchangeKline = {
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

// ─── Adapter Interface ────────────────────────────────────────────────

export interface ExchangeAdapter {
  readonly id: ExchangeId;
  readonly name: string;

  // Account
  getAccountInfo(): Promise<ExchangeAccountInfo>;
  getBalance(): Promise<number>;

  // Orders
  placeOrder(request: ExchangeOrderRequest): Promise<ExchangeOrderResponse>;
  cancelOrder(symbol: string, orderId: string): Promise<boolean>;
  getOrder(symbol: string, orderId: string): Promise<ExchangeOrderResponse>;
  getOpenOrders(symbol?: string): Promise<ExchangeOrderResponse[]>;

  // Market Data
  getTicker(symbol: string): Promise<ExchangeTicker>;
  getTickers(symbols?: string[]): Promise<ExchangeTicker[]>;
  getKlines(
    symbol: string,
    interval: string,
    limit?: number,
  ): Promise<ExchangeKline[]>;

  // Position
  getPositions(): Promise<
    Array<{
      symbol: string;
      side: "LONG" | "SHORT";
      size: number;
      entryPrice: number;
      markPrice: number;
      unrealizedPnl: number;
      leverage: number;
    }>
  >;

  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
