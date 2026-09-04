/**
 * Unified Exchange State — P7D-5.1
 *
 * Single source of truth for all Binance Futures Testnet data
 * consumed by the dashboard and boot screen.
 *
 * Replaces per-request REST calls with a cached, WebSocket-updated state.
 * The dashboard reads from this module instead of making direct Binance API calls.
 *
 * Architecture:
 *   Binance WebSocket (user data stream) ──┐
 *   REST polling (fallback)               ──┤──→ UnifiedExchangeState ──→ Dashboard API
 *   Initial REST snapshot                 ──┘
 *
 * SAFETY:
 * - This module is READ-ONLY for trading — it never places orders
 * - AI signal/analysis never modifies exchange state
 * - Only Binance-confirmed data enters this state
 * - Positions come from Binance REST/WebSocket, never from AI predictions
 */

import { logger } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────

export type ConnectionStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "SYNCHRONIZING"
  | "DEGRADED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "ERROR"
  | "OFFLINE";

export type UnifiedPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  margin: number;
  marginType: "isolated" | "cross" | "unknown";
};

export type UnifiedAccountState = {
  balance: number;
  availableBalance: number;
  marginBalance: number;
  unrealizedPnl: number;
};

export type ExchangeSnapshot = {
  /** Connection status of the Binance WebSocket/REST layer */
  connectionStatus: ConnectionStatus;
  /** Whether Binance Testnet API keys are configured */
  configured: boolean;
  /** Whether we have successfully connected at least once */
  connected: boolean;
  /** Account balance and margin data */
  account: UnifiedAccountState;
  /** Open positions from Binance (empty array = no positions) */
  positions: UnifiedPosition[];
  /** Timestamp of last successful sync from Binance */
  lastSyncTimestamp: number;
  /** Timestamp of last connection attempt */
  lastConnectionAttempt: number;
  /** Error message if last operation failed */
  lastError: string | null;
  /** Total consecutive sync failures since last success */
  consecutiveFailures: number;
  /** Whether the state is stale (no update for > 30s) */
  stale: boolean;
  /** Trading mode */
  executionMode: string;
  /** Whether trading is enabled */
  tradingEnabled: boolean;
  /** WebSocket listen key for user data stream */
  listenKey: string | null;
};

// ─── Constants ──────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30_000; // 30 seconds
const REST_POLL_INTERVAL_MS = 10_000; // 10 seconds
const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;
const LISTEN_KEY_RENEWAL_MS = 50 * 60 * 1000; // 50 minutes (Binance limit is 60 min)

// ─── Singleton State ────────────────────────────────────────────────

let _state: ExchangeSnapshot = {
  connectionStatus: "OFFLINE",
  configured: false,
  connected: false,
  account: {
    balance: 0,
    availableBalance: 0,
    marginBalance: 0,
    unrealizedPnl: 0,
  },
  positions: [],
  lastSyncTimestamp: 0,
  lastConnectionAttempt: 0,
  lastError: null,
  consecutiveFailures: 0,
  stale: true,
  executionMode: "PAPER",
  tradingEnabled: false,
  listenKey: null,
};

let _restPollTimer: ReturnType<typeof setInterval> | null = null;
let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _listenKeyTimer: ReturnType<typeof setInterval> | null = null;
let _ws: WebSocket | null = null;
let _wsReconnectAttempts = 0;
let _intentionalClose = false;
let _initialized = false;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get the current exchange snapshot.
 * This is the primary read method for all consumers.
 */
export function getExchangeSnapshot(): ExchangeSnapshot {
  // Recompute staleness on read
  const now = Date.now();
  const stale = _state.lastSyncTimestamp === 0
    ? _state.connectionStatus !== "OFFLINE"
    : now - _state.lastSyncTimestamp > STALE_THRESHOLD_MS;

  return { ..._state, stale };
}

/**
 * Initialize the unified exchange state.
 * Call once on server startup.
 */
