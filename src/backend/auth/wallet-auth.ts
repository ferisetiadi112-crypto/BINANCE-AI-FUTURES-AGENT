/**
 * Wallet Auth Protection — BINANCE AI FUTURES AGENT v0.1
 *
 * Wraps wallet mutation server functions with:
 * - Authentication check (valid session required)
 * - Authorization check (boss role required)
 * - Input validation (amounts, types, NaN/Infinity guards)
 * - Identity derivation (server-side, never trust client)
 * - Security logging for all auth/authz events
 *
 * Usage:
 *   export const topUpWallet = createServerFn({ method: "POST" })
 *     .validator((input: { amount: number; note?: string }) => input)
 *     .handler(async ({ data }) => {
 *       return withWalletAuth(request, data, async (ctx, validated) => {
 *         // ctx.userId and ctx.role are derived from the session
 *         // validated.amount is guaranteed to be a safe number
 *         return walletRepository.topUp(validated.amount, validated.note || "");
 *       });
 *     });
 */

import {
  requireBoss,
  createSessionContext,
  AuthError,
  type SessionContext,
} from "./index";
import { walletRepository } from "../repositories/wallet";
import { logger } from "../logger";

// ─── Types ───────────────────────────────────────────────────────────

export type WalletAuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 401 | 403 | 400; error: string };

export type ValidatedTopUp = {
  amount: number;
  note?: string;
};

export type ValidatedWithdraw = {
  amount: number;
  note?: string;
};

// ─── Input Validation ────────────────────────────────────────────────

function validateAmount(value: unknown, fieldName: string): number {
  if (value === null || value === undefined) {
    throw new AuthError(400, `${fieldName} is required`);
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    throw new AuthError(400, `${fieldName} must be a finite number`);
  }

  if (Number.isNaN(num)) {
    throw new AuthError(400, `${fieldName} is not a valid number`);
  }

  if (num <= 0) {
    throw new AuthError(400, `${fieldName} must be positive`);
  }

  if (num > 1_000_000) {
    throw new AuthError(400, `${fieldName} exceeds maximum allowed value`);
  }

  // Reject floating-point precision issues
  const rounded = Math.round(num * 100) / 100;
  if (Math.abs(rounded - num) > 0.0001) {
    throw new AuthError(400, `${fieldName} has excessive precision`);
  }

  return rounded;
}

function validateNote(note: unknown): string {
  if (note === null || note === undefined || note === "") {
    return "";
  }

  if (typeof note !== "string") {
    throw new AuthError(400, "Note must be a string");
  }

  if (note.length > 500) {
    throw new AuthError(400, "Note exceeds maximum length of 500 characters");
  }

  return note.trim();
}

// ─── Auth + Validation Wrapper ───────────────────────────────────────

/**
 * Run a wallet mutation with full auth + validation.
 * Extracts session from the request, validates input, derives identity server-side.
 *
 * @param request - The incoming HTTP request (for session extraction)
 * @param input - Raw input from the client
 * @param handler - The actual mutation handler (receives validated data + session context)
 * @returns The handler result, or an error response
 */
export async function withWalletAuth<T>(
  request: Request,
  input: Record<string, unknown>,
  handler: (
    ctx: SessionContext,
    validated: ValidatedTopUp | ValidatedWithdraw,
  ) => Promise<T>,
): Promise<WalletAuthResult<T>> {
  try {
    // 1. Authentication + Authorization (boss role required)
    const ctx = requireBoss(request);

    // 2. Input validation
    const amount = validateAmount(input["amount"], "amount");
    const note = validateNote(input["note"]);

    // 3. Execute handler with server-derived identity
    const data = await handler(ctx, { amount, note });

    return { ok: true, data };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        status: error.statusCode,
        error: error.message,
      };
    }

    logger.error("wallet-auth", `Unexpected error: ${error}`);
    return {
      ok: false,
      status: 400,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Run testnet sync with boss-level authorization.
 * No additional input validation needed — the executor handles its own validation.
 */
export async function withTestnetAuth<T>(
  request: Request,
  handler: (ctx: SessionContext) => Promise<T>,
): Promise<WalletAuthResult<T>> {
  try {
    // Boss role required for testnet sync (it modifies wallet balance)
    const ctx = requireBoss(request);

    const data = await handler(ctx);

    return { ok: true, data };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        status: error.statusCode,
        error: error.message,
      };
    }

    logger.error("wallet-auth", `Unexpected testnet auth error: ${error}`);
    return {
      ok: false,
      status: 400,
      error: "An unexpected error occurred",
    };
  }
}

// ─── Server-Derived Identity for Wallet Operations ───────────────────

/**
 * Perform a top-up with server-derived identity.
 * The initiated_by is ALWAYS set to the authenticated user — never from client input.
 */
export function serverTopUp(
  ctx: SessionContext,
  amount: number,
  note: string,
): number {
  const newBalance = walletRepository.topUp(amount, note);

  // Log with server-derived identity
  walletRepository.logGuardrailEvent(
    "WALLET_MODIFIED",
    "INFO",
    `Top-up: $${amount.toFixed(2)} by ${ctx.userId} — New balance: $${newBalance.toFixed(2)}`,
    { type: "TOP_UP", amount, note, initiatedBy: ctx.userId },
    newBalance,
  );

  logger.info(
    "wallet-auth",
    `Top-up: $${amount.toFixed(2)} by user ${ctx.userId} (role: ${ctx.role})`,
  );

  return newBalance;
}

/**
 * Perform a withdrawal with server-derived identity.
 */
export function serverWithdraw(
  ctx: SessionContext,
  amount: number,
  note: string,
): number {
  const newBalance = walletRepository.withdraw(amount, note);

  // Log with server-derived identity
  walletRepository.logGuardrailEvent(
    "WALLET_MODIFIED",
    "INFO",
    `Withdrawal: $${amount.toFixed(2)} by ${ctx.userId} — New balance: $${newBalance.toFixed(2)}`,
    { type: "WITHDRAW", amount, note, initiatedBy: ctx.userId },
    newBalance,
  );

  logger.info(
    "wallet-auth",
    `Withdrawal: $${amount.toFixed(2)} by user ${ctx.userId} (role: ${ctx.role})`,
  );

  return newBalance;
}
