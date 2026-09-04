# SocialPings — Phase 4 Seam Decisions

**Status:** LOCKED 2026-09-03, revision 2 (supersedes r1 of 2026-09-02)
**Governs:** All Phase 4 (relay + connection protocol) sessions on `jediwright/local-first-social-network`
**Baseline:** repo HEAD `9860e12` (2026-04-29), deployed at localfirst.social
**Source:** `socialpings-next-steps-spec_2026-09-02.md` §Phase 4, §Open Questions; pre-build seam-decision session 2026-09-02/03
**Companion files:** `src/types/crossing.ts` (S4-2 as code), `KNOWN_LIMITS.md` (S4-3, S4-4 in plain language)

## Retrofit notice — read before opening a Phase 4 session

The September 2026 spec describes the codebase as "Phase 1 COMPLETE, Phases 2–3 not built." That is stale. At HEAD `9860e12` the repo already contains the relay server (`relay/server.js`), the relay client (`src/lib/relay.js`), CRDT sync (`src/lib/crdt.js`), contacts with trust tiers, threads, channels, and assets — the April build line through Phase 5. **Phase 4 under this file is a governance retrofit onto running code, not a greenfield build.** Sessions should read the existing implementation before changing it, and prefer the smallest diff that satisfies each decision.

Build sessions open against this file as fixed. A decision here is changed only in a new seam-decision session that supersedes this file with a dated revision.

---

## S4-1 — Standing grant model (amended, S4-1a)

**Decision.** The trust graph entry in `trust_graph` (accessed via `getTrustGraphMap()`) is the grant. Every entry carries a `grantId` (via `generateId()`). The relay seam gate checks, at crossing time, whether an entry exists for the target contact **and whether that entry's status permits the requested crossing type**; otherwise the crossing fails closed and no relay message is sent.

**S4-1a — connection and trust are separate.** Two facts are recorded independently on the entry:

- *Connection status* (`syncStatus`): `pending` → written by the initiator before a connection request is sent; `synced` → set when the peer accepts. This is the peer's decision about reachability, not a decision about the initiator's data.
- *Trust level* (`tier`): set **only by the user of this device**, never by the peer's acceptance. A new entry created by a connection request or an acceptance lands at the lowest tier (`discoverable`) with `grantedBy: 'default'`. Raising the tier is an explicit user act recorded as `grantedBy: 'self'` with `grantedAt`.

Gate table:

| crossingType | passes when |
|---|---|
| `connection-request` | entry exists with `syncStatus: 'pending'` or `'synced'` (the request creates the pending entry; write-before-fire applies to the grant itself) |
| `thread-sync` | entry exists, `syncStatus: 'synced'`, **and** `grantedBy: 'self'` with tier ≥ `contact` |
| `channel-discovery` | entry exists, `syncStatus: 'synced'`, **and** `grantedBy: 'self'` (any tier ≥ `discoverable`) |

**Rationale.** Acceptance is the other party's act and must not grant them access to this user's history; the trust entry already exists as a timestamped, user-owned record, so making the user's own tier-setting the grant gives Phase 4 a real grant without a second artifact.

