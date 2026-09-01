import { getDatabase } from "../database";

export type AccountRecord = {
  id: string;
  name: string;
  balance: number;
  equity: number;
  available_margin: number;
  realized_pnl: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export const accountRepository = {
  getById(id: string): AccountRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(id) as AccountRecord | undefined;
  },

  getMain(): AccountRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1")
      .get() as AccountRecord | undefined;
  },

  getAll(): AccountRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM accounts ORDER BY created_at")
      .all() as AccountRecord[];
  },

  updateBalance(id: string, balance: number, equity: number): void {
    getDatabase()
      .prepare("UPDATE accounts SET balance = ?, equity = ?, updated_at = datetime('now') WHERE id = ?")
      .run(balance, equity, id);
  },
};
