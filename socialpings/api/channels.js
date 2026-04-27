/**
 * api/channels.js — Vercel serverless function
 *
 * Phase 4 placeholder.
 *
 * Channel discovery endpoint:
 *   GET /api/channels?interest=ai,music,design
 *   → { channels: [{ id, name, topic, memberCount }] }
 *
 * This function provides approximate member counts and channel lists
 * for interest-graph-based discovery. It stores NO content, NO
 * relationship data, NO user graph. Member counts are approximate
 * (rebuilt from reconnecting clients on relay restart).
 *
 * The relay earns nothing. The platform facilitates discovery and exits.
 */

// Phase 4 — not yet implemented
export default function handler(_req, res) {
  res.status(503).json({ error: 'Channel discovery available in Phase 4' })
}
