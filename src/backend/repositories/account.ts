import { dbQueryOne, dbQuery, dbExecute } from "../database/adapter";

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
  async getById(id: string): Promise<AccountRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM accounts WHERE id = $1", [id]);
    return row as AccountRecord | undefined;
  },

  async getMain(): Promise<AccountRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1");
    return row as AccountRecord | undefined;
  },

  async getAll(): Promise<AccountRecord[]> {
    const rows = await dbQuery("SELECT * FROM accounts ORDER BY created_at");
    return rows as unknown as AccountRecord[];
  },

  async updateBalance(id: string, balance: number, equity: number): Promise<void> {
    await dbExecute(
      "UPDATE accounts SET balance = $1, equity = $2, updated_at = datetime('now') WHERE id = $3",
      [balance, equity, id]
    );
  },
};
