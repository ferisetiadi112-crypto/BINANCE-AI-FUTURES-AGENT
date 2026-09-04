/**
 * UI State Derivation — P7D-5.5
 *
 * Pure, framework-free helpers that turn raw API payloads into explicit
 * per-card UI states:
 *
 *   LOADING   — data is being requested
 *   READY     — data is available and usable
 *   OFFLINE   — backend/exchange is not connected
 *   DEGRADED  — backend available but part of the data is stale/missing
 *   ERROR     — an error occurred that can be shown to the user
 *   EMPTY     — no data exists yet (not an error)
 *
 * Freshness semantics follow P7D-5.3:
 *   FRESH        < 30s
 *   STALE        30–120s
 *   UNAVAILABLE  > 120s or never synced
 *
 * Nothing in this module touches the network or the DOM — it is fully
 * unit-testable and safe to import from client components.
 */

export type UiPhase = "LOADING" | "READY" | "DEGRADED" | "OFFLINE" | "ERROR" | "EMPTY";
export type Freshness = "FRESH" | "STALE" | "UNAVAILABLE";

export const FRESH_AGE_MS = 30_000; // P7D-5.3: < 30s = FRESH
export const STALE_AGE_MS = 120_000; // P7D-5.3: 30–120s = STALE, > 120s = UNAVAILABLE

export const CONNECTING_STATUSES = new Set([
  "CONNECTING",
  "SYNCHRONIZING",
  "RECONNECTING",
]);

export function isConnectingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return CONNECTING_STATUSES.has(status.toUpperCase());
}

/**
 * Classify data age into FRESH / STALE / UNAVAILABLE (P7D-5.3 thresholds).
 * `undefined`/0/null (never synced) is always UNAVAILABLE.
 */
export function freshnessFor(
  updatedAt: number | null | undefined,
  now = Date.now(),
): Freshness {
  if (!updatedAt || updatedAt <= 0) return "UNAVAILABLE";
  const age = now - updatedAt;
  if (age < FRESH_AGE_MS) return "FRESH";
  if (age <= STALE_AGE_MS) return "STALE";
  return "UNAVAILABLE";
}

/**
 * Human label for a timestamp, e.g. "2s ago", "48s ago", "3m 12s ago".
 * Returns "never" for timestamps that do not exist yet.
 */
export function ageLabel(
  updatedAt: number | null | undefined,
  now = Date.now(),
): string {
  if (!updatedAt || updatedAt <= 0) return "never";
  const totalSeconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

// ─── Payload shapes (client-side subsets) ────────────────────────────

// Payload fields are all optional so tests and callers can pass partial
// payloads (null/undefined = unknown, exactly like a missing request).

export type TestnetPayload = {
  configured?: boolean | null;
  connected?: boolean | null;
  paperTrading?: boolean | null;
  connectionStatus?: string | null;
  lastSyncTimestamp?: number | null;
  stale?: boolean | null;
  lastError?: string | null;
  consecutiveFailures?: number | null;
  balance?: number | null;
  availableBalance?: number | null;
  marginBalance?: number | null;
  unrealizedPnl?: number | null;
  positions?: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    leverage: number;
    margin: number;
  }> | null;
};

export type MarketPayload = {
  connectionStatus?: string | null;
  lastUpdateAt?: number | null;
  dataFreshness?: Freshness | null;
  errorCount?: number | null;
  subscribedSymbols?: string[] | null;
  ticks?: Array<{
    symbol: string;
    lastPrice: number;
    bid?: number | null;
    ask?: number | null;
    priceChangePercent24h?: number | null;
    updatedAt?: number | null;
  }> | null;
};

export type RuntimeEventLite = {
  timestamp: number;
  symbol: string;
  decision?: string | null;
  confidence?: number | null;
  strategy?: string | null;
  executionResult?: string | null;
  error?: string | null;
};

