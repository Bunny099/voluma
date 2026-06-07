import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
    ? undefined
    : { rejectUnauthorized: false }, 
  max:                     10,
  min:                      2, 
  idleTimeoutMillis:   30_000,
  connectionTimeoutMillis: 8_000,
  statement_timeout:   15_000, 
  query_timeout:       15_000,
});

pool.on('error', (err) => {
  console.error('[Pool] Idle client error:', err.message);
});

pool.on('connect', () => {
  // Silence 
});

export default pool;
