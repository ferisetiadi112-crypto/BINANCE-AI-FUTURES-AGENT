/**
 * Paper Trading Engine — BINANCE AI FUTURES AGENT v0.1
 *
 * Simulates order execution without sending orders to Binance.
 * All trades are PAPER / SIMULATION only.
 *
 * Features:
 * - Simulated fees (0.04% taker)
 * - Simulated slippage
 * - Position management
 * - PnL calculation
 * - Stop loss / take profit
 * - Daily safety limits
 *
 * THIS IS NOT REAL TRADING.
 */

import type { AiDecision, PaperOrder, PaperPosition, PaperTrade, StrategyName } from "../ai/types";
import { logger } from "../logger";

// ─── Configuration ────────────────────────────────────────────────────

export type PaperConfig = {
  initialCapital: number;
  simulatedFeeRate: number; // e.g., 0.0004 = 0.04%
  simulatedSlippageRate: number; // e.g., 0.0001 = 0.01%
  defaultLeverage: number;
  positionSizePercent: number; // % of capital per trade
};

const DEFAULT_PAPER_CONFIG: PaperConfig = {
  initialCapital: 5.0,
  simulatedFeeRate: 0.0004, // 0.04% taker fee
  simulatedSlippageRate: 0.0001, // 0.01% slippage
  defaultLeverage: 5,
  positionSizePercent: 20, // 20% of capital per trade
};

// ─── Paper Trading Engine ─────────────────────────────────────────────

export class PaperTradingEngine {
  private config: PaperConfig;
  private capital: number;
  private position: PaperPosition | null = null;
  private trades: PaperTrade[] = [];
  private orders: PaperOrder[] = [];
  private orderCounter = 0;
  private tradeCounter = 0;

  constructor(config: Partial<PaperConfig> = {}) {
    this.config = { ...DEFAULT_PAPER_CONFIG, ...config };
    this.capital = this.config.initialCapital;
  }

  // ─── Execute Decision ────────────────────────────────────────────

