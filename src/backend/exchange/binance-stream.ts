/**
 * Binance Futures WebSocket Stream — READ-ONLY
 *
 * Real-time market data streaming from Binance Futures.
 * No order execution capability.
 *
 * Streams:
 * - Individual symbol ticker: <symbol>@ticker
 * - Kline/candle: <symbol>@kline_<interval>
 * - Mark price: <symbol>@markPrice
 *
 * Features:
 * - Automatic reconnect with backoff
 * - Heartbeat/ping
 * - Stale data detection
 * - Graceful shutdown
 * - Connection state management
 */

import { EventEmitter } from "events";
import { logger } from "../logger";

export type StreamStatus = "CONNECTING" | "ONLINE" | "RECONNECTING" | "OFFLINE";

export type StreamConfig = {
  symbols: string[];
  intervals: string[];
  baseUrl?: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  pingIntervalMs?: number;
  staleThresholdMs?: number;
};

export type TickerMessage = {
  e: "24hrTicker";
  s: string; // symbol
  c: string; // close price
  o: string; // open price
  h: string; // high price
  l: string; // low price
  v: string; // volume
  q: string; // quote volume
  P: string; // price change percent
  p: string; // price change
  E: number; // event time
  T: number; // trade time
};

export type KlineMessage = {
  e: "kline";
  s: string;
  k: {
    t: number; // kline start time
    T: number; // kline close time
    s: string; // symbol
    i: string; // interval
    o: string; // open
    c: string; // close
    h: string; // high
    l: string; // low
    v: string; // volume
    n: number; // number of trades
    x: boolean; // is final (closed)
  };
};

export type StreamMessage = TickerMessage | KlineMessage;

const DEFAULT_CONFIG: Required<StreamConfig> = {
  symbols: ["BTCUSDT"],
  intervals: ["15m"],
  baseUrl: "wss://fstream.binance.com",
  reconnectBaseMs: 1000,
  reconnectMaxMs: 30000,
  pingIntervalMs: 30000,
  staleThresholdMs: 60000,
};

export class BinanceStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<StreamConfig>;
  private status: StreamStatus = "OFFLINE";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageTime = 0;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;

  constructor(config: Partial<StreamConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Connection ──────────────────────────────────────────────────

  connect(): void {
    if (this.status === "ONLINE" || this.status === "CONNECTING") {
      return;
    }

    this.intentionalClose = false;
    this.updateStatus("CONNECTING");

    const streams = this.buildStreamNames();
    const url = `${this.config.baseUrl}/stream?streams=${streams.join("/")}`;

    logger.info("binance-stream", `Connecting to ${streams.length} streams`);

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        logger.info("binance-stream", "WebSocket connected");
        this.updateStatus("ONLINE");
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        this.startPing();
        this.startStaleCheck();
        this.emit("connected");
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        try {
          const data = JSON.parse(String(event.data));
          if (data.data) {
            this.handleMessage(data.data);
          }
        } catch (e) {
          logger.warn("binance-stream", `Failed to parse message: ${e}`);
        }
      };

      this.ws.onerror = (event) => {
        logger.error("binance-stream", `WebSocket error: ${event}`);
        this.emit("error", event);
      };

      this.ws.onclose = (event) => {
        logger.info("binance-stream", `WebSocket closed: code=${event.code} reason=${event.reason}`);
        this.updateStatus("OFFLINE");
        this.stopPing();
        this.stopStaleCheck();
        this.emit("disconnected", event);

        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      logger.error("binance-stream", `Connection failed: ${error}`);
      this.updateStatus("OFFLINE");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopPing();
    this.stopStaleCheck();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.updateStatus("OFFLINE");
    logger.info("binance-stream", "Disconnected intentionally");
  }

  // ─── Stream Names ────────────────────────────────────────────────

  private buildStreamNames(): string[] {
    const streams: string[] = [];

    for (const symbol of this.config.symbols) {
      const lower = symbol.toLowerCase();
      streams.push(`${lower}@ticker`);

      for (const interval of this.config.intervals) {
        streams.push(`${lower}@kline_${interval}`);
      }
    }

    return streams;
  }

  // ─── Message Handling ────────────────────────────────────────────

  private handleMessage(data: StreamMessage): void {
    if (data.e === "24hrTicker") {
      this.emit("ticker", data as TickerMessage);
    } else if (data.e === "kline") {
      this.emit("kline", data as KlineMessage);
    }
  }

  // ─── Reconnect ───────────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectBaseMs * Math.pow(2, this.reconnectAttempts - 1),
      this.config.reconnectMaxMs,
    );

    logger.info("binance-stream", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.updateStatus("RECONNECTING");
    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ─── Ping ────────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          (this.ws as any).ping();
        } catch {
          // ping not supported in all environments
        }
      }
    }, this.config.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ─── Stale Detection ─────────────────────────────────────────────

  private startStaleCheck(): void {
    this.stopStaleCheck();
    this.staleCheckTimer = setInterval(() => {
      if (this.status !== "ONLINE") return;

      const age = Date.now() - this.lastMessageTime;
      if (age > this.config.staleThresholdMs) {
        logger.warn("binance-stream", `Data stale: ${age}ms since last message`);
        this.emit("stale", { age, threshold: this.config.staleThresholdMs });
      }
    }, this.config.staleThresholdMs / 2);
  }

  private stopStaleCheck(): void {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
  }

  // ─── Status ──────────────────────────────────────────────────────

  private updateStatus(status: StreamStatus): void {
    const prev = this.status;
    this.status = status;
    if (prev !== status) {
      this.emit("statusChange", { from: prev, to: status });
    }
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === "ONLINE";
  }

  getLastMessageTime(): number {
    return this.lastMessageTime;
  }

  getDataAge(): number {
    return this.lastMessageTime > 0 ? Date.now() - this.lastMessageTime : Infinity;
  }
}
