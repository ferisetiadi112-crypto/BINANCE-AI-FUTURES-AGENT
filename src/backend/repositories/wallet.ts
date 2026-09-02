/**
 * Wallet Repository — BINANCE AI FUTURES AGENT v0.1
 *
 * Manages sandbox wallet balance and transaction history.
 *
 * ARCHITECTURAL BOUNDARY:
 *   - Only the Boss (human user) may call topUp / withdraw.
 *   - The AI trading engine has ZERO permission to modify wallet balance.
 *   - The paper engine reads balance but never writes to wallet_transactions.
 */

import { getDatabase } from "../database";

// ─── Types ───────────────────────────────────────────────────────────

export type WalletTransactionRecord = {
  id: string;
  account_id: string;
  type: "TOP_UP" | "WITHDRAW";
  amount: number;
  balance_before: number;
  balance_after: number;
  note: string;
  initiated_by: string;
  created_at: string;
};

export type GuardrailEventRecord = {
  id: number;
  event_type:
    | "BALANCE_CHECK"
    | "TRADE_BLOCKED"
    | "TRADE_ALLOWED"
    | "INSUFFICIENT_FUNDS"
    | "MARKET_UNSTABLE"
    | "DAILY_LIMIT_REACHED"
    | "WALLET_MODIFIED";
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  message: string;
  details: string;
  balance_snapshot: number | null;
  created_at: string;
};

export type WalletStatus = {
  balance: number;
  initialCapital: number;
  totalTopUp: number;
  totalWithdraw: number;
  netChange: number;
  transactionCount: number;
};

// ─── Wallet Repository ──────────────────────────────────────────────

export const walletRepository = {
  /** Get current wallet balance from the main account */
  getBalance(): number {
    const db = getDatabase();
    const row = db
      .prepare("SELECT balance FROM accounts ORDER BY created_at ASC LIMIT 1")
      .get() as { balance: number } | undefined;
    return row?.balance ?? 0;
  },

  /** Get full wallet status */
  getStatus(): WalletStatus {
    const db = getDatabase();
    const account = db
      .prepare("SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1")
      .get() as { balance: number; equity?: number } | undefined;

    const configRow = db
      .prepare(
        "SELECT value FROM system_config WHERE key = 'initial_capital'",
      )
      .get() as { value: string } | undefined;
    const initialCapital = configRow
      ? parseFloat(configRow.value)
      : 5.0;

    const txns = db
      .prepare(
        "SELECT type, SUM(amount) as total FROM wallet_transactions GROUP BY type",
      )
      .all() as { type: string; total: number }[];

    let totalTopUp = 0;
    let totalWithdraw = 0;
    for (const t of txns) {
      if (t.type === "TOP_UP") totalTopUp = t.total;
      if (t.type === "WITHDRAW") totalWithdraw = t.total;
    }

    const txnCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM wallet_transactions")
        .get() as { c: number }
    ).c;

    const balance = account?.balance ?? 0;

    return {
      balance,
      initialCapital,
      totalTopUp,
      totalWithdraw,
      netChange: totalTopUp - totalWithdraw,
      transactionCount: txnCount,
    };
  },

  /**
   * Top up wallet balance (Boss-only).
   * Returns the new balance after the top-up.
   */
  topUp(amount: number, note = ""): number {
    if (amount <= 0) throw new Error("Top-up amount must be positive");

    const db = getDatabase();
    const account = db
      .prepare("SELECT id, balance FROM accounts ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string; balance: number };

    if (!account) throw new Error("No account found");

    const newBalance = account.balance + amount;

    // Update account balance
    db.prepare(
      "UPDATE accounts SET balance = ?, equity = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(newBalance, newBalance, account.id);

    // Record transaction
    const txnId = `WALLET-TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'TOP_UP', ?, ?, ?, ?, 'boss')`,
    ).run(txnId, account.id, amount, account.balance, newBalance, note);

    return newBalance;
  },

  /**
   * Withdraw from wallet balance (Boss-only).
   * Returns the new balance after the withdrawal.
   */
  withdraw(amount: number, note = ""): number {
    if (amount <= 0) throw new Error("Withdrawal amount must be positive");

    const db = getDatabase();
    const account = db
      .prepare("SELECT id, balance FROM accounts ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string; balance: number };

    if (!account) throw new Error("No account found");
    if (account.balance < amount) {
      throw new Error(
        `Insufficient balance: $${account.balance.toFixed(2)} < $${amount.toFixed(2)}`,
      );
    }

    const newBalance = account.balance - amount;

    db.prepare(
      "UPDATE accounts SET balance = ?, equity = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(newBalance, newBalance, account.id);

    const txnId = `WALLET-TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
       VALUES (?, ?, 'WITHDRAW', ?, ?, ?, ?, 'boss')`,
    ).run(txnId, account.id, amount, account.balance, newBalance, note);

    return newBalance;
  },

  /** Get recent wallet transactions */
  getTransactions(limit = 20): WalletTransactionRecord[] {
    return getDatabase()
      .prepare(
        "SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as WalletTransactionRecord[];
  },

  // ─── Guardrail Events ──────────────────────────────────────────

  /** Log a guardrail event (balance check, trade block, etc.) */
  logGuardrailEvent(
    eventType: GuardrailEventRecord["event_type"],
    severity: GuardrailEventRecord["severity"],
    message: string,
    details: Record<string, unknown> = {},
    balanceSnapshot?: number,
  ): void {
    getDatabase()
      .prepare(
        `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        eventType,
        severity,
        message,
        JSON.stringify(details),
        balanceSnapshot ?? null,
      );
  },

  /** Get recent guardrail events (for audit trail) */
  getGuardrailEvents(limit = 50): GuardrailEventRecord[] {
    return getDatabase()
      .prepare(
        "SELECT * FROM guardrail_events ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as GuardrailEventRecord[];
  },

  /** Get combined audit trail: all significant events */
  getAuditTrail(limit = 50): Array<
    GuardrailEventRecord & { source: "guardrail" | "wallet" }
  > {
    const guardrail = getDatabase()
      .prepare(
        "SELECT * FROM guardrail_events ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as Array<GuardrailEventRecord & { source: string }>;

    const wallet = getDatabase()
      .prepare(
        "SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as Array<WalletTransactionRecord & { source: string }>;

    // Merge and sort by created_at descending
    const merged: Array<
      GuardrailEventRecord & { source: "guardrail" | "wallet" }
    > = [
      ...guardrail.map((g) => ({ ...g, source: "guardrail" as const })),
      ...wallet.map((w) => ({
        id: 0,
        event_type: `WALLET_${w.type}` as GuardrailEventRecord["event_type"],
        severity: "INFO" as const,
        message: `${w.type === "TOP_UP" ? "Top-up" : "Withdrawal"}: $${w.amount.toFixed(2)} (Balance: $${w.balance_before.toFixed(2)} → $${w.balance_after.toFixed(2)})`,
        details: JSON.stringify({ transactionId: w.id, note: w.note }),
        balance_snapshot: w.balance_after,
        created_at: w.created_at,
        source: "wallet" as const,
      })),
    ];

    merged.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return merged.slice(0, limit);
  },
};
