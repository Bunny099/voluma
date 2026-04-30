import db from './db';

export interface WalletRecord {
  userId:       string;
  publicKey:    string;
  encryptedKey: string;
  iv:           string;
  createdAt:    number;
  lastUsedAt:   number | null;
}

const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO wallets (userId, publicKey, encryptedKey, iv, createdAt, lastUsedAt)
    VALUES (@userId, @publicKey, @encryptedKey, @iv, @createdAt, @lastUsedAt)
  `),
  get:           db.prepare(`SELECT * FROM wallets WHERE userId = ?`),
  getAll:        db.prepare(`SELECT * FROM wallets`),
  updateLastUsed: db.prepare(`UPDATE wallets SET lastUsedAt = ? WHERE userId = ?`),
};

export const walletRepo = {
  insert(record: WalletRecord): void {
    stmts.insert.run(record);
  },
  get(userId: string): WalletRecord | null {
    return (stmts.get.get(userId) as WalletRecord | undefined) ?? null;
  },
  getAll(): WalletRecord[] {
    return stmts.getAll.all() as WalletRecord[];
  },
  touch(userId: string): void {
    stmts.updateLastUsed.run(Date.now(), userId);
  },
};