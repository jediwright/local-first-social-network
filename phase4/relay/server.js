/**
 * local-first-social-network — WebSocket relay server
 * Deploys to Fly.io. Stateless: crash and restart loses nothing.
 * All state is client-side (Y.js / IndexedDB).
 *
 * Three operations only:
 *   1. Handle registration — @handle → connection ID (ephemeral registry)
 *   2. Connection request routing — client A → relay → client B, relay exits after handshake
 *   3. Channel discovery — broadcast interest-channel presence (no content stored)
 */

import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT || 8080;

// ─── Ephemeral registries ───────────────────────────────────────────────────
// Rebuilt from reconnecting clients on restart. Intentional minimal server state.

/** @type {Map<string, WebSocket>} handle → socket */
const handleRegistry = new Map();

/** @type {Map<WebSocket, string>} socket → handle (reverse index for cleanup) */
const socketHandles = new Map();

/** @type {Map<string, Set<WebSocket>>} channelId → Set<socket> */
const channelPresence = new Map();

// ─── Server ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`[relay] listening on port ${PORT}`);
});

wss.on('connection', (socket, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[relay] client connected — ${ip}`);

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(socket, 'PARSE_ERROR', 'Message must be valid JSON');
      return;
    }

    switch (msg.type) {
      case 'REGISTER_HANDLE':
        handleRegister(socket, msg);
        break;
      case 'CONNECTION_REQUEST':
        connectionRequest(socket, msg);
        break;
      case 'CONNECTION_ACCEPT':
        connectionAccept(socket, msg);
        break;
      case 'CONNECTION_REJECT':
        connectionReject(socket, msg);
        break;
      case 'CHANNEL_JOIN':
        channelJoin(socket, msg);
        break;
      case 'CHANNEL_LEAVE':
        channelLeave(socket, msg);
        break;
      case 'SYNC_COMPLETE':
        syncComplete(socket, msg);
        break;
      default:
        sendError(socket, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`);
    }
  });

  socket.on('close', () => {
    cleanup(socket);
  });

  socket.on('error', (err) => {
    console.error(`[relay] socket error:`, err.message);
    cleanup(socket);
  });
});

// ─── Handlers ───────────────────────────────────────────────────────────────

/**
 * REGISTER_HANDLE
 * Client registers their @handle on first connect.
 * First-come-first-served. Registry is ephemeral — rebuilt on relay restart.
 *
 * Payload: { type: 'REGISTER_HANDLE', handle: string }
 * Response: HANDLE_REGISTERED | HANDLE_TAKEN
 */
function handleRegister(socket, msg) {
  const { handle } = msg;

  if (!handle || typeof handle !== 'string' || !handle.startsWith('@')) {
    sendError(socket, 'INVALID_HANDLE', 'Handle must be a string starting with @');
    return;
  }

  const normalized = handle.toLowerCase().trim();

  // Release previous handle if this socket is re-registering
  const previous = socketHandles.get(socket);
  if (previous) {
    handleRegistry.delete(previous);
    socketHandles.delete(socket);
  }

  if (handleRegistry.has(normalized)) {
    const existingSocket = handleRegistry.get(normalized);
    if (existingSocket === socket) {
      // Same socket re-registering same handle — idempotent OK
      send(socket, { type: 'HANDLE_REGISTERED', handle: normalized });
      return;
    }
    // Taken by a different active socket
    send(socket, { type: 'HANDLE_TAKEN', handle: normalized });
    console.log(`[relay] handle taken: ${normalized}`);
    return;
  }

  handleRegistry.set(normalized, socket);
  socketHandles.set(socket, normalized);
  send(socket, { type: 'HANDLE_REGISTERED', handle: normalized });
  console.log(`[relay] handle registered: ${normalized} (registry size: ${handleRegistry.size})`);
}

/**
 * CONNECTION_REQUEST
 * Client A wants to connect to Client B.
 * Relay routes the intent to B and then exits the path after handshake.
 *
 * Payload: { type: 'CONNECTION_REQUEST', fromHandle: string, toHandle: string, requestId: string }
 * → Forwarded to target as CONNECTION_REQUEST_INCOMING
 * → If target not found: CONNECTION_REQUEST_FAILED
 */