export type RuntimePayload = {
  running?: boolean | null;
  stats?: {
    lastTickAt?: number | null;
    startedAt?: number | null;
    totalErrors?: number | null;
    tickCount?: number | null;
    executionMode?: string | null;
  } | null;
  recentEvents?: RuntimeEventLite[] | null;
};

export type RiskPayload = {
  dailyPnl?: number | null;
  sessionPnl?: number | null;
  isLocked?: boolean | null;
  lockReason?: string | null;
  cooldownActive?: boolean | null;
  cooldownEndsAt?: number | null;
  hardCapReached?: boolean | null;
};

// ─── Card models ─────────────────────────────────────────────────────

export type BinanceCard = {
  phase: UiPhase;
  /** Big headline — verbatim connection status (CONNECTED / OFFLINE / …) */
  headline: string;
  /** Contextual status line ("Connecting to Binance Testnet…") */
  statusText: string;
  /** Banner-style line used when the exchange is unreachable */
  banner: string | null;
  freshness: Freshness;
  ageText: string | null;
  mode: string;
  lastError: string | null;
};

export type AccountCard = {
  phase: UiPhase;
  values: {
    balance: number | null;
    availableBalance: number | null;
    marginBalance: number | null;
    unrealizedPnl: number | null;
  };
  freshness: Freshness;
  ageText: string | null;
  message: string | null;
};

export type PositionCard = {
  phase: UiPhase;
  state: "LOADING" | "NO_POSITION" | "LONG" | "SHORT" | "OFFLINE" | "DEGRADED" | "ERROR";
  positions: TestnetPayload["positions"];
  message: string | null;
};

export type MarketCard = {
  phase: UiPhase;
  headline: string;
  statusText: string;
  freshness: Freshness;
  ageText: string | null;
  ticks: MarketPayload["ticks"];
};

export type AiCard = {
  phase: UiPhase;
  headline: string;
  statusText: string;
  activity: string;
  mode: string;
  ageText: string | null;
};

export type RiskCard = {
  phase: UiPhase;
  risk: RiskPayload | null;
  message: string | null;
};

export type DecisionCard = {
  phase: UiPhase;
  event: RuntimeEventLite | null;
  message: string | null;
};

export type FeedCard = {
  phase: UiPhase;
  count: number;
  message: string | null;
};

// ─── Builders ────────────────────────────────────────────────────────

type QueryState = {
  pending: boolean;
  failed: boolean;
};

function freshnessOfTestnet(payload: TestnetPayload | null | undefined, now: number): Freshness {
  // Account state freshness uses the unified-state last successful sync.
  const lastSync = payload?.lastSyncTimestamp ?? null;
  if (payload?.connected && lastSync && lastSync > 0) return freshnessFor(lastSync, now);
  if (lastSync && lastSync > 0) {
    // Was synced before but is not connected right now.
    const age = now - lastSync;
    return age <= STALE_AGE_MS ? "STALE" : "UNAVAILABLE";
  }
  return "UNAVAILABLE";
}

/**
 * Binance connection card — never blocks the shell; every payload maps to
 * an explicit phase with an informational status line.
 */
