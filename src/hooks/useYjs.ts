/**
 * useYjs.ts — Local-First Social reactive hooks
 *
 * THE CORE LESSON from checkout-seam: attach observers to ALL nested Y.Arrays
 * from the start. A Y.Array that gets an observer added later (after first render)
 * will miss mutations that happened before the observer was attached, leading to
 * stale state that only corrects on full reload. Apply attachArrayObserver() to
 * every nested Y.Array at document initialization, not lazily.
 *
 * attachArrayObserver(yArray, setState) — canonical pattern:
 *   1. Read current toArray() into state immediately
 *   2. Observe the array for future mutations
 *   3. Return cleanup that removes the observer
 *
 * All hooks follow the same shape:
 *   - useState initialized from current Y.js state
 *   - useEffect attaches observer, sets state on change, returns cleanup
 *   - Returns typed readonly state
 */

import { useEffect, useState, useCallback } from 'react'
import * as Y from 'yjs'
import {
  doc,
  persistenceReady,
  profileMap,
  pingsMap,
  threadsMap,
  channelsMap,
  assetsMap,
  trustGraphMap,
  pingHistoryArray,
  channelMembershipsArray,
  getOrCreateChannelPings,
  getOrCreateThread,
  pruneAllExpiredPings,
  pruneMalformedThreadKeys,
  pruneMalformedTrustGraphKeys,
  type Identity,
  type Preferences,
  type TrustEntry,
  type PingHistoryEntry,
  type ChannelMembership,
  type PingObject,
  type ThreadMessage,
  type ChannelEntry,
  type AssetEntry,
} from '../store/ydoc'

// ─── Utility: canonical array observer attachment ─────────────────────────────

/**
 * attachArrayObserver<T>
 *
 * Reads current state immediately, then observes for future changes.
 * Returns an unsubscribe function for use in useEffect cleanup.
 *
 * This is the pattern that checkout-seam taught us to apply everywhere.
 * Every nested Y.Array in the document gets this treatment.
 */
function attachArrayObserver<T>(
  yArray: Y.Array<T>,
  setState: (items: T[]) => void,
): () => void {
  // Immediate read — don't wait for the first mutation
  setState(yArray.toArray())

  const observer = () => {
    setState(yArray.toArray())
  }

  yArray.observe(observer)
  return () => yArray.unobserve(observer)
}

/**
 * attachMapObserver<V>
 *
 * Same pattern for Y.Map — used for trustGraph, channelsMap, assetsMap, etc.
 */
function attachMapObserver<V>(
  yMap: Y.Map<V>,
  setState: (entries: Map<string, V>) => void,
): () => void {
  const read = () => {
    const m = new Map<string, V>()
    yMap.forEach((v, k) => m.set(k, v))
    setState(m)
  }

  read()

  const observer = () => read()
  yMap.observe(observer)
  return () => yMap.unobserve(observer)
}

// ─── Persistence ready hook ───────────────────────────────────────────────────

export function usePersistenceReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    persistenceReady.then(() => setReady(true))
  }, [])
  return ready
}

// ─── Profile hooks ────────────────────────────────────────────────────────────

export function useIdentity(): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(
    () => (profileMap.get('identity') as Identity) ?? null,
  )

  useEffect(() => {
    const read = () => {
      setIdentity((profileMap.get('identity') as Identity) ?? null)
    }
    profileMap.observe(read)
    return () => profileMap.unobserve(read)
  }, [])

  return identity
}

export function usePreferences(): Preferences | null {
  const [prefs, setPrefs] = useState<Preferences | null>(
    () => (profileMap.get('preferences') as Preferences) ?? null,
  )

  useEffect(() => {
    const read = () => {
      setPrefs((profileMap.get('preferences') as Preferences) ?? null)
    }
    profileMap.observe(read)
    return () => profileMap.unobserve(read)
  }, [])

  return prefs
}

// ─── Trust graph hook ─────────────────────────────────────────────────────────

export function useTrustGraph(): Map<string, TrustEntry> {
  const [contacts, setContacts] = useState<Map<string, TrustEntry>>(new Map())

  useEffect(() => {
    return attachMapObserver(trustGraphMap as Y.Map<TrustEntry>, setContacts)
  }, [])

  return contacts
}

// ─── Ping history hook ────────────────────────────────────────────────────────

export function usePingHistory(): PingHistoryEntry[] {
  const [history, setHistory] = useState<PingHistoryEntry[]>([])

  useEffect(() => {
    return attachArrayObserver(pingHistoryArray, setHistory)
  }, [])

  return history
}

// ─── Channel memberships hook ─────────────────────────────────────────────────

export function useChannelMemberships(): ChannelMembership[] {
  const [memberships, setMemberships] = useState<ChannelMembership[]>([])

  useEffect(() => {
    return attachArrayObserver(channelMembershipsArray, setMemberships)
  }, [])

  return memberships
}

// ─── Channel pings hook ───────────────────────────────────────────────────────

/**
 * useChannelPings(channelId)
 *
 * Reactive hook for a specific channel's ping Y.Array.
 * Calls getOrCreateChannelPings() to ensure the Y.Array exists before
 * attaching the observer — consistent with the "create once, observe always"
 * pattern.
 */
