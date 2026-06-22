<div align="center">

### Voluma Web

Next.js 15 dashboard and marketing site — one authenticated WebSocket connection per session, no polling for live data.

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)


[← Part of Voluma](../README.md) · [voluma.online](https://voluma.online)

</div>

<br/>

This is the interface: sign in, build automations, watch the chain live, manage a custodial trading wallet, review trade history. Almost everything updates over one long-lived WebSocket connection established on load — the only polling in the app is a 5-second system-stats refresh and a debounced balance refresh after a trade confirms.

<br/>

## Structure

```
web/
├── app/
│   ├── layout.tsx                  # Root layout, metadata, JSON-LD, dark mode
│   ├── globals.css                 # Tailwind + theme tokens + animations
│   ├── page.tsx                    # Marketing landing page
│   ├── login/page.tsx              # Google sign-in
│   ├── terms/ · privacy/           # Legal pages
│   ├── dashboard/page.tsx          # Main application shell
│   ├── robots.ts · sitemap.ts      # Search-engine metadata
│   └── api/auth/[...all]/route.ts  # Better Auth handler
│
├── components/                     # ConditionBuilder, ConditionList, EventFeed,
│                                    # TriggerFeed, TradeHistory, WalletPanel, SystemStats
├── hooks/                          # useSocket, useConditions, useWallet, useUserId
├── lib/                            # Better Auth client/server config, cn()
├── conditions/types.ts             # Condition/Action types (mirrors the server)
├── middleware.ts                   # Edge route protection for /dashboard
└── public/                         # favicon, OG image, web manifest
```

<br/>

## Pages

**Landing (`app/page.tsx`)** — the marketing entry point, styled independently of the rest of the app with its own scoped theme (Bebas Neue + DM Sans + JetBrains Mono on near-black, chartreuse accent). Includes an animated stat counter and a simulated terminal feed explicitly labeled in its own copy as an illustrative preview, not a live data source.

**Login (`app/login/page.tsx`)** — Google OAuth only. Redirects straight to `/dashboard` if a session already exists.

**Dashboard (`app/dashboard/page.tsx`)** — the application shell, gated behind an authenticated session. Five tabs (Live Feed, Executions, Automations, Wallet, History) plus a sidebar carrying live system metrics and a pipeline-status indicator. Responsive down to a bottom mobile nav below 1024px.

**Terms & Privacy** — static legal pages in the same visual language, linked from the dashboard and login screen.

<br/>

## Components

| Component | Does |
|---|---|
| `ConditionBuilder` | The `WHEN → THEN` visual automation builder, with live wallet/balance validation for trade actions before submission |
| `ConditionList` / `ConditionsPanel` | Active automations, with a real-time "fired" animation triggered off the live trigger stream |
| `EventFeed` | The sampled live transaction stream, with filters, pause/resume, and matched-condition highlighting |
| `TriggerFeed` | Expandable execution history — match explanation, confidence, and per-action (including trade) results |
| `TradeHistory` | Confirmed/pending/failed trade ledger with summary stats |
| `WalletPanel` | Wallet creation, animated balance, quick-sell, withdraw and export flows behind step-up verification |
| `SystemStats` | Live backend health metrics, polled every 5 seconds |

<br/>

## Hooks

| Hook | Owns |
|---|---|
| `useSocket(userId)` | The single WebSocket connection — reconnect with backoff, message routing, capped in-memory buffers for events/triggers/toasts |
| `useConditions(userId)` | CRUD against the conditions API, with optimistic create/delete/toggle |
| `useWallet(userId)` | Wallet state plus export/withdraw flows; exposes a small module-level pub/sub so a trade-success event from `useSocket` can trigger a debounced balance refresh without React context |
| `useUserId()` | The authenticated user's ID from the active Better Auth session |

<br/>

## Auth

**Better Auth**, Google as the only configured provider. `lib/auth.ts` runs server-side against the same Postgres database the backend uses, connecting through a raw `pg.Pool` rather than an ORM adapter. `middleware.ts` checks for the session cookie at the edge on any `/dashboard/*` request and redirects to `/login` if it's missing — the actual session token is re-validated server-side on every API call, this is just the first gate. The frontend and backend share one session: the same Bearer token authenticates REST calls and the WebSocket connection.

<br/>

## SEO & metadata

`app/robots.ts` and `app/sitemap.ts` generate `robots.txt`/`sitemap.xml` at build time, disallowing `/dashboard/` and pointing crawlers at the public marketing routes. `layout.tsx` carries full Open Graph and Twitter card metadata backed by `public/og-image.png`, JSON-LD `WebApplication` structured data, a Google Search Console verification tag, and a PWA-style `site.webmanifest` matching the product's chartreuse theme color.

<br/>

## Design system

| Role | Value |
|---|---|
| Background | `#070b10` |
| Accent | `#d4ff00` |
| Text primary / secondary | `#e8ecf0` / `#8a939f` |
| Wallet Activity · Swap Burst · Volume Spike · Large Transfer | `#a78bfa` · `#fbbf24` · `#22d3ee` · `#f87171` |

Display type is Bebas Neue, body copy is DM Sans, data/addresses are JetBrains Mono. The dashboard leans on inline styles rather than utility classes — most of its surface is computed from live state (firing animations, balance deltas, connection health), and that maps more directly onto inline style objects than conditional class strings. The marketing, auth, and legal pages each carry one self-contained scoped stylesheet instead.

<br/>

## Environment variables

```env
NEXT_PUBLIC_API_URL=http://localhost:3001     # the Voluma server
NEXT_PUBLIC_APP_URL=http://localhost:3000      # this app's own URL
DATABASE_URL=postgresql://...                  # same Postgres instance as the server — see
                                                # server/README.md#database for local vs. production format
BETTER_AUTH_SECRET=...                         # ≥ 16 characters, used by this app's Better Auth instance
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

The WebSocket URL is derived from `NEXT_PUBLIC_API_URL` at runtime — not configured separately. The server has its own `BETTER_AUTH_SECRET` in its own `.env`; sessions are looked up by the server directly against the `session` table rather than re-verified through Better Auth's signing logic, so this isn't a value the two services need to coordinate beyond each independently meeting Better Auth's minimum length requirement.

<br/>

## Local setup

```bash
cd web
cp .env.example .env.local
bun install

# Generates Better Auth's schema (user / session / account / verification) from
# the config in lib/auth.ts. Run this before the server's own SQL migrations —
# see server/README.md#database.
npx @better-auth/cli@latest migrate

bun run dev
```

App available at `http://localhost:3000`. Production build: `bun run build && bun run start`. The production deployment runs on Vercel, pointed at the deployed server via `NEXT_PUBLIC_API_URL`.

<br/>

## Why it's built this way

**Inline styles on the dashboard, scoped CSS on marketing pages** — the dashboard's visual state is mostly derived from live data; the marketing/legal pages are static and benefit from one isolated stylesheet instead.

**No global state library** — three independent data concerns (socket, conditions, wallet), each owned by one hook. The one real cross-concern dependency, refreshing the wallet balance after a trade, is a small pub/sub rather than a reason to add Redux or Zustand.

**A real session identity, not a local UUID** — custodial wallets and real trade execution need an accountable identity. Every wallet, condition, and trade is scoped to the authenticated user's ID end to end, frontend and backend.