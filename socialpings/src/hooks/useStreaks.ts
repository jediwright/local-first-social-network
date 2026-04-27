/**
 * useStreaks.ts — Local streak and reciprocity calculations
 *
 * Derived entirely from ping_history Y.Array — no server required.
 *
 * Streak: consecutive days with at least one outbound ping.
 * Reciprocity: channels where you've pinged recently, as a presence signal.
 * Channel frequency: which channels you ping most, for composer defaulting.
 */

import { useMemo } from 'react'
import { usePingHistory } from './useYjs'
import type { PingHistoryEntry } from '../store/ydoc'

export interface StreakData {
  currentStreak: number       // consecutive days with at least one ping
  longestStreak: number
  totalPings: number
  last30Days: number
  todayCount: number
}

export interface ChannelFrequency {
  channelId: string
  count: number
  lastPingAt: string | null
}

function dayKey(isoString: string): string {
  return isoString.slice(0, 10) // YYYY-MM-DD
}

export function useStreaks(): StreakData {
  const history = usePingHistory()

  return useMemo(() => {
    if (history.length === 0) {
      return { currentStreak: 0, longestStreak: 0, totalPings: 0, last30Days: 0, todayCount: 0 }
    }

    const now = new Date()
    const todayKey = dayKey(now.toISOString())
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

    // Unique days with pings, sorted descending
    const pingDays = [...new Set(history.map(e => dayKey(e.sentAt)))].sort().reverse()

    // Current streak: count consecutive days back from today or yesterday
    let currentStreak = 0
    const checkDate = new Date(now)
    // If no ping today, start check from yesterday
    if (!pingDays.includes(todayKey)) {
      checkDate.setDate(checkDate.getDate() - 1)
    }
    for (let i = 0; i < pingDays.length; i++) {
      const expected = dayKey(checkDate.toISOString())
      if (pingDays[i] === expected) {
        currentStreak++
        checkDate.setDate(checkDate.getDate() - 1)
      } else {
        break
      }
    }

    // Longest streak
    let longestStreak = 0
    let run = 1
    for (let i = 1; i < pingDays.length; i++) {
      const prev = new Date(pingDays[i - 1])
      const curr = new Date(pingDays[i])
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays === 1) {
        run++
        longestStreak = Math.max(longestStreak, run)
      } else {
        run = 1
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak, pingDays.length > 0 ? 1 : 0)

    const last30Days = history.filter(
      (e: PingHistoryEntry) => new Date(e.sentAt).getTime() > thirtyDaysAgo
    ).length

    const todayCount = history.filter(
      (e: PingHistoryEntry) => dayKey(e.sentAt) === todayKey
    ).length

    return {
      currentStreak,
      longestStreak,
      totalPings: history.length,
      last30Days,
      todayCount,
    }
  }, [history])
}

export function useChannelFrequency(): ChannelFrequency[] {
  const history = usePingHistory()

  return useMemo(() => {
    const map = new Map<string, { count: number; lastPingAt: string }>()

    history.forEach((e: PingHistoryEntry) => {
      const existing = map.get(e.channelId)
      if (!existing || e.sentAt > existing.lastPingAt) {
        map.set(e.channelId, {
          count: (existing?.count ?? 0) + 1,
          lastPingAt: e.sentAt,
        })
      } else {
        map.set(e.channelId, { ...existing, count: existing.count + 1 })
      }
    })

    return Array.from(map.entries())
      .map(([channelId, data]) => ({ channelId, ...data }))
      .sort((a, b) => b.count - a.count)
  }, [history])
}
