# Voluma Web

> Real-time automation dashboard for Solana on-chain trading

The Voluma frontend is a Next.js 14 application that connects to the Voluma server via REST API and WebSocket. It provides a live view of Solana mainnet activity, a visual pipeline builder for creating automations, an execution history feed, and a wallet manager with server-side AES-256 encrypted key storage.

---

## What This Is

The web app is the interface through which users:

1. **Watch the chain live** — every transaction from monitored DEX programs streams in real time via WebSocket
2. **Build automations** — a visual node-based pipeline builder (WHEN trigger → THEN action) that creates backend conditions
3. **See their automations fire** — the Executions panel receives real-time push notifications when conditions match
4. **Manage their trading wallet** — create, fund, and monitor the dedicated keypair that executes automated trades

Everything updates in real time without page refreshes. The WebSocket connection handles both the live transaction feed (broadcast to all users) and personal trigger notifications (scoped per user).

---

## Project Structure

```
web/
├── app/
│   ├── layout.tsx                  # Root layout, fonts, metadata
│   ├── globals.css                 # Tailwind + global CSS + animations
│   ├── page.tsx                    # Landing page
│   └── dashboard/
│       └── page.tsx                # Main dashboard — tabs, layout, state wiring
│
├── components/
│   ├── ConditionBuilder.tsx        # Visual pipeline builder (WHEN → THEN nodes)
│   ├── ConditionList.tsx           # Active automations with live fire animations
│   ├── ConditionsPanel.tsx         # Container — list + builder together
│   ├── EventFeed.tsx               # Live Solana transaction stream
│   ├── TriggerFeed.tsx             # Execution history with expandable detail
│   ├── WalletPanel.tsx             # Wallet create/fund/withdraw/balance
│   └── SystemStats.tsx             # Backend health metrics sidebar
│
├── hooks/
│   ├── useSocket.ts                # WebSocket client, reconnect, event routing
│   ├── useConditions.ts            # Conditions CRUD with optimistic updates
│   ├── useWallet.ts                # Wallet state, trade success callbacks
│   └── useUserId.ts                # Browser-local UUID identity
│
├── conditions/
│   └── types.ts                    # Shared TypeScript types (mirrors server types)
│
├── .env.example
├── package.json
├── next.config.ts
└── README.md
```

---

## Pages

### Landing Page (`app/page.tsx`)

Marketing page explaining what Voluma does. Includes:
- Animated terminal feed showing simulated live transactions
- Stats section (condition types, latency, tx volume)
- How it works (3-step flow)
- Condition type showcase
- Feature grid
- Architecture section
- CTA to dashboard

### Dashboard (`app/dashboard/page.tsx`)

The main product interface. Layout:

```
┌─────────────────────────────────────────────────────┐
│  TOPBAR: Logo | Tab navigation | Connection status  │
├───────────────┬─────────────────────────────────────┤
│   SIDEBAR     │              MAIN AREA              │
│               │                                     │
│  • Nav items  │  Active tab content:                │
│  • Pipeline   │  - Live Feed (EventFeed)            │
│    status     │  - Executions (TriggerFeed)         │
│  • System     │  - Automations (ConditionsPanel)    │
│    metrics    │  - Wallet (WalletPanel)             │
│  • Network    │                                     │
│    info       │                                     │
└───────────────┴─────────────────────────────────────┘
│           MOBILE NAV BAR (hidden on desktop)        │
└─────────────────────────────────────────────────────┘
```

State managed in `page.tsx`:
- `useUserId()` — stable browser identity
- `useSocket(userId)` — WebSocket connection, live events, trigger events
- View state (`'feed' | 'triggers' | 'conditions' | 'wallet'`)
- Trade success callback wiring (`_onTradeSuccessRef`)

---

## Components

### `ConditionBuilder.tsx`

Visual node-based automation builder. The UI mirrors how a builder like n8n or Zapier works — two pipeline nodes connected by an animated SVG line.

**Structure:**
```
[Automation Name + Cooldown]

[WHEN node] ──────→ [THEN node]
     ↓                    ↓
  Config panel        Config panel
  (collapses          (collapses
   open/shut)          open/shut)

[Deploy Automation button]
```

