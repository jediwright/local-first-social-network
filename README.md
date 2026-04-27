# local-first-social-network

> A local-first social network architecture. The user owns the graph. The relay facilitates connection and then exits.

---

## The Architectural Argument

Most social networks are built server-first: your content, connections, and history live on their infrastructure, optimized for their revenue. This architecture inverts that.

**The network is the byproduct, not the product.**

Your social graph lives on your device, in a CRDT document persisted to IndexedDB. The relay server facilitates connection between two clients and then exits the path. The platform never accumulates relationship data, because there is no server-side graph to accumulate.

```
client A (Y.js/IndexedDB) ──handshake──▶ relay (stateless) ──handshake──▶ client B (Y.js/IndexedDB)

Ping:   ephemeral Y.js doc, relay exits after presence broadcast
Thread: persistent Y.js doc, relay facilitates CRDT merge, exits after sync
```

Three operations require relay contact. Everything else is local:

1. **New connection request** — client A signals intent to client B; relay exits after handshake
2. **Initial thread sync** — CRDT merge of thread history on first connection; relay exits after sync
3. **Channel discovery** — relay broadcasts interest-channel presence signals (no content)

After a connection is established between two clients, the relay is no longer in the path.

---

## The Social Primitive: The Ping

This is not a feed product. The feed model — endless, algorithmic, ad-optimized — is what the architecture is built against.

The primitive here is the **ping**: a low-friction, intentional signal. Not a post for broadcast. Not a message requiring a response. A ping says: *I'm here. I'm thinking about this. You're in my circle.*

Five ping types:

| Type | Signal |
|---|---|
| `here` | Presence — I'm around, thinking of you |
| `check-this` | Share — here's something worth your attention |
| `thinking-of-you` | Relationship maintenance — no response expected |
| `let's-connect` | Invitation to elevate to a thread |
| `status` | Current state — what I'm working on, where I am |

Pings are ephemeral by design. They expire. The only thing that persists is the pattern — stored locally.

---

## Stack

- **React + TypeScript** — UI
- **Y.js** — CRDT document layer
- **y-indexeddb** — local persistence
- **Tailwind** — styling
- **WebSocket relay** (Phase 4) — stateless handshake facilitator, Fly.io

---

## Data Model

All state lives in a single Y.js document persisted to IndexedDB:

```
doc.getMap('profile')   → identity, preferences, trust graph
doc.getMap('pings')     → ephemeral ping state, keyed by channel
doc.getMap('threads')   → persistent thread history, keyed by contactId
doc.getMap('channels')  → interest channel memberships
doc.getMap('assets')    → thread asset library
```

---

## Part of the Local-First Prototype Series

This is the fourth prototype in a series exploring the seam problem in local-first architecture — where and how a local-first client must touch a server, and how to keep that contact minimal.

| Prototype | Domain | Seam |
|---|---|---|
| [Governance Window Tracker](https://infinitydrive.net) | Civic intelligence | No seam — read-only, fully local |
| checkout-seam | Commerce | Fires once per purchase (Stripe) |
| fhir-seam | Healthcare intake | Fires once per submission (FHIR endpoint) |
| **local-first-social-network** | **Social graph** | **Fires on every new connection** |

Each prototype introduced a harder version of the seam. This one is the hardest: the thing on the far side of the seam is another user's local-first client, not a stateless server.

---

## Pattern Commons

This prototype contributes three patterns to the local-first pattern commons:

**The distributed seam** — where the server-dependent operation is a peer handshake rather than a server transaction. The relay facilitates connection and then exits. The social graph is built from the accumulation of distributed seams, each of which fires once and becomes a direct peer relationship.

**CRDT as trust graph** — the trust graph is not a server-side database. It is a Y.Map that lives on the client and syncs via the distributed seam on connection. Tier assignments, connection history, and sync status are all local-first state.

**Ephemeral CRDT collections** — Y.Arrays with TTL-bounded entries, cleaned by an observer on document load. Pings are the first application; the pattern applies to any local-first collection where entries should expire rather than accumulate.

---

## Design Principles

1. **Presence, not performance.** Rewards being here, not going viral.
2. **Ownership, not access.** Your data is yours before it's the platform's.
3. **Depth, not breadth.** 50 real pings beat 5,000 followers.
4. **Intentionality, not optimization.** No algorithm decides who you see.
5. **Portability as a feature.** Full export, open format, no lock-in.
6. **The relay earns nothing.** The platform facilitates connection and then exits.

---

## Live

[github.com/jediwright/local-first-social-network](https://github.com/jediwright/local-first-social-network)

---

## License

MIT — see [LICENSE](LICENSE)

---

*Part of [Systems of Thought](https://systemsofthought.com) / Local-First Prototype Series*
