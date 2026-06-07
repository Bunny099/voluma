
CREATE TABLE IF NOT EXISTS wallets (
    user_id         TEXT        PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    public_key      TEXT        NOT NULL UNIQUE,
    encrypted_key   TEXT        NOT NULL,
    iv              TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ
);


CREATE TABLE IF NOT EXISTS conditions (
    id              TEXT        PRIMARY KEY,
    user_id         TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    data            JSONB       NOT NULL,
    execution_count INTEGER     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conditions_user_id ON conditions(user_id);


CREATE TABLE IF NOT EXISTS trigger_stats (
    condition_id    TEXT        PRIMARY KEY,
    trigger_count   INTEGER     NOT NULL DEFAULT 0,
    last_triggered  TIMESTAMPTZ
);


CREATE TABLE IF NOT EXISTS pending_txs (
    tx_hash         TEXT        PRIMARY KEY,
    user_id         TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    condition_id    TEXT,
    status          TEXT        NOT NULL DEFAULT 'PENDING',
    raw_amount_in   BIGINT,
    input_mint      TEXT,
    output_mint     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_txs_status  ON pending_txs(status);
CREATE INDEX IF NOT EXISTS idx_pending_txs_user_id ON pending_txs(user_id);


CREATE TABLE IF NOT EXISTS processed_events (
    condition_id    TEXT        NOT NULL,
    signature       TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (condition_id, signature)
);
CREATE INDEX IF NOT EXISTS idx_processed_events_created_at ON processed_events(created_at);