export function buildBinanceCard(
  q: QueryState,
  payload: TestnetPayload | null | undefined,
  now = Date.now(),
): BinanceCard {
  const mode = payload?.paperTrading === false ? "TESTNET" : payload ? "PAPER" : "—";
  const lastError = payload?.lastError ?? null;
  const freshness = freshnessOfTestnet(payload, now);

  if (!payload) {
    if (q.pending) {
      return {
        phase: "LOADING",
        headline: "CONNECTING",
        statusText: "Connecting to Binance Testnet...",
        banner: null,
        freshness: "UNAVAILABLE",
        ageText: null,
        mode,
        lastError: null,
      };
    }
    return {
      phase: q.failed ? "ERROR" : "EMPTY",
      headline: q.failed ? "STATUS UNAVAILABLE" : "NO DATA",
      statusText: q.failed
        ? "Status service unreachable — Binance state unknown."
        : "Waiting for first status response from the server.",
      banner: "BINANCE FUTURES TESTNET OFFLINE",
      freshness: "UNAVAILABLE",
      ageText: null,
      mode,
      lastError,
    };
  }

  const status = (payload.connectionStatus ?? (payload.connected ? "CONNECTED" : "OFFLINE")).toUpperCase();

  // Connecting-ish states must look intentional, never frozen.
  if (status === "CONNECTING" || status === "SYNCHRONIZING" || status === "RECONNECTING") {
    const text =
      status === "CONNECTING"
        ? "Connecting to Binance Testnet..."
        : status === "RECONNECTING"
          ? "Reconnecting to Binance Testnet..."
          : "Syncing account with Binance Testnet...";
    return {
      phase: "LOADING",
      headline: status,
      statusText: text,
      banner: null,
      freshness,
      ageText: lastSyncText(payload.lastSyncTimestamp, now),
      mode,
      lastError,
    };
  }

  if (status === "CONNECTED") {
    const degraded = freshness === "STALE" || freshness === "UNAVAILABLE";
    return {
      phase: degraded ? "DEGRADED" : "READY",
      headline: "CONNECTED",
      statusText: degraded
        ? "Connected, but account updates are stale — showing last known state."
        : "Live account feed from Binance Futures Testnet.",
      banner: null,
      freshness,
      ageText: lastSyncText(payload.lastSyncTimestamp, now),
      mode,
      lastError,
    };
  }

  if (status === "DEGRADED") {
    return {
      phase: "DEGRADED",
      headline: "DEGRADED",
      statusText: "Binance reachable but data flow degraded — showing last known state.",
      banner: null,
      freshness,
      ageText: lastSyncText(payload.lastSyncTimestamp, now),
      mode,
      lastError,
    };
  }

  // ERROR / OFFLINE / DISCONNECTED — the required "not blocking" offline UX.
  return {
    phase: "OFFLINE",
    headline: status === "ERROR" ? "ERROR" : "OFFLINE",
    statusText:
      status === "ERROR"
        ? "Binance connection failed — dashboard continues in offline mode."
        : "Binance Futures Testnet is not connected.",
    banner: "BINANCE FUTURES TESTNET OFFLINE",
    freshness,
    ageText: lastSyncText(payload.lastSyncTimestamp, now),
    mode,
    lastError,
  };
}

function lastSyncText(lastSync: number | null | undefined, now: number): string | null {
  if (!lastSync || lastSync <= 0) return null;
  return `Last update: ${ageLabel(lastSync, now)}`;
}

function hasUsableAccount(payload: TestnetPayload): boolean {
  return !!payload.lastSyncTimestamp && payload.lastSyncTimestamp > 0;
}

/**
 * Account card — account/position data comes from the unified exchange
 * snapshot (P7D-5.1); a slow/failed Binance never blanks this card.
 */