**WHEN node (trigger configuration):**
- Select from 4 condition types via card grid
- Type-specific fields appear below in an animated panel
- `WALLET_ACTIVITY`: wallet address, transaction type, min amount
- `SWAP_BURST`: token mint, min swap count, time window
- `TOKEN_VOLUME`: token mint, min volume in SOL, time window
- `LARGE_TRANSFER`: minimum SOL threshold

**THEN node (action configuration):**
- 4 action type tabs: Push Notify, Webhook, Server Log, Auto Trade
- `WEBHOOK`: URL input + live test button (hits `/webhook/test` endpoint)
- `AUTO TRADE`: direction (BUY/SELL), token selector (known tokens + custom mint), amount, slippage, execution limit (once/limited/unlimited)

**Trade action wallet check:**
When Trade is selected, the component fetches `/wallet/:userId` to verify a wallet exists and show balance. Shows clear error if wallet is missing with link to Wallet tab.

**Node connector:**
Animated SVG line between nodes with a traveling dot when both nodes are configured. Becomes active/glowing once trigger and action are both set.

**Form state management:**
- All form state is in a single `Partial<Condition>` object
- Changes sync immediately to node preview cards
- Submits to `POST /conditions` on "Deploy Automation"
- Optimistic add via `onCreated` callback to parent

---

### `ConditionList.tsx`

Renders the list of active automations. Each condition is a `ConditionCard` component.

**ConditionCard features:**
- **Live state detection**: Compares `lastTriggered` timestamp in a `useRef` — when the value changes (new trigger from server poll), fires local animations
- **Firing state (3 seconds)**: Card border glows in the condition's type color, top accent bar lights up, `● FIRED` badge animates in, pipeline connector shows traveling dot
- **High frequency warning**: Detects conditions firing faster than expected (≥2 triggers within 2× cooldown window), shows `⚠` icon
- **Toggle switch**: Enable/disable condition with optimistic UI update + server sync
- **Delete button**: Hidden until card hover, confirms via optimistic removal
- **Pipeline flow visualization**: Mini [TRIGGER node] → [ACTION node] within each card showing configured params

---

### `EventFeed.tsx`

Live stream of Solana transactions received via WebSocket broadcast.

**Features:**
- Sliding animation for new rows entering from the left
- Triggered transactions highlighted with `#d4ff00` accent and `⚡` icon, showing condition name
- Filter pills: ALL / SWAP / TRANSFER / UNKNOWN
- Pause/Resume with buffered count showing how many events arrived while paused
- Pipeline header showing ingestion stages with live pulsing dots
- "N matched" counter showing how many visible events triggered a condition
- Links to Solscan for each transaction signature

**Column layout:**
```
Type  │  Transaction Signature  │  Token Mint  │  Age
```

---

### `TriggerFeed.tsx`

Execution history — every time a condition fires, an entry appears here in real time.

**Expandable rows:**
- Collapsed: status dot + condition name + result badge + age
- Expanded: full explanation, matched fields, confidence, details grid, trade result, action badges

**Trade result card** (when expanded):
- BUY (green) or SELL (red) direction indicator
- Amount in SOL + token mint
- Execution latency in ms
- Clickable transaction hash → Solscan

**Importance classification:**
- `CRITICAL`: Large transfer ≥ 1,000 SOL
- `HIGH`: Volume spike, any trade action, high confidence ≥ 100 SOL
- `NORMAL`: Everything else

Newest execution auto-expands.

---

### `WalletPanel.tsx`

Wallet management with server-side encrypted key storage.

**Features:**
- **Pending transactions display**: Shows pending/confirmed/failed status for recent trades with input/output mints and amounts
- **Token quick-sell**: 25%/50%/100% buttons for instant token → SOL swaps with quote preview

**States:**
1. **No wallet** → Create wallet CTA
2. **Wallet exists, unfunded** → Balance display with amber warning glow + fund instructions
3. **Wallet ready** → Full balance display with green glow

**BalanceNumber component:**
When `balanceSol` changes (triggered by a completed trade via `notifyTradeSuccess`), the number animates from old value to new value using `requestAnimationFrame` easing. A delta badge (`+0.0012`) floats above and fades after 3.5 seconds.

