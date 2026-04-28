/**
 * relay/server.js — local-first-social-network WebSocket relay
 * Deploys to Fly.io. Stateless: crash and restart loses nothing.
 *
 * Three operations only:
 *   1. Handle registration — @handle → connection ID (ephemeral registry)
 *   2. Connection request routing — relay exits after handshake
 *   3. Channel discovery — presence broadcast, no content stored
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;

// ─── Ephemeral registries ─────────────────────────────────────────────────────

/** @type {Map<string, WebSocket>} handle → socket */
const handleRegistry = new Map();

/** @type {Map<WebSocket, string>} socket → handle */
const socketHandles = new Map();

/** @type {Map<string, Set<WebSocket>>} channelId → Set<socket> */
const channelPresence = new Map();

// ─── HTTP + WS server ─────────────────────────────────────────────────────────

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

const wss = new WebSocketServer({ server });

wss.on('connection', (socket, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[relay] client connected — ${ip}`);

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { sendError(socket, 'PARSE_ERROR', 'Message must be valid JSON'); return; }

    switch (msg.type) {
      case 'REGISTER_HANDLE':    handleRegister(socket, msg); break;
      case 'CONNECTION_REQUEST': connectionRequest(socket, msg); break;
      case 'CONNECTION_ACCEPT':  connectionAccept(socket, msg); break;
      case 'CONNECTION_REJECT':  connectionReject(socket, msg); break;
      case 'CHANNEL_JOIN':       channelJoin(socket, msg); break;
      case 'CHANNEL_LEAVE':      channelLeave(socket, msg); break;
      case 'SYNC_COMPLETE':      syncComplete(socket, msg); break;
      case 'CRDT_SYNC_OFFER':    relayToHandle(socket, msg, msg.toHandle); break;
      case 'CRDT_SYNC_ANSWER':   relayToHandle(socket, msg, msg.toHandle); break;
      case 'PING':               send(socket, { type: 'PONG' }); break;
      default: sendError(socket, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`);
    }
  });

  socket.on('close', () => cleanup(socket));
  socket.on('error', (err) => { console.error('[relay] socket error:', err.message); cleanup(socket); });
});