export function buildAccountCard(
  q: QueryState,
  payload: TestnetPayload | null | undefined,
  now = Date.now(),
): AccountCard {
  const empty: AccountCard = {
    phase: "LOADING",
    values: { balance: null, availableBalance: null, marginBalance: null, unrealizedPnl: null },
    freshness: "UNAVAILABLE",
    ageText: null,
    message: null,
  };

  if (!payload) {
    if (q.pending) return empty;
    return {
      ...empty,
      phase: q.failed ? "ERROR" : "EMPTY",
      message: q.failed
        ? "Account status unreachable — Binance account unavailable."
        : "Waiting for account data.",
    };
  }

  const status = (payload.connectionStatus ?? (payload.connected ? "CONNECTED" : "OFFLINE")).toUpperCase();
  const freshness = freshnessOfTestnet(payload, now);

  if (isConnectingStatus(status)) {
    return {
      ...empty,
      phase: "LOADING",
      freshness,
      ageText: lastSyncText(payload.lastSyncTimestamp, now),
      message:
        status === "SYNCHRONIZING"
          ? "Syncing account from Binance Testnet..."
          : "Connecting to Binance Testnet...",
    };
  }

  // Have real numbers from a previous sync? Then show them (possibly stale).
  if (hasUsableAccount(payload)) {
    const degraded = !payload.connected || freshness === "STALE" || freshness === "UNAVAILABLE";
    const connectedNow = payload.connected && (status === "CONNECTED" || status === "DEGRADED");
    const balance = payload.balance ?? 0;
    const available = payload.availableBalance ?? balance;
    const margin = payload.marginBalance ?? balance;
    const unrealized = payload.unrealizedPnl ?? payload.positions?.reduce((a, p) => a + p.unrealizedPnl, 0) ?? 0;
    return {
      phase: degraded ? "DEGRADED" : "READY",
      values: {
        balance,
        availableBalance: available,
        marginBalance: margin,
        unrealizedPnl: unrealized,
      },
      freshness,
      ageText: lastSyncText(payload.lastSyncTimestamp, now),
      message: connectedNow
        ? null
        : freshness === "STALE"
          ? "Account data is stale — Binance offline since last sync."
          : "Showing last synced account data — Binance Testnet is offline.",
    };
  }

  return {
    ...empty,
    phase: "OFFLINE",
    message: "Waiting for Binance Testnet",
  };
}

/**
 * Active position card. Positions come only from Binance (never from AI).
 */
export function buildPositionCard(
  q: QueryState,
  payload: TestnetPayload | null | undefined,
): PositionCard {
  if (!payload) {
    return {
      phase: q.failed ? "ERROR" : q.pending ? "LOADING" : "EMPTY",
      state: q.failed ? "ERROR" : "LOADING",
      positions: null,
      message: q.failed
        ? "Position data unavailable — Binance status service unreachable."
        : null,
    };
  }

  const status = (payload.connectionStatus ?? (payload.connected ? "CONNECTED" : "OFFLINE")).toUpperCase();
  const positions = payload.positions ?? [];

  if (isConnectingStatus(status)) {
    return {
      phase: "LOADING",
      state: "LOADING",
      positions: positions.length > 0 ? positions : null,
      message:
        status === "SYNCHRONIZING"
          ? "Fetching Binance position data..."
          : "Connecting to Binance Testnet...",
    };
  }

  if (status === "OFFLINE" || status === "DISCONNECTED" || status === "ERROR") {
    return {
      phase: "OFFLINE",
      state: positions.length > 0 ? "DEGRADED" : "OFFLINE",
      positions: positions.length > 0 ? positions : null,
      message: positions.length > 0
        ? "Binance Testnet offline — showing last known positions."
        : "Waiting for Binance Testnet",
    };
  }

  if (status === "DEGRADED" || (payload.stale && positions.length > 0)) {
    return {
      phase: "DEGRADED",
      state: "DEGRADED",
      positions: positions.length > 0 ? positions : null,
      message: positions.length > 0
        ? "Position data stale — showing last known positions."
        : "Position data stale — no recent sync.",
    };
  }

  if (positions.length > 0) {
    const first = positions[0]!;
    return {
      phase: "READY",
      state: first.side === "LONG" ? "LONG" : "SHORT",
      positions,
      message: null,
    };
  }

  return { phase: "EMPTY", state: "NO_POSITION", positions: null, message: null };
}

/**
 * Market data card — mirrors P7D-5.3 market-data-state freshness.
 */
