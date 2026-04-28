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

import * as Y from 'yjs';
import { profileMap, doc } from '../store/ydoc';
import {
  initiateSyncHandshake,
  respondToSyncOffer,
  completeSyncHandshake,
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
let connectedPeerHandle = null;  // handle of current established peer
let docUpdateListener = null;    // cleanup ref for doc.on('update')

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
      const req = pendingRequests.get(msg.requestId);
      if (req) {
        pendingRequests.delete(msg.requestId);
        req.resolve({ accepted: true, byHandle: msg.byHandle });
      }
      emit('connection_accepted', { requestId: msg.requestId, byHandle: msg.byHandle });

      // Set trust tier on initiator side before CRDT sync
      if (msg.byHandle) {
        const trustGraph = profileMap.get('trust_graph');
        if (trustGraph && !trustGraph.get(msg.byHandle)) {
          trustGraph.set(msg.byHandle.replace(/^@/, ''), { tier: 'contact', connectedAt: new Date().toISOString(), syncStatus: 'pending' });
        }
      }
      // If relay signals sync should begin, initiate CRDT handshake
      if (msg.syncSignal) {
        setState('syncing');
        const normalizedPeer = msg.byHandle.replace(/^@/, '').toLowerCase().trim();
        const offer = initiateSyncHandshake(normalizedPeer);
        if (offer) {
          sendMessage(offer);
          console.log(`[relay-client] CRDT sync initiated with ${msg.byHandle}`);
        } else {
          // Trust tier insufficient — accept but skip sync
          connectedPeerHandle = msg.byHandle;
          wireDocUpdateForwarding(msg.byHandle);
          setState('established');
        }
      } else {
        setState('established');
      }
      break;
    }

    case 'CONNECTION_REJECTED': {
      setState('registered');
      const req = pendingRequests.get(msg.requestId);
      if (req) {
        pendingRequests.delete(msg.requestId);
        req.resolve({ accepted: false, byHandle: msg.byHandle });
      }
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
      // Peer sent a real-time Y.js update — apply it with 'relay' origin to avoid echo
      const update = new Uint8Array(msg.update);
      Y.applyUpdate(doc, update, 'relay');
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
      // Peer is initiating sync with us — build and send answer
      const answer = respondToSyncOffer(msg.fromHandle || msg.toHandle, msg.offer);
      if (answer) {
        sendMessage(answer);
        console.log(`[relay-client] CRDT sync answer sent to ${answer.toHandle}`);
      }
      break;
    }

    case 'CRDT_SYNC_ANSWER': {
      // We initiated sync — apply the answer and signal complete
      const fromHandle = msg.fromHandle || msg.toHandle;
      const complete = completeSyncHandshake(fromHandle, msg.answer, msg.requestId);
      if (complete) {
        sendMessage(complete); // SYNC_COMPLETE → relay exits sync path
        connectedPeerHandle = fromHandle;
        wireDocUpdateForwarding(fromHandle);
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
