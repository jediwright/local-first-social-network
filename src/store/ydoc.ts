/**
 * ydoc.ts — Local-First Social Y.js document
 *
 * Single Y.js document persisted to IndexedDB via y-indexeddb.
 * All application state lives here. Five maps:
 *   profile   → identity, preferences, trust_graph (Y.Map), ping_history (Y.Array), channel_memberships (Y.Array)
 *   pings     → ephemeral, keyed by channelId → Y.Array of ping objects
 *   threads   → persistent, keyed by contactId → Y.Array of message objects
 *   channels  → interest channel memberships, keyed by channelId
 *   assets    → thread asset library, keyed by assetId
 *
 * Pattern: all nested Y.Arrays are created here and observers attached
 * in useYjs.ts via attachArrayObserver(). Never recreate nested Y types
 * after first initialization — Y.js will produce a new identity and break sync.
 */

import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'

// ─── Types ──────────────────────────────────────────────────────────────────

export type PingType = 'here' | 'check-this' | 'thinking-of-you' | 'lets-connect' | 'status'

export type TrustTier = 'close' | 'contact' | 'discoverable' | 'guardian'

export interface Identity {
  displayName: string
  handle: string               // @handle — relay-registered on Phase 4
  handleRegisteredAt: string | null
  avatarColor: string          // hex — generated, no photo upload required for MVP
  createdAt: string
}

export interface Preferences {
  defaultPingType: PingType
  notificationsEnabled: boolean
  discoverable: boolean
  guardianHandle?: string
}

export interface TrustEntry {
  tier: TrustTier
  connectedAt: string
  syncStatus: 'pending' | 'synced' | 'offline'
}

export interface PingHistoryEntry {
  pingId: string
  type: PingType
  channelId: string
  sentAt: string
  expiresAt: string
  content?: string
}

export interface ChannelMembership {
  channelId: string
  joinedAt: string
  lastPingAt: string | null
}

export interface PingObject {
  pingId: string
  type: PingType
  senderId: string             // handle of sender
  sentAt: string
  expiresAt: string
  content?: string
}

export interface ThreadMessage {
  messageId: string
  senderId: string
  sentAt: string
  content: string
  assetRef?: string            // assetId if message includes asset
  readAt?: string
}

export interface ChannelEntry {
  name: string
  topic: string
  memberCount: number          // relay-provided, approximate; 0 local
  lastActivityAt: string
  myLastPingAt: string | null
}

export interface AssetEntry {
  type: 'link' | 'image' | 'file'
  url?: string
  localRef?: string            // IndexedDB blob reference
  title?: string
  sharedInThread: string       // contactId
  sharedAt: string
}

// ─── TTL constants (ms) ─────────────────────────────────────────────────────

export const PING_TTL: Record<PingType, number> = {
  'here':             24 * 60 * 60 * 1000,
  'thinking-of-you':  24 * 60 * 60 * 1000,
  'status':           24 * 60 * 60 * 1000,
  'check-this':        7 * 24 * 60 * 60 * 1000,
  'lets-connect':     30 * 24 * 60 * 60 * 1000,
}

// ─── Y.js document ──────────────────────────────────────────────────────────

export const doc = new Y.Doc()

// ─── Five top-level maps ─────────────────────────────────────────────────────

export const profileMap   = doc.getMap<unknown>('profile')
export const pingsMap     = doc.getMap<Y.Array<PingObject>>('pings')
export const threadsMap   = doc.getMap<Y.Array<ThreadMessage>>('threads')
export const channelsMap  = doc.getMap<ChannelEntry>('channels')
export const assetsMap    = doc.getMap<AssetEntry>('assets')

// ─── Profile nested Y types (created once, referenced always) ────────────────

/**
 * Get or create a nested Y.Map / Y.Array inside the profile map.
 * Y.js requires that shared types be created exactly once and then reused.
 * We use getOrCreate helpers to ensure idempotency.
 */
function getOrCreateProfileMap(key: string): Y.Map<unknown> {
  let m = profileMap.get(key)
  if (!(m instanceof Y.Map)) {
    m = new Y.Map()
    profileMap.set(key, m)
  }
  return m as Y.Map<unknown>
}

