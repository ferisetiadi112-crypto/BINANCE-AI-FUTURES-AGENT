import { getDatabase } from "../database";

export type StrategyRecord = {
  id: string;
  name: string;
  version: string;
  state: string;
  allocation_percent: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  total_pnl: number;
  sharpe_ratio: number;
  max_drawdown: number;
  description: string;
  created_at: string;
  updated_at: string;
};

export const strategyRepository = {
  getById(id: string): StrategyRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM strategies WHERE id = ?")
      .get(id) as StrategyRecord | undefined;
  },

  getAll(): StrategyRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM strategies ORDER BY allocation_percent DESC")
      .all() as StrategyRecord[];
  },

  getActive(): StrategyRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM strategies WHERE state = 'ACTIVE' ORDER BY allocation_percent DESC")
      .all() as StrategyRecord[];
  },

  getByState(state: string): StrategyRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM strategies WHERE state = ? ORDER BY allocation_percent DESC")
      .all(state) as StrategyRecord[];
  },

  updateMetrics(id: string, winRate: number, profitFactor: number, totalTrades: number, totalPnl: number): void {
    getDatabase()
      .prepare(`
        UPDATE strategies
        SET win_rate = ?, profit_factor = ?, total_trades = ?, total_pnl = ?, updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(winRate, profitFactor, totalTrades, totalPnl, id);
  },
};