function connectionRequest(socket, msg) {
  const { fromHandle, toHandle, requestId } = msg;

  if (!fromHandle || !toHandle || !requestId) {
    sendError(socket, 'INVALID_PAYLOAD', 'CONNECTION_REQUEST requires fromHandle, toHandle, requestId');
    return;
  }

  const fromNorm = fromHandle.toLowerCase().trim();
  const toNorm = toHandle.toLowerCase().trim();

  const registeredHandle = socketHandles.get(socket);
  if (registeredHandle !== fromNorm) {
    sendError(socket, 'AUTH_ERROR', 'fromHandle does not match registered handle for this connection');
    return;
  }

  const targetSocket = handleRegistry.get(toNorm);
  if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
    send(socket, {
      type: 'CONNECTION_REQUEST_FAILED',
      requestId,
      reason: 'TARGET_NOT_FOUND',
      toHandle: toNorm,
    });
    console.log(`[relay] connection request failed — target not found: ${toNorm}`);
    return;
  }

  // Route to target — relay's work here is done after forwarding
  send(targetSocket, {
    type: 'CONNECTION_REQUEST_INCOMING',
    requestId,
    fromHandle: fromNorm,
  });

  // Acknowledge to sender that relay has routed the request
  send(socket, {
    type: 'CONNECTION_REQUEST_ROUTED',
    requestId,
    toHandle: toNorm,
  });

  console.log(`[relay] connection request routed: ${fromNorm} → ${toNorm} (id: ${requestId})`);
}

/**
 * CONNECTION_ACCEPT
 * Client B accepts a connection request from Client A.
 * Relay notifies A, facilitates initial CRDT sync signal, then exits the path.
 *
 * Payload: { type: 'CONNECTION_ACCEPT', requestId: string, fromHandle: string, toHandle: string }
 */
function connectionAccept(socket, msg) {
  const { requestId, fromHandle, toHandle } = msg;

  if (!requestId || !fromHandle || !toHandle) {
    sendError(socket, 'INVALID_PAYLOAD', 'CONNECTION_ACCEPT requires requestId, fromHandle, toHandle');
    return;
  }

  const fromNorm = fromHandle.toLowerCase().trim();
  const toNorm = toHandle.toLowerCase().trim();

  const registeredHandle = socketHandles.get(socket);
  if (registeredHandle !== toNorm) {
    sendError(socket, 'AUTH_ERROR', 'toHandle does not match registered handle for this connection');
    return;
  }

  const requesterSocket = handleRegistry.get(fromNorm);
  if (!requesterSocket || requesterSocket.readyState !== WebSocket.OPEN) {
    // Requester disconnected — accept noted but undeliverable
    console.log(`[relay] accept for ${requestId} — requester ${fromNorm} no longer connected`);
    return;
  }

  // Notify requester of acceptance — include signal to begin CRDT sync
  send(requesterSocket, {
    type: 'CONNECTION_ACCEPTED',
    requestId,
    byHandle: toNorm,
    syncSignal: true, // Client should initiate CRDT state vector exchange
  });

  // Relay exits the handshake path here.
  // The CRDT sync (src/lib/crdt.js) happens directly between clients via
  // subsequent relay-routed UPDATE messages, then the relay exits that path too.
  console.log(`[relay] connection accepted: ${fromNorm} ← ${toNorm} (id: ${requestId}) — relay exiting handshake path`);
}

/**
 * CONNECTION_REJECT
 * Client B rejects a connection request.
 * Relay notifies A and exits.
 *
 * Payload: { type: 'CONNECTION_REJECT', requestId: string, fromHandle: string, toHandle: string }
 */
function connectionReject(socket, msg) {
  const { requestId, fromHandle, toHandle } = msg;

  if (!requestId || !fromHandle || !toHandle) {
    sendError(socket, 'INVALID_PAYLOAD', 'CONNECTION_REJECT requires requestId, fromHandle, toHandle');
    return;
  }

  const fromNorm = fromHandle.toLowerCase().trim();
  const toNorm = toHandle.toLowerCase().trim();

  const registeredHandle = socketHandles.get(socket);
  if (registeredHandle !== toNorm) {
    sendError(socket, 'AUTH_ERROR', 'toHandle does not match registered handle for this connection');
    return;
  }

  const requesterSocket = handleRegistry.get(fromNorm);
  if (requesterSocket && requesterSocket.readyState === WebSocket.OPEN) {
    send(requesterSocket, {
      type: 'CONNECTION_REJECTED',
      requestId,
      byHandle: toNorm,
    });
  }

  console.log(`[relay] connection rejected: ${fromNorm} ← ${toNorm} (id: ${requestId})`);
}

/**
 * CHANNEL_JOIN
 * Client subscribes to interest-channel presence broadcasts.
 * Relay tracks channel membership ephemerally and broadcasts presence to members.
 * No content is stored. No relationship data is retained.
 *
 * Payload: { type: 'CHANNEL_JOIN', channelIds: string[] }
 */
