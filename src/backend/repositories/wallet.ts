/**
 * Wallet Repository — BINANCE AI FUTURES AGENT v0.1
 *
 * Manages sandbox wallet balance and transaction history.
 *
 * ARCHITECTURAL BOUNDARY:
 *   - Only the Boss (human user) may call topUp / withdraw.
 *   - The AI trading engine has ZERO permission to modify wallet balance.
 *   - The paper engine reads balance but never writes to wallet_transactions.
 *
 * Migrated to async PostgreSQL adapter for Neon compatibility.
 */

import { dbQueryOne, dbQuery, dbExecute, dbTransaction } from "../database/adapter";

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
  async getBalance(): Promise<number> {
    const row = await dbQueryOne(
      "SELECT balance FROM accounts ORDER BY created_at ASC LIMIT 1"
    );
    return (row?.["balance"] as number) ?? 0;
  },

  /** Get full wallet status */
  async getStatus(): Promise<WalletStatus> {
    const account = await dbQueryOne(
      "SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1"
    ) as { balance: number; equity?: number } | undefined;

    const configRow = await dbQueryOne(
      "SELECT value FROM system_config WHERE key = 'initial_capital'"
    ) as { value: string } | undefined;
    const initialCapital = configRow ? parseFloat(configRow.value) : 5.0;

    const txns = await dbQuery(
      "SELECT type, SUM(amount) as total FROM wallet_transactions GROUP BY type"
    ) as Array<{ type: string; total: number }>;

    let totalTopUp = 0;
    let totalWithdraw = 0;
    for (const t of txns) {
      if (t.type === "TOP_UP") totalTopUp = Number(t.total);
      if (t.type === "WITHDRAW") totalWithdraw = Number(t.total);
    }

    const countResult = await dbQueryOne(
      "SELECT COUNT(*) as c FROM wallet_transactions"
    ) as { c: number } | undefined;

    const balance = account?.balance ?? 0;

    return {
      balance,
      initialCapital,
      totalTopUp,
      totalWithdraw,
      netChange: totalTopUp - totalWithdraw,
      transactionCount: Number(countResult?.c ?? 0),
    };
  },

  /**
   * Top up wallet balance (Boss-only) with transaction.
   * Returns the new balance after the top-up.
   */
  async topUp(amount: number, note = ""): Promise<number> {
    if (amount <= 0) throw new Error("Top-up amount must be positive");

    return await dbTransaction(async () => {
      const account = await dbQueryOne(
        "SELECT id, balance FROM accounts ORDER BY created_at ASC LIMIT 1"
      ) as { id: string; balance: number } | undefined;

      if (!account) throw new Error("No account found");

      const newBalance = account.balance + amount;

      await dbExecute(
        "UPDATE accounts SET balance = $1, equity = $2, updated_at = datetime('now') WHERE id = $3",
        [newBalance, newBalance, account.id]
      );

      const txnId = `WALLET-TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await dbExecute(
        `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
         VALUES ($1, $2, 'TOP_UP', $3, $4, $5, $6, 'boss')`,
        [txnId, account.id, amount, account.balance, newBalance, note]
      );

      return newBalance;
    });
  },

  /**
   * Withdraw from wallet balance (Boss-only) with transaction.
   * Returns the new balance after the withdrawal.
   */
  async withdraw(amount: number, note = ""): Promise<number> {
    if (amount <= 0) throw new Error("Withdrawal amount must be positive");

    return await dbTransaction(async () => {
      const account = await dbQueryOne(
        "SELECT id, balance FROM accounts ORDER BY created_at ASC LIMIT 1"
      ) as { id: string; balance: number } | undefined;

      if (!account) throw new Error("No account found");
      if (account.balance < amount) {
        throw new Error(
          `Insufficient balance: $${account.balance.toFixed(2)} < $${amount.toFixed(2)}`
        );
      }

      const newBalance = account.balance - amount;

      await dbExecute(
        "UPDATE accounts SET balance = $1, equity = $2, updated_at = datetime('now') WHERE id = $3",
        [newBalance, newBalance, account.id]
      );

      const txnId = `WALLET-TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await dbExecute(
        `INSERT INTO wallet_transactions (id, account_id, type, amount, balance_before, balance_after, note, initiated_by)
         VALUES ($1, $2, 'WITHDRAW', $3, $4, $5, $6, 'boss')`,
        [txnId, account.id, amount, account.balance, newBalance, note]
      );

      return newBalance;
    });
  },

  /** Get recent wallet transactions */
  async getTransactions(limit = 20): Promise<WalletTransactionRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return rows as unknown as WalletTransactionRecord[];
  },

  // ─── Guardrail Events ──────────────────────────────────────────

  /** Log a guardrail event */
  async logGuardrailEvent(
    eventType: GuardrailEventRecord["event_type"],
    severity: GuardrailEventRecord["severity"],
    message: string,
    details: Record<string, unknown> = {},
    balanceSnapshot?: number,
  ): Promise<void> {
    await dbExecute(
      `INSERT INTO guardrail_events (event_type, severity, message, details, balance_snapshot)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventType, severity, message, JSON.stringify(details), balanceSnapshot ?? null]
    );
  },

  /** Get recent guardrail events */
  async getGuardrailEvents(limit = 50): Promise<GuardrailEventRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM guardrail_events ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return rows as unknown as GuardrailEventRecord[];
  },

  /** Get combined audit trail: all significant events */
  async getAuditTrail(limit = 50): Promise<Array<
    GuardrailEventRecord & { source: "guardrail" | "wallet" }
  >> {
    const guardrail = await dbQuery(
      "SELECT * FROM guardrail_events ORDER BY created_at DESC LIMIT $1",
      [limit]
    ) as Array<GuardrailEventRecord & { source: string }>;

    const wallet = await dbQuery(
      "SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT $1",
      [limit]
    ) as Array<WalletTransactionRecord & { source: string }>;

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