**Implications for Phase 4 build (against HEAD `9860e12`).**
- `TrustEntry` in `src/store/ydoc.ts` gains three fields: `grantId: string`, `grantedBy: 'default' | 'self'`, `grantedAt: string | null`. `syncStatus: 'pending'` already exists in the type and is currently never set; it now is.
- `addContact()` sets `grantId`, `grantedBy: 'default'`, `grantedAt: null`. `updateContactTier()` sets `grantedBy: 'self'` and `grantedAt`. A one-time backfill on `persistenceReady` assigns `grantId` to existing entries and marks them `grantedBy: 'default'` — existing contacts lose thread-sync eligibility until the user re-confirms their tier. That is intended; surface it in the UI, do not silently grandfather.
- `sendConnectionRequest()` in `src/lib/relay.js` writes the pending entry (via a new `addPendingContact()` helper) **before** `sendMessage()`. On reject, or on the 60 s timeout, the pending entry is removed.
- The `CONNECTION_ACCEPTED` handler currently calls `addContact(peerKey, 'contact')` and then, on `syncSignal`, immediately runs `initiateSyncHandshake()`. Both change: the entry is promoted to `syncStatus: 'synced'` at tier `discoverable`, and **automatic sync-on-accept is removed**. Thread sync becomes a user-initiated crossing gated per the table above.
- The gate is one function, `canCross(contactId, crossingType): { ok: true } | { ok: false, reason: string }`, exported from `ydoc.ts` (it reads the Y.js document; it does not belong in the relay transport layer). `relay.js` calls it before every send.
- Key normalization: `trust_graph` keys are bare lowercase handles; the wire uses `@handle`. `relay.js` already normalizes with `.replace(/^@/, '').toLowerCase().trim()` at the accept site — reuse that exact normalization in the gate lookup, or the fail-closed path fires on valid contacts.
- `getTrustGraphMap()` is a function returning a live reference; there is no stale-module-constant hazard.
- A `block` from the gate still writes a completion record (S4-2). Silence is not a result.
- The Phase 3 `thread_intents` map named in the spec does not exist at HEAD. Phase 4 does not depend on it; when it is added, a `thread-sync` intent record may cite it in addition to the trust entry.
- `TrustSettings.tsx` is the UI surface where `grantedBy: 'self'` gets set. It needs a visible distinction between "connected" and "trusted."

---

## S4-2 — Crossing record schema

**Decision.** Two append-only Y.js maps on the originating client: `doc.getMap('crossing_intents')` (keyed by `intentId`) and `doc.getMap('crossing_records')` (keyed by `recordId`). Required fields on both: `grantReference`, `crossingParty`, `crossingType` (`connection-request | thread-sync | channel-discovery`), `timestamp`, `result` (`pass | block`), `chainReference`. Locked additions: `contactId` on both records; optional `blockReason` on the completion record only.

`chainReference` semantics: on an **intent** record it points to the upstream completion record's `recordId`, and is `null` only for `connection-request` (root of chain). On a **completion** record it is always the `intentId` it fulfils, never `null`.

**Rationale.** These are the fields a crossing needs to carry to satisfy the four governed-crossing properties (declared scope, grant, gate, record) while remaining readable on the device without dereferencing anything else.

**Implications for Phase 4 build (against HEAD `9860e12`).**
- Interfaces are fixed in `src/types/crossing.ts`. Do not add, remove, or retype fields in a build session.
- `ydoc.ts` currently declares five top-level maps. Add two: `crossingIntentsMap = doc.getMap<CrossingIntentRecord>('crossing_intents')` and `crossingRecordsMap = doc.getMap<CrossingCompletionRecord>('crossing_records')`. Update the file header comment, which enumerates the maps.
- Export exactly two mutation helpers: `writeCrossingIntent()` and `writeCrossingCompletion()`. Export no delete or prune helper for either map. Append-only is a convention the helpers enforce.
- Neither map is touched by `pruneAllExpiredPings()` or `pruneExpiredPingHistory()`.
- Write-before-fire: the intent record is committed inside `doc.transact()` before the `socket.send()`. On a local gate `block`, the completion record is written immediately with `blockReason: 'gate-failed-closed'` and no socket send occurs.
- `relay/server.js` must emit a crossing event on every operation completion (`CONNECTION_REQUEST_ROUTED`, `CONNECTION_REQUEST_FAILED`, `CONNECTION_ACCEPTED`, `CONNECTION_REJECTED`, sync-complete, channel join/leave acks) carrying a `relayId` field; `crossingParty` on the completion record is taken from that payload, not assumed. Until the server emits it, use the `RELAY_URL` hostname and note the gap in the record.
- `exportLocalState()` gains `crossingIntents` and `crossingRecords` alongside `profile`, `channels`, `assets`. Phase 6 asserts their presence.

---

## S4-3 — Keyhive is post-MVP

**Decision.** Phase 4 does not introduce Keyhive or `@automerge/automerge-repo-keyhive`. Trust tier enforcement is convention-enforced (application code following S4-1). Keyhive-based capability enforcement is the named post-MVP upgrade path.

