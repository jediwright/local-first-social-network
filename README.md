# Local-First Social

A social network where you own your graph. The relay facilitates connection and then exits. The platform never accumulates your relationship data.

**Live:** [localfirst.social](https://localfirst.social)

---

## What it is

Local-First Social is a social network built on a different architectural premise: your content, connections, and history live on your device first. The server is minimal by design — it facilitates the initial handshake between two people and then gets out of the way.

The social primitive is the **ping** — a low-friction, intentional signal. Not a post optimized for engagement. Not a message requiring a response. A ping says: *I'm here. I'm thinking about this. You're in my circle.*

Five ping types:

| Type | Signal |
|---|---|
| `here` | Presence — I'm around |
| `check-this` | Share — worth your attention |
| `thinking-of-you` | Relationship maintenance, no response expected |
| `let's-connect` | Invitation to start a thread |
| `status` | What I'm working on, where I am |

Pings expire. They don't accumulate into a feed you have to clear. The pattern of who pings whom, about what, and how often is what builds the social graph — and that graph lives on your device.

---

## Architecture

All application state lives in a single Y.js document persisted to IndexedDB via `y-indexeddb`. There is no user database, no server-side session, no backend that owns your relationships.

```
client (Y.js / IndexedDB)
    ↕ WebSocket handshake
relay (stateless — facilitates connection, exits after sync)
    ↕ WebSocket handshake
client (Y.js / IndexedDB)
```

**Three operations require the relay:**

1. New connection request — client A signals intent to client B; relay exits after handshake
2. Initial thread sync — CRDT merge of thread history on first connection; relay exits after sync
3. Channel presence — lightweight discovery signal, no content stored server-side

After a connection is established, the relay is no longer in the path. Your threads, pings, and contact list are yours — before they're anyone else's.

**Stack:**

- React + TypeScript + Tailwind
- Y.js + y-indexeddb (local-first state)
- WebSocket relay on Fly.io (stateless, persistent connections)
- Deployed on Vercel

---

## Features

**Pings**
- Five ping types with configurable TTL (24h to 30 days)
- Interest channels — opt-in, no algorithm, no follower count
- Ping streaks and daily activity tracking
- Save and share pings; URLs in ping content are clickable
- TTL progress bar on each ping card

**Threads**
- Full conversation history, owned locally
- Persists offline — readable after any prior online session
- Asset library — links and files shared in threads, searchable
- Messages sorted by timestamp; CRDT merge preserves order across devices

**Contacts**
- Trust graph stored locally as Y.Map
- Two tiers: `close` (full sync) and `contact` (limited)
- Backfilled from thread history on load — contacts appear even without a fresh connection
- Guardian mode for supervised accounts

**Connection**
- Share link: `localfirst.social/#/connect/@handle` — opens app pre-filled for new and existing users
- Profile card share button copies your link to clipboard
- CRDT sync on connection merges thread history from both sides

---

## Design Principles

1. **Presence, not performance.** Rewards being here, not going viral.
2. **Ownership, not access.** Your data is yours before it's the platform's. Export is a first-class feature.
3. **Depth, not breadth.** 50 real pings beat 5,000 followers.
4. **Intentionality, not optimization.** No algorithm decides who you see.
5. **Portability as a feature.** Full export, open format, no lock-in.
6. **The relay earns nothing.** Infrastructure facilitates connection and exits. It does not accumulate relationship data.

---

## Data Model

```
doc.getMap('profile')      → identity, preferences, trust graph
doc.getMap('pings')        → ephemeral ping state, keyed by channel
doc.getMap('threads')      → persistent thread history, keyed by contactId
doc.getMap('channels')     → interest channel memberships
doc.getMap('assets')       → thread asset library, keyed by assetId
```

The trust graph is a `Y.Map` nested inside `profile` — not a server-side database. Tier assignments, connection history, and sync status are all local-first state.

---

## Running Locally

```bash
git clone https://github.com/jediwright/local-first-social-network
cd local-first-social-network
npm install
cp .env.example .env.local
npm run dev
```

The relay is required for connections between users. A local relay can be run from `relay/server.js`:

```bash
node relay/server.js
```

Update `VITE_RELAY_URL` in `.env.local` to point to your local relay instance.

---

## Relay

The relay is deployed on Fly.io. It is stateless — a crash and restart loses nothing because all state is client-side. The handle registry is ephemeral and rebuilt from reconnecting clients.

```bash
curl https://local-first-social-relay.fly.dev/health
# {"status":"ok","handles":N,"channels":N}
```

---

## Part of the Local-First Prototype Series

This is the fourth prototype in a series exploring local-first architecture across domains:

| Prototype | Domain | Seam |
|-----------|--------|------|
| Governance Window Tracker | Civic intelligence | None — read-only |
| checkout-seam | Commerce | Once per purchase (Stripe) |
| fhir-seam | Healthcare intake | Once per submission (FHIR) |
| **Local-First Social** | **Social networking** | **Every new connection** |

Each prototype introduced a harder version of the seam problem. Local-First Social introduces the hardest version: the seam fires on every new connection, and the thing on the far side is another user's local-first client, not a stateless server.

The architectural argument: a social network where the user owns the graph, the relay facilitates connection and then exits, and the platform never accumulates relationship data.

---

## Status

Phase 5 complete as of April 2026. Real-time bidirectional messaging, CRDT sync, trust graph, channels, ping streaks, share links, and asset library all working in production.

---

*Built by [J. Wright](https://systemsofthought.com) / UX Minds, LLC*
*AI-collaborative development: Claude Sonnet 4.6 / Anthropic*
*Methodology: [Systems of Thought](https://systemsofthought.com)*
