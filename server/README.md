# Voluma Server

> Real-time Solana ingestion → condition evaluation → automated execution pipeline

The Voluma backend is a Fastify server written in TypeScript that runs on Bun. It streams transactions from Solana mainnet via WebSocket, evaluates user-defined conditions against every event in real time, and executes actions — including automated trades via Jupiter DEX — when conditions are met.

---

## Architecture Overview

```
Solana Mainnet WebSocket
         │
         │  logsSubscribe (5 DEX programs + System Program)
         ▼
┌─────────────────────┐
│  PublicRPCProvider  │  Parse raw logs → NormalizedEvent
│  (ingestion layer)  │  Dedup by signature, frequency-based mint extraction
└─────────┬───────────┘
          │ emit('transaction', event)
          ▼
┌─────────────────────┐
│    EventQueue       │  In-memory queue, max 5,000 items
│  (concurrency=20)   │  20 concurrent handlers, backpressure via drop
└─────────┬───────────┘
          │ handler(event)
          ▼
┌─────────────────────┐
│  ConditionEngine    │  O(1) inverted index lookup by wallet/token
│  (evaluation layer) │  Sliding window counters for SWAP_BURST/TOKEN_VOLUME
│                     │  Cooldown system, fire-once dedup cache
└─────────┬───────────┘
          │ matches[]
          ▼
┌─────────────────────┐
│  ExecutionEngine    │  Dispatch actions per match result
│  (action layer)     │  Retry logic (3x for webhook, 1x for trade)
│                     │  Delivery-level idempotency
└─────────┬───────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
TradeExecutor  BroadcastServer
(Jupiter DEX)  (WebSocket rooms)
```

---

## Project Structure

```
server/
├── src/
│   ├── index.ts                    # Server entry point, all HTTP routes, bootstrap
│   │
│   ├── ingestion/
│   │   ├── provider.ts             # NormalizedEvent and IngestionProvider interfaces
│   │   ├── public-rpc-provider.ts  # WebSocket-based Solana ingestion
│   │   └── yellowstone-provider.ts # Helius gRPC stub (future upgrade path)
│   │
│   ├── conditions/
│   │   ├── engine.ts               # Core condition evaluator
│   │   └── types.ts                # Condition, ExecutionAction type definitions
│   │
│   ├── execution/
│   │   ├── executor.ts             # Action dispatcher, retry, delivery dedup
│   │   ├── tradeExecutor.ts        # Jupiter DEX quote + swap + confirm
│   │   └── tradeGuard.ts           # Rate limiting, balance check, mint validation
│   │
│   ├── wallets/
│   │   └── walletManager.ts        # AES-256 keypair encryption, SOL balance, withdraw
│   │
│   ├── ws/
│   │   └── broadcast.ts            # WebSocket server, per-user rooms, keepalive
│   │
│   ├── queue/
│   │   └── in-memory-queue.ts      # Concurrent queue with backpressure
│   │
│   └── db/
│       ├── db.ts                   # SQLite connection, schema init, WAL mode
│       ├── conditionRepo.ts        # Condition CRUD + execution count
│       ├── statsRepo.ts            # Trigger statistics
│       ├── walletRepo.ts           # Wallet record persistence
│       ├── processedEventRepo.ts   # Deduplication cache (conditionId:signature)
│       └── pendingTxRepo.ts        # Pending transaction tracking
│
├── data/                           # SQLite database files (auto-created)
│   └── voluma.db
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## Core Modules

### `ingestion/public-rpc-provider.ts`

Connects to Solana mainnet via WebSocket and subscribes to log notifications for 5 DEX programs (Jupiter, Raydium, Orca, and others) plus the System Program.

**What it does:**
- Maintains a single persistent WebSocket connection with exponential backoff reconnect
- Subscribes to `logsSubscribe` for each DEX program
- Deduplicates events by signature (DEDUP_MAX=12,000, LRU-style trim)
- Parses raw program logs into `NormalizedEvent` objects:
  - **Type detection**: SWAP (DEX program in logs) or TRANSFER (System Program)
  - **Wallet detection**: Two-pass — exact pubkey match, then prefix heuristic
  - **Token mint extraction**: Two-pass — explicit `Mint:` log pattern, then frequency analysis (most repeated non-program pubkey across all log lines)
  - **Amount extraction**: Regex on `amount:` log pattern
  - **Confidence scoring**: HIGH (exact wallet match) / MEDIUM (prefix or amount present) / LOW (neither)
- Emits `transaction` events consumed by the EventQueue

> **Note on parsing**: Wallet and mint detection use heuristic approaches — exact pubkey matching and frequency-based inference from log data. This is intentional and pragmatic. The Yellowstone upgrade path replaces heuristics with fully decoded canonical transaction data.

**Key design decision**: Frequency-based mint extraction compensates for DEX programs that don't emit explicit mint labels. The token mint appears in multiple CPI invocation logs, making it the most repeated non-program pubkey — a reliable heuristic.

**Upgrade path**: `yellowstone-provider.ts` is a drop-in replacement stub. Helius Yellowstone gRPC delivers fully decoded transaction data at <100ms latency. The rest of the system requires zero changes because both implement `IngestionProvider`.

---

### `conditions/engine.ts`

The core condition evaluation system. Uses inverted indexes for O(1) candidate lookup — evaluating a transaction against thousands of conditions takes microseconds, not milliseconds.

**Index structure:**
```typescript
walletIdx:      Map<walletAddress, Set<conditionId>>  // WALLET_ACTIVITY
tokenIdx:       Map<tokenMint, Set<conditionId>>       // SWAP_BURST/TOKEN_VOLUME
globalBurst:    Set<conditionId>                       // Any token (no mint filter)
swapTokenConds: Set<conditionId>                       // Token-specific swap conditions
                                                       // (rawLogs fallback path)
