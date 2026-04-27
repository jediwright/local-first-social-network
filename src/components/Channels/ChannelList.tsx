/**
 * ChannelList.tsx — Joined channels with activity indicators
 *
 * Shows all joined channels, last ping time, active ping count.
 * Includes a join flow for adding new channels by interest.
 * Channel memberships and metadata persisted locally via Y.js.
 */

import { useState } from 'react'
import { joinChannel, leaveChannel, upsertChannel } from '../../store/ydoc'
import { useChannelMemberships, useChannels, useAllChannelPings } from '../../hooks/useYjs'

// Suggested starter channels — in Phase 4, these come from relay discovery
const SUGGESTED_CHANNELS = [
  { id: 'general',     topic: 'Open presence — no theme required' },
  { id: 'design',      topic: 'Visual thinking, systems, craft' },
  { id: 'technology',  topic: 'Tools, infrastructure, software' },
  { id: 'writing',     topic: 'Long-form, essays, craft' },
  { id: 'music',       topic: 'Making, listening, finding' },
  { id: 'governance',  topic: 'Civic infrastructure, policy, democracy' },
  { id: 'health',      topic: 'Movement, rest, wellbeing' },
  { id: 'learning',    topic: 'What you\'re reading, studying, building' },
]

function formatLastActivity(isoString: string | null): string {
  if (!isoString) return 'never'
  const ms = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

interface ChannelListProps {
  selectedChannelId: string
  onSelectChannel: (channelId: string) => void
}

export function ChannelList({ selectedChannelId, onSelectChannel }: ChannelListProps) {
  const memberships = useChannelMemberships()
  const channels = useChannels()
  const allPings = useAllChannelPings()
  const [showDiscover, setShowDiscover] = useState(false)
  const [customChannel, setCustomChannel] = useState('')

  const joinedIds = new Set(memberships.map(m => m.channelId))

  const handleJoin = (channelId: string, topic = '') => {
    joinChannel(channelId)
    upsertChannel(channelId, {
      name: channelId,
      topic,
      memberCount: 0, // relay-provided in Phase 4
      lastActivityAt: new Date().toISOString(),
      myLastPingAt: null,
    })
    onSelectChannel(channelId)
    setShowDiscover(false)
    setCustomChannel('')
  }

  const handleLeave = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    leaveChannel(channelId)
    if (selectedChannelId === channelId) {
      const remaining = memberships.filter(m => m.channelId !== channelId)
      onSelectChannel(remaining[0]?.channelId ?? 'general')
    }
  }

  const handleJoinCustom = () => {
    const id = customChannel.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
    if (!id) return
    handleJoin(id)
  }

  // Active ping count per channel (not expired)
  const getActivePingCount = (channelId: string): number => {
    const pings = allPings.get(channelId) ?? []
    const now = Date.now()
    return pings.filter(p => new Date(p.expiresAt).getTime() > now).length
  }

  return (
    <div className="flex flex-col h-full">
      {/* Joined channels */}
      <div className="flex-1 overflow-y-auto">
        {memberships.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-gray-500 text-sm">No channels joined yet</p>
            <p className="text-gray-700 text-xs">Join a channel to start pinging</p>
          </div>
        ) : (
          <div className="py-2">
            {memberships.map(m => {
              const channel = channels.get(m.channelId)
              const activePings = getActivePingCount(m.channelId)
              const isSelected = selectedChannelId === m.channelId

              return (
                <button
                  key={m.channelId}
                  onClick={() => onSelectChannel(m.channelId)}
                  className={`w-full flex items-center justify-between px-4 py-3 transition text-left ${
                    isSelected
                      ? 'bg-indigo-950/50 border-l-2 border-indigo-500'
                      : 'hover:bg-gray-800/50 border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-gray-500 text-sm flex-shrink-0">#</span>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium truncate ${isSelected ? 'text-indigo-300' : 'text-gray-200'}`}>
                        {m.channelId}
                      </p>
                      <p className="text-gray-600 text-xs truncate">
                        {channel?.topic ?? ''} · {formatLastActivity(m.lastPingAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {activePings > 0 && (
                      <span className="bg-indigo-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {activePings}
                      </span>
                    )}
                    <button
                      onClick={e => handleLeave(m.channelId, e)}
                      className="text-gray-700 hover:text-gray-400 text-xs px-1 opacity-0 group-hover:opacity-100 transition"
                      title="Leave channel"
                    >
                      ✕
                    </button>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Discover / join */}
      <div className="border-t border-gray-800 p-3">
        {!showDiscover ? (
          <button
            onClick={() => setShowDiscover(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-3 rounded-xl transition font-medium flex items-center justify-center gap-1"
          >
            <span>+</span> Join a channel
          </button>
        ) : (
          <div className="space-y-3">
            {/* Suggested */}
            <div className="space-y-1">
              {SUGGESTED_CHANNELS.filter(s => !joinedIds.has(s.id)).slice(0, 5).map(s => (
                <button
                  key={s.id}
                  onClick={() => handleJoin(s.id, s.topic)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-800 transition text-left"
                >
                  <div>
                    <span className="text-gray-300 text-xs">#{s.id}</span>
                    <p className="text-gray-600 text-xs">{s.topic}</p>
                  </div>
                  <span className="text-indigo-400 text-xs">+ join</span>
                </button>
              ))}
            </div>

            {/* Custom channel */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">#</span>
                <input
                  type="text"
                  value={customChannel}
                  onChange={e => setCustomChannel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleJoinCustom()}
                  placeholder="custom-channel"
                  maxLength={30}
                  className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg pl-6 pr-3 py-2 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
              <button
                onClick={handleJoinCustom}
                disabled={!customChannel}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg transition"
              >
                Join
              </button>
            </div>

            <button
              onClick={() => setShowDiscover(false)}
              className="w-full text-gray-600 text-xs py-1 hover:text-gray-400 transition"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
