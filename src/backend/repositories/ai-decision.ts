import { dbQueryOne, dbQuery } from "../database/adapter";

export type AiDecisionRecord = {
  id: string;
  action: string;
  symbol: string;
  size: string;
  confidence: number;
  strategy_name: string;
  strategy_version: string;
  strategy_edge: number;
  reasoning: string;
  regime: string;
  regime_confidence: number;
  signals_snapshot: string;
  risk_approved: number;
  risk_rejection_reason: string | null;
  executed: number;
  created_at: string;
};

export const aiDecisionRepository = {
  async getLatest(): Promise<AiDecisionRecord | undefined> {
    const row = await dbQueryOne(
      "SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1"
    );
    return row as AiDecisionRecord | undefined;
  },

  async getRecent(limit = 10): Promise<AiDecisionRecord[]> {
    const rows = await dbQuery(
      "SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return rows as unknown as AiDecisionRecord[];
  },

  async getById(id: string): Promise<AiDecisionRecord | undefined> {
    const row = await dbQueryOne("SELECT * FROM ai_decisions WHERE id = $1", [id]);
    return row as AiDecisionRecord | undefined;
  },

  async getStats(): Promise<{ totalDecisions: number; executedCount: number; avgConfidence: number }> {
    const stats = await dbQueryOne(`
      SELECT
        COUNT(*) as "totalDecisions",
        SUM(CASE WHEN executed = 1 THEN 1 ELSE 0 END) as "executedCount",
        AVG(confidence) as "avgConfidence"
      FROM ai_decisions
    `) as { totalDecisions: number; executedCount: number; avgConfidence: number } | undefined;

    return {
      totalDecisions: Number(stats?.totalDecisions || 0),
      executedCount: Number(stats?.executedCount || 0),
      avgConfidence: Math.round(Number(stats?.avgConfidence || 0) * 10) / 10,
    };
  },
};