function getOrCreateProfileArray(key: string): Y.Array<unknown> {
  let a = profileMap.get(key)
  if (!(a instanceof Y.Array)) {
    a = new Y.Array()
    profileMap.set(key, a)
  }
  return a as Y.Array<unknown>
}

export const trustGraphMap        = getOrCreateProfileMap('trust_graph')    as Y.Map<TrustEntry>
export const pingHistoryArray     = getOrCreateProfileArray('ping_history') as Y.Array<PingHistoryEntry>
export const channelMembershipsArray = getOrCreateProfileArray('channel_memberships') as Y.Array<ChannelMembership>

// ─── IndexedDB persistence ──────────────────────────────────────────────────

const DB_NAME = 'local-first-social-v1'

export const persistence = new IndexeddbPersistence(DB_NAME, doc)

export const persistenceReady: Promise<void> = new Promise((resolve) => {
  persistence.once('synced', () => resolve())
})

// ─── Avatar color palette ────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  '#f97316', '#84cc16',
]

export function generateAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Profile mutations ───────────────────────────────────────────────────────

export function setIdentity(identity: Identity): void {
  doc.transact(() => {
    profileMap.set('identity', identity)
  })
}

export function getIdentity(): Identity | null {
  const v = profileMap.get('identity')
  return v ? (v as Identity) : null
}

export function setPreferences(prefs: Preferences): void {
  doc.transact(() => {
    profileMap.set('preferences', prefs)
  })
}

export function getPreferences(): Preferences | null {
  const v = profileMap.get('preferences')
  return v ? (v as Preferences) : null
}

export function defaultPreferences(): Preferences {
  return {
    defaultPingType: 'here',
    notificationsEnabled: true,
    discoverable: true,
  }
}

// ─── Trust graph mutations ───────────────────────────────────────────────────

export function addContact(contactId: string, tier: TrustTier): void {
  doc.transact(() => {
    trustGraphMap.set(contactId, {
      tier,
      connectedAt: new Date().toISOString(),
      syncStatus: 'offline',
    })
  })
}

export function updateContactTier(contactId: string, tier: TrustTier): void {
  const existing = trustGraphMap.get(contactId)
  if (!existing) return
  doc.transact(() => {
    trustGraphMap.set(contactId, { ...existing, tier })
  })
}

export function removeContact(contactId: string): void {
  doc.transact(() => {
    trustGraphMap.delete(contactId)
  })
}

export function getContacts(): Map<string, TrustEntry> {
  const result = new Map<string, TrustEntry>()
  trustGraphMap.forEach((v, k) => result.set(k, v))
  return result
}

// ─── Ping history mutations ──────────────────────────────────────────────────

export function recordPingToHistory(entry: Omit<PingHistoryEntry, 'pingId'>): void {
  doc.transact(() => {
    pingHistoryArray.push([{ ...entry, pingId: generateId() }])
  })
}

export function pruneExpiredPingHistory(): number {
  const now = Date.now()
  const toDelete: number[] = []
  pingHistoryArray.forEach((entry, i) => {
    if (new Date(entry.expiresAt).getTime() < now) toDelete.push(i)
  })
  // Delete in reverse order to preserve indices
  for (let i = toDelete.length - 1; i >= 0; i--) {
    doc.transact(() => {
      pingHistoryArray.delete(toDelete[i], 1)
    })
  }
  return toDelete.length
}

// ─── Channel membership mutations ────────────────────────────────────────────

export function joinChannel(channelId: string): void {
  // Avoid duplicate memberships
  const existing = channelMembershipsArray.toArray().find(m => m.channelId === channelId)
  if (existing) return
  doc.transact(() => {
    channelMembershipsArray.push([{
      channelId,
      joinedAt: new Date().toISOString(),
      lastPingAt: null,
    }])
  })
}

export function leaveChannel(channelId: string): void {
  const idx = channelMembershipsArray.toArray().findIndex(m => m.channelId === channelId)
  if (idx === -1) return
  doc.transact(() => {
    channelMembershipsArray.delete(idx, 1)
  })
}