**Rationale.** The stakes of a social connection do not justify the alpha dependency and delegation machinery the employment seam required, and the S4-2 crossing records already provide an evidence plane without cryptographic enforcement.

**Implications for Phase 4 build.**
- Stack stays React + TypeScript + Tailwind + Y.js + y-indexeddb. No Automerge.
- No `package.json` changes that add Keyhive or Automerge packages in any Phase 4 session. If a session finds itself wanting one, that is a signal to stop and reopen this file in a seam-decision session, not to proceed.
- `canCross()` (S4-1) is the single substitution point for a future capability check. Keep it free of transport concerns.
- `KNOWN_LIMITS.md` entry 1 is the public-facing statement of this limit and ships with Phase 4.

---

## S4-4 — Relay registry is ephemeral by design

**Decision.** The relay's `@handle → socket` registry (`handleRegistry` in `relay/server.js`) is held in memory only and is rebuilt from reconnecting clients after a relay restart. No persistent handle store is introduced. This is an architectural tradeoff, recorded as such, not a defect to be fixed in Phase 4.

**Rationale.** A persistent handle database would be the first durable server-side state and would make the relay the authority on identity, contradicting the facilitate-and-exit principle.

**Implications for Phase 4 build (against HEAD `9860e12`).**
- Already true at HEAD: `handleRegistry` and `socketHandles` are plain `Map`s; `/health` reports `handles: handleRegistry.size`; the client re-sends `REGISTER_HANDLE` on every socket open. Keep all three.
- Correction to r1: the client's `HANDLE_TAKEN` handler is a **fixed 3 s retry repeated indefinitely**, not a bounded backoff. The bounded exponential backoff (`RECONNECT_*` constants) applies to socket reconnection only. Bounding the handle retry and surfacing a user-visible state after N failures is a Phase 4 build item; it does not alter this decision.
- `KNOWN_LIMITS.md` entry 2 is the public-facing statement and ships with Phase 4.

---

## S4-5 — Two-tab simulation is the Phase 4 acceptance test

**Decision.** Phase 4 acceptance is demonstrated with two browser tabs on one machine simulating two users, against a locally running relay. A two-device test against the production relay (localfirst.social) is Phase 6 acceptance, not Phase 4.

**Rationale.** Two tabs exercise the complete handshake, gate, and crossing-record path without coupling Phase 4 to deployment work that belongs in Phase 6.

**Implications for Phase 4 build (against HEAD `9860e12`).**
- The April build line already passed handshake, merge, and relay-exit under two tabs. Under the retrofit, S4-5 is a **regression check plus new assertions**, not a first pass.
- Each tab must use an isolated IndexedDB namespace (distinct `DB_NAME`) or the "two users" share one document and the test is invalid.
- Acceptance checklist for the Phase 4 close session: (1) connection request writes a `pending` trust entry before the socket send; (2) `crossing_intents` holds the intent before relay contact; (3) accept promotes to `synced` at tier `discoverable` and **does not** trigger sync; (4) `thread-sync` is blocked with a completion record until the user raises the tier; (5) after raising the tier, `thread-sync` passes and history merges; (6) `crossing_records` holds a completion for every intent, pass or block; (7) relay log shows exit after sync; (8) both tabs operate with relay stopped; (9) `exportLocalState()` includes both crossing maps.
- Do not deploy to Fly.io or Vercel in a Phase 4 session. That is Phase 6 scope.

---

## Change log

| Date | Rev | Change |
|---|---|---|
| 2026-09-02 | r1 | Initial lock, S4-1 through S4-5, written against the spec's stated phase state. |
| 2026-09-03 | r2 | Retrofit notice added after repo verification at HEAD `9860e12`. S4-1 amended (S4-1a: connection/trust separation, pending-entry root case, gate table). S4-4 retry-policy correction. S4-5 reframed as regression + new assertions. All implications rewritten against actual symbols. |

*Systems of Thought / J. Wright. AI-collaborative synthesis, human authorial responsibility held by J. Wright.*
