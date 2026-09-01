/**
 * Binance Futures Adapter — STUB (Phase 1)
 *
 * Implements the ExchangeAdapter interface for Binance Futures.
 * Currently returns mock data. No real API calls are made.
 *
 * Phase 4: Implement real REST + WebSocket Binance API integration.
 *
 * IMPORTANT: This adapter MUST NOT be used for real trading.
 * It exists only to validate the adapter interface.
 */

import type {
  ExchangeAdapter,
  ExchangeAccountInfo,
  ExchangeOrderRequest,
  ExchangeOrderResponse,
  ExchangeTicker,
  ExchangeKline,
} from "./types";
import { logger } from "../logger";

export type BinanceConfig = {
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
  recvWindow?: number;
};

export class BinanceFuturesAdapter implements ExchangeAdapter {
  readonly id = "binance-futures" as const;
  readonly name = "Binance Futures";

  private config: BinanceConfig;
  private connected = false;

  constructor(config: BinanceConfig = {}) {
    this.config = {
      testnet: true,
      recvWindow: 5000,
      ...config,
    };

    if (!config.apiKey || !config.apiSecret) {
      logger.warn(
        "binance-adapter",
        "No API keys configured — running in mock mode",
      );
    }
  }

  // ─── Connection ──────────────────────────────────────────────────

  async connect(): Promise<void> {
    logger.info("binance-adapter", "Connect called (mock mode — no real connection)");
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    logger.info("binance-adapter", "Disconnect called");
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── Account ─────────────────────────────────────────────────────

  async getAccountInfo(): Promise<ExchangeAccountInfo> {
    logger.debug("binance-adapter", "getAccountInfo (mock)");
    return {
      totalWalletBalance: 5.0,
      totalUnrealizedProfit: 0,
      totalMarginBalance: 5.0,
      availableBalance: 5.0,
      totalCrossWalletBalance: 5.0,
      totalCrossPnl: 0,
      positions: [],
    };
  }

  async getBalance(): Promise<number> {
    logger.debug("binance-adapter", "getBalance (mock)");
    return 5.0;
  }

  // ─── Orders ──────────────────────────────────────────────────────

  async placeOrder(_request: ExchangeOrderRequest): Promise<ExchangeOrderResponse> {
    logger.warn("binance-adapter", "placeOrder called — BLOCKED in Phase 1");
    throw new Error(
      "Real trading is not enabled. This is a Phase 1 stub. " +
      "Trading will be enabled after 12 months of testing.",
    );
  }

  async cancelOrder(_symbol: string, _orderId: string): Promise<boolean> {
    logger.warn("binance-adapter", "cancelOrder called — BLOCKED in Phase 1");
    return false;
  }

  async getOrder(_symbol: string, _orderId: string): Promise<ExchangeOrderResponse> {
    logger.debug("binance-adapter", "getOrder (mock)");
    return {
      orderId: "MOCK-001",
      clientOrderId: "client-001",
      symbol: _symbol,
      side: "BUY",
      type: "MARKET",
      price: 0,
      quantity: 0,
      status: "NEW",
      fills: [],
      transactTime: Date.now(),
    };
  }

  async getOpenOrders(_symbol?: string): Promise<ExchangeOrderResponse[]> {
    logger.debug("binance-adapter", "getOpenOrders (mock)");
    return [];
  }

  // ─── Market Data ─────────────────────────────────────────────────

  async getTicker(_symbol: string): Promise<ExchangeTicker> {
    logger.debug("binance-adapter", "getTicker (mock)");
    return {
      symbol: _symbol,
      lastPrice: 63884.9,
      priceChange: 785.2,
      priceChangePercent: 1.24,
      volume: 28432.1,
      quoteVolume: 1814291234.5,
      openInterest: 682341.2,
      fundingRate: 0.00011,
      nextFundingTime: Date.now() + 8 * 3600_000,
    };
  }

  async getTickers(_symbols?: string[]): Promise<ExchangeTicker[]> {
    logger.debug("binance-adapter", "getTickers (mock)");
    return [
      await this.getTicker("BTCUSDT"),
      await this.getTicker("ETHUSDT"),
      await this.getTicker("SOLUSDT"),
      await this.getTicker("BNBUSDT"),
    ];
  }

  async getKlines(
    _symbol: string,
    _interval: string,
    limit = 100,
  ): Promise<ExchangeKline[]> {
    logger.debug("binance-adapter", "getKlines (mock)");
    const klines: ExchangeKline[] = [];
    let price = 63250;
    const now = Date.now();
    for (let i = 0; i < limit; i++) {
      const drift = (Math.random() - 0.46) * 260;
      const open = price;
      const close = Math.max(100, open + drift);
      const high = Math.max(open, close) + Math.random() * 130;
      const low = Math.min(open, close) - Math.random() * 130;
      klines.push({
        openTime: now - (limit - i) * 15 * 60_000,
        open,
        high,
        low,
        close,
        volume: 400 + Math.random() * 1600,
        closeTime: now - (limit - i - 1) * 15 * 60_000,
        quoteVolume: (400 + Math.random() * 1600) * price,
        trades: Math.floor(Math.random() * 500),
      });
      price = close;
    }
    return klines;
  }

  // ─── Position ────────────────────────────────────────────────────

  async getPositions(): Promise<
    Array<{
      symbol: string;
      side: "LONG" | "SHORT";
      size: number;
      entryPrice: number;
      markPrice: number;
      unrealizedPnl: number;
      leverage: number;
    }>
  > {
    logger.debug("binance-adapter", "getPositions (mock)");
    return [];
  }
}
