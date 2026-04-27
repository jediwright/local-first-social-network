/**
 * relay.js — SocialPings relay client
 *
 * Phase 4 placeholder.
 *
 * Will handle:
 *   - WebSocket connection management + reconnection on drop
 *   - Handshake state machine (pending → connecting → syncing → established)
 *   - Connection request protocol (client A → relay → client B)
 *   - Initial thread CRDT merge on first connection between two devices
 *   - Channel discovery: relay-broadcast interest channel presence signals
 *   - Handle registration: @handle → relay registry on first connect
 *
 * After a connection between two clients is established, the relay exits
 * the path. All subsequent sync is direct peer CRDT merge.
 */

// Phase 4 — not yet implemented
