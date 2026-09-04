# Contributing to local-first-social-network

This repository follows the [Governed PR Framework v0.4](https://github.com/jediwright/governed-pr-framework) (J. Wright).
This file is a governed derivative of that framework. Inheritance rules: §8 of `FRAMEWORK.md`.

---

## What this repository is

`local-first-social-network` (SocialPings) is a local-first prototype implementing the Relay Seam pattern — user-side governance of what crosses a stateless relay at the social-connection boundary. The core claim: a person should be able to connect with, sync with, and be discovered by contacts through a relay that facilitates the handshake and then exits, without the relay or the platform ever holding custody of their relationship data.

Governing record: `SEAM_DECISIONS.md` (S4-1 through S4-5, locked 2026-09-03 r2)  
Public statement of design limits: `KNOWN_LIMITS.md`  
Locked schema as code: `src/types/crossing.ts`

---

## Review scale

This repository operates at **S1 — Solo + AI assistant** (§3 of the framework). There is one author; PRs are reviewed by the author in a separate session or context from the one that produced the code, against the written spec and acceptance criteria.

For Critical changes on protected surfaces, the compensating mechanism is external verification — checking the design claim against the Y.js/y-indexeddb ecosystem or the governing record before merge. The ecosystem is the second reviewer of record for boundary-layer claims at this scale.

---

## Change tiers — the short version

Tier is determined by **how far a failure would spread**, not by line count.

| Tier | When to use it |
|---|---|
| **Low-risk** | Failure would be local and visible: a rename, a constant, a test-only change, copy. |
| **Feature** | Failure could spread within one bounded area: a new feature, a module refactor, a behavior change in one component. |
| **Critical** | Failure could be silent or unrecoverable. See the protected surfaces list below. |

**Tier disputes resolve upward** — if author and reviewer disagree (including across sessions), the higher tier applies.

---

## Protected surfaces

Changes touching any of the following are **automatically Critical**, regardless of diff size. K4 applies: no `Unverified` tags on protected-surface claims.

**Schema and data conventions**

- `src/types/crossing.ts` — the locked crossing-record schema (S4-2). Any addition, removal, or modification of an exported type or field is a Critical change and is out of scope for build sessions entirely; interfaces here change only in a seam-decision session that supersedes `SEAM_DECISIONS.md`.
- `src/store/ydoc.ts` — top-level Y.js map declarations, `TrustEntry` (including `grantId`, `grantedBy`, `grantedAt`, `syncStatus`, `tier`), and the exported mutation helpers. Changes here affect every document created by every installation.
- Any new file that declares or exports types stored in the Y.js document (present or future).

**Sync and replication semantics**

- CRDT merge and sync handshake logic (`src/lib/crdt.js`, `src/hooks/useYjs.ts`): anything that changes what state gets replicated, in what order, or what a peer can observe after a sync.
- `y-indexeddb` persistence configuration and `DB_NAME`: changes to how documents are namespaced on the device.
- The offline path: changes to how the prototype behaves when the relay is unreachable or a peer is unresponsive.

**Gate and grant semantics — the core governance layer**

- `canCross()` in `src/store/ydoc.ts` — the single relay seam gate (S4-1). Changes affect what the gate permits, blocks, or records as evidence. It must stay free of transport concerns; it is the substitution point for a future capability check (S4-3).
- The S4-1a gate table: any change to which `crossingType` passes under which `syncStatus` / `grantedBy` / `tier` combination.
- Write-before-fire in `src/lib/relay.js`: the intent record and pending trust entry are committed before any `socket.send()`. Any change that reorders or removes this is Critical.
- Handle normalization (`.replace(/^@/, '').toLowerCase().trim()`): the gate lookup and the accept site must use the identical normalization or the fail-closed path fires on valid contacts.

**Connection/trust separation — S4-1a boundary**

- `syncStatus` (the peer's decision about reachability) and `tier` / `grantedBy` (this user's decision about trust) are recorded independently. Acceptance by a peer must never raise `tier` or set `grantedBy: 'self'`. Any change that lets a remote act widen local trust — including automatic sync-on-accept — is Critical and requires explicit boundary questions answered.
- `grantedBy: 'self'` is set only from this device's UI (`TrustSettings.tsx`). Changes to where or how it is set are Critical.

**Evidence layer**

- The `crossing_intents` and `crossing_records` maps and their two mutation helpers, `writeCrossingIntent()` and `writeCrossingCompletion()`. Append-only is a convention the helpers enforce: adding a delete or prune helper for either map, or touching them from `pruneAllExpiredPings()` / `pruneExpiredPingHistory()`, is Critical.
- `exportLocalState()`: additions or removals that change what a person can take off the device.
- Crossing event emission in `relay/server.js` (`relayId` on every operation completion): `crossingParty` on the completion record is taken from that payload, not assumed.

**Relay state**

- `handleRegistry` and `socketHandles` in `relay/server.js` are in-memory only (S4-4). Introducing any persistent server-side handle store is Critical and contradicts the governing record; it is a seam-decision question, not a build item.

**Dependency versions**

- Any change to the sync stack in `package.json`, `package-lock.json`, `relay/package.json`, or `relay/package-lock.json`. Adding Keyhive or Automerge packages in any Phase 4 session is out of scope by decision (S4-3); wanting one is a signal to stop and reopen `SEAM_DECISIONS.md`, not to proceed.

  Current declared ranges (read from `package.json` and `relay/package.json` at `c64d39a`; these are caret ranges, not exact pins):

  | Package | Range |
  |---|---|
  | `yjs` | `^13.6.18` |
  | `y-indexeddb` | `^9.0.12` |
  | `ws` (relay) | `^8.17.0` |

**Governance configuration**

- This file (`CONTRIBUTING.md`) — declaring, widening, or modifying any pre-cleared class or protected surface is itself a Critical change (§2.3 of the framework).
- `.github/PULL_REQUEST_TEMPLATE.md` — changes to the PR template are Critical changes to the governance instrument.
- `SEAM_DECISIONS.md` and `KNOWN_LIMITS.md` — the governing record and its public statement. Changed only in a seam-decision session that issues a dated revision; never in a build PR.

---

## Pre-cleared change classes

**None declared yet.** Pre-cleared classes are created by a Critical-tier PR that declares the class, its machine-checkable boundary predicate, and its mandatory expiry/review interval (§2.3 of the framework). No class exists in this repository at adoption; instances will follow as CI gates are instrumented.

When a class is declared, it will appear here with: the class name, its exact boundary (which files may be touched, which semver band is permitted, what CI predicate verifies membership), and the review interval.

---

## The mechanized layer (§6 gates)

The following are enforced by tooling, not by reviewer memory:

- **Type check and build** — `npm run build` (`tsc && vite build`); must pass before merge. No separate lint script exists at adoption; adding one is a §7 item.
- **Test suite** — none is instrumented at adoption. The S4-5 two-tab acceptance checklist in `SEAM_DECISIONS.md` (nine assertions, against a locally running relay) is the manual gate for Phase 4 PRs until automated tests exist. A PR that breaks any S4-5 assertion is blocked regardless of tier.
- **Structured commit format** — `fix:` / `feat:` / `refactor:` / `chore:` + scope. Enforced by commit hook (to be added; manual discipline until then). Makes history parseable and intention-legible.
- **Diff-size advisory** — PRs exceeding 400 changed lines receive a comment requiring either a split or a written justification. Line count is not the tier definition; it is the signal that something may be mis-tiered.

Any rule currently enforced by memory is a candidate for the mechanized layer. If you find one, the §7 self-healing rule applies: surfacing it is part of your PR.

---

## What K2 (independent review) means at S1

K2 is satisfied by a review pass in a **separate session or context** from the one that produced the code, conducted against the written spec and acceptance criteria — not the diff alone.

For AI-assisted review: a review conducted in the same conversation that wrote the code is not independent. A fresh context given only the spec and the acceptance criteria (not the authoring conversation) can satisfy K2 at this scale. For Critical changes on protected surfaces, external verification against the upstream ecosystem or governing record is the compensating control. See §3 (S1) and §6.1 of the framework for the full account.

---

## Self-healing conventions (§7)

If your PR surfaces something undocumented — a convention not written down, a failure mode not on any list, a protected surface not declared above, a dependency quirk not recorded — **updating this file (or the relevant governing document) is part of your PR**. Code and documentation ship together. This is universal at Critical tier; it is the only mechanism that keeps this file accurate over time.

---

## Emergency changes

Live incident, security response, something that cannot wait? **Act first.** Apply the fix. Then open a PR retrospectively within **1 business day** and fill it as a Critical-tier PR with honest after-the-fact tags. The emergency path moves the governance sequence; it does not remove the governance. `Confirmed` still means verified; `Unverified` still requires a closure plan.

See §10.1 of the framework for the full procedure.

---

## Attribution

This file is a governed derivative of the **Governed PR Framework v0.4** (J. Wright · UX Minds, LLC).  
Framework repo: `github.com/jediwright/governed-pr-framework`

Derivative-local content (protected surfaces, dependency ranges, repository-specific gates) does not flow upstream. Improvements worth proposing upstream go through the parent's change-control process.

---

*`CONTRIBUTING.md` — local-first-social-network — Governed PR Framework v0.4 derivative*  
*Adopted September 3, 2026. Register: CONTEXTUAL. Delivery-not-application: apply locally, commit.*