```

**Condition types:**

| Type | Logic |
|------|-------|
| `WALLET_ACTIVITY` | Exact wallet match, optional transaction type + min amount filter. Requires confidence ≥ MEDIUM. |
| `SWAP_BURST` | Sliding window counter — fires once when swap count crosses threshold, resets after cooldown |
| `TOKEN_VOLUME` | Sliding window sum — fires once when total SOL volume crosses threshold |
| `LARGE_TRANSFER` | Single event threshold — any TRANSFER with amount ≥ minSol |

**Mint matching (two-tier):**
1. `event.tokenMint === condition.tokenMint` (exact)
2. `event.rawLogs?.includes(condition.tokenMint)` (substring in joined logs)

This compensates for unreliable log-based mint extraction. A 44-char base58 string appearing in logs is an extremely reliable signal even without exact field extraction.

**Cooldown system**: After a condition fires, it enters cooldown for `cooldownSeconds`. Sliding window state (`aboveThreshold`) resets on cooldown expiry, preventing immediate re-fire.

**Fire cache**: `Set<conditionId:signature>` prevents the same event from firing the same condition twice even under concurrent processing.

---

### `execution/executor.ts`

Dispatches actions when conditions match. Handles retry logic, delivery-level idempotency, and the notification pipeline.

**Action processing order:**
1. Skip `NOTIFY` actions (processed last, after all other actions complete)
2. Dispatch `WEBHOOK`, `LOG`, and `TRADE` actions with retry
3. Send WebSocket notification including results of all actions

**Retry policy:**
- `WEBHOOK`: Up to 3 attempts, exponential backoff (500ms, 1000ms)
- `TRADE`: 1 attempt only (trades are not safe to retry — side effects are irreversible)
- `LOG`: No retry (fire-and-forget)

**Delivery dedup**: `Set<conditionId:signature>` at the executor level. Second dedup layer after the engine's fire cache.

**Webhook delivery includes:**
- `X-Voluma-Idempotency-Key`: `conditionId:signature`
- `X-Voluma-Delivery-Id`: unique per-match delivery ID
- `X-Voluma-Attempt`: current attempt number

---

### `execution/tradeExecutor.ts`

Executes trades via Jupiter DEX Aggregator v6.

**Trade flow:**
```
1. GET /quote  →  Jupiter quotes best route for inputMint→outputMint
2. POST /swap  →  Jupiter builds versioned transaction
3. Deserialize + sign with user keypair
4. sendRawTransaction (maxRetries=0, prevents client-side duplicate submission)
5. Poll getSignatureStatus until confirmed/finalized (30s timeout)
```

**BUY**: SOL → token (ExactIn mode, spend exact SOL amount)
**SELL**: token → SOL (ExactIn mode, sell exact token amount)

---

### `execution/tradeGuard.ts`

Multi-layer safety system that runs before every trade:

```
checkRateLimit(userId)    →  Max 5 trades/minute per user (in-memory window)
validateMint(tokenMint)   →  Base58 format check before hitting Jupiter
getExecutionCount(condId) →  Enforce maxExecutions / allowRepeatedExecution
checkBalance(publicKey)   →  Live RPC balance ≥ tradeAmount + 0.005 SOL fee buffer
markTradeSubmitted(key)   →  Trade-level dedup (conditionId:signature)
```

Guards run cheapest-first (in-memory before RPC calls).

---

### `wallets/walletManager.ts`

Manages per-user dedicated trading wallets with server-side encrypted key storage.

**Encryption**: AES-256-CBC with random IV per wallet. Key derived from `WALLET_ENCRYPTION_KEY` env var (padded/truncated to 32 bytes).

```typescript
encrypt(secretKey) → { encryptedKey: hex, iv: hex }  // stored in DB
decrypt(encryptedKey, iv) → Uint8Array                // only when trading
```

**Keypair is only decrypted when:**
- Executing a trade (executor.ts calls `getKeypair`)
- Processing a withdrawal (withdraw route calls `getKeypair`)

The decrypted keypair exists in memory only for the duration of the operation.

**Security model**: The server holds encrypted private keys in the database and controls the encryption key via environment variables. This protects against database-only breaches but means the server has access to sign transactions on behalf of users. For true non-custodial trading (user-held keys), the upgrade path is delegated trading authority.

**Trade dedup cache**: 5,000-entry LRU cache via `markTradeSubmitted()` prevents duplicate trade submissions for the same condition:signature pair.

---

### `ws/broadcast.ts`

WebSocket server with per-user room isolation.

```
/ws?userId=<uuid>  →  join room for userId
```

**`sendToUser(userId, payload)`**: Sends to all sockets in a user's room (supports multiple tabs/devices per user).

**`broadcast(payload)`**: Sends to all connected sockets (used for live event feed — every client sees the same transaction stream).

Keepalive: 25-second ping interval per socket.

---

### `queue/in-memory-queue.ts`

Bounded concurrent queue. 

- Max size: 5,000 items (drops events when full, increments `droppedEvents` counter)
- Concurrency: 20 simultaneous handlers
- Zero dependencies

---

### Background Systems

**Pending Transaction Checker** (`index.ts:222-267`):
- Polls every 15 seconds for pending transaction confirmation
- Updates `pending_txs` table on confirmation/failure
- Ensures UI always reflects on-chain state

**Cleanup Jobs** (`index.ts:271-282`):
- Deletes `processed_events` older than 1 hour
- Deletes confirmed `pending_txs` older than 24 hours
- Prevents database growth

---

### `db/db.ts`

SQLite database initialized on startup. WAL mode enabled for better concurrent read performance.

**Schema:**

```sql
wallets (
  userId       TEXT PRIMARY KEY,
  publicKey    TEXT NOT NULL UNIQUE,
  encryptedKey TEXT NOT NULL,
  iv           TEXT NOT NULL,
  createdAt    INTEGER NOT NULL,
  lastUsedAt   INTEGER
)

