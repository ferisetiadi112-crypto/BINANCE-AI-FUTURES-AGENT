import { getDatabase } from "../database";

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
  getLatest(): AiDecisionRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1")
      .get() as AiDecisionRecord | undefined;
  },

  getRecent(limit = 10): AiDecisionRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as AiDecisionRecord[];
  },

  getById(id: string): AiDecisionRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM ai_decisions WHERE id = ?")
      .get(id) as AiDecisionRecord | undefined;
  },

  getStats(): { totalDecisions: number; executedCount: number; avgConfidence: number } {
    const db = getDatabase();
    const stats = db.prepare(`
      SELECT
        COUNT(*) as totalDecisions,
        SUM(CASE WHEN executed = 1 THEN 1 ELSE 0 END) as executedCount,
        AVG(confidence) as avgConfidence
      FROM ai_decisions
    `).get() as { totalDecisions: number; executedCount: number; avgConfidence: number };
    return {
      totalDecisions: stats.totalDecisions || 0,
      executedCount: stats.executedCount || 0,
      avgConfidence: Math.round((stats.avgConfidence || 0) * 10) / 10,
    };
  },
};
