import { getDatabase } from "../database";

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
  getById(id: string): TradeRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM trades WHERE id = ?")
      .get(id) as TradeRecord | undefined;
  },

  getRecent(limit = 10): TradeRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM trades ORDER BY closed_at DESC LIMIT ?")
      .all(limit) as TradeRecord[];
  },

  getByAccount(accountId: string, limit = 50): TradeRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM trades WHERE account_id = ? ORDER BY closed_at DESC LIMIT ?")
      .all(accountId, limit) as TradeRecord[];
  },

  getByStrategy(strategyName: string): TradeRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM trades WHERE strategy_name = ? ORDER BY closed_at DESC")
      .all(strategyName) as TradeRecord[];
  },

  getStats(): { totalTrades: number; winRate: number; totalPnl: number } {
    const db = getDatabase();
    const stats = db.prepare(`
      SELECT
        COUNT(*) as totalTrades,
        SUM(CASE WHEN pnl >= 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as winRate,
        SUM(pnl) as totalPnl
      FROM trades
    `).get() as { totalTrades: number; winRate: number; totalPnl: number };
    return {
      totalTrades: stats.totalTrades || 0,
      winRate: Math.round((stats.winRate || 0) * 10) / 10,
      totalPnl: Math.round((stats.totalPnl || 0) * 100) / 100,
    };
  },

  count(): number {
    const result = getDatabase().prepare("SELECT COUNT(*) as count FROM trades").get() as { count: number };
    return result.count;
  },
};
