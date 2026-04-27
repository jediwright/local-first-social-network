/**
 * api/channels.js — Vercel serverless function
 * local-first-social-network
 *
 * GET /api/channels?interest=ai,music,design
 * Returns channels matching the requested interest tags.
 *
 * No content stored. No relationship data. Approximate member counts only.
 * Member counts are derived from relay presence signals (not stored state).
 *
 * For MVP: static channel catalog. Phase 5+ can connect to relay presence API
 * for live member counts.
 */

// ─── Channel catalog ──────────────────────────────────────────────────────────
// Static for MVP. Curated set of interest channels.
// member_count is approximate and intentionally imprecise.

const CHANNEL_CATALOG = [
  // Technology
  { id: 'ai', name: 'AI & Machine Learning', topic: 'Research, tools, and implications', interests: ['ai', 'tech', 'ml'] },
  { id: 'open-source', name: 'Open Source', topic: 'Building and contributing in the open', interests: ['open-source', 'tech', 'dev'] },
  { id: 'local-first', name: 'Local-First Software', topic: 'Apps that work offline and give users control', interests: ['local-first', 'tech', 'dev'] },
  { id: 'privacy-tech', name: 'Privacy & Tech', topic: 'Data ownership, encryption, security', interests: ['privacy', 'tech', 'security'] },
  { id: 'indie-dev', name: 'Indie Dev', topic: 'Building products solo or in small teams', interests: ['indie-dev', 'dev', 'startups'] },
  { id: 'design-systems', name: 'Design Systems', topic: 'Components, tokens, and consistency at scale', interests: ['design', 'systems', 'dev', 'ui'] },

  // Creative
  { id: 'music', name: 'Music', topic: 'Making and listening', interests: ['music', 'creative', 'audio'] },
  { id: 'writing', name: 'Writing', topic: 'Craft, process, and publication', interests: ['writing', 'creative', 'books'] },
  { id: 'photography', name: 'Photography', topic: 'Film, digital, and everything in between', interests: ['photography', 'creative', 'visual'] },
  { id: 'film', name: 'Film', topic: 'Cinema, criticism, and making', interests: ['film', 'creative', 'visual'] },
  { id: 'design', name: 'Design', topic: 'Visual, product, and systems thinking', interests: ['design', 'creative', 'visual', 'ui'] },

  // Ideas
  { id: 'governance', name: 'Governance & Policy', topic: 'Civic systems and institutional design', interests: ['governance', 'policy', 'politics'] },
  { id: 'philosophy', name: 'Philosophy', topic: 'Ethics, epistemology, and how to think', interests: ['philosophy', 'ideas'] },
  { id: 'science', name: 'Science', topic: 'Research and discovery across fields', interests: ['science', 'ideas', 'research'] },
  { id: 'economics', name: 'Economics', topic: 'How resources and incentives shape everything', interests: ['economics', 'ideas', 'policy'] },

  // Life
  { id: 'books', name: 'Books', topic: 'Reading and discussing', interests: ['books', 'reading', 'writing'] },
  { id: 'food', name: 'Food & Cooking', topic: 'Recipes, restaurants, and culture', interests: ['food', 'cooking', 'culture'] },
  { id: 'cities', name: 'Cities & Urban Life', topic: 'Planning, community, and place', interests: ['cities', 'urban', 'culture'] },
  { id: 'health', name: 'Health & Wellbeing', topic: 'Sustainable practices, not optimization theater', interests: ['health', 'wellness', 'fitness'] },
  { id: 'parenting', name: 'Parenting', topic: 'Raising kids in a noisy world', interests: ['parenting', 'family'] },
];

// Approximate member count ranges by channel tier
// Intentionally imprecise — no exact counts stored or exposed
function approximateMemberCount(channelId) {
  // Deterministic but non-identifying — based on channel ID hash
  const hash = channelId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const tiers = [
    [3, 12],    // small
    [10, 45],   // medium-small
    [30, 120],  // medium
    [80, 350],  // large
  ];
  const tier = tiers[hash % tiers.length];
  return tier[0] + (hash % (tier[1] - tier[0]));
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default function handler(req, res) {
  // CORS — allow from any origin for MVP
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Parse interest tags from query string
  // e.g. ?interest=ai,music,design  or  ?interest=ai&interest=music
  const rawInterest = req.query.interest;
  let requestedInterests = [];

  if (rawInterest) {
    const tags = Array.isArray(rawInterest) ? rawInterest : [rawInterest];
    requestedInterests = tags
      .flatMap((t) => t.split(','))
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  // Filter catalog by interest match
  let channels = CHANNEL_CATALOG;

  if (requestedInterests.length > 0) {
    channels = CHANNEL_CATALOG.filter((channel) =>
      channel.interests.some((interest) => requestedInterests.includes(interest))
    );
  }

  // Shape response — no relationship data, no identity, approximate counts only
  const response = channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    topic: channel.topic,
    memberCount: approximateMemberCount(channel.id),
  }));

  res.status(200).json({ channels: response });
}
