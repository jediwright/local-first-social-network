/**
 * relay/server.js — SocialPings WebSocket relay
 *
 * Phase 4 placeholder. This is the seam infrastructure.
 *
 * Design constraints:
 *   - Stateless: crash and restart loses nothing (all state is client-side)
 *   - Minimal: facilitates handshake + CRDT merge, then exits the path
 *   - Three operations only: connection request routing, initial thread sync,
 *     channel discovery broadcasts
 *   - Stores no content, owns no relationships
 *
 * Deployment: Fly.io (persistent WebSocket — Vercel serverless is not
 * appropriate for long-lived WebSocket connections)
 *
 * See spec Phase 4 for full implementation details.
 */

// Phase 4 — not yet implemented
