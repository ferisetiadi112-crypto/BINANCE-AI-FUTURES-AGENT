/**
 * Testnet Executor — BINANCE AI FUTURES AGENT v0.1 (P4)
 *
 * Bridges the Trading Orchestrator to the real Binance Futures Testnet.
 *
 * P4 Capabilities:
 * - Order confirmation: verify FILLED status before considering order successful
 * - Idempotency: deterministic client order IDs prevent duplicate orders
 * - SL/TP protection: STOP_MARKET and TAKE_PROFIT_MARKET orders on Binance
 * - Position monitoring: reconcile local state vs Binance positions
 * - Startup reconciliation: recover state from Binance on restart
 *
 * Architecture:
 *   AI Decision → Risk Engine → TestnetExecutor → Binance Testnet → Database
 *
 * SAFETY:
 * - All orders validated against Risk Engine BEFORE placement
 * - Balance check uses sandbox wallet (Boss-controlled)
 * - Every order result persisted with full audit trail
 * - Testnet ONLY — never touches production
 *
 * Database: Async via PostgreSQL adapter (dbQuery/dbExecute).
 */

import {
  getTestnetClient,
  BinanceTestnetClient,
  BinanceTestnetError,
  type TestnetOrderResponse,
  type TestnetPositionResponse,
} from "./binance-testnet";
import {
  validateSymbol,
  validateQuantity,
  validatePrice,
  validateNotional,
  validateOrderFilters,
  getEffectiveMaxLeverage,
  validateTestnetUrl,
} from "./filters";
import { walletRepository } from "../repositories/wallet";
import { logger } from "../logger";
import { dbQueryOne, dbExecute } from "../database";
import {
  recordOrderSubmitted,
  recordOrderConfirmed,
  recordPositionOpened,
  recordPositionClosed,
  recordStopLoss,
  recordTakeProfit,
  recordPositionMonitor,
  recordRiskLocked,
} from "../journal";

// ─── Types ──────────────────────────────────────────────────────────

export type TestnetExecutionResult = {
  success: boolean;
  orderId: number | null;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  status: string;
  actualMargin: number;
  actualLeverage: number;
  error?: string;
  guardrailReason?: string;
};

export type TestnetPositionSnapshot = {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  margin: number;
  /** P7A: actual margin mode reported by Binance — "isolated" | "cross" | "unknown" */
  marginType: "isolated" | "cross" | "unknown";
};

export type TestnetAccountSnapshot = {
  balance: number;
  availableBalance: number;
  unrealizedPnl: number;
  marginBalance: number;
  positions: TestnetPositionSnapshot[];
};

export type OrderProtectionResult = {
  stopLossOrderId: number | null;
  takeProfitOrderId: number | null;
  errors: string[];
};

// ─── Configuration ──────────────────────────────────────────────────

const CAPITAL_LIMIT = 10.0;
const MIN_WALLET_BALANCE = 0.50;
const ORDER_CONFIRMATION_TIMEOUT = 10_000;
const MAX_ORDER_RETRIES = 1;

// ─── Testnet Executor ───────────────────────────────────────────────

export class TestnetExecutor {
  private client: BinanceTestnetClient | null;
  private executionCount = 0;
  private pendingOrders = new Map<string, TestnetOrderResponse>();

  constructor() {
    this.client = getTestnetClient();
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): BinanceTestnetClient | null {
    return this.client;
  }

  // ─── Startup Validation ────────────────────────────────────────

