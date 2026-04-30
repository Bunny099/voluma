import db from './db';

const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO processed_events (conditionId, signature, createdAt)
    VALUES (@conditionId, @signature, @createdAt)
  `),
  exists: db.prepare(`
    SELECT 1 FROM processed_events WHERE conditionId = @conditionId AND signature = @signature LIMIT 1
  `),
  deleteOld: db.prepare(`DELETE FROM processed_events WHERE createdAt < ?`),
};

export const processedEventRepo = {
 
  exists(conditionId: string, signature: string): boolean {
    const row = stmts.exists.get({ conditionId, signature }) as { '1': number } | undefined;
    return !!row;
  },

 
  insert(conditionId: string, signature: string): void {
    stmts.insert.run({ conditionId, signature, createdAt: Date.now() });
  },

  cleanup(olderThanTs: number): number {
    const info = db.prepare(`DELETE FROM processed_events WHERE createdAt < ?`).run(olderThanTs);
    return info.changes;
  },
};
