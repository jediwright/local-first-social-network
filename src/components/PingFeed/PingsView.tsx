/**
 * PingsView.tsx — Main pings view
 *
 * Layout:
 *   - Left panel: ChannelList (sidebar on wide, drawer on narrow)
 *   - Right panel: PingFeed for selected channel + PingComposer
 *   - Top: streak indicator
 *
 * All local — no relay in Phase 2.
 */

import { useState } from 'react'
import { PingFeed } from '../PingFeed/PingFeed'
import { PingComposer } from '../PingFeed/PingComposer'
import { ChannelList } from '../Channels/ChannelList'
import { useStreaks } from '../../hooks/useStreaks'
import { useChannelMemberships } from '../../hooks/useYjs'
import { joinChannel, upsertChannel } from '../../store/ydoc'

function StreakBar({ streak, todayCount }: { streak: number; todayCount: number }) {
  if (streak === 0 && todayCount === 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900/50 border-b border-gray-800">
      {streak > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400 text-sm">◈</span>
          <span className="text-gray-300 text-xs">
            <span className="font-semibold text-amber-400">{streak}</span>
            {streak === 1 ? ' day streak' : ' day streak'}
          </span>
        </div>
      )}
      {todayCount > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-indigo-400 text-xs">
            <span className="font-semibold">{todayCount}</span> ping{todayCount !== 1 ? 's' : ''} today
          </span>
        </div>
      )}
    </div>
  )
}

export function PingsView() {
  const memberships = useChannelMemberships()
  const { currentStreak, todayCount } = useStreaks()

  // Default to first joined channel, or auto-join general
  const defaultChannel = memberships[0]?.channelId ?? 'general'
  const [selectedChannel, setSelectedChannel] = useState(defaultChannel)
  const [showChannels, setShowChannels] = useState(false)
  const [showComposer, setShowComposer] = useState(false)

  // Auto-join general if no memberships
  if (memberships.length === 0) {
    joinChannel('general')
    upsertChannel('general', {
      name: 'general',
      topic: 'Open presence — no theme required',
      memberCount: 0,
      lastActivityAt: new Date().toISOString(),
      myLastPingAt: null,
    })
  }

  return (
    <div className="flex flex-col h-full">
      <StreakBar streak={currentStreak} todayCount={todayCount} />

      {/* Channel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <button
          onClick={() => setShowChannels(!showChannels)}
          className="flex items-center gap-2 text-gray-200 hover:text-white transition"
        >
          <span className="text-gray-500">#</span>
          <span className="font-medium text-sm">{selectedChannel}</span>
          <span className="text-gray-600 text-xs">{showChannels ? '▲' : '▼'}</span>
        </button>
        <button
          onClick={() => setShowComposer(!showComposer)}
          className="text-indigo-400 hover:text-indigo-300 text-sm transition flex items-center gap-1"
        >
          <span>{showComposer ? '✕' : '◎'}</span>
          <span className="text-xs">{showComposer ? 'close' : 'ping'}</span>
        </button>
      </div>

      {/* Channel drawer */}
      {showChannels && (
        <div className="border-b border-gray-800 bg-gray-950 max-h-64 overflow-y-auto">
          <ChannelList
            selectedChannelId={selectedChannel}
            onSelectChannel={id => {
              setSelectedChannel(id)
              setShowChannels(false)
            }}
          />
        </div>
      )}

      {/* Composer */}
      {showComposer && (
        <div className="p-4 border-b border-gray-800">
          <PingComposer
            defaultChannelId={selectedChannel}
            onSent={() => setShowComposer(false)}
          />
        </div>
      )}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        <PingFeed channelId={selectedChannel} />
      </div>

      {/* Floating ping button when composer is closed */}
      {!showComposer && (
        <div className="px-4 py-3 border-t border-gray-800">
          <button
            onClick={() => setShowComposer(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-sm font-medium transition flex items-center justify-center gap-2"
          >
            <span>◎</span> Send a ping
          </button>
        </div>
      )}
    </div>
  )
}
