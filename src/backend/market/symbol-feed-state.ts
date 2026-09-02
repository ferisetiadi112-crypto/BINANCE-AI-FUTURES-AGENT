/**
 * Symbol Feed State Manager — BINANCE AI FUTURES AGENT v0.1 (Phase 8C)
 *
 * Manages per-symbol real-time feed state from Binance Futures WebSocket.
 * Wraps BinanceStream (Phase 4) for transport and adds:
 *   - Per-symbol feed state machine (OFFLINE → ONLINE → DEGRADED → STALE)
 *   - Deterministic feed state from actual event timestamps (no Math.random)
 *   - Heartbeat/monitor timer for stale detection
 *   - Aggregate feed state computation
 *   - Clean shutdown with timer cleanup
 *
 * Feed states:
 *   OFFLINE — no events received yet or connection lost
 *   ONLINE  — connection active, events arriving within normal threshold
 *   DEGRADED — connection active but events delayed beyond degraded threshold
 *   STALE   — no events for longer than stale threshold
 *
 * Binance public WebSocket requires NO API key.
 */

import { BinanceStream, type StreamStatus } from "../exchange/binance-stream";
import { getEnabledSymbols, getEnabledSymbolsSync } from "./symbols";
import { logger } from "../logger";
import type { FeedState, SymbolFeedStatus } from "../../types/api";

// ─── Configuration ────────────────────────────────────────────────────

/** Time without events before marking a symbol DEGRADED (ms) */
export const FEED_DEGRADED_THRESHOLD_MS = 90_000; // 90 seconds

/** Time without events before marking a symbol STALE (ms) */
export const FEED_STALE_THRESHOLD_MS = 180_000; // 3 minutes

/** How often the stale monitor checks symbol states (ms) */
const STALE_CHECK_INTERVAL_MS = 15_000; // every 15 seconds

// ─── Types ────────────────────────────────────────────────────────────

/** Kline data point for indicator calculation */
export type KlineDataPoint = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  isFinal: boolean;
};

/** Market snapshot for a single symbol */
export type MarketSnapshot = {
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volume24h: number;
  klines: KlineDataPoint[];
  feedState: FeedState;
  dataAgeMs: number;
  lastEventTimestamp: number;
};

/** Maximum klines to keep per symbol in memory */
const MAX_KLINE_BUFFER = 100;

export type PerSymbolFeedState = {
  symbol: string;
  feedState: FeedState;
  lastEventTimestamp: number; // epoch ms, 0 if no event received
  dataAgeMs: number; // ms since last event, Infinity if never
  lastPrice: number;
  lastKlineTimestamp: number;
  connectionActive: boolean;
  recentKlines: KlineDataPoint[]; // buffered klines for indicator calculation
};

export type FeedAggregateState = {
  overallFeedState: FeedState;
  onlineCount: number;
  degradedCount: number;
  staleCount: number;
  offlineCount: number;
  totalSymbols: number;
};

// ─── Feed Manager ─────────────────────────────────────────────────────

