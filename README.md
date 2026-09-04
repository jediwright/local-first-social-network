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

1. Connection request — client A signals intent to client B; relay exits after handshake
2. Thread sync — CRDT merge of thread history between connected clients; relay exits after sync
3. Channel discovery — lightweight interest-channel presence signal, no content stored server-side

After a connection is established, the relay is no longer in the path. Your threads, pings, and contact list are yours — before they're anyone else's.

Each of these three operations is a *crossing*: a moment where data leaves the device. How crossings are gated and recorded is governed by [`SEAM_DECISIONS.md`](SEAM_DECISIONS.md). Design tradeoffs that might look like gaps are explained in [`KNOWN_LIMITS.md`](KNOWN_LIMITS.md).

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
- Four trust tiers: `close`, `contact`, `discoverable`, `guardian`
- Backfilled from thread history on load — contacts appear even without a fresh connection
- Guardian mode for supervised accounts

**Connection**
- Share link: `localfirst.social/#/connect/@handle` — opens app pre-filled for new and existing users
- Profile card share button copies your link to clipboard
- CRDT sync merges thread history from both sides

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

Two further maps, `crossing_intents` and `crossing_records`, are specified in [`src/types/crossing.ts`](src/types/crossing.ts) and land with the Phase 4 governance work (see Status).

---

## Running Locally

```bash
git clone https://github.com/jediwright/local-first-social-network
cd local-first-social-network
npm install
cp .env.example .env.local
npm run dev
```

`.env.example` points at the production relay, so the app works against live infrastructure out of the box. To run your own relay for two-tab testing:

```bash
node relay/server.js
```

then set `VITE_RELAY_URL=ws://localhost:8080` in `.env.local` and restart `npm run dev`.

---

## Relay

The relay is deployed on Fly.io. It is stateless — a crash and restart loses nothing because all state is client-side. The handle registry is ephemeral and rebuilt from reconnecting clients (this is deliberate; see [`KNOWN_LIMITS.md`](KNOWN_LIMITS.md)).

```bash
curl https://local-first-social-relay.fly.dev/health
# {"status":"ok","handles":N,"channels":N}
```

---

## Part of the Local-First Prototype Series

This is one of the prototypes in the [Local-First Series](https://github.com/jediwright/local-first-series), which explores local-first architecture across domains:

| Prototype | Domain | Seam |
|-----------|--------|------|
| Governance Window Tracker | Civic intelligence | None — read-only |
| checkout-seam | Commerce | Once per purchase (Stripe) |
| fhir-seam | Healthcare intake | Once per submission (FHIR) |
| **Local-First Social** | **Social networking** | **Every new connection** |
| [employment-seam](https://github.com/jediwright/employment-seam) | Employment relationship | Every transition in the employer–worker relationship |

Each prototype introduces a harder version of the seam problem. Local-First Social's seam fires on every new connection, and the thing on the far side is another user's local-first client, not a stateless server — the series calls this the *distributed seam*. The employment seam that followed extends the same pattern into a regulated, multi-party relationship; its formalization is documented in the [Seam Stack](https://github.com/jediwright/seam-stack).

The architectural argument: a social network where the user owns the graph, the relay facilitates connection and then exits, and the platform never accumulates relationship data.

---

## Status

**Phase 5 complete as of April 2026.** Real-time bidirectional messaging, CRDT sync, trust graph, channels, ping streaks, share links, and asset library all working in production.

**Phase 4 governance retrofit in progress (September 2026).** The relay and connection protocol already work; what's being added is the governance layer around them, under [`SEAM_DECISIONS.md`](SEAM_DECISIONS.md). The most visible change coming: connecting with someone will no longer automatically sync thread history. Accepting a request makes you *connected*; sharing history requires the user to set a trust level themselves. Every relay operation will also write a local record of what crossed and why.

---

*Built by [J. Wright](https://systemsofthought.com) / UX Minds, LLC*
*AI-collaborative synthesis, human authorial responsibility held by J. Wright.*
*Methodology: [Systems of Thought](https://systemsofthought.com)*
