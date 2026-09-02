import { dbQueryOne, dbQuery, dbExecute } from "../database/adapter";

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
  async getById(id: string): Promise<StrategyRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM strategies WHERE id = $1", [id]);
    return row as StrategyRecord | undefined;
  },

  async getAll(): Promise<StrategyRecord[]> {
    const rows = await dbQuery("SELECT * FROM strategies ORDER BY allocation_percent DESC");
    return rows as unknown as StrategyRecord[];
  },

  async getActive(): Promise<StrategyRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM strategies WHERE state = 'ACTIVE' ORDER BY allocation_percent DESC"
    );
    return rows as unknown as StrategyRecord[];
  },

  async getByState(state: string): Promise<StrategyRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM strategies WHERE state = $1 ORDER BY allocation_percent DESC",
      [state]
    );
    return rows as unknown as StrategyRecord[];
  },

  async updateMetrics(id: string, winRate: number, profitFactor: number, totalTrades: number, totalPnl: number): Promise<void> {
    await dbExecute(
      `UPDATE strategies
       SET win_rate = $1, profit_factor = $2, total_trades = $3, total_pnl = $4, updated_at = datetime('now')
       WHERE id = $5`,
      [winRate, profitFactor, totalTrades, totalPnl, id]
    );
  },
};
