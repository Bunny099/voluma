import Database from 'better-sqlite3';
import path     from 'path';
import fs       from 'fs';

const DB_DIR  = process.env.DB_PATH ?? path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'voluma.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_FILE);


db.pragma('journal_mode = WAL');
db.pragma('synchronous  = NORMAL');   
db.pragma('foreign_keys = ON');
db.pragma('temp_store   = memory');

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    userId       TEXT PRIMARY KEY,
    publicKey    TEXT NOT NULL UNIQUE,
    encryptedKey TEXT NOT NULL,
    iv           TEXT NOT NULL,
    createdAt    INTEGER NOT NULL,
    lastUsedAt   INTEGER
  );

  CREATE TABLE IF NOT EXISTS conditions (
    id             TEXT PRIMARY KEY,
    userId         TEXT NOT NULL,
    data           TEXT NOT NULL,   -- full Condition JSON blob
    executionCount INTEGER NOT NULL DEFAULT 0,  -- successful TRADE executions only
    createdAt      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cond_user ON conditions(userId);

  CREATE TABLE IF NOT EXISTS trigger_stats (
    conditionId   TEXT PRIMARY KEY,
    triggerCount  INTEGER NOT NULL DEFAULT 0,
    lastTriggered INTEGER
  );

  CREATE TABLE IF NOT EXISTS pending_txs (
    txHash       TEXT PRIMARY KEY,
    userId       TEXT NOT NULL,
    conditionId  TEXT,
    status       TEXT NOT NULL DEFAULT 'PENDING',
    rawAmountIn  INTEGER,
    inputMint    TEXT,
    outputMint   TEXT,
    createdAt    INTEGER NOT NULL,
    updatedAt    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_txs(status);
  CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_txs(userId);

  CREATE TABLE IF NOT EXISTS processed_events (
    conditionId  TEXT NOT NULL,
    signature    TEXT NOT NULL,
    createdAt   INTEGER NOT NULL,
    PRIMARY KEY (conditionId, signature)
  );
  CREATE INDEX IF NOT EXISTS idx_processed_events_age ON processed_events(createdAt);
`);

export default db;