**Balance card:**
- Animated glow: green pulse when funded, amber pulse when low
- Token holdings (SPL tokens with balance > 0)
- Wallet address with one-click copy
- Status badge (READY / LOW)

**Withdraw:**
- Inline expand panel
- Client-side validation before sending to API
- Success state with Solscan transaction link

**Wallet validation in ConditionBuilder:**
When Trade action is selected in `ConditionBuilder.tsx:289-327`, the component fetches `/wallet/:userId` to verify wallet existence and show balance before allowing condition creation.

---

### `SystemStats.tsx`

Sidebar widget showing live backend metrics. Polls `/stats` every 5 seconds.

| Metric | Description |
|--------|-------------|
| Queue | Depth / in-flight items |
| Automations | Active condition count |
| Clients | Connected WebSocket sessions |
| Events | Total transactions processed |
| Drop rate | % of events dropped (queue overflow) |
| Trade rate | % of automated trades succeeded |
| Uptime | Server uptime formatted |

Each value flashes chartreuse (`#d4ff00`) on change. Warn color (`#fbbf24`) when queue depth > 1,000 or trade success < 80%.

---

### Trade Toast Notifications (`dashboard/page.tsx:69-122`, `useSocket.ts:139-150`)

Toast queue for trade execution feedback:
- **Success**: Green toast with Solscan link (auto-dismiss after 3 seconds)
- **Pending**: Amber toast while awaiting on-chain confirmation
- **Error**: Red toast with error message
- Queue system prevents overlapping toasts

---

## Hooks

### `useSocket.ts`

WebSocket client with full lifecycle management.

**Key behaviors:**
- Connects to `ws://<API_URL>/ws?userId=<uuid>` on mount
- Exponential backoff reconnect (1.5s, 2.25s, ..., max 30s)
- Generation counter prevents stale callbacks after reconnect
- Separate state refs for live events and trigger events to avoid closure staleness
- `MAX_LIVE_EVENTS=200`, `MAX_TRIGGERS=100` — prevents memory growth
- `triggeredSigs` map tracks which transaction signatures triggered conditions (for EventFeed highlighting)
- `_onTradeSuccessRef` — allows parent to inject trade success callback without prop drilling

**Message routing:**
```
ws message → parse JSON
  → type === 'LIVE_EVENT' → prepend to liveEvents
  → type === 'TRIGGER'    → prepend to triggers
                          → update triggeredSigs
                          → call onTradeSuccessRef if TRADE action succeeded
```

---

### `useConditions.ts`

Conditions CRUD with optimistic updates.

- **`refetch()`**: Load conditions from `GET /conditions/:userId`
- **`addOptimistic(cond)`**: Immediately add to local state (called after creation, before server confirmation)
- **`deleteCondition(id)`**: Optimistic remove, refetch on error
- **`toggleCondition(id, enabled)`**: Optimistic toggle, refetch on error

---

### `useWallet.ts`

Wallet state management with trade-triggered balance refresh.

**Module-level listener pattern:**
```typescript
// In useWallet.ts (module scope)
const tradeSuccessListeners = new Set<(userId: string) => void>();
export function notifyTradeSuccess(userId: string): void { ... }
```

When `useSocket` detects a successful TRADE action, it calls `notifyTradeSuccess(userId)`. Any mounted `useWallet` instance for that userId schedules a debounced refresh (3 second delay — gives RPC time to reflect on-chain state).

This avoids prop drilling, context, or global state management for the cross-component communication.

---

### `useUserId.ts`

Returns a stable UUID stored in `localStorage` under key `voluma_user_id`. Returns empty string during SSR — all hooks and API calls defer until this is populated.

---

## Design System

The application uses a custom dark theme with a consistent palette:

