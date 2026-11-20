/**
 * src/lib/relay.js — WebSocket client
 * local-first-social-network
 *
 * Connection management, reconnection on drop, handshake state machine.
 * Gracefully degrades when relay is offline — all local features continue.
 *
 * Handshake state machine:
 *   idle → connecting → registered → pending_accept → syncing → established
 *
 * Message routing:
 *   Relay messages (REGISTER, CONNECTION_REQUEST, etc.) → handled here
 *   CRDT messages (CRDT_SYNC_OFFER, CRDT_SYNC_ANSWER) → forwarded to crdt.js
 */

import { profileMap, doc, addContact } from '../store/ydoc';
import {
  initiateSyncHandshake,
  respondToSyncOffer,
  completeSyncHandshake,
  applyRemoteUpdate,
  CRDT_MESSAGE_TYPES,
} from './crdt';

// ─── Config ──────────────────────────────────────────────────────────────────

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://local-first-social-relay.fly.dev';
const RECONNECT_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_BACKOFF_FACTOR = 1.5;
const PING_INTERVAL_MS = 25000; // keepalive

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {'idle'|'connecting'|'registered'|'pending_accept'|'syncing'|'established'} */
let connectionState = 'idle';

/** @type {WebSocket|null} */
let socket = null;

/** @type {number|null} */
let reconnectTimer = null;
let pingTimer = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let connectedPeerHandle = null;  // bare handle (no @, lowercase) of the current established peer, either side
let docUpdateListener = null;    // cleanup ref for doc.on('update')

/**
 * Handshake bookkeeping for this relay session. All three are keyed by bare
 * handle and cleared when the socket closes.
 *
 *   acceptedPeers      — requests this user accepted in the UI; a sync offer is
 *                        answered only from one of these, once.
 *   outstandingOffers  — peers this client sent a sync offer to; a sync answer
 *                        is applied only from one of these, once.
 *
 * A CRDT message from anyone else is dropped. The sender's handle is the one
 * the relay attaches; these checks are only as strong as that relay.
 */
const acceptedPeers = new Set();
const outstandingOffers = new Set();

/**
 * Pending outbound connection requests awaiting accept/reject.
 * @type {Map<string, { toHandle: string, resolve: Function, reject: Function }>}
 */
const pendingRequests = new Map();

/**
 * Event listeners registered by UI components.
 * @type {Map<string, Set<Function>>}
 */
const listeners = new Map();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Connect to the relay. Safe to call multiple times — idempotent.
 */
export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  openSocket();
}

/**
 * Disconnect from the relay and stop reconnection attempts.
 */
export function disconnect() {
  clearReconnectTimer();
  clearPingTimer();
  if (socket) {
    socket.close();
    socket = null;
  }
  setState('idle');
}

/**
 * Send a connection request to another handle.
 * Returns a Promise that resolves with { accepted: true } or { accepted: false }.
 *
 * @param {string} toHandle
 * @returns {Promise<{ accepted: boolean, byHandle?: string }>}
 */