function channelJoin(socket, msg) {
  const { channelIds } = msg;

  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    sendError(socket, 'INVALID_PAYLOAD', 'CHANNEL_JOIN requires channelIds array');
    return;
  }

  const handle = socketHandles.get(socket);

  for (const channelId of channelIds) {
    if (!channelPresence.has(channelId)) {
      channelPresence.set(channelId, new Set());
    }
    channelPresence.get(channelId).add(socket);
  }

  // Broadcast updated member counts (approximate — no identity data)
  for (const channelId of channelIds) {
    const memberCount = channelPresence.get(channelId).size;
    broadcastToChannel(channelId, {
      type: 'CHANNEL_PRESENCE',
      channelId,
      memberCount,
      // No handles, no identifiers — count only
    }, null); // broadcast to all including sender
  }

  console.log(`[relay] ${handle || 'anon'} joined channels: ${channelIds.join(', ')}`);
}

/**
 * CHANNEL_LEAVE
 * Client unsubscribes from interest-channel presence.
 *
 * Payload: { type: 'CHANNEL_LEAVE', channelIds: string[] }
 */
function channelLeave(socket, msg) {
  const { channelIds } = msg;

  if (!Array.isArray(channelIds)) return;

  for (const channelId of channelIds) {
    const members = channelPresence.get(channelId);
    if (members) {
      members.delete(socket);
      if (members.size === 0) {
        channelPresence.delete(channelId);
      } else {
        // Broadcast updated count
        broadcastToChannel(channelId, {
          type: 'CHANNEL_PRESENCE',
          channelId,
          memberCount: members.size,
        }, null);
      }
    }
  }
}

/**
 * SYNC_COMPLETE
 * Client signals that initial CRDT sync with a peer is done.
 * Relay logs exit from sync path. No state change on relay.
 *
 * Payload: { type: 'SYNC_COMPLETE', withHandle: string, requestId: string }
 */
function syncComplete(socket, msg) {
  const { withHandle, requestId } = msg;
  const handle = socketHandles.get(socket);
  console.log(`[relay] sync complete: ${handle} ↔ ${withHandle} (id: ${requestId}) — relay exiting sync path`);
  // Relay does nothing else. State lives on clients.
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function sendError(socket, code, message) {
  send(socket, { type: 'ERROR', code, message });
}

function broadcastToChannel(channelId, data, excludeSocket) {
  const members = channelPresence.get(channelId);
  if (!members) return;
  for (const socket of members) {
    if (socket !== excludeSocket) {
      send(socket, data);
    }
  }
}

function cleanup(socket) {
  // Remove handle registration
  const handle = socketHandles.get(socket);
  if (handle) {
    handleRegistry.delete(handle);
    socketHandles.delete(socket);
    console.log(`[relay] handle released: ${handle} (registry size: ${handleRegistry.size})`);
  }

  // Remove from all channel presence sets
  for (const [channelId, members] of channelPresence.entries()) {
    if (members.has(socket)) {
      members.delete(socket);
      if (members.size === 0) {
        channelPresence.delete(channelId);
      } else {
        broadcastToChannel(channelId, {
          type: 'CHANNEL_PRESENCE',
          channelId,
          memberCount: members.size,
        }, null);
      }
    }
  }
}

// ─── Health check endpoint (Fly.io expects HTTP on the same port) ────────────
// Fly.io's health checks use HTTP. We handle upgrade → WebSocket and
// non-upgrade requests as a simple 200 health response.

import http from 'http';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      handles: handleRegistry.size,
      channels: channelPresence.size,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wssFull = new WebSocketServer({ server });

// Re-attach all the same event handlers to the server-attached WSS
wssFull.on('connection', (socket, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[relay] client connected — ${ip}`);

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(socket, 'PARSE_ERROR', 'Message must be valid JSON');
      return;
    }

    switch (msg.type) {
      case 'REGISTER_HANDLE':   handleRegister(socket, msg); break;
      case 'CONNECTION_REQUEST': connectionRequest(socket, msg); break;
      case 'CONNECTION_ACCEPT':  connectionAccept(socket, msg); break;
      case 'CONNECTION_REJECT':  connectionReject(socket, msg); break;
      case 'CHANNEL_JOIN':       channelJoin(socket, msg); break;
      case 'CHANNEL_LEAVE':      channelLeave(socket, msg); break;
      case 'SYNC_COMPLETE':      syncComplete(socket, msg); break;
      default: sendError(socket, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`);
    }
  });

  socket.on('close', () => cleanup(socket));
  socket.on('error', (err) => { console.error('[relay] socket error:', err.message); cleanup(socket); });
});

server.listen(PORT, () => {
  console.log(`[relay] HTTP+WS server listening on port ${PORT}`);
});

// Close the standalone WSS (it was only used for the handler function definitions above)
wss.close();
