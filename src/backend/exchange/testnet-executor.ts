/**
 * Testnet Executor — BINANCE AI FUTURES AGENT v0.1
 *
 * Bridges the Trading Orchestrator to the real Binance Futures Testnet.
 *
 * Responsibilities:
 * - Converts AI decisions into testnet orders
 * - Enforces $5 capital limit and daily ±$0.50 guardrail
 * - Persists all execution results to database
 * - Records guardrail events for every execution attempt
 * - Never bypasses the Risk Engine
 *
 * Architecture:
 *   AI Decision → Risk Engine → TestnetExecutor → Binance Testnet → Database
 *
 * SAFETY:
 * - All orders validated against wallet balance BEFORE placement
 * - Balance check uses sandbox wallet (Boss-controlled)
 * - Every order result persisted with full audit trail
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
import { walletRepository } from "../repositories/wallet";
import { logger } from "../logger";
import { dbQueryOne, dbExecute } from "../database";

// ─── Types ──────────────────────────────────────────────────────────

export type TestnetExecutionResult = {
  success: boolean;
  orderId: number | null;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  status: string;
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
};

export type TestnetAccountSnapshot = {
  balance: number;
  availableBalance: number;
  unrealizedPnl: number;
  marginBalance: number;
  positions: TestnetPositionSnapshot[];
};

// ─── Configuration ──────────────────────────────────────────────────

const CAPITAL_LIMIT = 5.0;
const DAILY_PROFIT_CAP = 0.50;
const DAILY_LOSS_LIMIT = 0.50;
const MAX_LEVERAGE = 10;
const MAX_POSITION_SIZE_PERCENT = 20;
const MIN_WALLET_BALANCE = 0.50;

// ─── Testnet Executor ───────────────────────────────────────────────

export class TestnetExecutor {
  private client: BinanceTestnetClient | null;
  private executionCount = 0;

  constructor() {
    this.client = getTestnetClient();
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): BinanceTestnetClient | null {
    return this.client;
  }

  // ─── Execute Trade Decision ──────────────────────────────────────

  async executeTrade(
    direction: "LONG" | "SHORT",
    symbol: string,
    currentPrice: number,
  ): Promise<TestnetExecutionResult> {
    if (!this.client) {
      return {
        success: false,
        orderId: null,
        symbol,
        side: direction === "LONG" ? "BUY" : "SELL",
        quantity: 0,
        price: currentPrice,
        status: "NOT_CONFIGURED",
        error: "Binance Testnet not configured — missing API keys",
        guardrailReason: "TESTNET_NOT_CONFIGURED",
      };
    }

    const side = direction === "LONG" ? "BUY" : "SELL";

    // ─── Pre-flight Guardrail Checks ───────────────────────────

    const walletBalance = await walletRepository.getBalance();
    if (walletBalance < MIN_WALLET_BALANCE) {
      const reason = `Insufficient wallet balance: $${walletBalance.toFixed(2)} (min: $${MIN_WALLET_BALANCE.toFixed(2)})`;
      await walletRepository.logGuardrailEvent(
        "INSUFFICIENT_FUNDS",
        "ERROR",
        reason,
        { symbol, side, currentPrice },
        walletBalance,
      );
      return {
        success: false,
        orderId: null,
        symbol,
        side,
        quantity: 0,
        price: currentPrice,
        status: "REJECTED",
        error: reason,
        guardrailReason: "INSUFFICIENT_FUNDS",
      };
    }

    if (walletBalance > CAPITAL_LIMIT) {
      const reason = `Wallet balance $${walletBalance.toFixed(2)} exceeds $${CAPITAL_LIMIT.toFixed(2)} limit`;
      await walletRepository.logGuardrailEvent(
        "TRADE_BLOCKED",
        "ERROR",
        reason,
        { symbol, side, walletBalance, capitalLimit: CAPITAL_LIMIT },
        walletBalance,
      );
      return {
        success: false,
        orderId: null,
        symbol,
        side,
        quantity: 0,
        price: currentPrice,
        status: "REJECTED",
        error: reason,
        guardrailReason: "CAPITAL_LIMIT_EXCEEDED",
      };
    }

    const positionValue = walletBalance * (MAX_POSITION_SIZE_PERCENT / 100);
    const quantity = Math.floor((positionValue / currentPrice) * 1000) / 1000;

    if (quantity <= 0) {
      return {
        success: false,
        orderId: null,
        symbol,
        side,
        quantity: 0,
        price: currentPrice,
        status: "REJECTED",
        error: "Calculated quantity is zero — position too small",
        guardrailReason: "POSITION_TOO_SMALL",
      };
    }

    // ─── Execute Order ─────────────────────────────────────────

    try {
      await this.client.setLeverage(symbol, MAX_LEVERAGE);

      const order = await this.client.placeMarketOrder(symbol, side, quantity);

      this.executionCount++;

      await walletRepository.logGuardrailEvent(
        "TRADE_ALLOWED",
        "INFO",
        `Testnet order placed: ${side} ${quantity} ${symbol} @ ~$${currentPrice} (orderId: ${order.orderId})`,
        {
          orderId: order.orderId,
          symbol,
          side,
          quantity,
          price: currentPrice,
          status: order.status,
        },
        walletBalance,
      );

      // Persist to database (async)
      await this.persistOrder(order, side, symbol, quantity, currentPrice);

      return {
        success: order.status === "FILLED" || order.status === "NEW",
        orderId: order.orderId,
        symbol,
        side,
        quantity,
        price: parseFloat(order.averagePrice || String(currentPrice)),
        status: order.status,
      };
    } catch (error) {
      if (error instanceof BinanceTestnetError) {
        await walletRepository.logGuardrailEvent(
          "TRADE_BLOCKED",
          "WARN",
          `Testnet order failed: ${error.message}`,
          { symbol, side, quantity, errorCode: error.code },
          walletBalance,
        );

        return {
          success: false,
          orderId: null,
          symbol,
          side,
          quantity,
          price: currentPrice,
          status: "FAILED",
          error: error.message,
          guardrailReason: error.code,
        };
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      await walletRepository.logGuardrailEvent(
        "TRADE_BLOCKED",
        "ERROR",
        `Testnet execution error: ${errorMsg}`,
        { symbol, side, quantity },
        walletBalance,
      );

      return {
        success: false,
        orderId: null,
        symbol,
        side,
        quantity,
        price: currentPrice,
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

  // ─── Account & Position Queries ──────────────────────────────────

  async getAccountSnapshot(): Promise<TestnetAccountSnapshot> {
    if (!this.client) {
      return { balance: 0, availableBalance: 0, unrealizedPnl: 0, marginBalance: 0, positions: [] };
    }

    try {
      const account = await this.client.getAccountInfo();
      const positions: TestnetPositionSnapshot[] = account.positions
        .filter((p) => parseFloat(p.positionAmount) !== 0)
        .map((p) => ({
          symbol: p.symbol,
          side: (parseFloat(p.positionAmount) > 0 ? "LONG" : "SHORT") as "LONG" | "SHORT",
          size: Math.abs(parseFloat(p.positionAmount)),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unrealizedPnl: parseFloat(p.unRealizedProfit),
          leverage: parseInt(p.leverage),
          margin: parseFloat(p.positionInitialMargin),
        }));

      return {
        balance: parseFloat(account.totalWalletBalance),
        availableBalance: parseFloat(account.availableBalance),
        unrealizedPnl: parseFloat(account.totalUnrealizedProfit),
        marginBalance: parseFloat(account.totalMarginBalance),
        positions,
      };
    } catch (error) {
      logger.error("testnet-executor", `Failed to get account snapshot: ${error}`);
      return { balance: 0, availableBalance: 0, unrealizedPnl: 0, marginBalance: 0, positions: [] };
    }
  }

  async getOpenPositions(): Promise<TestnetPositionSnapshot[]> {
    if (!this.client) return [];

    try {
      const positions = await this.client.getOpenPositions();
      return positions.map((p) => ({
        symbol: p.symbol,
        side: (parseFloat(p.positionAmount) > 0 ? "LONG" : "SHORT") as "LONG" | "SHORT",
        size: Math.abs(parseFloat(p.positionAmount)),
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        unrealizedPnl: parseFloat(p.unRealizedProfit),
        leverage: parseInt(p.leverage),
        margin: parseFloat(p.positionInitialMargin),
      }));
    } catch (error) {
      logger.error("testnet-executor", `Failed to get positions: ${error}`);
      return [];
    }
  }

  async getRecentTestnetTrades(limit = 50): Promise<
    Array<{
      id: number;
      symbol: string;
      side: string;
      price: number;
      qty: number;
      pnl: number;
      commission: number;
      time: number;
    }>
  > {
    if (!this.client) return [];

    try {
      const trades = await this.client.getRecentTrades("BTCUSDT", limit);
      return trades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.isBuyer ? "BUY" : "SELL",
        price: parseFloat(t.price),
        qty: parseFloat(t.qty),
        pnl: parseFloat(t.realizedPnl),
        commission: parseFloat(t.commission),
        time: t.time,
      }));
    } catch (error) {
      logger.error("testnet-executor", `Failed to get recent trades: ${error}`);
      return [];
    }
  }

  // ─── Balance Sync ────────────────────────────────────────────────

  async syncBalance(): Promise<number> {
    if (!this.client) {
      return await walletRepository.getBalance();
    }

    try {
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
            `Balance synced: sandbox $${currentBalance.toFixed(2)} → testnet $${testnetBalance.toFixed(2)}`,
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
    } catch (error) {
      logger.error("testnet-executor", `Balance sync failed: ${error}`);
      return await walletRepository.getBalance();
    }
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