export function buildMarketCard(
  q: QueryState,
  payload: MarketPayload | null | undefined,
  now = Date.now(),
): MarketCard {
  const noData: MarketCard = {
    phase: "OFFLINE",
    headline: "UNAVAILABLE",
    statusText: "Waiting for Binance Testnet",
    freshness: "UNAVAILABLE",
    ageText: null,
    ticks: null,
  };

  if (!payload) {
    if (q.pending) {
      return { ...noData, phase: "LOADING", headline: "CONNECTING", statusText: "Connecting to Binance Testnet..." };
    }
    return {
      ...noData,
      phase: q.failed ? "ERROR" : "EMPTY",
      headline: q.failed ? "ERROR" : "UNAVAILABLE",
      statusText: q.failed
        ? "Market status service unreachable."
        : "Waiting for Binance Testnet",
    };
  }

  const status = (payload.connectionStatus ?? "OFFLINE").toUpperCase();
  const freshness = payload.dataFreshness ?? freshnessFor(payload.lastUpdateAt, now);
  const ticks = (payload.ticks ?? []).filter((t) => t.lastPrice > 0);
  const ageText = payload.lastUpdateAt && payload.lastUpdateAt > 0
    ? `Last update: ${ageLabel(payload.lastUpdateAt, now)}`
    : null;

  if (isConnectingStatus(status)) {
    return {
      phase: "LOADING",
      headline: status,
      statusText:
        status === "RECONNECTING"
          ? "Reconnecting market stream..."
          : "Connecting to Binance Testnet...",
      freshness,
      ageText,
      ticks: ticks.length > 0 ? ticks : null,
    };
  }

  // No usable ticks at all → the required "Waiting for Binance Testnet" UX.
  if (freshness === "UNAVAILABLE" || ticks.length === 0) {
    return {
      phase: freshness === "STALE" ? "DEGRADED" : "OFFLINE",
      headline: freshness === "STALE" ? "STALE" : "UNAVAILABLE",
      statusText: "Waiting for Binance Testnet",
      freshness,
      ageText,
      ticks: ticks.length > 0 ? ticks : null,
    };
  }

  // 30–120s old ticks → explicit STALE state even if the WS is nominally up.
  if (freshness === "STALE") {
    return {
      phase: "DEGRADED",
      headline: "STALE",
      statusText: "Market feed stalled — showing last ticks from Binance Testnet.",
      freshness,
      ageText,
      ticks,
    };
  }

  if (status === "ERROR" || status === "OFFLINE" || status === "DISCONNECTED") {
    return {
      phase: "DEGRADED",
      headline: "DEGRADED",
      statusText: "Feed interrupted — showing last ticks from Binance Testnet.",
      freshness,
      ageText,
      ticks,
    };
  }

  return {
    phase: "READY",
    headline: "CONNECTED",
    statusText: "Live market feed from Binance Futures Testnet.",
    freshness,
    ageText,
    ticks,
  };
}

/**
 * AI engine card — deliberately independent from Binance UI rendering.
 */
