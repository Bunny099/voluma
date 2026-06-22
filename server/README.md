<div align="center">

### Voluma Server

Fastify + Bun service that ingests Solana mainnet in real time, evaluates user-defined conditions against it, and executes the result — including signing live trades.

![Bun](https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=flat-square&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

[← Part of Voluma](../README.md)

</div>

<br/>

## Architecture

```
Solana Mainnet WebSocket
         │  logsSubscribe — 5 DEX program IDs + System Program
         ▼
┌──────────────────────┐
│  PublicRPCProvider    │  dedupe by signature, heuristic parse → selective
│  (ingestion)          │  full-transaction enrichment, RPC failover hooks
└──────────┬────────────┘
           ▼
┌──────────────────────┐
│  EventQueue           │  bounded (5,000), 20 concurrent handlers,
│  (backpressure)       │  drops rather than blocks under sustained load
└──────────┬────────────┘
           ▼
┌──────────────────────┐
│  ConditionEngine      │  inverted-index lookup, sliding windows,
│  (evaluation)         │  cooldowns, fire-once dedup
└──────────┬────────────┘
           ▼
┌──────────────────────┐
│  ExecutionEngine      │  per-action retry, per-wallet trade locking,
│  (dispatch)           │  database-level idempotency
└──────────┬────────────┘
     ┌─────┴──────┐
     ▼            ▼
TradeExecutor   BroadcastServer
(Jupiter DEX)   (per-user WS rooms + sampled live feed)
```

The HTTP API and the WebSocket server share one underlying `http.Server` — Fastify is configured with a custom `serverFactory` so both attach to it.

<br/>

## What's running under the hood

<details>
<summary><strong>Ingestion</strong> — <code>ingestion/public-rpc-provider.ts</code>, <code>transaction-parser.ts</code></summary>
<br/>

A single persistent WebSocket subscribes to five DEX program IDs plus the System Program, with per-wallet `mentions` filters added on demand. Notifications for the same signature are debounced for 40ms and the highest-priority subscription source kept, so a transaction matching multiple subscriptions isn't processed twice.

Every event is first parsed heuristically from raw log text alone — fast, low-confidence. Whether it then gets a full `getParsedTransaction` call for exact enrichment depends on whether anything is actually configured to care: wallet-specific subscriptions are always enriched, generic swaps only if a tracked mint or watched wallet currently exists, transfers only if a large-transfer condition is active. RPC call volume scales with what's being watched, not with total chain throughput.

Enrichment itself computes pre/post token balance deltas and infers BUY vs. SELL vs. generic SWAP by correlating a matched wallet's SOL delta against its token deltas, with confidence scored `EXACT` / `HIGH` / `MEDIUM` / `LOW` depending on how cleanly a wallet was attributed.

A Yellowstone gRPC provider (`yellowstone-provider.ts`) is **stubbed but not implemented** — it satisfies the same ingestion interface and documents the upgrade path, but calling it throws today.

</details>

<details>
<summary><strong>Condition Engine</strong> — <code>conditions/engine.ts</code></summary>
<br/>

The matching core. Conditions live in inverted indexes (by wallet, by token mint, plus a global set for unfiltered conditions) so evaluating an event against thousands of conditions is a lookup, not a scan.

`SWAP_BURST` and `TOKEN_VOLUME` use sliding time windows and are **edge-triggered** — they fire once on the transition into threshold, not on every event while already above it. `LARGE_TRANSFER` is a single-event check. `WALLET_ACTIVITY` supports optional token, transaction-type, and minimum-amount filters and requires confidence above the lowest tier. A per-`(condition, signature)` fire cache prevents the same event firing the same condition twice even under concurrent evaluation, and mint matching falls back to a raw-log substring check when exact field extraction misses.

</details>

<details>
<summary><strong>Execution Engine</strong> — <code>execution/executor.ts</code></summary>
<br/>

Dispatches the actions on a matched condition with **three independent layers of idempotency**: an in-memory fire cache, a database-level insert-if-absent check, and a trade-submission dedup cache — the last one specifically guarding the irreversible trade path.

Webhook and log actions retry up to three times with exponential backoff; trades get exactly one attempt — irreversible side effects aren't retried. Trade dispatch is **serialized per wallet** through an in-memory lock, so two conditions firing for the same wallet at once can't both believe they have sufficient balance. Execution-limit modes ("once" / "limited" / "unlimited") are enforced with a single atomic SQL statement, not a check-then-write that could race.

</details>

<details>
<summary><strong>Trade Execution</strong> — <code>execution/tradeExecutor.ts</code>, <code>jupiter.ts</code>, <code>tradeGuard.ts</code></summary>
<br/>

Quotes come from Jupiter Aggregator v6, cached briefly and rejected outright if price impact exceeds a configurable cap. A quote's age is checked again immediately before the swap transaction is built — a stale quote is never executed against. Before any of that, `TradeGuard` runs its own independent rate limiter, live balance check, mint format validation, and (for sells) an integer-safe percentage-of-balance calculation.

Transactions are submitted with retries disabled at the RPC level (`maxRetries: 0`) and confirmed by polling rather than resubmitting, to avoid double-submission. A trade that doesn't confirm within the polling window comes back `PENDING`, not failed, and is picked up by a background checker.

</details>

<details>
<summary><strong>Wallet Custody</strong> — <code>wallets/walletManager.ts</code></summary>
<br/>

Each user gets one server-generated keypair. The current encryption scheme is **AES-256-GCM**, with a random salt and IV per wallet and the encryption key derived via `scrypt` rather than used directly — not a shared static key. A legacy AES-256-CBC decrypt path exists only for reading pre-migration records and is never used to write new ones; any wallet still on the old scheme is transparently re-encrypted the next time it's used, with no read interruption.

Exporting a key or withdrawing funds requires a short-lived, single-use step-up token (`security/sensitiveActionManager.ts`) plus a typed confirmation phrase, gated separately from normal session auth.

</details>

<details>
<summary><strong>RPC Failover</strong> — <code>rpc/rpcManager.ts</code></summary>
<br/>

Built from a provider chain: Helius primary, an optional secondary, and the public Solana RPC always present as a final fallback. Each provider tracks consecutive failures and a rolling failure window; crossing a threshold triggers an automatic failover and a live `SYSTEM_STATUS` push to every connected client, reporting `HEALTHY`, `DEGRADED`, or `FALLBACK`.

</details>

<details>
<summary><strong>Realtime Delivery</strong> — <code>ws/broadcast.ts</code></summary>
<br/>

A WebSocket server sharing the API's HTTP server. Connections authenticate via a session token in the query string and are grouped per user, supporting multiple simultaneous tabs or devices. Per-user messages (trigger events, trade lifecycle) go to one user's sockets; the live transaction feed and system-status messages broadcast to everyone. The public live feed is **sampled** — only every fifth ingested event is broadcast — to keep output bounded regardless of underlying chain volume; condition evaluation itself still sees every event.

</details>

<details>
<summary><strong>Persistence</strong> — <code>db/</code></summary>
<br/>

PostgreSQL via Supabase, accessed through a pooled connection tuned for Supavisor. No ORM — each table has one repository module exporting plain functions. Conditions are stored as a JSONB blob keyed by ID rather than fully normalized into columns, which keeps the condition shape free to evolve.

</details>

<br/>

## API surface

A REST API plus one authenticated WebSocket channel. Wallet, condition, and trade routes require a Bearer session token validated against the shared `session` table; wallet export and withdrawals additionally require a consumed step-up verification token and a typed confirmation. The live dashboard connects to `wss://<api>/ws?token=<session-token>` for a single channel carrying the live transaction feed, per-user trigger and trade-lifecycle events, and system health.

The full route list, payload shapes, and per-route rate limits are kept in the route definitions in `src/index.ts` rather than duplicated here — a second copy tends to drift from the code that actually enforces it.

<br/>

## Database

PostgreSQL via Supabase. Two things have to happen before the server will boot cleanly against a fresh database, in this order:

```bash

cd web && npx @better-auth/cli@latest migrate


cd ../server
psql "$DATABASE_URL" -f migrations/001_voluma_tables.sql
psql "$DATABASE_URL" -f migrations/002_reliability_and_security.sql
```

| Table | Holds | Source |
|---|---|---|
| `user`, `session`, `account`, `verification` | Identity, sessions, OAuth tokens | Better Auth CLI |
| `wallets` | Encrypted custodial wallet per user — public key, ciphertext, IV, KDF salt, encryption version | `001_voluma_tables.sql` |
| `conditions` | One automation per row, stored as JSONB, plus an execution counter | `001_voluma_tables.sql` |
| `trigger_stats` | Per-condition trigger count and last-fired timestamp | `001_voluma_tables.sql` |
| `pending_txs` | Trades/withdrawals submitted but not yet confirmed | `001_voluma_tables.sql` |
| `processed_events` | The database-level idempotency ledger | `001_voluma_tables.sql` |
| `trade_executions` | Full trade history — amounts, slippage, price impact, route, timing | `002_reliability_and_security.sql` |
| `wallet_activity_logs` | Security-relevant audit trail (creation, export, withdrawal, trade) | `002_reliability_and_security.sql` |

**Local vs. production connection string.** Supabase's direct host (`db.<project-ref>.supabase.co:5432`) is what `.env.example` shows and what works for local development. In production, on platforms like Vercel or Railway, that direct connection generally doesn't — switch `DATABASE_URL` to the pooled Supavisor connection instead, on both the server and the web app:

```env
# Local
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres

# Production — note the project-ref folded into the username, and port 6543
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-<region>.pooler.supabase.com:6543/postgres
```

This is also why `web/lib/auth.ts` explicitly strips `sslmode` from the URL and sets `ssl` directly when constructing the Postgres pool — `pg` otherwise applies the parsed connection string's own SSL params last and silently overrides an explicit `ssl` config.

<br/>

## Background jobs

| Job | Cadence | Does |
|---|---|---|
| Pending transaction checker | 15s | Confirms, fails, or times out (5 min) unresolved transactions |
| Cleanup | every 30 min | Prunes resolved idempotency/pending records past their retention window |
| Session cache pruning | 5 min | Clears expired entries from the in-memory session lookup cache |

<br/>

## Environment variables

<details>
<summary><strong>Show full list</strong></summary>

```env
# Required
DATABASE_URL=postgresql://...                # see the Database section above for local vs. production format
WALLET_ENCRYPTION_KEY=...                    # ≥ 32 characters
BETTER_AUTH_SECRET=...                       # ≥ 16 characters

# Origins / environment
FRONTEND_URL=https://your-web-app.example    # comma-separated CORS allow-list
NODE_ENV=production

# RPC providers
HELIUS_API_KEY=...
HELIUS_RPC_HTTP_URL=...
HELIUS_RPC_WS_URL=...
SECONDARY_HELIUS_API_KEY=...
SECONDARY_RPC_HTTP_URL=...
SECONDARY_RPC_WS_URL=...
SECONDARY_RPC_LABEL=...
SOLANA_RPC_URL=...
RPC_WSS=...

# Jupiter
JUPITER_API_KEY=...
JUPITER_QUOTE_MAX_AGE_MS=12000
JUPITER_MAX_PRICE_IMPACT_PCT=25

# Misc
PORT=3001
DEBUG_MINT_MATCHING=false
```

The public Solana RPC is always included as the final fallback regardless of configuration. The server validates the three required variables at startup and exits immediately if any are missing or too short. `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` belong to the **web app's** environment, not this one — see [`web/README.md`](../web/README.md#environment-variables).

</details>

<br/>

## Local setup

```bash
cd server
cp .env.example .env        


psql "$DATABASE_URL" -f migrations/001_voluma_tables.sql
psql "$DATABASE_URL" -f migrations/002_reliability_and_security.sql

bun src/index.ts
```

**Docker:**

```bash
docker build -t voluma-server .
docker run -p 3001:3001 --env-file .env voluma-server
```

Built on `oven/bun:1.1`, production dependencies only, runs `bun run src/index.ts` directly with no separate build step. `HEALTHCHECK` polls `GET /health` every 30 seconds.

<br/>

## Security

This is custodial software handling real funds — here's where things actually stand.

**In place today:** encrypted wallet storage with a per-wallet derived key; step-up verification and typed confirmation for export and withdrawals; SSRF protection on webhook testing and dispatch; ownership checks on every wallet/condition/trade route; three-layer trade idempotency with per-wallet locking; exact-match CORS; pre-trade balance, rate-limit, mint-format, freshness, and price-impact checks.

**Not yet hardened:** a couple of system/telemetry endpoints are intentionally public today and not yet individually rate-limited; most list/read routes rely on session auth alone rather than per-route throttling; the WebSocket layer authenticates by session token but doesn't yet separately validate connection origin. These are the first items in the [roadmap](../README.md#roadmap).

Found something? Please report it privately — see [`CONTRIBUTING.md`](../CONTRIBUTING.md#reporting-a-security-issue).

<br/>

## Upgrade path

```
Public/Helius WebSocket RPC  →  Helius Yellowstone gRPC (stub already in place)
In-memory EventQueue         →  Redis Streams / durable queue (same interface)
Single Fastify instance      →  Multiple instances behind a load balancer
```