export async function initializeUnifiedState(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const configured = !!(
    process.env["BINANCE_TESTNET_API_KEY"] &&
    process.env["BINANCE_TESTNET_SECRET"]
  );

  _state.configured = configured;
  _state.executionMode = configured ? "TESTNET" : "PAPER";
  _state.tradingEnabled = process.env["TRADING_ENABLED"] === "true";

  if (!configured) {
    _state.connectionStatus = "OFFLINE";
    logger.info("unified-state", "Binance Testnet not configured — staying OFFLINE");
    return;
  }

  // Initial REST snapshot
  _state.connectionStatus = "CONNECTING";
  await performRestSnapshot();

  // Start WebSocket user data stream
  await connectUserDataStream();

  // Start REST polling as fallback
  startRestPoll();

  logger.info("unified-state", `Initialized: status=${_state.connectionStatus}, positions=${_state.positions.length}`);
}

/**
 * Shut down the unified state (for clean server restarts).
 */
export function shutdownUnifiedState(): void {
  _intentionalClose = true;

  if (_ws) {
    _ws.close(1000, "Shutdown");
    _ws = null;
  }
  if (_wsReconnectTimer) {
    clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = null;
  }
  if (_restPollTimer) {
    clearInterval(_restPollTimer);
    _restPollTimer = null;
  }
  if (_listenKeyTimer) {
    clearInterval(_listenKeyTimer);
    _listenKeyTimer = null;
  }

  _state.connectionStatus = "OFFLINE";
  _initialized = false;
}

/**
 * Force a resync from REST (e.g., after reconnect).
 */
export async function forceResync(): Promise<void> {
  if (!_state.configured) return;
  await performRestSnapshot();
}

// ─── REST Snapshot ──────────────────────────────────────────────────