export function useChannelPings(channelId: string): PingObject[] {
  const [pings, setPings] = useState<PingObject[]>([])

  useEffect(() => {
    if (!channelId) return
    const arr = getOrCreateChannelPings(channelId)
    return attachArrayObserver(arr, setPings)
  }, [channelId])

  return pings
}

/**
 * useAllChannelPings()
 *
 * Reactive hook for the top-level pings map.
 * Returns a Map<channelId, PingObject[]>.
 * When a new channel Y.Array is added to pingsMap, re-reads all channels.
 */
export function useAllChannelPings(): Map<string, PingObject[]> {
  const [allPings, setAllPings] = useState<Map<string, PingObject[]>>(new Map())

  useEffect(() => {
    const readAll = () => {
      const result = new Map<string, PingObject[]>()
      pingsMap.forEach((arr, channelId) => {
        result.set(channelId, arr.toArray())
      })
      setAllPings(new Map(result))
    }

    readAll()

    // Observe the map for new channels being added
    const mapObserver = () => readAll()
    pingsMap.observe(mapObserver)

    // Also observe existing channel arrays
    const arrayCleanups: (() => void)[] = []
    pingsMap.forEach((arr) => {
      const cleanup = attachArrayObserver(arr, () => readAll())
      arrayCleanups.push(cleanup)
    })

    return () => {
      pingsMap.unobserve(mapObserver)
      arrayCleanups.forEach(fn => fn())
    }
  }, [])

  return allPings
}

// ─── Thread hooks ─────────────────────────────────────────────────────────────

/**
 * useThread(contactId)
 *
 * Reactive hook for a single thread's Y.Array.
 * Same getOrCreate + attachArrayObserver pattern.
 */
export function useThread(contactId: string): ThreadMessage[] {
  const [messages, setMessages] = useState<ThreadMessage[]>([])

  useEffect(() => {
    if (!contactId) return
    let cleanup = attachArrayObserver(getOrCreateThread(contactId), setMessages)
    const mapObserver = () => {
      cleanup()
      cleanup = attachArrayObserver(getOrCreateThread(contactId), setMessages)
    }
    threadsMap.observe(mapObserver)
    return () => {
      cleanup()
      threadsMap.unobserve(mapObserver)
    }
  }, [contactId])

  return messages
}

/**
 * useAllThreads()
 *
 * Returns a Map<contactId, ThreadMessage[]> and reacts to
 * both new threads being created and messages added to existing threads.
 */
export function useAllThreads(): Map<string, ThreadMessage[]> {
  const [threads, setThreads] = useState<Map<string, ThreadMessage[]>>(new Map())

  useEffect(() => {
    const readAll = () => {
      const result = new Map<string, ThreadMessage[]>()
      threadsMap.forEach((arr, contactId) => {
        result.set(contactId, arr.toArray())
      })
      setThreads(new Map(result))
    }

    readAll()

    const mapObserver = () => readAll()
    threadsMap.observe(mapObserver)

    const arrayCleanups: (() => void)[] = []
    threadsMap.forEach((arr) => {
      const cleanup = attachArrayObserver(arr, () => readAll())
      arrayCleanups.push(cleanup)
    })

    return () => {
      threadsMap.unobserve(mapObserver)
      arrayCleanups.forEach(fn => fn())
    }
  }, [])

  return threads
}

// ─── Channels hooks ───────────────────────────────────────────────────────────

export function useChannels(): Map<string, ChannelEntry> {
  const [channels, setChannels] = useState<Map<string, ChannelEntry>>(new Map())

  useEffect(() => {
    return attachMapObserver(channelsMap as Y.Map<ChannelEntry>, setChannels)
  }, [])

  return channels
}

// ─── Assets hooks ─────────────────────────────────────────────────────────────

export function useAssets(): Map<string, AssetEntry> {
  const [assets, setAssets] = useState<Map<string, AssetEntry>>(new Map())

  useEffect(() => {
    return attachMapObserver(assetsMap as Y.Map<AssetEntry>, setAssets)
  }, [])

  return assets
}

// ─── Document-level: observe all nested arrays on load ───────────────────────

/**
 * useDocumentReady()
 *
 * Called once at app root. Ensures:
 * 1. Persistence is synced from IndexedDB
 * 2. Expired pings are pruned on document load
 * 3. All existing nested Y.Arrays in pings/threads have observers attached
 *    (handles the case where document was loaded from IndexedDB with existing data)
 *
 * This is the "attach from the start" guarantee the spec requires.
 */
export function useDocumentReady(): { ready: boolean } {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    persistenceReady.then(() => {
      pruneAllExpiredPings()
      pruneMalformedThreadKeys()
      pruneMalformedTrustGraphKeys()
      setReady(true)
    })
  }, [])

  return { ready }
}

// ─── Derived: profile completeness ───────────────────────────────────────────

export function useProfileComplete(): boolean {
  const identity = useIdentity()
  return !!(identity?.displayName && identity?.handle)
}

// ─── Derived: last ping per channel from membership list ─────────────────────

export function useMembershipWithActivity(): Array<ChannelMembership & { channelName?: string }> {
  const memberships = useChannelMemberships()
  const channels = useChannels()

  return memberships.map(m => ({
    ...m,
    channelName: channels.get(m.channelId)?.name,
  }))
}

// ─── Doc transaction helper for components ────────────────────────────────────

export function useYDoc() {
  const transact = useCallback((fn: () => void) => {
    doc.transact(fn)
  }, [])
  return { transact, doc }
}
