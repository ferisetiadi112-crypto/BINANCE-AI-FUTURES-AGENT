import { getDatabase } from "../database";

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
  getOpen(): PositionRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM positions WHERE status = 'OPEN' ORDER BY opened_at DESC")
      .all() as PositionRecord[];
  },

  getOpenBySymbol(symbol: string): PositionRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM positions WHERE symbol = ? AND status = 'OPEN' LIMIT 1")
      .get(symbol) as PositionRecord | undefined;
  },

  getById(id: string): PositionRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM positions WHERE id = ?")
      .get(id) as PositionRecord | undefined;
  },

  getRecent(limit = 10): PositionRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM positions ORDER BY opened_at DESC LIMIT ?")
      .all(limit) as PositionRecord[];
  },

  getOpenCount(): number {
    const result = getDatabase()
      .prepare("SELECT COUNT(*) as count FROM positions WHERE status = 'OPEN'")
      .get() as { count: number };
    return result.count;
  },

  updateMarkPrice(id: string, markPrice: number, unrealizedPnl: number): void {
    getDatabase()
      .prepare("UPDATE positions SET mark_price = ?, unrealized_pnl = ? WHERE id = ?")
      .run(markPrice, unrealizedPnl, id);
  },
};