export function buildAiCard(
  q: QueryState,
  payload: RuntimePayload | null | undefined,
  now = Date.now(),
): AiCard {
  const events = payload?.recentEvents ?? [];
  const last = events.length > 0 ? events[events.length - 1]! : null;

  const activityOf = (): { activity: string; statusText: string } => {
    if (!last) {
      return { activity: "NO DECISION YET", statusText: "AI engine online — no decision produced yet." };
    }
    if (last.error) {
      return { activity: "CYCLE ERROR", statusText: `Last cycle error: ${last.error}` };
    }
    const result = (last.executionResult ?? "").toUpperCase();
    if (result === "TESTNET_EXECUTED" || result === "PAPER_EXECUTED") {
      return { activity: "TRADING", statusText: `Executed ${last.decision ?? "trade"} on ${last.symbol}.` };
    }
    if (result === "REJECTED") {
      return { activity: "RISK REJECTED", statusText: `Risk engine rejected ${last.decision ?? "signal"} on ${last.symbol}.` };
    }
    if (result === "NO_TRADE") {
      return { activity: "MONITORING", statusText: `No trade on ${last.symbol} — ${last.decision ?? "monitoring"}.` };
    }
    return { activity: "ANALYZING", statusText: `Analyzing ${last.symbol} — last cycle ${ageLabel(last.timestamp, now)}.` };
  };

  const fallback = (phase: UiPhase, headline: string, statusText: string): AiCard => ({
    phase,
    headline,
    statusText,
    activity: "—",
    mode: "—",
    ageText: null,
  });

  if (!payload) {
    if (q.pending) {
      return fallback("LOADING", "INITIALIZING", "Booting AI engine...");
    }
    return fallback(q.failed ? "ERROR" : "EMPTY", "DEGRADED", "AI engine status unavailable.");
  }

  const mode = payload.stats?.executionMode ?? "—";
  const lastTickAt = payload.stats?.lastTickAt ?? null;

  if (!payload.running) {
    return fallback("OFFLINE", "OFFLINE", "AI scheduler not running — no analysis cycles active.");
  }

  const cycleFreshness = lastTickAt ? freshnessFor(lastTickAt, now) : "UNAVAILABLE";
  if (cycleFreshness === "UNAVAILABLE") {
    const noCycleYet = !lastTickAt || lastTickAt <= 0;
    return {
      phase: "DEGRADED",
      headline: "DEGRADED",
      statusText: noCycleYet
        ? "AI engine online — waiting for the first analysis cycle."
        : `No recent AI cycle — last cycle ${ageLabel(lastTickAt, now)}.`,
      activity: noCycleYet ? "WAITING FOR MARKET DATA" : "STALLED",
      mode,
      ageText: lastTickAt ? `Last cycle: ${ageLabel(lastTickAt, now)}` : null,
    };
  }

  if (cycleFreshness === "STALE") {
    const a = activityOf();
    return {
      phase: "DEGRADED",
      headline: "DEGRADED",
      statusText: `AI engine online but cycles are slow — ${a.statusText}`,
      activity: a.activity,
      mode,
      ageText: lastTickAt ? `Last cycle: ${ageLabel(lastTickAt, now)}` : null,
    };
  }

  const a = activityOf();
  return {
    phase: "READY",
    headline: "ONLINE",
    statusText: a.statusText,
    activity: a.activity,
    mode,
    ageText: lastTickAt ? `Last cycle: ${ageLabel(lastTickAt, now)}` : null,
  };
}

/** Last AI decision card — "No decision yet" is a real EMPTY state. */
export function buildDecisionCard(
  q: QueryState,
  payload: RuntimePayload | null | undefined,
): DecisionCard {
  if (!payload) {
    if (q.pending) return { phase: "LOADING", event: null, message: null };
    return { phase: q.failed ? "ERROR" : "EMPTY", event: null, message: q.failed ? "Decision feed unavailable." : null };
  }
  const events = payload.recentEvents ?? [];
  const last = events.length > 0 ? events[events.length - 1]! : null;
  if (!last) return { phase: "EMPTY", event: null, message: null };
  return { phase: "READY", event: last, message: null };
}

/** Risk state card. */
export function buildRiskCard(
  q: QueryState,
  risk: RiskPayload | null | undefined,
): RiskCard {
  if (!risk) {
    if (q.pending) return { phase: "LOADING", risk: null, message: null };
    return {
      phase: q.failed ? "DEGRADED" : "EMPTY",
      risk: null,
      message: q.failed
        ? "Risk engine state unavailable — guardrails remain enforced server-side."
        : "Risk engine has not reported state yet.",
    };
  }
  return { phase: "READY", risk, message: null };
}

/** Journal / reviews feed card. */
export function buildFeedCard(
  q: QueryState,
  count: number | null | undefined,
): FeedCard {
  if (count == null) {
    if (q.pending) return { phase: "LOADING", count: 0, message: null };
    return { phase: q.failed ? "ERROR" : "EMPTY", count: 0, message: q.failed ? "Journal feed unavailable." : null };
  }
  if (count === 0) return { phase: "EMPTY", count: 0, message: null };
  return { phase: "READY", count, message: null };
}