export class FeedManager {
  private stream: BinanceStream;
  private symbolStates: Map<string, PerSymbolFeedState> = new Map();
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor() {
    this.stream = new BinanceStream();

    // Listen for overall connection status changes
    this.stream.on("statusChange", ({ to }: { from: string; to: StreamStatus }) => {
      const isActive = to === "ONLINE" || to === "CONNECTING";
      // Update all symbol connection status
      for (const [symbol, state] of this.symbolStates) {
        if (state.connectionActive !== isActive) {
          this.symbolStates.set(symbol, { ...state, connectionActive: isActive });
        }
      }
      // If connection lost, mark all as OFFLINE
      if (to === "OFFLINE") {
        for (const [symbol, state] of this.symbolStates) {
          if (state.feedState !== "OFFLINE") {
            this.symbolStates.set(symbol, { ...state, feedState: "OFFLINE" });
            logger.warn("feed-manager", `${symbol} → OFFLINE (connection lost)`);
          }
        }
      }
      // If reconnected, re-evaluate states (events will push them to ONLINE)
      if (to === "ONLINE") {
        logger.info("feed-manager", "Connection restored — awaiting events to update symbol states");
      }
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  /**
   * Start the feed: connect WebSocket and begin stale monitoring.
   * Safe to call multiple times — only starts once.
   */
  start(): void {
    if (this.started) return;

    // Use cached sync version since start() is called from constructor
    const symbols = getEnabledSymbolsSync();
    if (symbols.length === 0) {
      logger.warn("feed-manager", "No enabled symbols — feed not started");
      return;
    }

    // Initialize all symbols to OFFLINE
    for (const s of symbols) {
      this.symbolStates.set(s.symbol, {
        symbol: s.symbol,
        feedState: "OFFLINE",
        lastEventTimestamp: 0,
        dataAgeMs: Infinity,
        lastPrice: 0,
        lastKlineTimestamp: 0,
        connectionActive: false,
        recentKlines: [],
      });
    }

    // Update stream config with current symbol universe
    this.stream = new BinanceStream({
      symbols: symbols.map((s) => s.symbol),
      intervals: [...new Set(symbols.flatMap((s) => s.intervals))],
    });

    // Re-attach listeners after replacing stream
    this.stream.on("statusChange", ({ to }: { from: string; to: StreamStatus }) => {
      const isActive = to === "ONLINE" || to === "CONNECTING";
      for (const [symbol, state] of this.symbolStates) {
        if (state.connectionActive !== isActive) {
          this.symbolStates.set(symbol, { ...state, connectionActive: isActive });
        }
      }
      if (to === "OFFLINE") {
        for (const [symbol, state] of this.symbolStates) {
          if (state.feedState !== "OFFLINE") {
            this.symbolStates.set(symbol, { ...state, feedState: "OFFLINE" });
            logger.warn("feed-manager", `${symbol} → OFFLINE (connection lost)`);
          }
        }
      }
      if (to === "ONLINE") {
        logger.info("feed-manager", "Connection restored — awaiting events to update symbol states");
      }
    });

    // Listen for kline events
    this.stream.on("kline", (msg: any) => {
      this.handleKlineEvent(msg);
    });

    // Listen for ticker events (price updates)
    this.stream.on("ticker", (msg: any) => {
      this.handleTickerEvent(msg);
    });

    // Connect
    logger.info("feed-manager", `Starting feed for ${symbols.length} symbols`);
    this.stream.connect();
    this.started = true;

    // Start stale detection monitor
    this.startStaleMonitor();
  }

  /**
   * Stop the feed: disconnect WebSocket, clear all timers.
   */
  stop(): void {
    this.stopStaleMonitor();
    try {
      this.stream.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }
    this.started = false;

    // Reset all states
    for (const [symbol, state] of this.symbolStates) {
      this.symbolStates.set(symbol, {
        ...state,
        feedState: "OFFLINE",
        connectionActive: false,
        lastEventTimestamp: 0,
        dataAgeMs: Infinity,
        recentKlines: [],
      });
    }

    logger.info("feed-manager", "Feed stopped — all timers cleaned");
  }

  // ─── Event Handling ───────────────────────────────────────────────

  /**
   * Process incoming kline event from WebSocket.
   * Validates event, updates per-symbol state.
   */
  handleKlineEvent(msg: any): void {
    const symbol = msg?.s;
    const kline = msg?.k;
    if (!symbol || !kline) return;

    const timestamp = msg.E || Date.now();
    const price = parseFloat(kline.c);
    const klineTimestamp = kline.t || kline.T || timestamp;

    if (!this.validateEvent(symbol, timestamp, price)) return;

    const prev = this.symbolStates.get(symbol);
    if (!prev) return; // Unknown symbol — ignore

    const now = Date.now();

    // Store kline in buffer for indicator calculation
    const klineData: KlineDataPoint = {
      openTime: kline.t || timestamp,
      open: parseFloat(kline.o),
      high: parseFloat(kline.h),
      low: parseFloat(kline.l),
      close: price,
      volume: parseFloat(kline.v),
      closeTime: kline.T || timestamp + 60000,
      isFinal: !!kline.x,
    };

    // Update or append kline (replace if same openTime, otherwise append)
    const klines = [...prev.recentKlines];
    const existingIdx = klines.findIndex((k) => k.openTime === klineData.openTime);
    if (existingIdx >= 0) {
      klines[existingIdx] = klineData;
    } else {
      klines.push(klineData);
    }
    // Cap buffer size
    while (klines.length > MAX_KLINE_BUFFER) {
      klines.shift();
    }

    const newState: PerSymbolFeedState = {
      ...prev,
      lastEventTimestamp: timestamp,
      dataAgeMs: now - timestamp,
      lastPrice: price,
      lastKlineTimestamp: klineTimestamp,
      connectionActive: true,
      feedState: "ONLINE", // Any valid event → ONLINE
      recentKlines: klines,
    };

    this.symbolStates.set(symbol, newState);

    if (prev.feedState !== "ONLINE") {
      logger.info("feed-manager", `${symbol} → ONLINE (kline event, price=${price})`);
    }
  }

  /**
   * Process incoming ticker event from WebSocket.
   * Updates price and timestamp but not kline-specific fields.
   */
  handleTickerEvent(msg: any): void {
    const symbol = msg?.s;
    const price = parseFloat(msg?.c);
    const timestamp = msg?.E || Date.now();

    if (!symbol || !this.validateEvent(symbol, timestamp, price)) return;

    const prev = this.symbolStates.get(symbol);
    if (!prev) return;

    const now = Date.now();
    const newState: PerSymbolFeedState = {
      ...prev,
      lastEventTimestamp: timestamp,
      dataAgeMs: now - timestamp,
      lastPrice: price,
      connectionActive: true,
      feedState: "ONLINE", // Any valid event → ONLINE
    };

    this.symbolStates.set(symbol, newState);

    if (prev.feedState !== "ONLINE") {
      logger.info("feed-manager", `${symbol} → ONLINE (ticker event, price=${price})`);
    }
  }

  // ─── Validation ───────────────────────────────────────────────────

  /**
   * Validate a WebSocket event before updating state.
   * Returns true if the event is valid and should be used.
   */
  validateEvent(symbol: string, timestamp: number, price: number): boolean {
    // Symbol must be in our tracking set
    if (!this.symbolStates.has(symbol)) {
      logger.debug("feed-manager", `Ignoring event for unknown symbol: ${symbol}`);
      return false;
    }

    // Timestamp must be valid positive number
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
      logger.warn("feed-manager", `Invalid timestamp for ${symbol}: ${timestamp}`);
      return false;
    }

    // Price must be valid positive number
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      logger.warn("feed-manager", `Invalid price for ${symbol}: ${price}`);
      return false;
    }

    // Event must not be from the future (with 5s tolerance)
    if (timestamp > Date.now() + 5000) {
      logger.warn("feed-manager", `Future timestamp for ${symbol}: ${timestamp}`);
      return false;
    }

    // Event must not be older than current last event (no backward time travel)
    const prev = this.symbolStates.get(symbol);
    if (prev && prev.lastEventTimestamp > 0 && timestamp < prev.lastEventTimestamp) {
      logger.debug("feed-manager", `Out-of-order event for ${symbol}: ${timestamp} < ${prev.lastEventTimestamp}`);
      return false;
    }

    return true;
  }

  // ─── Stale Detection ─────────────────────────────────────────────

  /**
   * Start the periodic stale detection monitor.
   * Checks all symbols at STALE_CHECK_INTERVAL_MS intervals.
   */
  private startStaleMonitor(): void {
    this.stopStaleMonitor();
    this.staleTimer = setInterval(() => {
      this.checkStaleness();
    }, STALE_CHECK_INTERVAL_MS);
  }

  private stopStaleMonitor(): void {
    if (this.staleTimer !== null) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  /**
   * Check all symbols for staleness.
   * Transitions: ONLINE → DEGRADED → STALE based on elapsed time.
   * This runs on a timer, not just when events arrive.
   */
  checkStaleness(): void {
    if (!this.stream.isConnected()) return;

    const now = Date.now();
    let changed = false;

    for (const [symbol, state] of this.symbolStates) {
      if (state.lastEventTimestamp === 0) continue; // Never received event
      if (state.feedState === "OFFLINE") continue; // Connection issue, not staleness

      const age = now - state.lastEventTimestamp;
      let newFeedState: FeedState = state.feedState;

      if (age > FEED_STALE_THRESHOLD_MS) {
        newFeedState = "STALE";
      } else if (age > FEED_DEGRADED_THRESHOLD_MS) {
        newFeedState = "DEGRADED";
      }

      if (newFeedState !== state.feedState) {
        this.symbolStates.set(symbol, {
          ...state,
          feedState: newFeedState,
          dataAgeMs: age,
        });
        logger.warn("feed-manager", `${symbol} → ${newFeedState} (age=${Math.round(age)}ms)`);
        changed = true;
      } else {
        // Update dataAgeMs even if state didn't change
        this.symbolStates.set(symbol, { ...state, dataAgeMs: age });
      }
    }

    if (changed) {
      // Emit aggregate state change
      const agg = this.computeAggregateState();
      logger.debug("feed-manager", `Aggregate: ${agg.overallFeedState} (${agg.onlineCount}/${agg.totalSymbols} online)`);
    }
  }

  // ─── State Accessors ─────────────────────────────────────────────

  /** Get feed state for a specific symbol */
  getSymbolFeedState(symbol: string): PerSymbolFeedState | undefined {
    return this.symbolStates.get(symbol);
  }

  /** Get buffered klines for a specific symbol */
  getKlinesForSymbol(symbol: string): KlineDataPoint[] {
    return this.symbolStates.get(symbol)?.recentKlines || [];
  }

  /**
   * Get market snapshot for a symbol.
   * Returns snapshot with current price, klines, and feed state.
   * Returns null if symbol has no data.
   */
  getMarketSnapshot(symbol: string): MarketSnapshot | null {
    const state = this.symbolStates.get(symbol);
    if (!state) return null;

    return {
      symbol: state.symbol,
      price: state.lastPrice,
      priceChange24h: 0, // Not available from kline stream alone
      priceChangePercent24h: 0, // Not available from kline stream alone
      volume24h: 0, // Accumulated from klines if needed
      klines: state.recentKlines,
      feedState: state.feedState,
      dataAgeMs: state.dataAgeMs,
      lastEventTimestamp: state.lastEventTimestamp,
    };
  }

  /** Get feed states for all tracked symbols */
  getAllSymbolFeedStates(): PerSymbolFeedState[] {
    return Array.from(this.symbolStates.values());
  }

  /**
   * Compute aggregate feed state from all symbols.
   *
   * Rules:
   *   ONLINE  — at least one symbol ONLINE, none STALE or OFFLINE
   *   DEGRADED — at least one symbol DEGRADED (but none STALE)
   *   STALE   — at least one symbol STALE
   *   OFFLINE — all symbols OFFLINE
   */
  computeAggregateState(): FeedAggregateState {
    const states = Array.from(this.symbolStates.values());
    const total = states.length;

    let onlineCount = 0;
    let degradedCount = 0;
    let staleCount = 0;
    let offlineCount = 0;

    for (const s of states) {
      switch (s.feedState) {
        case "ONLINE": onlineCount++; break;
        case "DEGRADED": degradedCount++; break;
        case "STALE": staleCount++; break;
        case "OFFLINE": offlineCount++; break;
      }
    }

    let overall: FeedState;
    if (total === 0 || offlineCount === total) {
      overall = "OFFLINE";
    } else if (staleCount > 0) {
      overall = "STALE";
    } else if (degradedCount > 0) {
      overall = "DEGRADED";
    } else {
      overall = "ONLINE";
    }

    return {
      overallFeedState: overall,
      onlineCount,
      degradedCount,
      staleCount,
      offlineCount,
      totalSymbols: total,
    };
  }

  /**
   * Get SymbolFeedStatus array for API consumption.
   * Converts internal state to the API-facing type.
   */
  getFeedStatusesForApi(): SymbolFeedStatus[] {
    return Array.from(this.symbolStates.values()).map((s) => ({
      symbol: s.symbol,
      feedState: s.feedState,
      lastUpdate: s.lastEventTimestamp,
      dataAgeMs: s.dataAgeMs === Infinity ? Infinity : s.dataAgeMs,
      candleCount: s.recentKlines.length,
      trend: s.lastPrice > 0 ? "LIVE" : "N/A",
      price: s.lastPrice,
      change24h: 0,
    }));
  }

  /** Get the underlying stream status */
  getStreamStatus(): StreamStatus {
    return this.stream.getStatus();
  }

  /** Whether the WebSocket is connected */
  isConnected(): boolean {
    return this.stream.isConnected();
  }

  /** Whether the feed manager has been started */
  isStarted(): boolean {
    return this.started;
  }

  /** Get number of tracked symbols */
  getSymbolCount(): number {
    return this.symbolStates.size;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────

let _instance: FeedManager | null = null;

export function getFeedManager(): FeedManager {
  if (!_instance) {
    _instance = new FeedManager();
    _instance.start(); // F-1 fix: auto-start WebSocket on first access
  }
  return _instance;
}

export function resetFeedManager(): void {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}

export {
  getEnabledSymbols,
  getEnabledSymbolsSync,
};
