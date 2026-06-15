
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS encryption_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS kdf_salt TEXT,
  ADD COLUMN IF NOT EXISTS auth_tag TEXT,
  ADD COLUMN IF NOT EXISTS encryption_migrated_at TIMESTAMPTZ;

ALTER TABLE pending_txs
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS trade_executions (
    id                       TEXT PRIMARY KEY,
    tx_hash                  TEXT UNIQUE,
    user_id                  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    condition_id             TEXT,
    manual                   BOOLEAN NOT NULL DEFAULT FALSE,
    direction                TEXT NOT NULL,
    input_mint               TEXT NOT NULL,
    output_mint              TEXT NOT NULL,
    raw_amount_in            BIGINT NOT NULL,
    quote_out_amount         BIGINT,
    actual_out_amount        BIGINT,
    slippage_bps             INTEGER NOT NULL DEFAULT 100,
    quote_price_impact_pct   DOUBLE PRECISION,
    route_summary            JSONB,
    status                   TEXT NOT NULL DEFAULT 'PENDING',
    quote_fetched_at         TIMESTAMPTZ,
    submitted_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at             TIMESTAMPTZ,
    failed_at                TIMESTAMPTZ,
    execution_duration_ms    INTEGER,
    failure_reason           TEXT,
    rpc_provider             TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_executions_user_created
  ON trade_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_executions_status
  ON trade_executions(status);

CREATE TABLE IF NOT EXISTS wallet_activity_logs (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    wallet_public_key TEXT NOT NULL,
    action_type       TEXT NOT NULL,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_activity_logs_user_created
  ON wallet_activity_logs(user_id, created_at DESC);