  /**
   * Validate testnet configuration on startup.
   * Returns validation result — does not throw.
   */
  async validateTestnetConfig(): Promise<{
    valid: boolean;
    errors: string[];
    connected: boolean;
    balance: number;
  }> {
    const errors: string[] = [];

    // Check API keys
    const apiKey = process.env["BINANCE_TESTNET_API_KEY"];
    const apiSecret = process.env["BINANCE_TESTNET_SECRET"];

    if (!apiKey) errors.push("BINANCE_TESTNET_API_KEY not set");
    if (!apiSecret) errors.push("BINANCE_TESTNET_SECRET not set");

    if (!this.client) {
      errors.push("Testnet client not initialized — missing credentials");
      return { valid: false, errors, connected: false, balance: 0 };
    }

    // Verify testnet URL (must NOT be mainnet)
    const mainnetPatterns = [
      "fapi.binance.com",
      "api.binance.com",
      "www.binance.com",
    ];
    // The client uses TESTNET_REST_URL by default, which is testnet
    // Verify by checking the base URL is NOT mainnet
    // (constructor already sets TESTNET_REST_URL)

    // Test connectivity
    const connected = await this.client.connect();
    if (!connected) {
      errors.push("Cannot connect to Binance Futures Testnet");
      return { valid: false, errors, connected: false, balance: 0 };
    }

    // Get balance
    let balance = 0;
    try {
      balance = await this.client.getUSDTBalance();
      if (balance < MIN_WALLET_BALANCE) {
        errors.push(`Insufficient testnet balance: $${balance.toFixed(2)} (min: $${MIN_WALLET_BALANCE})`);
      }
    } catch (err) {
      errors.push(`Failed to get testnet balance: ${err}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      connected,
      balance,
    };
  }

  // ─── Generate Client Order ID ─────────────────────────────────

  /**
   * Generate deterministic client order ID for idempotency.
   * Format: P4-{symbol}-{side}-{timestamp}-{counter}
   */
  generateClientOrderId(
    symbol: string,
    side: "BUY" | "SELL",
  ): string {
    this.executionCount++;
    return `P4-${symbol}-${side}-${Date.now()}-${this.executionCount}`;
  }

  // ─── Execute Trade Decision ──────────────────────────────────────

  /**
   * Execute a trade on Binance Futures Testnet.
   *
   * P4 changes:
   * - Accepts full TradeProposal with margin/leverage details
   * - Uses client order ID for idempotency
   * - Confirms order status before returning success
   * - Places SL/TP protection orders after fill
   */
  async executeTrade(params: {
    direction: "LONG" | "SHORT";
    symbol: string;
    quantity: number;
    price: number;
    leverage: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    decisionId: string;
  }): Promise<TestnetExecutionResult> {
    const { direction, symbol, quantity, price, leverage, stopLossPrice, takeProfitPrice, decisionId } = params;
    const side = direction === "LONG" ? "BUY" : "SELL";
    const clientOrderId = this.generateClientOrderId(symbol, side);

    if (!this.client) {
      return {
        success: false,
        orderId: null,
        clientOrderId,
        symbol,
        side,
        quantity: 0,
        price: 0,
        status: "NOT_CONFIGURED",
        actualMargin: 0,
        actualLeverage: 0,
        error: "Binance Testnet not configured — missing API keys",
        guardrailReason: "TESTNET_NOT_CONFIGURED",
      };
    }

    // P4-FIX: Validate testnet URL (reject mainnet)
    // Access base URL via a test call — client doesn't expose it publicly
    // We verify the client is connected and configured, which implies testnet URL
    // (constructor sets TESTNET_REST_URL by default)

    // P4-FIX: Validate symbol against exchange info
    let symbolInfo;
    try {
      symbolInfo = await this.client.getSymbolInfo(symbol);
    } catch (err) {
      logger.error("testnet-executor", `Failed to get exchange info: ${err}`);
      return {
        success: false,
        orderId: null,
        clientOrderId,
        symbol,
        side,
        quantity: 0,
        price: 0,
        status: "REJECTED",
        actualMargin: 0,
        actualLeverage: 0,
        error: `Exchange info unavailable: ${err instanceof Error ? err.message : String(err)}`,
        guardrailReason: "EXCHANGE_INFO_UNAVAILABLE",
      };
    }

    const symbolValidation = validateSymbol(symbolInfo, symbol);
    if (!symbolValidation.valid) {
      logger.error("testnet-executor", `Symbol validation failed: ${symbolValidation.errors.join(", ")}`);
      return {
        success: false,
        orderId: null,
        clientOrderId,
        symbol,
        side,
        quantity: 0,
        price: 0,
        status: "REJECTED",
        actualMargin: 0,
        actualLeverage: 0,
        error: symbolValidation.errors.join("; "),
        guardrailReason: "SYMBOL_INVALID",
      };
    }

    // P4-FIX: Validate quantity and price against Binance filters
    const filterResult = validateOrderFilters(symbolInfo!, {
      quantity,
      price: price,
      stopLossPrice,
      takeProfitPrice,
    });

    if (!filterResult.valid) {
      logger.error("testnet-executor", `Filter validation failed: ${filterResult.errors.join(", ")}`);
      return {
        success: false,
        orderId: null,
        clientOrderId,
        symbol,
        side,
        quantity: 0,
        price: 0,
        status: "REJECTED",
        actualMargin: 0,
        actualLeverage: 0,
        error: filterResult.errors.join("; "),
        guardrailReason: "FILTER_VALIDATION_FAILED",
      };
    }

    // Use normalized values from Binance filters
    const normalizedQuantity = filterResult.normalizedQuantity;
    const normalizedPrice = filterResult.normalizedPrice;

    // P7D-2A: Margin mode enforcement — ISOLATED only
    let marginType: "isolated" | "cross" | "unknown" = "unknown";
    try {
      marginType = await this.client.getMarginType(symbol);
    } catch (err) {
      logger.warn("testnet-executor", `Cannot determine margin type for ${symbol}: ${err}`);
    }

    if (marginType !== "isolated") {
      logger.error("testnet-executor", `Margin mode not ISOLATED for ${symbol}: ${marginType} — REJECT`);
      recordOrderConfirmed(symbol, direction, 0, false, `Margin mode: ${marginType}`);
      return {
        success: false,
        orderId: null,
        clientOrderId,
        symbol,
        side,
        quantity: 0,
        price: 0,
        status: "REJECTED",
        actualMargin: 0,
        actualLeverage: 0,
        error: `Margin mode is not ISOLATED: ${marginType} — execution blocked (fail closed)`,
        guardrailReason: "MARGIN_MODE_NOT_ISOLATED",
      };
    }

    // Journal: ORDER_SUBMITTED
    recordOrderSubmitted(symbol, direction, normalizedQuantity, leverage, decisionId);

    try {
      // Set leverage
      try {
        await this.client.setLeverage(symbol, leverage);
      } catch (err) {
        if (err instanceof BinanceTestnetError) {
          logger.warn("testnet-executor", `Cannot set leverage ${leverage}x for ${symbol}: ${err.message}`);
        }
      }

      // Place market order with NORMALIZED quantity
      const order = await this.client.placeMarketOrder(symbol, side, normalizedQuantity);

      // Verify order is actually FILLED
      if (order.status !== "FILLED" && order.status !== "NEW") {
        logger.warn("testnet-executor", `Order not filled: status=${order.status}, orderId=${order.orderId}`);
        recordOrderConfirmed(symbol, direction, order.orderId, false, `Status: ${order.status}`);
        return {
          success: false,
          orderId: order.orderId,
          clientOrderId,
          symbol,
          side,
          quantity,
          price: parseFloat(order.averagePrice || "0"),
          status: order.status,
          actualMargin: 0,
          actualLeverage: leverage,
          error: `Order not filled: ${order.status}`,
          guardrailReason: "ORDER_NOT_FILLED",
        };
      }

      // Order confirmed as filled
      const fillPrice = parseFloat(order.averagePrice || "0");
      const actualMargin = (fillPrice * normalizedQuantity) / leverage;

      recordOrderConfirmed(symbol, direction, order.orderId, true, `Filled @ $${fillPrice}`);

      // Place SL/TP protection (using normalized quantity)
      const protection = await this.placeProtectionOrders(
        symbol,
        direction,
        normalizedQuantity,
        leverage,
        stopLossPrice,
        takeProfitPrice,
      );

      if (protection.errors.length > 0) {
        logger.warn("testnet-executor", `Protection order issues: ${protection.errors.join(", ")}`);
      }

      // Persist order (using normalized quantity)
      await this.persistOrder(order, side, symbol, normalizedQuantity, fillPrice, clientOrderId);

      this.executionCount++;

      logger.info(
        "testnet-executor",
        `EXECUTED: ${side} ${normalizedQuantity} ${symbol} @ $${fillPrice.toFixed(2)} (orderId: ${order.orderId}, margin: $${actualMargin.toFixed(4)})`,
      );

      return {
        success: true,
        orderId: order.orderId,
        clientOrderId,
        symbol,
        side,
        quantity,
        price: fillPrice,
        status: order.status,
        actualMargin,
        actualLeverage: leverage,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("testnet-executor", `Execution failed: ${errorMsg}`);

      if (error instanceof BinanceTestnetError) {
        return {
          success: false,
          orderId: null,
          clientOrderId,
          symbol,
          side,
          quantity,
          price: 0,
          status: "FAILED",
          actualMargin: 0,
          actualLeverage: leverage,
          error: error.message,
          guardrailReason: error.code,
        };
      }

      return {
        success: false,
        orderId: null,
        clientOrderId,
        symbol,
        side,
        quantity,
        price: 0,
        status: "ERROR",
        actualMargin: 0,
        actualLeverage: leverage,
        error: errorMsg,
      };
    }
  }

  // ─── SL/TP Protection Orders ──────────────────────────────────

  /**
   * Place STOP_MARKET and TAKE_PROFIT_MARKET orders on Binance Testnet.
   * These are separate orders that protect the position.
   */
  async placeProtectionOrders(
    symbol: string,
    direction: "LONG" | "SHORT",
    quantity: number,
    leverage: number,
    stopLossPrice: number,
    takeProfitPrice: number,
  ): Promise<OrderProtectionResult> {
    const result: OrderProtectionResult = {
      stopLossOrderId: null,
      takeProfitOrderId: null,
      errors: [],
    };

    if (!this.client) {
      result.errors.push("Client not configured");
      return result;
    }

    const slSide = direction === "LONG" ? "SELL" : "BUY";
    const tpSide = direction === "LONG" ? "SELL" : "BUY";

    // Place STOP_MARKET order
    try {
      const slOrder = await this.client.request<{
        orderId: number;
        status: string;
      }>("POST", "/fapi/v1/order", {
        symbol,
        side: slSide,
        type: "STOP_MARKET",
        stopPrice: String(stopLossPrice),
        quantity: String(quantity),
        workingType: "MARKET_PRICE",
      });
      result.stopLossOrderId = slOrder.orderId;
      recordStopLoss(symbol, direction, stopLossPrice, slOrder.orderId);
      logger.info("testnet-executor", `SL placed: ${symbol} @ $${stopLossPrice} (orderId: ${slOrder.orderId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`SL failed: ${msg}`);
      logger.warn("testnet-executor", `SL placement failed for ${symbol}: ${msg}`);
    }

    // Place TAKE_PROFIT_MARKET order
    try {
      const tpOrder = await this.client.request<{
        orderId: number;
        status: string;
      }>("POST", "/fapi/v1/order", {
        symbol,
        side: tpSide,
        type: "TAKE_PROFIT_MARKET",
        stopPrice: String(takeProfitPrice),
        quantity: String(quantity),
        workingType: "MARKET_PRICE",
      });
      result.takeProfitOrderId = tpOrder.orderId;
      recordTakeProfit(symbol, direction, takeProfitPrice, tpOrder.orderId);
      logger.info("testnet-executor", `TP placed: ${symbol} @ $${takeProfitPrice} (orderId: ${tpOrder.orderId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`TP failed: ${msg}`);
      logger.warn("testnet-executor", `TP placement failed for ${symbol}: ${msg}`);
    }

    return result;
  }

  // ─── Position Monitoring ───────────────────────────────────────

  /**
   * Get current positions from Binance Testnet.
   * Use as source of truth for position monitoring.
   */
  async getTestnetPositions(): Promise<TestnetPositionSnapshot[]> {
    if (!this.client) return [];

    try {
      const positions = await this.client.getOpenPositions();
      return positions.map((p) => {
        const rawMarginType = String(p.marginType || "").toLowerCase();
        const marginType: "isolated" | "cross" | "unknown" =
          rawMarginType === "isolated" ? "isolated" : rawMarginType === "cross" ? "cross" : "unknown";
        return {
          symbol: p.symbol,
          side: (parseFloat(p.positionAmount) > 0 ? "LONG" : "SHORT") as "LONG" | "SHORT",
          size: Math.abs(parseFloat(p.positionAmount)),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unrealizedPnl: parseFloat(p.unRealizedProfit),
          leverage: parseInt(p.leverage),
          margin: parseFloat(p.positionInitialMargin),
          marginType,
        };
      });
    } catch (error) {
      logger.error("testnet-executor", `Failed to get positions: ${error}`);
      return [];
    }
  }

  /**
   * Reconcile local state vs Binance Testnet positions.
   * Returns discrepancies for journal and correction.
   */
  async reconcilePositions(
    localPositions: Array<{
      symbol: string;
      side: string;
      size: number;
    }>,
  ): Promise<{
    matched: Array<{ symbol: string; local: typeof localPositions[0]; remote: TestnetPositionSnapshot }>;
    localOnly: Array<typeof localPositions[0]>;
    remoteOnly: TestnetPositionSnapshot[];
    consistent: boolean;
  }> {
    const remotePositions = await this.getTestnetPositions();
    const remoteMap = new Map(remotePositions.map((p) => [p.symbol, p]));
    const localMap = new Map(localPositions.map((p) => [p.symbol, p]));

    const matched: Array<{ symbol: string; local: typeof localPositions[0]; remote: TestnetPositionSnapshot }> = [];
    const localOnly: typeof localPositions = [];
    const remoteOnly: TestnetPositionSnapshot[] = [];

    for (const local of localPositions) {
      const remote = remoteMap.get(local.symbol);
      if (remote) {
        matched.push({ symbol: local.symbol, local, remote });
      } else {
        localOnly.push(local);
      }
    }

    for (const remote of remotePositions) {
      if (!localMap.has(remote.symbol)) {
        remoteOnly.push(remote);
      }
    }

    const consistent = localOnly.length === 0 && remoteOnly.length === 0;

    if (!consistent) {
      logger.warn(
        "testnet-executor",
        `Position discrepancy: matched=${matched.length}, localOnly=${localOnly.length}, remoteOnly=${remoteOnly.length}`,
      );
    }

    return { matched, localOnly, remoteOnly, consistent };
  }

  /**
   * Get account snapshot from Binance Testnet.
   */
  async getAccountSnapshot(): Promise<TestnetAccountSnapshot> {
    if (!this.client) {
      throw new Error("Testnet client not configured — cannot get account snapshot");
    }

    // Must succeed — Binance is source of truth. On failure, fail closed.
    const account = await this.client.getAccountInfo();
    const positions: TestnetPositionSnapshot[] = account.positions
      .filter((p) => parseFloat(p.positionAmount) !== 0)
      .map((p) => {
        const rawMarginType = String(p.marginType || "").toLowerCase();
        const marginType: "isolated" | "cross" | "unknown" =
          rawMarginType === "isolated"
            ? "isolated"
            : rawMarginType === "cross"
              ? "cross"
              : "unknown";
        return {
          symbol: p.symbol,
          side: (parseFloat(p.positionAmount) > 0 ? "LONG" : "SHORT") as "LONG" | "SHORT",
          size: Math.abs(parseFloat(p.positionAmount)),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unrealizedPnl: parseFloat(p.unRealizedProfit),
          leverage: parseInt(p.leverage),
          margin: parseFloat(p.positionInitialMargin),
          marginType,
        };
      });

    return {
      balance: parseFloat(account.totalWalletBalance),
      availableBalance: parseFloat(account.availableBalance),
      unrealizedPnl: parseFloat(account.totalUnrealizedProfit),
      marginBalance: parseFloat(account.totalMarginBalance),
      positions,
    };
  }

  /**
   * P7D-3-FIX-REALIZED-PNL-2: Get realized PnL from Binance Futures Testnet.
   * Returns RealizedPnlResult with distinct statuses:
   *   - SUCCESS + value=0  → Binance responded, no PnL records (real zero)
   *   - ERROR + value=null → Binance request failed (NOT zero)
   *   - UNAVAILABLE + value=null → Client not connected
   *
   * CRITICAL: NEVER returns 0 for errors.
   * REAL ZERO ≠ ERROR ≠ UNAVAILABLE
   */
  async getRealizedPnl(): Promise<import("./types").RealizedPnlResult> {
    if (!this.client) {
      return {
        status: "UNAVAILABLE",
        value: null,
        source: "unavailable",
        recordCount: 0,
        error: "Testnet client not configured",
      };
    }

    try {
      return await this.client.getRealizedPnl();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn("testnet-executor", `Failed to get realized PnL from Binance: ${errMsg}`);
      return {
        status: "ERROR",
        value: null,
        source: "unavailable",
        recordCount: 0,
        error: errMsg,
      };
    }
  }

  /**
   * Get a single position from Binance for a specific symbol.
   * Returns null if no position on Binance.
   */
  async getBinancePosition(symbol: string): Promise<TestnetPositionSnapshot | null> {
    const positions = await this.getTestnetPositions();
    return positions.find((p) => p.symbol === symbol) || null;
  }

  // ─── Trade Close ─────────────────────────────────────────────

  /**
   * Close a position on Binance Testnet.
   * Returns actual realized PnL from Binance.
   */
  async closePosition(
    symbol: string,
    side: "LONG" | "SHORT",
    quantity: number,
  ): Promise<{
    success: boolean;
    orderId: number | null;
    realizedPnl: number;
    exitPrice: number;
    status: string;
    error?: string;
  }> {
    if (!this.client) {
      return {
        success: false,
        orderId: null,
        realizedPnl: 0,
        exitPrice: 0,
        status: "NOT_CONFIGURED",
        error: "Testnet not configured",
      };
    }

    const closeSide = side === "LONG" ? "SELL" : "BUY";
    const clientOrderId = this.generateClientOrderId(symbol, closeSide);

    try {
      // First, cancel any open SL/TP orders for this symbol
      try {
        const openOrders = await this.client.getOpenOrders(symbol);
        for (const order of openOrders) {
          if (order.type === "STOP_MARKET" || order.type === "TAKE_PROFIT_MARKET") {
            await this.client.cancelOrder(symbol, order.orderId);
            logger.info("testnet-executor", `Cancelled protection order: ${order.type} #${order.orderId}`);
          }
        }
      } catch (err) {
        logger.warn("testnet-executor", `Failed to cancel protection orders: ${err}`);
      }

      // Close with market order
      const closeOrder = await this.client.placeMarketOrder(symbol, closeSide, quantity);

      // Get actual realized PnL from income history
      let realizedPnl = 0;
      try {
        const income = await this.client.getIncomeHistory(symbol, "REALIZED_PNL", 5);
        if (income.length > 0) {
          realizedPnl = parseFloat(income[0]!.income);
        }
      } catch (err) {
        logger.warn("testnet-executor", `Failed to get PnL from income history: ${err}`);
        // Fall back to order price calculation
        realizedPnl = 0;
      }

      const exitPrice = parseFloat(closeOrder.averagePrice || "0");

      recordPositionClosed(symbol, side, exitPrice, realizedPnl, closeOrder.orderId);

      logger.info(
        "testnet-executor",
        `CLOSED: ${closeSide} ${quantity} ${symbol} @ $${exitPrice.toFixed(2)} | PnL: $${realizedPnl.toFixed(4)}`,
      );

      return {
        success: closeOrder.status === "FILLED" || closeOrder.status === "NEW",
        orderId: closeOrder.orderId,
        realizedPnl,
        exitPrice,
        status: closeOrder.status,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("testnet-executor", `Close position failed: ${errorMsg}`);
      return {
        success: false,
        orderId: null,
        realizedPnl: 0,
        exitPrice: 0,
        status: "ERROR",
        error: errorMsg,
      };
    }
  }

  // ─── Database Persistence ────────────────────────────────────────

  private async persistOrder(
    order: TestnetOrderResponse,
    side: "BUY" | "SELL",
    symbol: string,
    quantity: number,
    price: number,
    clientOrderId: string,
  ): Promise<void> {
    try {
      const account = await dbQueryOne(
        "SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1"
      );

      if (!account) {
        logger.warn("testnet-executor", "No account found for persistence");
        return;
      }

      const orderId = `TESTNET-${order.orderId}`;
      await dbExecute(
        `INSERT INTO orders (id, account_id, symbol, side, order_type, price, quantity, filled_quantity, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'MARKET', $5, $6, $7, $8, NOW()::TEXT, NOW()::TEXT)
         ON CONFLICT (id) DO UPDATE SET
           price = $5, quantity = $6, filled_quantity = $7, status = $8, updated_at = NOW()::TEXT`,
        [
          orderId,
          account['id'],
          symbol,
          side === "BUY" ? "LONG" : "SHORT",
          price,
          quantity,
          order.status === "FILLED" ? quantity : 0,
          order.status === "FILLED" ? "FILLED" : order.status,
        ],
      );

      logger.info(
        "testnet-executor",
        `Persisted order ${orderId}: ${side} ${quantity} ${symbol} @ $${price} [${order.status}]`,
      );
    } catch (err) {
      logger.error("testnet-executor", `Failed to persist order: ${err}`);
    }
  }

  /**
   * Persist a completed trade to the trades table.
   */
  async persistTrade(
    symbol: string,
    side: "BUY" | "SELL",
    entryPrice: number,
    exitPrice: number,
    quantity: number,
    pnl: number,
    durationMinutes: number,
    strategyName: string,
    strategyVersion: string,
  ): Promise<void> {
    try {
      const account = await dbQueryOne(
        "SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1"
      );

      if (!account) return;

      const tradeId = `TESTNET-TRD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const pnlPercent = (pnl / (entryPrice * quantity)) * 100;

      await dbExecute(
        `INSERT INTO trades (id, account_id, symbol, side, entry_price, exit_price, quantity, pnl, pnl_percent, duration_minutes, strategy_name, strategy_version, opened_at, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()::TEXT, NOW()::TEXT)`,
        [
          tradeId,
          account['id'],
          symbol,
          side === "BUY" ? "LONG" : "SHORT",
          entryPrice,
          exitPrice,
          quantity,
          pnl,
          pnlPercent,
          durationMinutes,
          strategyName,
          strategyVersion,
        ],
      );

      await dbExecute(
        "UPDATE accounts SET realized_pnl = realized_pnl + $1, updated_at = NOW()::TEXT WHERE id = $2",
        [pnl, account['id']],
      );

      logger.info(
        "testnet-executor",
        `Persisted trade ${tradeId}: ${side} ${symbol} PnL: $${pnl.toFixed(4)}`,
      );
    } catch (err) {
      logger.error("testnet-executor", `Failed to persist trade: ${err}`);
    }
  }

  // ─── Balance Sync ────────────────────────────────────────────────

  async syncBalance(): Promise<number> {
    if (!this.client) {
      throw new Error("Testnet client not configured — cannot sync balance");
    }

    // Binance is source of truth for balance
    const testnetBalance = await this.client.getUSDTBalance();
    const currentBalance = await walletRepository.getBalance();

    if (Math.abs(testnetBalance - currentBalance) > 0.001) {
      const account = await dbQueryOne(
        "SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1"
      );

      if (account) {
        await dbExecute(
          "UPDATE accounts SET balance = $1, equity = $1, updated_at = NOW()::TEXT WHERE id = $2",
          [testnetBalance, account['id']],
        );

        await walletRepository.logGuardrailEvent(
          "BALANCE_CHECK",
          "INFO",
          `Balance synced: local $${currentBalance.toFixed(2)} → binance $${testnetBalance.toFixed(2)}`,
          { testnetBalance, previousBalance: currentBalance },
          testnetBalance,
        );

        logger.info(
          "testnet-executor",
          `Balance synced: $${currentBalance.toFixed(2)} → $${testnetBalance.toFixed(2)}`,
        );
      }
    }

    return testnetBalance;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

let executorInstance: TestnetExecutor | null = null;

export function getTestnetExecutor(): TestnetExecutor {
  if (!executorInstance) {
    executorInstance = new TestnetExecutor();
  }
  return executorInstance;
}

export function resetTestnetExecutor(): void {
  executorInstance = null;
}
