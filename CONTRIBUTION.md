<div align="center">

### Contributing to Voluma

[← Back to Voluma](./README.md)

</div>

<br/>

Thanks for considering it. Voluma is two services — a Fastify/Bun backend (`server/`) and a Next.js frontend (`web/`) — sharing one Postgres database and one session model. This is a full walkthrough: getting both running locally, what trips people up the first time, what to know before touching code that moves real funds, and how to submit a change.

## Code of conduct

Be respectful, assume good faith, keep disagreements about technical direction technical. Harassment or bad-faith reviewing isn't tolerated.

<br/>

## Before you start

Voluma is custodial software: it holds users' Solana private keys (encrypted) and signs transactions on their behalf, including with real funds on mainnet. That raises the bar for some parts of this codebase relative to a typical web app — read the [Code touching wallets, trades, or execution](#code-touching-wallets-trades-or-execution) section before opening a PR in that area.

<br/>

## What you'll need

- [Bun](https://bun.sh) ≥ 1.0
- A Postgres database — a free [Supabase](https://supabase.com) project is the easiest path, since that's what production runs on
- A Google Cloud OAuth client (Web application type), with `http://localhost:3000` and your callback path registered
- A Solana RPC endpoint — the public mainnet RPC (already the default fallback) is fine for light testing; get a free [Helius](https://helius.dev) key for anything beyond that

<br/>

## Local setup

The two services need to come up in a specific order, because Voluma's own tables foreign-key reference the identity tables that Better Auth owns.

**1. Clone and set up the frontend's environment.**

```bash
git clone <repo-url> && cd voluma/web
cp .env.example .env.local
# fill in NEXT_PUBLIC_API_URL, NEXT_PUBLIC_APP_URL, DATABASE_URL,
# BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
bun install
```

**2. Generate the identity schema.** This reads the config exported from `web/lib/auth.ts` and creates `user`, `session`, `account`, and `verification` in your database. It has to run before step 4.

```bash
npx @better-auth/cli@latest migrate
```

**3. Set up the backend's environment.**

```bash
cd ../server
cp .env.example .env
# fill in DATABASE_URL (same database), WALLET_ENCRYPTION_KEY (≥ 32 chars),
# BETTER_AUTH_SECRET (≥ 16 chars), and RPC config
bun install
```

**4. Apply Voluma's own tables**, against the same database, now that `user` exists for the foreign keys to reference:

```bash
psql "$DATABASE_URL" -f migrations/001_voluma_tables.sql
psql "$DATABASE_URL" -f migrations/002_reliability_and_security.sql
```

**5. Start both services.**

```bash
# server/
bun src/index.ts

# web/ — in a second terminal
cd ../web && bun run dev
```

<br/>

## Verifying it's working

- `curl http://localhost:3001/health` returns `{"status":"ok",...}`
- `http://localhost:3000` loads the landing page, and signing in with Google lands you on `/dashboard`
- The dashboard's connection indicator in the top bar shows **LIVE**, not **OFFLINE** — that means the WebSocket handshake against your session token succeeded
- Creating a `LARGE_TRANSFER` condition with a low threshold and leaving the **Live Feed** tab open should show matching activity within a few minutes, since that condition type doesn't need a specific wallet to watch

If the server exits the instant you start it, it's almost always a missing or too-short required variable (`DATABASE_URL`, `WALLET_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`) — it validates these before doing anything else and exits with a message naming the problem.

<br/>

## Common setup issues

**`relation "user" does not exist`** when running the SQL migrations — the Better Auth CLI migration (step 2 above) hasn't been run yet, or ran against a different database than `DATABASE_URL` points to now. Run it first.

**Database connects locally but not when deployed** — Supabase's direct connection string (`db.<project-ref>.supabase.co:5432`) is what works on your machine. Most hosting platforms (Vercel, Railway included) need the pooled Supavisor connection instead — different host, port `6543`, and the project ref folded into the username (`postgres.<project-ref>`). Full detail in [`server/README.md`](./server/README.md#database).

**Google sign-in redirects to an error page** — the OAuth client's authorized redirect URI in Google Cloud Console has to match `NEXT_PUBLIC_APP_URL` exactly, including the callback path Better Auth expects (`/api/auth/callback/google`).

**Dashboard loads but the connection indicator stays OFFLINE** — usually means the server isn't reachable at `NEXT_PUBLIC_API_URL`, or the WebSocket upgrade is being blocked somewhere between them (a proxy, a CORS mismatch from `FRONTEND_URL` on the server not matching where the web app is actually running, etc).

<br/>

## Conventions already in place

- **TypeScript throughout**, no casual `any` beyond what already exists for third-party data shapes.
- **Backend input validation is Zod**, at the route boundary — see `ConditionSchema` / `ActionSchema` in `server/src/index.ts`. New routes follow the same pattern.
- **One repository module per table** in `server/src/db/`. Routes and engines call repositories; raw SQL doesn't leak outside `db/`.
- **Condition/Action types are mirrored by hand** between `server/src/conditions/types.ts` and `web/conditions/types.ts` — there's no shared package today. Change the shape in one, change it in both.
- **Dashboard components use inline styles; static pages use scoped CSS.** Match whichever pattern the file you're editing already uses.
- **Idempotency is layered, not single-point.** The execution path already has three independent dedup mechanisms plus a per-wallet lock — understand what each one covers before removing or changing one.
- **There's no test suite in this repository yet.** Adding coverage — starting with the condition engine's matching logic — is one of the highest-value contributions available.

<br/>

## Especially welcome

- Tests for `conditions/engine.ts` (sliding-window edge-triggering, cooldowns, mint matching) and `execution/executor.ts` (retry/idempotency)
- Closing the gaps listed in [`server/README.md`'s security section](./server/README.md#security)
- A working `YellowstoneProvider` (currently a stub that throws)
- Accessibility passes on the dashboard — it's built from custom inline-styled components, so a11y needs to be added deliberately
- Doc fixes — if something here no longer matches the code, that's a bug; fix it or flag it

<br/>

## Code touching wallets, trades, or execution

PRs touching `wallets/walletManager.ts`, `execution/*`, `security/sensitiveActionManager.ts`, or the execution-limit logic in `conditionRepo.ts` get extra scrutiny — bugs here have real financial consequences. There's no devnet toggle built in; `RPCManager`, `tradeExecutor.ts`, and `jupiter.ts` point at mainnet by configuration, so test with small real amounts on a wallet you don't mind losing funds from, or point your local `.env` at a devnet RPC and accept Jupiter may behave differently there.

Please explain in the PR what changed about the failure modes — a Jupiter timeout, an RPC drop mid-confirmation, two triggers racing for the same wallet — avoid weakening existing checks without discussion first, and keep diffs small.

<br/>

## PR workflow

1. Fork and branch off `main`.
2. Keep PRs scoped to one concern.
3. Explain *why*, not just *what* — especially in the execution/wallet path.
4. Reference any related issue.

This is a small, actively maintained project — review turnaround is usually fast.

<br/>

## Reporting a security issue

Voluma is early-stage and handles real funds. **Don't open a public issue for a vulnerability.** Report it privately through the contact channel on [voluma.online](https://voluma.online) with enough detail to reproduce it; we'll acknowledge and work a fix before any public disclosure. The security section of [`server/README.md`](./server/README.md#security) already lists the gaps we know about — anything beyond that is exactly the kind of report we want.

<br/>

## License

By contributing, you agree your contributions are licensed under the project's [MIT License](./LICENSE).