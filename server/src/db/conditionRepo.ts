import db from './db';
import { type Condition } from '../conditions/types';

interface ConditionRow {
  id:             string;
  userId:         string;
  data:           string;
  executionCount: number;
  createdAt:      number;
}

const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO conditions (id, userId, data, executionCount, createdAt)
    VALUES (@id, @userId, @data, 0, @createdAt)
  `),
  updateData:        db.prepare(`UPDATE conditions SET data = ? WHERE id = ?`),
  get:               db.prepare(`SELECT * FROM conditions WHERE id = ?`),
  getByUser:         db.prepare(`SELECT * FROM conditions WHERE userId = ?`),
  getAll:            db.prepare(`SELECT * FROM conditions`),
  delete:            db.prepare(`DELETE FROM conditions WHERE id = ?`),
  incrementExecCount: db.prepare(`UPDATE conditions SET executionCount = executionCount + 1 WHERE id = ?`),
  getExecCount:      db.prepare(`SELECT executionCount FROM conditions WHERE id = ?`),
};

function parse(row: ConditionRow): Condition {
  return JSON.parse(row.data) as Condition;
}

export const conditionRepo = {
  save(condition: Condition): void {
    const existing = stmts.get.get(condition.id) as ConditionRow | undefined;
    if (existing) {
      stmts.updateData.run(JSON.stringify(condition), condition.id);
    } else {
      stmts.insert.run({ id: condition.id, userId: condition.userId, data: JSON.stringify(condition), createdAt: condition.createdAt });
    }
  },
  get(id: string): Condition | null {
    const row = stmts.get.get(id) as ConditionRow | undefined;
    return row ? parse(row) : null;
  },
  getByUserId(userId: string): Array<Condition & { executionCount: number }> {
    const rows = stmts.getByUser.all(userId) as ConditionRow[];
    return rows.map(r => ({ ...parse(r), executionCount: r.executionCount }));
  },
  getAll(): Condition[] {
    return (stmts.getAll.all() as ConditionRow[]).map(parse);
  },
  delete(id: string): void {
    stmts.delete.run(id);
  },
  incrementExecutionCount(id: string): void {
    stmts.incrementExecCount.run(id);
  },
  getExecutionCount(id: string): number {
    const row = stmts.getExecCount.get(id) as { executionCount: number } | undefined;
    return row?.executionCount ?? 0;
  },
};