conditions (
  id             TEXT PRIMARY KEY,
  userId         TEXT NOT NULL,
  data           TEXT NOT NULL,     -- full Condition as JSON blob
  executionCount INTEGER DEFAULT 0, -- successful TRADE executions only
  createdAt      INTEGER NOT NULL
)

trigger_stats (
  conditionId   TEXT PRIMARY KEY,
  triggerCount  INTEGER DEFAULT 0,
  lastTriggered INTEGER
)

processed_events (
  conditionId  TEXT NOT NULL,
  signature    TEXT NOT NULL,
  timestamp    INTEGER NOT NULL,
  PRIMARY KEY (conditionId, signature)
)

pending_txs (
  txHash       TEXT PRIMARY KEY,
  userId       TEXT NOT NULL,
  inputMint    TEXT,
  outputMint   TEXT,
  rawAmountIn  INTEGER,
  status       TEXT NOT NULL,  -- PENDING | CONFIRMED | FAILED
  createdAt    INTEGER NOT NULL
)
```

---

## API Reference

### Wallet Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/wallet/:userId` | Get wallet info, SOL balance, token holdings, pending txs |
| `POST` | `/wallet/:userId/create` | Create trading wallet (idempotent) |
| `POST` | `/wallet/:userId/withdraw/sol` | Withdraw SOL to external address |
| `POST` | `/wallet/:userId/withdraw/token` | Withdraw SPL tokens to external address |

**Withdraw body:**
```json
{
  "destinationAddress": "Base58PublicKey",
  "amountSol": 0.1
}
```

### Condition Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/conditions/:userId` | List all conditions with trigger stats |
| `POST` | `/conditions` | Create new condition |
| `DELETE` | `/conditions/:id` | Delete condition |
| `PATCH` | `/conditions/:id/toggle` | Enable / disable condition |

**Create condition body:**
```json
{
  "userId": "string",
  "name": "string",
  "type": "WALLET_ACTIVITY | SWAP_BURST | TOKEN_VOLUME | LARGE_TRANSFER",
  "enabled": true,
  "wallet": "optional - Base58 wallet address",
  "transactionType": "BUY | SELL | TRANSFER | ANY",
  "minAmountSol": 0.5,
  "tokenMint": "optional - Base58 mint address",
  "minSwaps": 50,
  "minVolumeSol": 1000,
  "windowSeconds": 30,
  "minSol": 100,
  "cooldownSeconds": 60,
  "maxExecutions": 1,
  "allowRepeatedExecution": false,
  "actions": [
    {
      "type": "NOTIFY | WEBHOOK | LOG | TRADE",
      "webhookUrl": "https://...",
      "tradeDirection": "BUY | SELL",
      "tradeTokenMint": "Base58MintAddress",
      "tradeAmountSol": 0.1,
      "tradeSlippageBps": 100
    }
  ]
}
```