export function updateChannelLastPing(channelId: string, at: string): void {
  const arr = channelMembershipsArray.toArray()
  const idx = arr.findIndex(m => m.channelId === channelId)
  if (idx === -1) return
  doc.transact(() => {
    channelMembershipsArray.delete(idx, 1)
    channelMembershipsArray.insert(idx, [{ ...arr[idx], lastPingAt: at }])
  })
}

// ─── Pings map mutations ─────────────────────────────────────────────────────

/**
 * Get or create the Y.Array for a channel's ping list.
 * IMPORTANT: must be called within a transaction or before attaching observers.
 */
export function getOrCreateChannelPings(channelId: string): Y.Array<PingObject> {
  let arr = pingsMap.get(channelId)
  if (!(arr instanceof Y.Array)) {
    arr = new Y.Array<PingObject>()
    pingsMap.set(channelId, arr)
  }
  return arr
}

export function sendPing(channelId: string, senderId: string, type: PingType, content?: string): PingObject {
  const ping: PingObject = {
    pingId: generateId(),
    type,
    senderId,
    sentAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PING_TTL[type]).toISOString(),
    content,
  }
  doc.transact(() => {
    const arr = getOrCreateChannelPings(channelId)
    arr.push([ping])
  })
  // Mirror to ping_history
  recordPingToHistory({
    type,
    channelId,
    sentAt: ping.sentAt,
    expiresAt: ping.expiresAt,
    content,
  })
  return ping
}

export function pruneExpiredChannelPings(channelId: string): number {
  const arr = pingsMap.get(channelId)
  if (!arr) return 0
  const now = Date.now()
  const toDelete: number[] = []
  arr.forEach((ping, i) => {
    if (new Date(ping.expiresAt).getTime() < now) toDelete.push(i)
  })
  for (let i = toDelete.length - 1; i >= 0; i--) {
    doc.transact(() => { arr.delete(toDelete[i], 1) })
  }
  return toDelete.length
}

export function pruneAllExpiredPings(): void {
  pingsMap.forEach((_arr, channelId) => {
    pruneExpiredChannelPings(channelId)
  })
  pruneExpiredPingHistory()
}

// ─── Threads map mutations ────────────────────────────────────────────────────

export function canonicalThreadId(handleA: string, handleB: string): string {
  const a = handleA.toLowerCase().replace(/^@/, '')
  const b = handleB.toLowerCase().replace(/^@/, '')
  return [a, b].sort().join(':')
}

/**
 * Prune thread keys that contain @ prefixes or more than one colon segment.
 * These are artifacts from the Phase 4/5 @ normalization bug.
 * Safe to run on every load — only removes keys that don't match canonical format.
 */
export function pruneMalformedTrustGraphKeys(): void {
  const keysToMigrate: Array<[string, unknown]> = []
  trustGraphMap.forEach((entry, key) => {
    if (key.startsWith('@')) {
      keysToMigrate.push([key.replace(/^@/, ''), entry])
    }
  })
  if (keysToMigrate.length > 0) {
    doc.transact(() => {
      keysToMigrate.forEach(([newKey, entry]) => {
        const oldKey = '@' + newKey
        trustGraphMap.delete(oldKey)
        trustGraphMap.set(newKey, entry as TrustEntry)
      })
    })
    console.log(`[ydoc] migrated ${keysToMigrate.length} trust_graph key(s) with @ prefix`)
  }
}

export function backfillTrustGraphFromThreads(): void {
  const threadKeys = [...threadsMap.keys()]
  let backfilled = 0
  for (const key of threadKeys) {
    const bare = key.replace(/^@/, '').toLowerCase().trim()
    if (bare && !trustGraphMap.get(bare)) {
      trustGraphMap.set(bare, {
        tier: 'contact',
        connectedAt: new Date().toISOString(),
        syncStatus: 'synced',
      })
      backfilled++
    }
  }
  if (backfilled > 0) {
    console.log(`[ydoc] backfilled ${backfilled} trust_graph entr(ies) from thread history`)
  }
}


