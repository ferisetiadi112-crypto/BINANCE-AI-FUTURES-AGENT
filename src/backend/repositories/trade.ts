import { dbQueryOne, dbQuery } from "../database/adapter";

export type TradeRecord = {
  id: string;
  account_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  pnl_percent: number;
  duration_minutes: number;
  strategy_name: string;
  strategy_version: string;
  opened_at: string;
  closed_at: string;
  created_at: string;
};

export const tradeRepository = {
  async getById(id: string): Promise<TradeRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM trades WHERE id = $1", [id]);
    return row as TradeRecord | undefined;
  },

  async getRecent(limit = 10): Promise<TradeRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM trades ORDER BY closed_at DESC LIMIT $1",
      [limit]
    );
    return rows as unknown as TradeRecord[];
  },

  async getByAccount(accountId: string, limit = 50): Promise<TradeRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM trades WHERE account_id = $1 ORDER BY closed_at DESC LIMIT $2",
      [accountId, limit]
    );
    return rows as unknown as TradeRecord[];
  },

  async getByStrategy(strategyName: string): Promise<TradeRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM trades WHERE strategy_name = $1 ORDER BY closed_at DESC",
      [strategyName]
    );
    return rows as unknown as TradeRecord[];
  },

  async getStats(): Promise<{ totalTrades: number; winRate: number; totalPnl: number }> {
    const stats = await dbQueryOne(`
      SELECT
        COUNT(*) as "totalTrades",
        SUM(CASE WHEN pnl >= 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as "winRate",
        SUM(pnl) as "totalPnl"
      FROM trades
    `) as { totalTrades: number; winRate: number; totalPnl: number } | undefined;

    return {
      totalTrades: Number(stats?.totalTrades || 0),
      winRate: Math.round(Number(stats?.winRate || 0) * 10) / 10,
      totalPnl: Math.round(Number(stats?.totalPnl || 0) * 100) / 100,
    };
  },

  async count(): Promise<number> {
    const result = await dbQueryOne("SELECT COUNT(*) as count FROM trades") as { count: number } | undefined;
    return Number(result?.count ?? 0);
  },
};