### Trade Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/trade/quote` | Get Jupiter quote for token pair |
| `POST` | `/trade/manual` | Execute manual trade with guard checks |

### Utility Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/test` | Test a webhook URL with sample payload |
| `GET` | `/stats` | System metrics — queue depth, events, trades, uptime |

### WebSocket

```
ws://localhost:3001/ws?userId=<uuid>
```

**Messages received by client:**

```json
// Live transaction events (broadcast to all)
{ "type": "LIVE_EVENT", "signature": "...", "eventType": "SWAP", "tokenMint": "...", "timestamp": 1234567890 }

// Condition triggered (sent to specific user only)
{
  "type": "TRIGGER",
  "conditionId": "...",
  "conditionName": "...",
  "signature": "...",
  "eventType": "SWAP",
  "matchedAt": 1234567890,
  "explanation": { "reason": "...", "confidence": "HIGH", "matchedFields": [...], "details": {...} },
  "execution": {
    "deliveryId": "...",
    "actions": [...],
    "summary": { "total": 2, "success": 2, "failed": 0 }
  }
}
```

---

## Environment Variables

```env
# Required
WALLET_ENCRYPTION_KEY=your-secret-key-minimum-32-characters-long

# Jupiter Api Key
JUPITER_API_KEY=your-jupiter-api-key

# Optional — defaults to public mainnet RPC
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
RPC_WSS=wss://api.mainnet-beta.solana.com

# Optional — CORS origin for frontend
FRONTEND_URL=http://localhost:3000

# Optional — server port (default: 3001)
PORT=3001

# Optional — SQLite database directory (default: ./data)
DB_PATH=./data

# Optional — enable verbose mint matching debug logs
DEBUG_MINT_MATCHING=false
```

---

## Local Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.0 (or Node.js >= 18)
- Git

### Installation

```bash
# From the server directory
cd server

# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Edit .env — set WALLET_ENCRYPTION_KEY to any string ≥32 chars
# Example: WALLET_ENCRYPTION_KEY=my-super-secret-key-at-least-32-chars-long

# Run in development mode
bun run dev
```

Server starts on `http://localhost:3001`.

The SQLite database is created automatically at `./data/voluma.db` on first run.

### Production Build

```bash
bun run build
bun run start
```

---

## Key Design Decisions

**Why SQLite instead of Postgres?**
Zero infrastructure. The product is designed to run at zero cost. SQLite with WAL mode handles the read/write patterns well — conditions are read frequently, written rarely. The conditionRepo and walletRepo interfaces abstract the DB layer cleanly for future migration.

**Why in-memory queue instead of Redis Streams?**
Zero infrastructure cost. The EventQueue with 5,000 item capacity and 20 concurrent workers handles current throughput with headroom. The interface is designed for drop-in replacement with a durable queue when scale requires it.

**Why public RPC WebSocket instead of Helius?**
Zero cost. The public endpoint is sufficient for the current load. The `yellowstone-provider.ts` stub documents the exact upgrade path — install one package, set two env vars, replace one import. Nothing else changes.

**Why AES-256-CBC for wallet encryption?**
Widely audited, deterministic (important for key storage), and sufficient for the threat model: an attacker with database access cannot recover private keys without the encryption key, which is stored separately in the environment.

---

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Event processing latency | <50ms | From WebSocket message to condition evaluation — applies to transactions from monitored DEX programs and System Program |
| Trade execution latency | 400–800ms | Jupiter quote + tx build + send + confirm |
| Queue capacity | 5,000 events | Events dropped beyond this (drop rate tracked) |
| Concurrent handlers | 20 | Tune via `EventQueue` constructor |
| Condition engine lookup | O(1) | Inverted index, constant time per event |
| WebSocket connections | Unlimited | One room per userId, multiple sockets per room |

---

## Infrastructure Upgrade Path

Current stack → Production stack (no code changes required):

```
Public RPC WebSocket     →  Helius Yellowstone gRPC (yellowstone-provider.ts stub)
SQLite                   →  PostgreSQL (swap repo implementations)
In-memory queue          →  Redis Streams (swap EventQueue implementation)
Single Fastify instance  →  Multiple instances behind load balancer
                            (condition engine is evaluation-stateless)
```