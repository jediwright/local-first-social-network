/**
 * PingFeed.tsx — Active channel pings, expiry-aware
 *
 * Shows live pings for the selected channel.
 * Filters expired pings client-side (pruneAllExpiredPings runs on doc load,
 * but we also filter here for any that expire during the session).
 * Empty state encourages first ping.
 */

import { useMemo } from 'react'
import { useChannelPings, useIdentity } from '../../hooks/useYjs'
import { PingBubble } from './PingBubble'
import type { PingObject } from '../../store/ydoc'

interface PingFeedProps {
  channelId: string
}

export function PingFeed({ channelId }: PingFeedProps) {
  const identity = useIdentity()
  const allPings = useChannelPings(channelId)

  // Filter out expired pings — belt-and-suspenders alongside the doc-load prune
  const activePings = useMemo(() => {
    const now = Date.now()
    return allPings
      .filter((p: PingObject) => new Date(p.expiresAt).getTime() > now)
      .sort((a: PingObject, b: PingObject) => b.sentAt.localeCompare(a.sentAt))
  }, [allPings])

  if (activePings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center space-y-3">
        <span className="text-4xl text-gray-800">◎</span>
        <p className="text-gray-500 text-sm">No active pings in #{channelId}</p>
        <p className="text-gray-700 text-xs">Pings expire. Be the first presence here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      {activePings.map(ping => (
        <PingBubble
          key={ping.pingId}
          ping={ping}
          isOwn={ping.senderId === identity?.handle}
        />
      ))}
    </div>
  )
}