export function pruneMalformedThreadKeys(): void {
  const keysToDelete: string[] = []
  threadsMap.forEach((_arr, key) => {
    // Valid canonical key: two lowercase handles joined by exactly one colon, no @ signs
    const valid = /^[a-z0-9_.]+:[a-z0-9_.]+$/.test(key)
    if (!valid) keysToDelete.push(key)
  })
  if (keysToDelete.length > 0) {
    doc.transact(() => {
      keysToDelete.forEach(k => threadsMap.delete(k))
    })
    console.log(`[ydoc] pruned ${keysToDelete.length} malformed thread key(s):`, keysToDelete)
  }
}

export function getOrCreateThread(contactId: string): Y.Array<ThreadMessage> {
  const myHandle = (profileMap.get('identity') as any)?.handle || ''
  const key = myHandle ? canonicalThreadId(myHandle, contactId) : contactId
  let arr = threadsMap.get(key)
  if (!(arr instanceof Y.Array)) {
    arr = new Y.Array<ThreadMessage>()
    threadsMap.set(key, arr)
  }
  return arr
}

export function sendMessage(contactId: string, senderId: string, content: string, assetRef?: string): ThreadMessage {
  const message: ThreadMessage = {
    messageId: generateId(),
    senderId,
    sentAt: new Date().toISOString(),
    content,
    assetRef,
  }
  doc.transact(() => {
    const arr = getOrCreateThread(contactId)
    arr.push([message])
  })
  return message
}

export function markMessageRead(contactId: string, messageId: string): void {
  const arr = threadsMap.get(contactId)
  if (!arr) return
  const idx = arr.toArray().findIndex(m => m.messageId === messageId)
  if (idx === -1) return
  const msg = arr.get(idx)
  doc.transact(() => {
    arr.delete(idx, 1)
    arr.insert(idx, [{ ...msg, readAt: new Date().toISOString() }])
  })
}

export function getThreadMessages(contactId: string): ThreadMessage[] {
  const arr = threadsMap.get(contactId)
  return arr ? arr.toArray() : []
}

// ─── Channels map mutations ───────────────────────────────────────────────────

export function upsertChannel(channelId: string, entry: ChannelEntry): void {
  doc.transact(() => {
    channelsMap.set(channelId, entry)
  })
}

export function getChannel(channelId: string): ChannelEntry | undefined {
  return channelsMap.get(channelId)
}

export function getAllChannels(): Map<string, ChannelEntry> {
  const result = new Map<string, ChannelEntry>()
  channelsMap.forEach((v, k) => result.set(k, v))
  return result
}

// ─── Assets map mutations ─────────────────────────────────────────────────────

export function addAsset(assetId: string, asset: AssetEntry): void {
  doc.transact(() => {
    assetsMap.set(assetId, asset)
  })
}

export function getAsset(assetId: string): AssetEntry | undefined {
  return assetsMap.get(assetId)
}

export function getAssetsByThread(contactId: string): Array<[string, AssetEntry]> {
  const result: Array<[string, AssetEntry]> = []
  assetsMap.forEach((v, k) => {
    if (v.sharedInThread === contactId) result.push([k, v])
  })
  return result
}

export function getAllAssets(): Array<[string, AssetEntry]> {
  const result: Array<[string, AssetEntry]> = []
  assetsMap.forEach((v, k) => result.push([k, v]))
  return result.sort((a, b) => b[1].sharedAt.localeCompare(a[1].sharedAt))
}

// ─── Full export (Phase 6 skeleton) ──────────────────────────────────────────

export function exportLocalState(): object {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    profile: {
      identity: getIdentity(),
      preferences: getPreferences(),
      trustGraph: Object.fromEntries(getContacts()),
      pingHistory: pingHistoryArray.toArray(),
      channelMemberships: channelMembershipsArray.toArray(),
    },
    channels: Object.fromEntries(getAllChannels()),
    assets: Object.fromEntries(getAllAssets()),
    // threads exported separately — can be large
    threads: (() => {
      const result: Record<string, ThreadMessage[]> = {}
      threadsMap.forEach((arr, contactId) => {
        result[contactId] = arr.toArray()
      })
      return result
    })(),
  }
}
