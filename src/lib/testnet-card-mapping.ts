/**
 * Testnet Card Mapping — Phase 3.5-N
 *
 * Pure, framework-free mapping from the `getTestnetStatus` response to the
 * Command Center Testnet stat cards.
 *
 * Phase 3.5-M proved that on Vercel serverless the in-memory unified
 * snapshot (configured/balance/positions fields) can be empty after a cold
 * start, while the SAME response contains a stateless, authenticated
 * `diagnostics` block (Phase 3.5-E) that reliably reaches Binance TESTNET.
 *
 * Priority: diagnostics first; fall back to the snapshot fields only when
 * diagnostics is absent. When neither source has a value, the mapping
 * returns an explicit unavailable state — NEVER a fabricated $0.00 and
 * never mock data.
 */

export type DiagnosticPosition = {
  readable: boolean | null;
  hasPosition: boolean | null;
  symbol: string | null;
  side: string | null;
  quantity: number | null;
  entryPrice: number | null;
  unrealizedPnl: number | null;
};

export type TestnetDiagnosticsLike = {
  environment?: { apiKeyConfigured?: boolean; secretConfigured?: boolean };
  binance?: { mode?: string; authenticated?: boolean | null };
  account?: { balanceReadable?: boolean | null; balance?: number | null };
  position?: DiagnosticPosition;
  orders?: { readable?: boolean | null; openOrderCount?: number | null };
};

export type SnapshotLike = {
  configured?: boolean;
  connected?: boolean;
  balance?: number | null;
  positions?: Array<{ unrealizedPnl: number }>;
};

export type TestnetPayloadLike = {
  diagnostics?: TestnetDiagnosticsLike | null;
  configured?: boolean;
  connected?: boolean;
  balance?: number | null;
  positions?: Array<{ unrealizedPnl: number }>;
  paperTrading?: boolean;
  realizedPnl?: number | null;
  realizedPnlStatus?: "SUCCESS" | "ERROR" | "UNAVAILABLE";
};

export type TestnetCardData = {
  /** Headline for the Testnet stat: LIVE / CONFIGURED / NOT CONFIGURED / OFFLINE */
  statusLabel: "LIVE" | "CONFIGURED" | "NOT CONFIGURED" | "OFFLINE";
  /** tone for the Stat card */
  statusTone: "gain" | "warn";
  /** Live Binance balance in USDT, or null when unavailable */
  balance: number | null;
  /** True when balance is a confirmed live Binance reading */
  balanceAvailable: boolean;
  /** Number of open positions confirmed by the authoritative source */
  positionCount: number | null;
  /** Primary open position (from diagnostics) for display */
  position: {
    symbol: string;
    side: string;
    quantity: number;
    unrealizedPnl: number;
  } | null;
  /** Unrealized PnL, or null when unavailable */
  unrealizedPnl: number | null;
  /** Open order count from diagnostics, or null when unavailable */
  openOrderCount: number | null;
};

const UNAVAILABLE: TestnetCardData = {
  statusLabel: "NOT CONFIGURED",
  statusTone: "warn",
  balance: null,
  balanceAvailable: false,
  positionCount: null,
  position: null,
  unrealizedPnl: null,
  openOrderCount: null,
};

/**
 * Phase 3.5-Q: robust numeric coercion for live Binance position values.
 *
 * Binance Futures account payloads carry position/PnL values as STRINGS
 * (e.g. positionAmount: "-7.000", unRealizedProfit: "-1.234").
 * parseFloat(undefined/empty) === NaN, and `typeof NaN === "number"`, so a
 * plain typeof guard lets NaN slip through and render as "qty NaN".
 * This helper accepts finite numbers or numeric strings and rejects NaN.
 */
function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the Testnet card data from the getTestnetStatus payload.
 * Diagnostics (stateless, authenticated per-request) wins over the
 * possibly-empty in-memory snapshot.
 */
export function buildTestnetCardData(
  payload: TestnetPayloadLike | null | undefined,
): TestnetCardData {
  const diag = payload?.diagnostics;

  if (!diag) {
    // Diagnostics unavailable — fall back to the snapshot fields, but only
    // for a genuinely connected snapshot; otherwise the safe unavailable state.
    if (payload?.connected) {
      const positions = payload.positions ?? [];
      const unrealized = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
      return {
        statusLabel: "LIVE",
        statusTone: "gain",
        balance: payload.balance ?? null,
        balanceAvailable: typeof payload.balance === "number",
        positionCount: positions.length,
        position: null,
        unrealizedPnl: positions.length > 0 ? unrealized : null,
        openOrderCount: null,
      };
    }
    if (payload?.configured) {
      return { ...UNAVAILABLE, statusLabel: "OFFLINE" };
    }
    return UNAVAILABLE;
  }

  const creds =
    !!diag.environment?.apiKeyConfigured && !!diag.environment?.secretConfigured;
  const authenticated = diag.binance?.authenticated === true;
  const authFailed = diag.binance?.authenticated === false;

  // Authentication/configuration state (priority A).
  // authenticated===false is an explicit failure → safe NOT CONFIGURED state.
  // authenticated===null/undefined means not yet verified → CONFIGURED (warn).
  let statusLabel: TestnetCardData["statusLabel"];
  let statusTone: TestnetCardData["statusTone"];
  if (authenticated) {
    statusLabel = "LIVE";
    statusTone = "gain";
  } else if (authFailed || !creds) {
    return { ...UNAVAILABLE, statusLabel: "NOT CONFIGURED", statusTone: "warn" };
  } else {
    statusLabel = "CONFIGURED";
    statusTone = "warn";
  }

  // Balance (priority B) — only a confirmed live reading
  const balanceAvailable =
    authenticated && diag.account?.balanceReadable === true && typeof diag.account?.balance === "number";
  const balance = balanceAvailable ? diag.account!.balance! : null;

  // Positions (priority C) — diagnostics carries a single position summary.
  // Phase 3.5-Q: quantity is coerced through toFiniteNumber (Binance sends
  // strings; NaN/undefined must never render as "qty NaN").
  const pos = diag.position;
  const positionReadable = authenticated && pos?.readable === true;
  const rawQty = positionReadable ? toFiniteNumber(pos?.quantity) : null;
  // Signed positionAmt: negative = SHORT. Display size is always absolute.
  const quantity = rawQty !== null ? Math.abs(rawQty) : null;
  const position =
    positionReadable && pos?.hasPosition && pos?.symbol && pos?.side && quantity !== null && quantity > 0
      ? {
          symbol: pos.symbol,
          side: pos.side,
          quantity,
          unrealizedPnl: toFiniteNumber(pos.unrealizedPnl) ?? 0,
        }
      : null;
  const positionCount = positionReadable ? (pos!.hasPosition && quantity !== null && quantity > 0 ? 1 : 0) : null;

  // Unrealized PnL (priority E) — only from a confirmed live position.
  // Phase 3.5-Q: a non-finite/missing PnL maps to null ("Waiting for Binance
  // data"), never to a fabricated $0.00.
  const rawUnrealized = position ? toFiniteNumber(pos!.unrealizedPnl) : null;
  const unrealizedPnl = position && rawUnrealized !== null ? rawUnrealized : null;

  // Open orders (priority D)
  const openOrderCount =
    authenticated && diag.orders?.readable === true && typeof diag.orders?.openOrderCount === "number"
      ? diag.orders!.openOrderCount!
      : null;

  return {
    statusLabel,
    statusTone,
    balance,
    balanceAvailable,
    positionCount,
    position,
    unrealizedPnl,
    openOrderCount,
  };
}
