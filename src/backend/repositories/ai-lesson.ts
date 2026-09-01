import { getDatabase } from "../database";

export type AiLessonRecord = {
  id: string;
  text: string;
  cycle: number;
  source_experience_ids: string;
  created_at: string;
};

export const aiLessonRepository = {
  getAll(): AiLessonRecord[] {
    return getDatabase()
      .prepare("SELECT * FROM ai_lessons ORDER BY cycle DESC")
      .all() as AiLessonRecord[];
  },

  getByCycle(cycle: number): AiLessonRecord | undefined {
    return getDatabase()
      .prepare("SELECT * FROM ai_lessons WHERE cycle = ?")
      .get(cycle) as AiLessonRecord | undefined;
  },

  count(): number {
    const result = getDatabase().prepare("SELECT COUNT(*) as count FROM ai_lessons").get() as { count: number };
    return result.count;
  },

  getLatestCycle(): number {
    const result = getDatabase().prepare("SELECT MAX(cycle) as cycle FROM ai_lessons").get() as { cycle: number };
    return result.cycle || 0;
  },
};