async function performRestSnapshot(): Promise<void> {
  try {
    // Dynamic import to avoid circular dependency at module load time
    const { getTestnetExecutor } = await import("./testnet-executor");
    const executor = getTestnetExecutor();
    const client = executor.getClient();

    if (!client) {
      _state.lastError = "Testnet client not configured";
      _state.consecutiveFailures++;
      return;
    }

    // Test connection if not connected
    if (!client.isConnected()) {
      const connected = await client.connect();
      if (!connected) {
        _state.connectionStatus = "ERROR";
        _state.lastError = "Cannot connect to Binance Futures Testnet";
        _state.consecutiveFailures++;
        return;
      }
    }

    // Fetch account snapshot (positions + balance in one call)
    const snapshot = await executor.getAccountSnapshot();

    // Update state with real Binance data
    _state.account = {
      balance: snapshot.balance,
      availableBalance: snapshot.availableBalance,
      marginBalance: snapshot.marginBalance,
      unrealizedPnl: snapshot.unrealizedPnl,
    };

    _state.positions = snapshot.positions.map((p) => ({
      symbol: p.symbol,
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      unrealizedPnl: p.unrealizedPnl,
      leverage: p.leverage,
      margin: p.margin,
      marginType: p.marginType,
    }));

    _state.connected = true;
    _state.lastSyncTimestamp = Date.now();
    _state.lastError = null;
    _state.consecutiveFailures = 0;

    if (_state.connectionStatus !== "CONNECTED" && _state.connectionStatus !== "SYNCHRONIZING") {
      _state.connectionStatus = "CONNECTED";
    }

    logger.debug(
      "unified-state",
      `REST snapshot: balance=$${snapshot.balance.toFixed(2)}, positions=${snapshot.positions.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _state.lastError = msg;
    _state.consecutiveFailures++;

    if (_state.connected) {
      // Was connected, now degraded
      _state.connectionStatus = "DEGRADED";
      logger.warn("unified-state", `REST snapshot failed (was connected): ${msg}`);
    } else {
      _state.connectionStatus = "ERROR";
      logger.error("unified-state", `REST snapshot failed: ${msg}`);
    }
  }
}

// ─── WebSocket User Data Stream ─────────────────────────────────────

async function connectUserDataStream(): Promise<void> {
  if (!_state.configured || _intentionalClose) return;

  try {
    // Get listen key for user data stream
    const listenKey = await getListenKey();
    if (!listenKey) {
      _state.connectionStatus = "ERROR";
      _state.lastError = "Failed to get listen key";
      return;
    }

    _state.listenKey = listenKey;

    // Connect WebSocket
    const wsUrl = `wss://fstream.binancefuture.com/ws/${listenKey}`;
    logger.info("unified-state", "Connecting WebSocket user data stream...");

    _ws = new WebSocket(wsUrl);

    _ws.onopen = () => {
      logger.info("unified-state", "WebSocket user data stream connected");
      _wsReconnectAttempts = 0;
      if (_state.connectionStatus === "CONNECTING" || _state.connectionStatus === "RECONNECTING") {
        _state.connectionStatus = "CONNECTED";
      }
      // Start listen key renewal
      startListenKeyRenewal();
    };

    _ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        handleUserDataEvent(data);
      } catch {
        // Ignore parse errors
      }
    };

    _ws.onerror = (event) => {
      logger.error("unified-state", `WebSocket error: ${event}`);
    };

    _ws.onclose = (event) => {
      logger.info("unified-state", `WebSocket closed: code=${event.code}`);
      _ws = null;
      stopListenKeyRenewal();

      if (!_intentionalClose) {
        // Mark as disconnected, will reconnect via REST fallback
        if (_state.connected) {
          _state.connectionStatus = "DEGRADED";
        }
        scheduleWsReconnect();
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("unified-state", `WebSocket connection failed: ${msg}`);
    _state.lastError = msg;
    // REST fallback will keep running
  }
}

function handleUserDataEvent(data: Record<string, unknown>): void {
  const eventType = data["e"] as string | undefined;

  if (eventType === "ACCOUNT_UPDATE") {
    handleAccountUpdate(data);
  } else if (eventType === "ORDER_TRADE_UPDATE") {
    handleOrderUpdate(data);
  }
}

function handleAccountUpdate(data: Record<string, unknown>): void {
  const accountData = data["a"] as Record<string, unknown> | undefined;
  if (!accountData) return;

  // Update balances
  const bal = accountData["B"] as Array<Record<string, string>> | undefined;
  if (bal) {
    for (const asset of bal) {
      if (asset["a"] === "USDT") {
        const wb = parseFloat(asset["wb"] ?? "0");
        const cw = parseFloat(asset["cw"] ?? "0");
        if (Number.isFinite(wb)) _state.account.balance = wb;
        if (Number.isFinite(cw)) _state.account.marginBalance = cw;
        break;
      }
    }
  }

  // Update positions
  const pos = accountData["P"] as Array<Record<string, string>> | undefined;
  if (pos) {
    const newPositions: UnifiedPosition[] = [];
    for (const p of pos) {
      const pa = parseFloat(p["pa"] ?? "0");
      if (pa === 0 || !Number.isFinite(pa)) continue; // Skip zero positions

      newPositions.push({
        symbol: p["s"] ?? "",
        side: pa > 0 ? "LONG" : "SHORT",
        size: Math.abs(pa),
        entryPrice: parseFloat(p["ep"] ?? "0"),
        markPrice: parseFloat(p["mp"] ?? "0") || parseFloat(p["ep"] ?? "0"),
        unrealizedPnl: parseFloat(p["up"] ?? "0"),
        leverage: parseInt(p["l"] ?? "5"),
        margin: parseFloat(p["iw"] ?? "0") || Math.abs(parseFloat(p["cw"] ?? "0")),
        marginType: (p["m"] === "1" ? "isolated" : "cross") as "isolated" | "cross",
      });
    }
    _state.positions = newPositions;
    _state.account.unrealizedPnl = newPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  }

  // Recompute available from balance minus margin
  _state.account.availableBalance = Math.max(
    0,
    _state.account.balance - (_state.account.marginBalance - _state.account.balance),
  );

  _state.lastSyncTimestamp = Date.now();
  _state.lastError = null;

  logger.debug(
    "unified-state",
    `ACCOUNT_UPDATE: balance=$${_state.account.balance.toFixed(2)}, positions=${_state.positions.length}`,
  );
}

function handleOrderUpdate(data: Record<string, unknown>): void {
  const orderData = data["o"] as Record<string, unknown> | undefined;
  if (!orderData) return;

  const status = orderData["X"] as string | undefined;
  const symbol = orderData["s"] as string | undefined;

  // On FILLED orders, trigger a REST snapshot to get updated positions
  if (status === "FILLED" && symbol) {
    logger.info("unified-state", `Order FILLED for ${symbol} — triggering REST resync`);
    // Debounced resync — wait 1s for Binance to update
    setTimeout(() => {
      performRestSnapshot().catch(() => {
        // Ignore — REST fallback polling will catch it
      });
    }, 1_000);
  }
}

// ─── Listen Key Management ──────────────────────────────────────────

async function getListenKey(): Promise<string | null> {
  try {
    const apiKey = process.env["BINANCE_TESTNET_API_KEY"];
    if (!apiKey) return null;

    const response = await fetch(
      "https://testnet.binancefuture.com/fapi/v1/listenKey",
      {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      logger.error("unified-state", `Listen key request failed: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { listenKey?: string };
    return data.listenKey ?? null;
  } catch (err) {
    logger.error("unified-state", `Listen key error: ${err}`);
    return null;
  }
}

async function renewListenKey(): Promise<void> {
  try {
    const apiKey = process.env["BINANCE_TESTNET_API_KEY"];
    const listenKey = _state.listenKey;
    if (!apiKey || !listenKey) return;

    const response = await fetch(
      `https://testnet.binancefuture.com/fapi/v1/listenKey?listenKey=${listenKey}`,
      {
        method: "PUT",
        headers: { "X-MBX-APIKEY": apiKey },
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (response.ok) {
      logger.debug("unified-state", "Listen key renewed");
    } else {
      logger.warn("unified-state", `Listen key renewal failed: ${response.status}`);
    }
  } catch (err) {
    logger.warn("unified-state", `Listen key renewal error: ${err}`);
  }
}

function startListenKeyRenewal(): void {
  stopListenKeyRenewal();
  _listenKeyTimer = setInterval(() => {
    renewListenKey().catch(() => {});
  }, LISTEN_KEY_RENEWAL_MS);
}

function stopListenKeyRenewal(): void {
  if (_listenKeyTimer) {
    clearInterval(_listenKeyTimer);
    _listenKeyTimer = null;
  }
}

// ─── WebSocket Reconnect ────────────────────────────────────────────

function scheduleWsReconnect(): void {
  if (_intentionalClose || _wsReconnectTimer) return;

  _wsReconnectAttempts++;
  const delay = Math.min(
    WS_RECONNECT_BASE_MS * Math.pow(2, _wsReconnectAttempts - 1),
    WS_RECONNECT_MAX_MS,
  );

  logger.info("unified-state", `WebSocket reconnect in ${delay}ms (attempt ${_wsReconnectAttempts})`);
  _state.connectionStatus = "RECONNECTING";

  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null;
    connectUserDataStream().catch(() => {});
  }, delay);
}

// ─── REST Polling (Fallback) ────────────────────────────────────────

function startRestPoll(): void {
  stopRestPoll();
  _restPollTimer = setInterval(async () => {
    if (_intentionalClose) return;
    await performRestSnapshot();
  }, REST_POLL_INTERVAL_MS);
}

function stopRestPoll(): void {
  if (_restPollTimer) {
    clearInterval(_restPollTimer);
    _restPollTimer = null;
  }
}
