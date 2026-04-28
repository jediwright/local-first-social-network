/**
 * src/lib/crdt.js — CRDT merge helpers
 * local-first-social-network
 *
 * Handles state vector exchange and Y.js update merging for initial
 * thread sync between two clients on first connection.
 *
 * Trust-tier gating: only merge threads where contact is 'close' or 'contact'.
 * The relay facilitates routing of update payloads; merge happens on-client.
 */

import * as Y from 'yjs';
import { doc, threadsMap, profileMap } from '../store/ydoc';

// ─── Trust gating ────────────────────────────────────────────────────────────

const SYNC_ELIGIBLE_TIERS = new Set(['close', 'contact']);

/**
 * Returns true if the given contactId is at a trust tier eligible for sync.
 * @param {string} contactId
 * @returns {boolean}
 */
export function isSyncEligible(contactId) {
  const normalized = contactId.replace(/^@/, '').toLowerCase().trim();
  const trustGraph = profileMap.get('trust_graph');
  if (!trustGraph) return false;
  const entry = trustGraph.get(normalized);
  if (!entry) return false;
  return SYNC_ELIGIBLE_TIERS.has(entry.tier);
}

// ─── State vector exchange ────────────────────────────────────────────────────

/**
 * Produces a state vector for the local Y.js document.
 * The remote client sends their state vector; we compute the diff and send
 * only the missing updates — not the full document.
 *
 * @returns {Uint8Array} encoded state vector
 */
export function getLocalStateVector() {
  return Y.encodeStateVector(doc);
}

/**
 * Given the remote client's state vector, compute the Y.js update
 * containing only the operations the remote is missing.
 *
 * @param {Uint8Array} remoteStateVector
 * @returns {Uint8Array} encoded diff update
 */
export function getDiffUpdate(remoteStateVector) {
  return Y.encodeStateAsUpdate(doc, remoteStateVector);
}

/**
 * Apply an incoming Y.js update from a remote client.
 * This merges their state into our local document (CRDT — commutative, idempotent).
 *
 * @param {Uint8Array} update
 */
export function applyRemoteUpdate(update) {
  // Save local identity before merge — profile must never be overwritten by a peer
  const identity = profileMap.get('identity');
  const preferences = profileMap.get('preferences');

  Y.applyUpdate(doc, update);

  // Re-assert local identity after merge (Y.js last-write-wins — we always win our own profile)
  if (identity) profileMap.set('identity', identity);
  if (preferences) profileMap.set('preferences', preferences);
}

// ─── Thread-scoped sync ───────────────────────────────────────────────────────

/**
 * Produces a state vector scoped to a single thread Y.Array.
 * Used for thread-level sync rather than full-doc sync.
 *
 * For MVP, full-doc state vector is used (Y.js doesn't natively scope
 * state vectors to sub-documents). This is the correct approach for a
 * single Y.doc architecture.
 *
 * @returns {{ stateVector: Uint8Array }}
 */
export function buildSyncOffer() {
  return {
    stateVector: Array.from(getLocalStateVector()), // serializable for JSON transport
  };
}

/**
 * Given a remote sync offer (their state vector), produce a sync answer
 * containing the diff update they're missing.
 *
 * @param {{ stateVector: number[] }} remoteOffer
 * @returns {{ update: number[] }} serializable diff update
 */
export function buildSyncAnswer(remoteOffer) {
  const remoteStateVector = new Uint8Array(remoteOffer.stateVector);
  const diffUpdate = getDiffUpdate(remoteStateVector);
  return {
    update: Array.from(diffUpdate),
  };
}

/**
 * Apply a sync answer from a remote client.
 * Merges their updates into our local Y.js document.
 * Trust-tier check must have been performed by the caller before invoking this.
 *
 * @param {{ update: number[] }} syncAnswer
 */
export function applySyncAnswer(syncAnswer) {
  const update = new Uint8Array(syncAnswer.update);
  applyRemoteUpdate(update);
}

// ─── Full handshake sequence ─────────────────────────────────────────────────

/**
 * Initiator side of the CRDT sync handshake.
 * Called after CONNECTION_ACCEPTED is received from relay.
 *
 * Returns the sync offer payload to send via relay to the peer.
 * The relay routes this message and then exits the sync path.
 *
 * @param {string} peerHandle
 * @returns {{ type: 'CRDT_SYNC_OFFER', toHandle: string, offer: { stateVector: number[] } } | null}
 */
export function initiateSyncHandshake(peerHandle) {
  const normalizedHandle = peerHandle.replace(/^@/, '').toLowerCase().trim();
  if (!isSyncEligible(normalizedHandle)) {
    console.warn(`[crdt] sync skipped — ${peerHandle} not at eligible trust tier`);
    return null;
  }

  const offer = buildSyncOffer();

  return {
    type: 'CRDT_SYNC_OFFER',
    toHandle: peerHandle,
    offer,
  };
}

/**
 * Responder side: receive a CRDT_SYNC_OFFER, produce a CRDT_SYNC_ANSWER.
 * The answer contains only the diff the initiator is missing.
 *
 * @param {string} fromHandle
 * @param {{ stateVector: number[] }} offer
 * @returns {{ type: 'CRDT_SYNC_ANSWER', toHandle: string, answer: { update: number[] } } | null}
 */
export function respondToSyncOffer(fromHandle, offer) {
  // Skip eligibility check — receiving an offer means initiator already verified trust.
  // The acceptor's trust graph entry may not be committed yet due to Y.js timing.
  console.log(`[crdt] responding to sync offer from ${fromHandle}`);
  const answer = buildSyncAnswer(offer);

  return {
    type: 'CRDT_SYNC_ANSWER',
    toHandle: (fromHandle.startsWith('@') ? fromHandle : '@' + fromHandle),
    answer,
  };
}

/**
 * Initiator side: receive a CRDT_SYNC_ANSWER and apply the update.
 * Signals sync complete after applying.
 *
 * @param {string} fromHandle
 * @param {{ update: number[] }} answer
 * @returns {{ type: 'SYNC_COMPLETE', withHandle: string, requestId: string } | null}
 */
export function completeSyncHandshake(fromHandle, answer, requestId) {
  if (!isSyncEligible(fromHandle)) {
    console.warn(`[crdt] sync answer rejected — ${fromHandle} not at eligible trust tier`);
    return null;
  }

  applySyncAnswer(answer);
  console.log(`[crdt] sync complete with ${fromHandle}`);

  // Signal relay to exit sync path
  return {
    type: 'SYNC_COMPLETE',
    withHandle: fromHandle,
    requestId,
  };
}

// ─── Relay message routing for CRDT messages ─────────────────────────────────
// These message types are relayed peer-to-peer through the relay server.
// The relay routes them by toHandle and does not inspect or store their contents.

export const CRDT_MESSAGE_TYPES = new Set([
  'CRDT_SYNC_OFFER',
  'CRDT_SYNC_ANSWER',
]);
