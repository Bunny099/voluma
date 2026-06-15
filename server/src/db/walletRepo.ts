import pool from './pool';

export interface WalletRecord {
  userId:       string;
  publicKey:    string;
  encryptedKey: string;
  iv:           string;
  encryptionVersion: number;
  kdfSalt:      string | null;
  authTag:      string | null;
  createdAt:    number;        
  lastUsedAt:   number | null; 
}


function toRecord(row: Record<string, unknown>): WalletRecord {
  return {
    userId:       row.user_id        as string,
    publicKey:    row.public_key     as string,
    encryptedKey: row.encrypted_key  as string,
    iv:           row.iv             as string,
    encryptionVersion: Number(row.encryption_version ?? 1),
    kdfSalt:      (row.kdf_salt as string | null) ?? null,
    authTag:      (row.auth_tag as string | null) ?? null,
    createdAt:    new Date(row.created_at  as string).getTime(),
    lastUsedAt:   row.last_used_at
      ? new Date(row.last_used_at as string).getTime()
      : null,
  };
}

export const walletRepo = {
  async insert(record: WalletRecord): Promise<void> {
    await pool.query(
      `INSERT INTO wallets
         (user_id, public_key, encrypted_key, iv, encryption_version, kdf_salt, auth_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO NOTHING`,
      [
        record.userId,
        record.publicKey,
        record.encryptedKey,
        record.iv,
        record.encryptionVersion,
        record.kdfSalt,
        record.authTag,
      ],
    );
  },

  async get(userId: string): Promise<WalletRecord | null> {
    const { rows } = await pool.query(
      `SELECT * FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
  },

  async getAll(): Promise<WalletRecord[]> {
    const { rows } = await pool.query(`SELECT * FROM wallets`);
    return rows.map(r => toRecord(r as Record<string, unknown>));
  },

  async touch(userId: string): Promise<void> {
    await pool.query(
      `UPDATE wallets SET last_used_at = NOW() WHERE user_id = $1`,
      [userId],
    );
  },

  async updateEncryption(
    userId: string,
    fields: {
      encryptedKey: string;
      iv: string;
      encryptionVersion: number;
      kdfSalt: string | null;
      authTag: string | null;
    },
  ): Promise<void> {
    await pool.query(
      `UPDATE wallets
       SET encrypted_key = $2,
           iv = $3,
           encryption_version = $4,
           kdf_salt = $5,
           auth_tag = $6,
           encryption_migrated_at = NOW()
       WHERE user_id = $1`,
      [
        userId,
        fields.encryptedKey,
        fields.iv,
        fields.encryptionVersion,
        fields.kdfSalt,
        fields.authTag,
      ],
    );
  },
};