| Role | Color |
|------|-------|
| Background | `#070b10` (near black with blue undertone) |
| Surface | `rgba(255,255,255,0.018)` |
| Border | `rgba(255,255,255,0.07)` |
| Accent (primary) | `#d4ff00` (chartreuse) |
| Text primary | `#e8ecf0` |
| Text secondary | `#8a939f` |
| Text dim | `#3d4452` |
| WALLET_ACTIVITY | `#a78bfa` (violet) |
| SWAP_BURST | `#fbbf24` (amber) |
| TOKEN_VOLUME | `#22d3ee` (cyan) |
| LARGE_TRANSFER | `#f87171` (red) |
| TRADE action | `#d4ff00` (chartreuse) |
| WEBHOOK action | `#38bdf8` (sky blue) |
| NOTIFY action | `#a78bfa` (violet) |

**Fonts:**
- Display/headings: `Bebas Neue` (all-caps, technical feel)
- Body: `DM Sans` (clean, readable)
- Code/data: `JetBrains Mono` (monospace for addresses, stats, timestamps)

All three fonts are loaded from Google Fonts.

---

## Environment Variables

```env
# Required
NEXT_PUBLIC_API_URL=http://localhost:3001

# Production example
NEXT_PUBLIC_API_URL=https://your-voluma-server.com
```

The WebSocket URL is derived automatically:
```typescript
NEXT_PUBLIC_API_URL.replace('https', 'wss').replace('http', 'ws')
// http://localhost:3001 → ws://localhost:3001
// https://api.voluma.io → wss://api.voluma.io
```

---

## Local Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.0 (or Node.js >= 18)
- Voluma server running on port 3001 (see [`../server/README.md`](../server/README.md))

### Installation

```bash
# From the web directory
cd web

# Install dependencies
bun install

# Copy environment file
cp .env.example .env.local

# Set your API URL (default works if server is on localhost:3001)
# NEXT_PUBLIC_API_URL=http://localhost:3001

# Run development server
bun run dev
```

App available at `http://localhost:3000`.

### Production Build

```bash
bun run build
bun run start
```

---

## Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| Desktop (>1024px) | Sidebar + top tabs visible, main content area |
| Tablet/Mobile (≤1024px) | Sidebar hidden, top tabs hidden, bottom mobile nav shown |
| Mobile (≤640px) | Brand subtitle hidden, condensed spacing |

---

## Real-Time Data Flow

```
Server WebSocket broadcast
         │
         │  ws message (type: LIVE_EVENT)
         ▼
    useSocket.ts
         │  setLiveEvents([newEvent, ...prev].slice(0, 200))
         ▼
    EventFeed.tsx
         │  Render with sliding entry animation

Server WebSocket (user-scoped)
         │
         │  ws message (type: TRIGGER)
         ▼
    useSocket.ts
         │  setTriggers([trigger, ...prev].slice(0, 100))
         │  updateTriggeredSigs(signature → conditionName)
         │  if TRADE success → notifyTradeSuccess(userId)
         ▼
    TriggerFeed.tsx          EventFeed.tsx
    (new execution row)      (highlight triggered tx)

notifyTradeSuccess(userId)
         │
         ▼
    useWallet.ts
    (debounced balance refresh after 3s)
         │
         ▼
    WalletPanel.tsx
    (animated balance number update + delta badge)
```

---

## Key Design Decisions

**Why inline styles instead of Tailwind utility classes?**
The dashboard components require extensive dynamic styling based on real-time state (condition firing, balance thresholds, live/idle states). Inline styles with computed values are cleaner for this than building conditional class strings. Tailwind is used in the landing page where styling is static.

**Why no state management library (Redux, Zustand)?**
The app has three separate data concerns: live events (WebSocket), conditions (REST), and wallet (REST + WebSocket callback). Each has its own hook with clear ownership. The `notifyTradeSuccess` module-level listener handles the one cross-concern communication path. Adding a state manager would add complexity without benefit at this scale.

**Why browser-local UUID identity?**
The current identity model is intentional for the hackathon build. It allows zero-friction first use (no signup required, open dashboard and start). The UUID is stable across page refreshes for the same browser/profile. The upgrade path to proper authentication (magic link, wallet sign-in) is a known next step and doesn't require changes to the backend API — just swap the identity source.

**Why shadcn/ui for only one component (Select)?**
The native HTML `<select>` is difficult to style consistently across browsers. Everything else in the UI uses custom components because the design requirements are specific enough that component libraries would require more overriding than building from scratch.