server.listen(PORT, () => {
  console.log(`[relay] HTTP+WS listening on port ${PORT}`);
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleRegister(socket, msg) {
  const { handle } = msg;
  if (!handle || typeof handle !== 'string' || !handle.startsWith('@')) {
    sendError(socket, 'INVALID_HANDLE', 'Handle must start with @'); return;
  }
  const normalized = handle.toLowerCase().trim();
  const previous = socketHandles.get(socket);
  if (previous) { handleRegistry.delete(previous); socketHandles.delete(socket); }

  if (handleRegistry.has(normalized)) {
    if (handleRegistry.get(normalized) === socket) {
      send(socket, { type: 'HANDLE_REGISTERED', handle: normalized }); return;
    }
    send(socket, { type: 'HANDLE_TAKEN', handle: normalized }); return;
  }

  handleRegistry.set(normalized, socket);
  socketHandles.set(socket, normalized);
  send(socket, { type: 'HANDLE_REGISTERED', handle: normalized });
  console.log(`[relay] registered: ${normalized} (total: ${handleRegistry.size})`);
}

function connectionRequest(socket, msg) {
  const { fromHandle, toHandle, requestId } = msg;
  if (!fromHandle || !toHandle || !requestId) {
    sendError(socket, 'INVALID_PAYLOAD', 'requires fromHandle, toHandle, requestId'); return;
  }
  const fromNorm = fromHandle.toLowerCase().trim();
  const toNorm = toHandle.toLowerCase().trim();

  if (socketHandles.get(socket) !== fromNorm) {
    sendError(socket, 'AUTH_ERROR', 'fromHandle mismatch'); return;
  }

  const targetSocket = handleRegistry.get(toNorm);
  if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
    send(socket, { type: 'CONNECTION_REQUEST_FAILED', requestId, reason: 'TARGET_NOT_FOUND', toHandle: toNorm }); return;
  }

  send(targetSocket, { type: 'CONNECTION_REQUEST_INCOMING', requestId, fromHandle: fromNorm });
  send(socket, { type: 'CONNECTION_REQUEST_ROUTED', requestId, toHandle: toNorm });
  console.log(`[relay] routed: ${fromNorm} → ${toNorm}`);
}

function connectionAccept(socket, msg) {
  const { requestId, fromHandle, toHandle } = msg;
  if (!requestId || !fromHandle || !toHandle) {
    sendError(socket, 'INVALID_PAYLOAD', 'requires requestId, fromHandle, toHandle'); return;
  }
  const toNorm = toHandle.toLowerCase().trim();
  const fromNorm = fromHandle.toLowerCase().trim();

  if (socketHandles.get(socket) !== toNorm) {
    sendError(socket, 'AUTH_ERROR', 'toHandle mismatch'); return;
  }

  const requesterSocket = handleRegistry.get(fromNorm);
  if (requesterSocket?.readyState === WebSocket.OPEN) {
    send(requesterSocket, { type: 'CONNECTION_ACCEPTED', requestId, byHandle: toNorm, syncSignal: true });
  }
  console.log(`[relay] accepted: ${fromNorm} ← ${toNorm} — exiting handshake path`);
}

function connectionReject(socket, msg) {
  const { requestId, fromHandle, toHandle } = msg;
  if (!requestId || !fromHandle || !toHandle) return;
  const toNorm = toHandle.toLowerCase().trim();
  const fromNorm = fromHandle.toLowerCase().trim();

  if (socketHandles.get(socket) !== toNorm) return;

  const requesterSocket = handleRegistry.get(fromNorm);
  if (requesterSocket?.readyState === WebSocket.OPEN) {
    send(requesterSocket, { type: 'CONNECTION_REJECTED', requestId, byHandle: toNorm });
  }
  console.log(`[relay] rejected: ${fromNorm} ← ${toNorm}`);
}

function channelJoin(socket, msg) {
  const { channelIds } = msg;
  if (!Array.isArray(channelIds) || channelIds.length === 0) return;

  for (const channelId of channelIds) {
    if (!channelPresence.has(channelId)) channelPresence.set(channelId, new Set());
    channelPresence.get(channelId).add(socket);
  }
  for (const channelId of channelIds) {
    broadcastToChannel(channelId, { type: 'CHANNEL_PRESENCE', channelId, memberCount: channelPresence.get(channelId).size }, null);
  }
}

function channelLeave(socket, msg) {
  const { channelIds } = msg;
  if (!Array.isArray(channelIds)) return;
  for (const channelId of channelIds) {
    const members = channelPresence.get(channelId);
    if (!members) continue;
    members.delete(socket);
    if (members.size === 0) channelPresence.delete(channelId);
    else broadcastToChannel(channelId, { type: 'CHANNEL_PRESENCE', channelId, memberCount: members.size }, null);
  }
}

function syncComplete(socket, msg) {
  const handle = socketHandles.get(socket);
  console.log(`[relay] sync complete: ${handle} ↔ ${msg.withHandle} — exiting sync path`);
}

function relayToHandle(socket, msg, toHandle) {
  if (!toHandle) return;
  const fromHandle = socketHandles.get(socket);
  const targetSocket = handleRegistry.get(toHandle.toLowerCase().trim());
  if (targetSocket?.readyState === WebSocket.OPEN) {
    send(targetSocket, { ...msg, fromHandle });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

function sendError(socket, code, message) {
  send(socket, { type: 'ERROR', code, message });
}

function broadcastToChannel(channelId, data, excludeSocket) {
  const members = channelPresence.get(channelId);
  if (!members) return;
  for (const socket of members) {
    if (socket !== excludeSocket) send(socket, data);
  }
}

function cleanup(socket) {
  const handle = socketHandles.get(socket);
  if (handle) {
    handleRegistry.delete(handle);
    socketHandles.delete(socket);
    console.log(`[relay] released: ${handle} (total: ${handleRegistry.size})`);
  }
  for (const [channelId, members] of channelPresence.entries()) {
    if (members.has(socket)) {
      members.delete(socket);
      if (members.size === 0) channelPresence.delete(channelId);
      else broadcastToChannel(channelId, { type: 'CHANNEL_PRESENCE', channelId, memberCount: members.size }, null);
    }
  }
}
