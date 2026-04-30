import db from './db';

export interface StatsRecord {
  conditionId:   string;
  triggerCount:  number;
  lastTriggered: number | null;
}

const stmts = {
  increment: db.prepare(`
    INSERT INTO trigger_stats (conditionId, triggerCount, lastTriggered)
    VALUES (@conditionId, 1, @lastTriggered)
    ON CONFLICT(conditionId) DO UPDATE SET
      triggerCount  = triggerCount + 1,
      lastTriggered = @lastTriggered
  `),
  get:    db.prepare(`SELECT * FROM trigger_stats WHERE conditionId = ?`),
  getAll: db.prepare(`SELECT * FROM trigger_stats`),
  delete: db.prepare(`DELETE FROM trigger_stats WHERE conditionId = ?`),
};

export const statsRepo = {
  increment(conditionId: string, ts: number): void {
    stmts.increment.run({ conditionId, lastTriggered: ts });
  },
  get(conditionId: string): StatsRecord | null {
    return (stmts.get.get(conditionId) as StatsRecord | undefined) ?? null;
  },
  getAll(): StatsRecord[] {
    return stmts.getAll.all() as StatsRecord[];
  },
  delete(conditionId: string): void {
    stmts.delete.run(conditionId);
  },
};