export function sendConnectionRequest(toHandle) {
  return new Promise((resolve, reject) => {
    if (!isRelayConnected()) {
      reject(new Error('Relay not connected — cannot send connection request'));
      return;
    }

    const requestId = generateRequestId();
    const rawHandle = getMyHandle();
    const myHandle = rawHandle && !rawHandle.startsWith("@") ? `@${rawHandle}` : rawHandle;

    if (!myHandle) {
      reject(new Error('No registered handle — complete onboarding first'));
      return;
    }

    pendingRequests.set(requestId, { toHandle, resolve, reject });

    sendMessage({
      type: 'CONNECTION_REQUEST',
      fromHandle: myHandle,
      toHandle: toHandle.toLowerCase().trim(),
      requestId,
    });

    // Timeout after 60s if no response
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Connection request to ${toHandle} timed out`));
      }
    }, 60000);
  });
}

/**
 * Accept an incoming connection request.
 * @param {string} requestId
 * @param {string} fromHandle
 */
export function acceptConnectionRequest(requestId, fromHandle) {
  const raw = getMyHandle();
  const myHandle = raw && !raw.startsWith("@") ? `@${raw}` : raw;
  if (!myHandle) return;

  // Record the accept before the send, so the offer that follows is expected.
  const peer = bareHandle(fromHandle);
  if (peer) acceptedPeers.add(peer);

  sendMessage({
    type: 'CONNECTION_ACCEPT',
    requestId,
    fromHandle: fromHandle.toLowerCase().trim(),
    toHandle: myHandle,
  });
}

/**
 * Reject an incoming connection request.
 * @param {string} requestId
 * @param {string} fromHandle
 */
export function rejectConnectionRequest(requestId, fromHandle) {
  const raw = getMyHandle();
  const myHandle = raw && !raw.startsWith("@") ? `@${raw}` : raw;
  if (!myHandle) return;

  sendMessage({
    type: 'CONNECTION_REJECT',
    requestId,
    fromHandle: fromHandle.toLowerCase().trim(),
    toHandle: myHandle,
  });
}

/**
 * Subscribe to interest channels for presence discovery.
 * @param {string[]} channelIds
 */
export function joinChannels(channelIds) {
  if (!isRelayConnected()) return;
  sendMessage({ type: 'CHANNEL_JOIN', channelIds });
}

/**
 * Unsubscribe from interest channels.
 * @param {string[]} channelIds
 */
export function leaveChannels(channelIds) {
  if (!isRelayConnected()) return;
  sendMessage({ type: 'CHANNEL_LEAVE', channelIds });
}

/**
 * Register an event listener.
 * Events: 'state_change', 'connection_request', 'connection_accepted',
 *         'connection_rejected', 'channel_presence', 'handle_registered',
 *         'handle_taken', 'error'
 *
 * @param {string} event
 * @param {Function} handler
 * @returns {Function} unsubscribe function
 */
export function on(event, handler) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

/**
 * Current relay connection state.
 * @returns {'idle'|'connecting'|'registered'|'pending_accept'|'syncing'|'established'}
 */
export function getConnectionState() {
  return connectionState;
}

/**
 * True if the relay WebSocket is open and handle is registered.
 */
export function isRelayConnected() {
  return socket?.readyState === WebSocket.OPEN && connectionState !== 'idle' && connectionState !== 'connecting';
}

// ─── Socket lifecycle ─────────────────────────────────────────────────────────

function openSocket() {
  setState('connecting');
  console.log(`[relay-client] connecting to ${RELAY_URL}`);

  try {
    socket = new WebSocket(RELAY_URL);
  } catch (err) {
    console.warn('[relay-client] WebSocket construction failed:', err.message);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    console.log('[relay-client] connected');
    reconnectDelay = RECONNECT_DELAY_MS; // reset backoff on successful connect
    startPingTimer();
    registerHandle();
  };

  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.warn('[relay-client] received non-JSON message');
      return;
    }
    handleMessage(msg);
  };

  socket.onclose = (event) => {
    console.log(`[relay-client] disconnected (code: ${event.code})`);
    clearPingTimer();
    // The relay forgets a connection when it drops; so does this client.
    acceptedPeers.clear();
    outstandingOffers.clear();
    connectedPeerHandle = null;
    setState('idle');
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    // onerror is always followed by onclose — let onclose handle reconnect
    console.warn('[relay-client] WebSocket error');
    emit('error', { message: 'Relay connection error' });
  };
}

function registerHandle() {
  const handle = getMyHandle();
  if (!handle) {
    console.warn('[relay-client] no handle in profile — skipping registration');
    return;
  }
  const prefixed = handle.startsWith('@') ? handle : `@${handle}`;
    sendMessage({ type: 'REGISTER_HANDLE', handle: prefixed });
}

// ─── Message handler ──────────────────────────────────────────────────────────

function handleMessage(msg) {
  // CRDT messages are forwarded to crdt.js for processing
  if (CRDT_MESSAGE_TYPES.has(msg.type)) {
    handleCrdtMessage(msg);
    return;
  }

  switch (msg.type) {
    case 'HANDLE_REGISTERED':
      setState('registered');
      emit('handle_registered', { handle: msg.handle });
      console.log(`[relay-client] handle registered: ${msg.handle}`);
      // Subscribe to channels from profile
      syncChannelSubscriptions();
      break;

    case 'HANDLE_TAKEN':
      emit('handle_taken', { handle: msg.handle });
      console.warn(`[relay-client] handle taken: ${msg.handle} — retrying in 3s`);
      setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          const identity = profileMap?.get('identity');
          const h = identity?.handle;
          if (h) {
            const normalized = (h.startsWith('@') ? h : `@${h}`).toLowerCase();
            socket.send(JSON.stringify({ type: 'REGISTER_HANDLE', handle: normalized }));
            console.log(`[relay-client] retrying handle registration: ${normalized}`);
          }
        }
      }, 3000);
      break;

    case 'CONNECTION_REQUEST_ROUTED':
      // Our outbound request was successfully routed — waiting for accept/reject
      setState('pending_accept');
      console.log(`[relay-client] connection request routed (id: ${msg.requestId})`);
      break;

    case 'CONNECTION_REQUEST_FAILED':
      setState('registered');
      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        pendingRequests.delete(msg.requestId);
        pending.reject(new Error(`${msg.reason}: ${msg.toHandle} not found on relay`));
      }
      break;

    case 'CONNECTION_REQUEST_INCOMING':
      // Someone wants to connect to us — surface to UI
      emit('connection_request', {
        requestId: msg.requestId,
        fromHandle: msg.fromHandle,
      });
      console.log(`[relay-client] incoming connection request from ${msg.fromHandle}`);
      break;

    case 'CONNECTION_ACCEPTED': {
      // An accept counts only as the answer to a request this client sent,
      // from the handle that request was addressed to.
      const req = pendingRequests.get(msg.requestId);
      const peerKey = bareHandle(msg.byHandle);
      if (!req || !peerKey || bareHandle(req.toHandle) !== peerKey) {
        console.warn('[relay-client] ignored a connection accept that matches no pending request');
        break;
      }
      pendingRequests.delete(msg.requestId);
      req.resolve({ accepted: true, byHandle: msg.byHandle });
      emit('connection_accepted', { requestId: msg.requestId, byHandle: msg.byHandle });

      // Set trust tier on initiator side before CRDT sync
      const trustGraph = profileMap.get('trust_graph');
      if (!trustGraph || !trustGraph.get(peerKey)) {
        addContact(peerKey, 'contact');
      }
      // If relay signals sync should begin, initiate CRDT handshake
      if (msg.syncSignal) {
        setState('syncing');
        const offer = initiateSyncHandshake('@' + peerKey);
        if (offer) {
          outstandingOffers.add(peerKey);
          sendMessage(offer);
          console.log(`[relay-client] CRDT sync initiated with ${msg.byHandle}`);
        } else {
          // Trust tier insufficient — accept but skip sync
          setState('established');
        }
      } else {
        setState('established');
      }
      break;
    }

    case 'CONNECTION_REJECTED': {
      // As with an accept: only the answer to a request this client sent.
      const req = pendingRequests.get(msg.requestId);
      if (!req || bareHandle(req.toHandle) !== bareHandle(msg.byHandle)) {
        console.warn('[relay-client] ignored a connection reject that matches no pending request');
        break;
      }
      setState('registered');
      pendingRequests.delete(msg.requestId);
      req.resolve({ accepted: false, byHandle: msg.byHandle });
      emit('connection_rejected', { requestId: msg.requestId, byHandle: msg.byHandle });
      break;
    }

    case 'CHANNEL_PRESENCE':
      emit('channel_presence', {
        channelId: msg.channelId,
        memberCount: msg.memberCount,
      });
      break;

    case 'ERROR':
      console.warn(`[relay-client] relay error: [${msg.code}] ${msg.message}`);
      emit('error', { code: msg.code, message: msg.message });
      break;

      case 'PONG': break; // keepalive response

    case 'CRDT_UPDATE': {
      // A real-time Y.js update is applied only from the established peer: the
      // one handle this client completed a sync handshake with on this
      // connection. The tier was checked at that handshake. It is not checked
      // again here, because the handshake merges the two trust graphs and the
      // local entry for the peer may not survive that merge.
      const from = bareHandle(msg.fromHandle);
      if (!from || from !== connectedPeerHandle) {
        console.warn('[relay-client] dropped a doc update from a handle that is not the established peer');
        break;
      }
      if (!Array.isArray(msg.update)) {
        console.warn('[relay-client] dropped a malformed doc update');
        break;
      }
      try {
        // 'relay' origin keeps the update from being echoed back to the peer.
        applyRemoteUpdate(new Uint8Array(msg.update), 'relay');
      } catch (err) {
        console.warn('[relay-client] dropped a doc update that could not be applied:', err.message);
      }
      break;
    }

    default:
      console.warn(`[relay-client] unhandled message type: ${msg.type}`);
  }
}

// ─── Real-time doc update forwarding ─────────────────────────────────────────
/**
 * After a peer connection is established, subscribe to Y.js doc updates
 * and forward them to the connected peer via the relay.
 * Guard: only forward when state is 'established' to avoid broadcasting
 * every local mutation during sync or before connection.
 */
function wireDocUpdateForwarding(peerHandle) {
  // Clean up any previous listener
  if (docUpdateListener) {
    doc.off('update', docUpdateListener);
    docUpdateListener = null;
  }
  docUpdateListener = (update, origin) => {
    // Don't echo back updates that originated from the relay (infinite loop guard)
    if (origin === 'relay') return;
    if (connectionState !== 'established') return;
    sendMessage({
      type: 'CRDT_UPDATE',
      toHandle: peerHandle,
      update: Array.from(update), // Uint8Array → serializable array
    });
  };
  doc.on('update', docUpdateListener);
  console.log(`[relay-client] doc update forwarding wired to ${peerHandle}`);
}

// ─── CRDT message handling ────────────────────────────────────────────────────

function handleCrdtMessage(msg) {
  switch (msg.type) {
    case 'CRDT_SYNC_OFFER': {
      // A sync offer is answered only from a handle whose connection request
      // this user accepted in this session. Receiving an offer never adds or
      // changes a trust entry.
      const offerFrom = bareHandle(msg.fromHandle);
      if (!offerFrom || !acceptedPeers.has(offerFrom)) {
        console.warn('[relay-client] dropped a sync offer from a handle with no accepted request');
        break;
      }
      acceptedPeers.delete(offerFrom);
      const answer = respondToSyncOffer(offerFrom, msg.offer);
      if (answer) {
        sendMessage(answer);
        connectedPeerHandle = offerFrom;
        wireDocUpdateForwarding('@' + offerFrom);
        setState('established');
        console.log(`[relay-client] CRDT sync answer sent to ${answer.toHandle}`);
      }
      break;
    }

    case 'CRDT_SYNC_ANSWER': {
      // We initiated sync — apply the answer and signal complete. An answer is
      // applied only from a handle this client sent an offer to.
      const fromHandle = bareHandle(msg.fromHandle);
      if (!fromHandle || !outstandingOffers.has(fromHandle)) {
        console.warn('[relay-client] dropped a sync answer that matches no outstanding offer');
        break;
      }
      outstandingOffers.delete(fromHandle);
      const complete = completeSyncHandshake(fromHandle, msg.answer, msg.requestId);
      if (complete) {
        sendMessage(complete); // SYNC_COMPLETE → relay exits sync path
        connectedPeerHandle = fromHandle;
        wireDocUpdateForwarding('@' + fromHandle);
        setState('established');
        console.log(`[relay-client] CRDT sync complete with ${fromHandle} — relay exiting sync path`);
      }
      break;
    }

  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sendMessage(data) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  } else {
    console.warn('[relay-client] attempted send while disconnected — message dropped:', data.type);
  }
}

function setState(newState) {
  if (connectionState === newState) return;
  const prev = connectionState;
  connectionState = newState;
  emit('state_change', { state: newState, prev });
}

function emit(event, data) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(data);
    } catch (err) {
      console.error(`[relay-client] listener error on '${event}':`, err);
    }
  });
}

/**
 * Bare handle: no leading @, lowercase, trimmed. The same normalization the
 * trust graph is keyed by. Returns '' for anything that is not a string.
 */
function bareHandle(handle) {
  return typeof handle === 'string' ? handle.replace(/^@/, '').toLowerCase().trim() : '';
}

function getMyHandle() {
  const identity = profileMap?.get('identity');
  return identity?.handle || null;
}

function syncChannelSubscriptions() {
  const memberships = profileMap?.get('channel_memberships');
  if (!memberships || memberships.length === 0) return;
  const channelIds = memberships.map((m) => m.channelId).filter(Boolean);
  if (channelIds.length > 0) {
    joinChannels(channelIds);
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  // Don't reconnect if navigator.onLine is false — wait for 'online' event instead
  if (!navigator.onLine) {
    window.addEventListener('online', onNetworkOnline, { once: true });
    return;
  }
  console.log(`[relay-client] reconnecting in ${Math.round(reconnectDelay / 1000)}s`);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * RECONNECT_BACKOFF_FACTOR, RECONNECT_MAX_DELAY_MS);
    openSocket();
  }, reconnectDelay);
}

function onNetworkOnline() {
  console.log('[relay-client] network restored — attempting relay reconnect');
  reconnectDelay = RECONNECT_DELAY_MS;
  openSocket();
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startPingTimer() {
  clearPingTimer();
  pingTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'PING' }));
    }
  }, PING_INTERVAL_MS);
}

function clearPingTimer() {
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
