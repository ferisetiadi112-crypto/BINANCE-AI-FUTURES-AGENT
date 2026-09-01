import { getDatabase } from "../database";

export type AiExperienceRecord = {
  id: string;
  tag: string;
  title: string;
  confidence: number;
  impact: string;
  details: string;
  trade_ids: string;
  created_at: string;
};

export const aiExperienceRepository = {
  getAll(): AiExperienceRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM ai_experiences ORDER BY confidence DESC")
      .all() as AiExperienceRecord[];
  },

  getByTag(tag: string): AiExperienceRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM ai_experiences WHERE tag = ? ORDER BY confidence DESC")
      .all(tag) as AiExperienceRecord[];
  },

  getById(id: string): AiExperienceRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM ai_experiences WHERE id = ?")
      .get(id) as AiExperienceRecord | undefined;
  },

  count(): number {
    const result = getDatabase().prepare("SELECT COUNT(*) as count FROM ai_experiences").get() as { count: number };
    return result.count;
  },
};