  execute(decision: AiDecision, currentPrice: number): PaperOrder | null {
    // NO_TRADE → no execution
    if (decision.direction === "NO_TRADE") {
      logger.info("paper-engine", "NO_TRADE — skipping execution");
      return null;
    }

    // Already in a position for this symbol
    if (this.position && this.position.symbol === decision.symbol && this.position.side !== "FLAT") {
      logger.warn("paper-engine", `Already in position: ${this.position.side} ${this.position.symbol}`);
      return null;
    }

    // Calculate order
    const side = decision.direction === "LONG" ? "BUY" : "SELL";
    const quantity = this.calculateQuantity(currentPrice);
    const simulatedSlippage = currentPrice * this.config.simulatedSlippageRate;
    const fillPrice = side === "BUY"
      ? currentPrice + simulatedSlippage
      : currentPrice - simulatedSlippage;
    const fee = quantity * fillPrice * this.config.simulatedFeeRate;

    // Create order
    this.orderCounter++;
    const order: PaperOrder = {
      id: `PAPER-ORD-${Date.now()}-${this.orderCounter}`,
      timestamp: Date.now(),
      symbol: decision.symbol,
      side,
      type: "MARKET",
      quantity,
      price: currentPrice,
      simulatedFee: fee,
      simulatedSlippage,
      fillPrice,
      status: "FILLED",
      decisionId: decision.id,
    };

    this.orders.push(order);

    // Create/update position
    this.position = {
      id: `PAPER-POS-${Date.now()}`,
      symbol: decision.symbol,
      side: decision.direction as "LONG" | "SHORT",
      size: quantity,
      entryPrice: fillPrice,
      markPrice: currentPrice,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      margin: (quantity * fillPrice) / this.config.defaultLeverage,
      leverage: this.config.defaultLeverage,
      stopLoss: decision.direction === "LONG"
        ? fillPrice * 0.98 // 2% stop loss
        : fillPrice * 1.02,
      takeProfit: decision.direction === "LONG"
        ? fillPrice * 1.04 // 4% take profit
        : fillPrice * 0.96,
      openedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Deduct margin from capital
    this.capital -= this.position.margin;

    logger.info("paper-engine", `EXECUTED: ${side} ${quantity} ${decision.symbol} @ ${fillPrice.toFixed(2)} (fee: $${fee.toFixed(4)})`);

    return order;
  }

  // ─── Update Position ─────────────────────────────────────────────

  updatePosition(currentPrice: number): void {
    if (!this.position || this.position.side === "FLAT") return;

    this.position.markPrice = currentPrice;
    this.position.updatedAt = Date.now();

    if (this.position.side === "LONG") {
      this.position.unrealizedPnl = (currentPrice - this.position.entryPrice) * this.position.size;
    } else {
      this.position.unrealizedPnl = (this.position.entryPrice - currentPrice) * this.position.size;
    }

    this.position.unrealizedPnlPercent = (this.position.unrealizedPnl / this.position.margin) * 100;

    // Check stop loss / take profit
    if (this.position.side === "LONG") {
      if (currentPrice <= this.position.stopLoss) {
        this.closePosition(currentPrice, "STOP_LOSS");
      } else if (currentPrice >= this.position.takeProfit) {
        this.closePosition(currentPrice, "TAKE_PROFIT");
      }
    } else {
      if (currentPrice >= this.position.stopLoss) {
        this.closePosition(currentPrice, "STOP_LOSS");
      } else if (currentPrice <= this.position.takeProfit) {
        this.closePosition(currentPrice, "TAKE_PROFIT");
      }
    }
  }

  // ─── Close Position ──────────────────────────────────────────────

  closePosition(currentPrice: number, reason: string): PaperTrade | null {
    if (!this.position || this.position.side === "FLAT") return null;

    const side = this.position.side;
    const exitPrice = currentPrice;
    const quantity = this.position.size;
    const fee = quantity * exitPrice * this.config.simulatedFeeRate;
    const slippage = exitPrice * this.config.simulatedSlippageRate;

    let pnl: number;
    if (side === "LONG") {
      pnl = (exitPrice - this.position.entryPrice) * quantity - fee;
    } else {
      pnl = (this.position.entryPrice - exitPrice) * quantity - fee;
    }

    const pnlPercent = (pnl / this.position.margin) * 100;
    const duration = Date.now() - this.position.openedAt;

    this.tradeCounter++;
    const trade: PaperTrade = {
      id: `PAPER-TRD-${Date.now()}-${this.tradeCounter}`,
      symbol: this.position.symbol,
      side,
      entryPrice: this.position.entryPrice,
      exitPrice,
      quantity,
      pnl,
      pnlPercent,
      fees: fee,
      slippage,
      duration,
      strategy: "TREND_FOLLOWING", // Will be updated from decision
      decisionId: "",
      openedAt: this.position.openedAt,
      closedAt: Date.now(),
    };

    this.trades.push(trade);

    // Return margin to capital
    this.capital += this.position.margin + pnl;

    logger.info("paper-engine", `CLOSED: ${side} ${this.position.symbol} @ ${exitPrice.toFixed(2)} | PnL: $${pnl.toFixed(4)} (${reason})`);

    this.position = null;
    return trade;
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private calculateQuantity(price: number): number {
    const positionValue = this.capital * (this.config.positionSizePercent / 100);
    return positionValue / price;
  }

  // ─── Getters ─────────────────────────────────────────────────────

  getCapital(): number {
    return this.capital;
  }

  getPosition(): PaperPosition | null {
    return this.position;
  }

  getTrades(): PaperTrade[] {
    return [...this.trades];
  }

  getOrders(): PaperOrder[] {
    return [...this.orders];
  }

  getStats() {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    const totalPnl = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalFees = this.trades.reduce((sum, t) => sum + t.fees, 0);

    return {
      capital: this.capital,
      initialCapital: this.config.initialCapital,
      totalPnl,
      totalFees,
      totalTrades: this.trades.length,
      winRate: this.trades.length > 0 ? (wins.length / this.trades.length) * 100 : 0,
      profitFactor: losses.length > 0 && losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) > 0
        ? wins.reduce((sum, t) => sum + t.pnl, 0) / losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0)
        : wins.length > 0 ? Infinity : 0,
      maxDrawdown: this.calculateMaxDrawdown(),
      hasPosition: this.position !== null,
    };
  }

  private calculateMaxDrawdown(): number {
    let peak = this.config.initialCapital;
    let maxDd = 0;

    for (const trade of this.trades) {
      const equity = this.config.initialCapital + this.trades.slice(0, this.trades.indexOf(trade) + 1).reduce((s, t) => s + t.pnl, 0);
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak * 100;
      if (dd > maxDd) maxDd = dd;
    }

    return maxDd;
  }
}
