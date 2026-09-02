import { dbQueryOne, dbQuery, dbExecute } from "../database/adapter";

export type PositionRecord = {
  id: string;
  account_id: string;
  symbol: string;
  side: string;
  leverage: number;
  size: number;
  entry_price: number;
  mark_price: number;
  liquidation_price: number;
  take_profit_price: number;
  stop_loss_price: number;
  unrealized_pnl: number;
  margin: number;
  opened_at: string;
  closed_at: string | null;
  status: string;
};

export const positionRepository = {
  async getOpen(): Promise<PositionRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM positions WHERE status = 'OPEN' ORDER BY opened_at DESC"
    );
    return rows as unknown as PositionRecord[];
  },

  async getOpenBySymbol(symbol: string): Promise<PositionRecord | undefined> {
    const row = await dbQueryOne(
      "SELECT * FROM positions WHERE symbol = $1 AND status = 'OPEN' LIMIT 1",
      [symbol]
    );
    return row as PositionRecord | undefined;
  },

  async getById(id: string): Promise<PositionRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM positions WHERE id = $1", [id]);
    return row as PositionRecord | undefined;
  },

  async getRecent(limit = 10): Promise<PositionRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM positions ORDER BY opened_at DESC LIMIT $1",
      [limit]
    );
    return rows as unknown as PositionRecord[];
  },

  async getOpenCount(): Promise<number> {
    const result = await dbQueryOne(
      "SELECT COUNT(*) as count FROM positions WHERE status = 'OPEN'"
    ) as { count: number } | undefined;
    return Number(result?.count ?? 0);
  },

  async updateMarkPrice(id: string, markPrice: number, unrealizedPnl: number): Promise<void> {
    await dbExecute(
      "UPDATE positions SET mark_price = $1, unrealized_pnl = $2 WHERE id = $3",
      [markPrice, unrealizedPnl, id]
    );
  },
};
