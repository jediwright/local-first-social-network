/**
 * src/types/crossing.ts
 *
 * Crossing record types for the SocialPings relay seam (Phase 4).
 *
 * Governing record: SEAM_DECISIONS.md — S4-1 (standing grant), S4-2 (schema).
 * Locked 2026-09-02. Do not modify these interfaces outside a seam-decision
 * session; Phase 4 build sessions open against them as fixed.
 *
 * Two append-only Y.js maps hold these records on the originating client:
 *
 *   doc.getMap('crossing_intents')  → Y.Map<CrossingIntentRecord>,     keyed by intentId
 *   doc.getMap('crossing_records')  → Y.Map<CrossingCompletionRecord>, keyed by recordId
 *
 * "Append-only" is a convention enforced by the mutation helpers in
 * src/store/ydoc.ts (no delete/prune helper is exported for either map), not
 * a Y.js guarantee. These maps are never pruned on document load, unlike the
 * TTL-bounded ping collections. They are the local evidence plane for
 * crossings the relay does not persist.
 *
 * Write-before-fire discipline: a CrossingIntentRecord is written to the
 * local document BEFORE any message is sent to the relay. A
 * CrossingCompletionRecord is written on relay response. If the relay drops
 * the request, the intent record persists as evidence of the attempt.
 */

/**
 * The three relay operations. No other operation contacts the relay.
 *
 * - `connection-request` — handshake from this client to a contact's client.
 *   Root of a chain; its intent record carries `chainReference: null`.
 * - `thread-sync`        — initial CRDT merge of thread history on connection.
 *   Chains from a completed `connection-request`.
 * - `channel-discovery`  — interest channel lookup via relay broadcast.
 *   Chains from a completed `connection-request` when scoped to a contact;
 *   otherwise chains from the client's own registry crossing.
 */
export type CrossingType = 'connection-request' | 'thread-sync' | 'channel-discovery';

/**
 * Gate outcome for a crossing.
 *
 * - `pass`  — a valid trust entry (grant) existed for the contact at crossing
 *   time and the relay completed the operation.
 * - `block` — the gate failed closed: no valid trust entry, or the relay
 *   refused/failed the operation. A `block` still produces a completion
 *   record; silence is not a result.
 */
export type CrossingResult = 'pass' | 'block';

/**
 * Written to `doc.getMap('crossing_intents')` before the relay is contacted.
 *
 * Records the intent to cross, the grant it is gated against, and its
 * position in the crossing chain. Immutable once written.
 */
export interface CrossingIntentRecord {
  /** Unique id for this intent. Map key. Generated via generateId(). */
  intentId: string;

  /**
   * The `grantId` of the trust graph entry (`trustGraphMap`) this crossing
   * is gated against. The trust entry IS the grant (standing grant model,
   * S4-1); no separate grant artifact exists.
   *
   * Lookup uses the bare handle (no `@`), matching `addContact()` storage.
   */
  grantReference: string;

  /**
   * Identifier of the crossing party — the relay this intent will be sent
   * to. Hostname form, e.g. `relay.socialpings.com`. Not a user handle.
   */
  crossingParty: string;

  /** Which of the three relay operations this intent targets. */
  crossingType: CrossingType;

  /** ISO 8601 timestamp at which the intent was written (pre-crossing). */
  timestamp: string;

  /**
   * Gate result recorded at intent time. Because the gate check runs
   * locally before the relay is contacted, a `block` may be known here —
   * in which case no relay message is sent and the completion record
   * mirrors this value. A `pass` here means "gate cleared locally; relay
   * not yet contacted"; the authoritative result is on the completion
   * record.
   */
  result: CrossingResult;

  /**
   * Upstream link in the crossing chain.
   *
   * - `connection-request`: always `null` (root of the chain).
   * - `thread-sync` / `channel-discovery`: the `recordId` of the upstream
   *   CrossingCompletionRecord (normally the completed `connection-request`
   *   for the same contact).
   *
   * `null` is a typed value permitted ONLY for `connection-request`.
   * It is never an omission.
   */
  chainReference: string | null;

  /**
   * Bare handle (no `@`) of the contact this crossing concerns. Mirrors the
   * `trustGraphMap` key so the record is readable without dereferencing
   * the grant. Present for all three crossing types; for a broadcast-scope
   * `channel-discovery` this is the client's own handle.
   */
  contactId: string;
}

/**
 * Written to `doc.getMap('crossing_records')` on relay response (or on a
 * local gate `block` that prevented relay contact).
 *
 * The authoritative record of what happened at the crossing. One
 * completion record per intent record. Immutable once written.
 */
export interface CrossingCompletionRecord {
  /** Unique id for this completion record. Map key. Generated via generateId(). */
  recordId: string;

  /** Same `grantId` as the fulfilled intent. Duplicated for self-contained readability. */
  grantReference: string;

  /**
   * Identifier of the relay that handled the crossing, as reported in the
   * relay's crossing event payload. Should equal the intent's
   * `crossingParty`; a mismatch is recorded, not corrected.
   */
  crossingParty: string;

  /** Same value as the fulfilled intent. */
  crossingType: CrossingType;

  /** ISO 8601 timestamp at which the relay response was received (or the local block was decided). */
  timestamp: string;

  /** Authoritative gate + relay outcome for this crossing. */
  result: CrossingResult;

  /**
   * The `intentId` of the CrossingIntentRecord this record fulfils.
   * Always a string on a completion record — never `null`. This is the
   * intent → completion link; the upstream chain is reached through the
   * intent's own `chainReference`.
   */
  chainReference: string;

  /** Bare handle (no `@`) of the contact this crossing concerned. Mirrors the intent. */
  contactId: string;

  /**
   * Optional relay-supplied reason on `block` (e.g. `handle-not-registered`,
   * `peer-offline`, `gate-failed-closed`). Free-form string; not an enum
   * at Phase 4. Omitted on `pass`.
   */
  blockReason?: string;
}
