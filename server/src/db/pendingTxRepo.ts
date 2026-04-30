import db from './db';

export interface PendingTx {
  txHash:      string;
  userId:      string;
  conditionId: string | null;
  status:      'PENDING' | 'CONFIRMED' | 'FAILED';
  rawAmountIn: number | null;
  inputMint:  string | null;
  outputMint: string | null;
  createdAt:  number;
  updatedAt:  number;
}

const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO pending_txs (txHash, userId, conditionId, status, rawAmountIn, inputMint, outputMint, createdAt, updatedAt)
    VALUES (@txHash, @userId, @conditionId, 'PENDING', @rawAmountIn, @inputMint, @outputMint, @createdAt, @updatedAt)
  `),
  updateConfirmed: db.prepare(`
    UPDATE pending_txs SET status = 'CONFIRMED', updatedAt = @updatedAt WHERE txHash = @txHash
  `),
  updateFailed: db.prepare(`
    UPDATE pending_txs SET status = 'FAILED', updatedAt = @updatedAt WHERE txHash = @txHash
  `),
  getPending: db.prepare(`
    SELECT * FROM pending_txs WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT ?
  `),
  getByTxHash: db.prepare(`SELECT * FROM pending_txs WHERE txHash = ?`),
  getByWallet: db.prepare(`SELECT * FROM pending_txs WHERE userId = ? AND status = 'PENDING' ORDER BY createdAt DESC`),
  deleteOld: db.prepare(`DELETE FROM pending_txs WHERE createdAt < ? AND status != 'PENDING'`),
};

export const pendingTxRepo = {
  insert(txHash: string, userId: string, conditionId: string | null, rawAmountIn: number | null, inputMint: string | null, outputMint: string | null): void {
    const now = Date.now();
    stmts.insert.run({ txHash, userId, conditionId, rawAmountIn, inputMint, outputMint, createdAt: now, updatedAt: now });
  },

  updateConfirmed(txHash: string): void {
    stmts.updateConfirmed.run({ txHash, updatedAt: Date.now() });
  },

  updateFailed(txHash: string): void {
    stmts.updateFailed.run({ txHash, updatedAt: Date.now() });
  },

  getPending(limit = 50): PendingTx[] {
    return stmts.getPending.all(limit) as PendingTx[];
  },

  getByTxHash(txHash: string): PendingTx | null {
    return (stmts.getByTxHash.get(txHash) as PendingTx | undefined) ?? null;
  },

  getByWallet(userId: string): PendingTx[] {
    return stmts.getByWallet.all(userId) as PendingTx[];
  },

  
  cleanup(olderThanTs: number): number {
    const info = db.prepare(`DELETE FROM pending_txs WHERE createdAt < ? AND status != 'PENDING'`).run(olderThanTs);
    return info.changes;
  },
};
