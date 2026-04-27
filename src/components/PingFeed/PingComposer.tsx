/**
 * PingComposer.tsx — Ping type selector + send
 *
 * Five ping types, optional content field (shown for check-this and status),
 * channel selector from joined channels.
 * Writes to local Y.js only — no relay in Phase 2.
 */

import { useState } from 'react'
import { sendPing, type PingType } from '../../store/ydoc'
import { useIdentity, useChannelMemberships } from '../../hooks/useYjs'

const PING_TYPES: Array<{
  type: PingType
  label: string
  icon: string
  description: string
  hasContent: boolean
  color: string
  activeColor: string
}> = [
  {
    type: 'here',
    label: 'Here',
    icon: '◎',
    description: 'I\'m around',
    hasContent: false,
    color: 'border-gray-700 text-gray-400',
    activeColor: 'border-indigo-500 bg-indigo-950 text-indigo-300',
  },
  {
    type: 'check-this',
    label: 'Check this',
    icon: '→',
    description: 'Worth your attention',
    hasContent: true,
    color: 'border-gray-700 text-gray-400',
    activeColor: 'border-amber-500 bg-amber-950 text-amber-300',
  },
  {
    type: 'thinking-of-you',
    label: 'Thinking of you',
    icon: '♡',
    description: 'No response needed',
    hasContent: false,
    color: 'border-gray-700 text-gray-400',
    activeColor: 'border-pink-500 bg-pink-950 text-pink-300',
  },
  {
    type: 'lets-connect',
    label: 'Let\'s connect',
    icon: '⊕',
    description: 'Start a thread',
    hasContent: false,
    color: 'border-gray-700 text-gray-400',
    activeColor: 'border-emerald-500 bg-emerald-950 text-emerald-300',
  },
  {
    type: 'status',
    label: 'Status',
    icon: '●',
    description: 'What I\'m up to',
    hasContent: true,
    color: 'border-gray-700 text-gray-400',
    activeColor: 'border-blue-500 bg-blue-950 text-blue-300',
  },
]

const SEND_BUTTON_COLORS: Record<PingType, string> = {
  'here':             'bg-indigo-600 hover:bg-indigo-500',
  'check-this':       'bg-amber-600 hover:bg-amber-500',
  'thinking-of-you':  'bg-pink-600 hover:bg-pink-500',
  'lets-connect':     'bg-emerald-600 hover:bg-emerald-500',
  'status':           'bg-blue-600 hover:bg-blue-500',
}

interface PingComposerProps {
  defaultChannelId?: string
  onSent?: () => void
}

export function PingComposer({ defaultChannelId, onSent }: PingComposerProps) {
  const identity = useIdentity()
  const memberships = useChannelMemberships()

  const [selectedType, setSelectedType] = useState<PingType>('here')
  const [content, setContent] = useState('')
  const [channelId, setChannelId] = useState(defaultChannelId ?? memberships[0]?.channelId ?? 'general')
  const [sending, setSending] = useState(false)
  const [justSent, setJustSent] = useState(false)

  const selectedConfig = PING_TYPES.find(p => p.type === selectedType)!

  const handleSend = () => {
    if (!identity) return
    if (selectedConfig.hasContent && !content.trim()) return

    setSending(true)
    sendPing(channelId, identity.handle, selectedType, content.trim() || undefined)

    // Brief confirmation state
    setJustSent(true)
    setContent('')
    setSending(false)
    setTimeout(() => {
      setJustSent(false)
      onSent?.()
    }, 800)
  }

  // Channel options: joined channels + always include 'general'
  const channelOptions = [
    ...new Set(['general', ...memberships.map(m => m.channelId)])
  ]

  return (
    <div className="bg-gray-900 rounded-2xl p-4 space-y-4">
      {/* Ping type selector */}
      <div className="grid grid-cols-5 gap-2">
        {PING_TYPES.map(({ type, label, icon, activeColor, color }) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition text-center ${
              selectedType === type ? activeColor : `${color} hover:border-gray-600`
            }`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span className="text-xs leading-tight">{label}</span>
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-gray-500 text-xs text-center">{selectedConfig.description}</p>

      {/* Content field — only for ping types that support it */}
      {selectedConfig.hasContent && (
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={selectedType === 'check-this' ? 'What should they check out?' : 'What\'s your status?'}
          maxLength={280}
          rows={2}
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none transition"
        />
      )}

      {/* Channel selector + send */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-gray-600 text-xs">#</span>
          <select
            value={channelId}
            onChange={e => setChannelId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 transition flex-1"
          >
            {channelOptions.map(id => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSend}
          disabled={sending || justSent || (selectedConfig.hasContent && !content.trim())}
          className={`px-5 py-2 rounded-xl text-white text-sm font-medium transition ${
            justSent
              ? 'bg-gray-700 text-gray-400'
              : `${SEND_BUTTON_COLORS[selectedType]} disabled:opacity-40 disabled:cursor-not-allowed`
          }`}
        >
          {justSent ? 'Sent ✓' : 'Ping'}
        </button>
      </div>
    </div>
  )
}
