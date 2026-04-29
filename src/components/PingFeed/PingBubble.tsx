/**
 * PingBubble.tsx — Individual ping display with TTL indicator
 *
 * Shows ping type, sender, content (if any), and a live TTL countdown.
 * TTL bar drains from full to empty over the ping's lifetime.
 * Expired pings are not rendered — the feed filters them before passing here.
 */

import { useEffect, useState } from 'react'
import type { PingObject, PingType } from '../../store/ydoc'
import { addAsset } from '../../store/ydoc'

const PING_LABELS: Record<PingType, string> = {
  'here':             'here',
  'check-this':       'check this',
  'thinking-of-you':  'thinking of you',
  'lets-connect':     'let\'s connect',
  'status':           'status',
}

const PING_COLORS: Record<PingType, { bg: string; text: string; bar: string }> = {
  'here':             { bg: 'bg-indigo-950',  text: 'text-indigo-300',  bar: 'bg-indigo-500' },
  'check-this':       { bg: 'bg-amber-950',   text: 'text-amber-300',   bar: 'bg-amber-500' },
  'thinking-of-you':  { bg: 'bg-pink-950',    text: 'text-pink-300',    bar: 'bg-pink-500' },
  'lets-connect':     { bg: 'bg-emerald-950', text: 'text-emerald-300', bar: 'bg-emerald-500' },
  'status':           { bg: 'bg-blue-950',    text: 'text-blue-300',    bar: 'bg-blue-500' },
}

const PING_ICONS: Record<PingType, string> = {
  'here':             '◎',
  'check-this':       '→',
  'thinking-of-you':  '♡',
  'lets-connect':     '⊕',
  'status':           '●',
}

interface PingBubbleProps {
  ping: PingObject
  isOwn?: boolean
}

function useTTLPercent(sentAt: string, expiresAt: string): number {
  const total = new Date(expiresAt).getTime() - new Date(sentAt).getTime()
  const [percent, setPercent] = useState(() => {
    const remaining = new Date(expiresAt).getTime() - Date.now()
    return Math.max(0, Math.min(100, (remaining / total) * 100))
  })

  useEffect(() => {
    const tick = () => {
      const remaining = new Date(expiresAt).getTime() - Date.now()
      setPercent(Math.max(0, Math.min(100, (remaining / total) * 100)))
    }
    // Update every 30s — fine granularity for TTLs measured in hours/days
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [sentAt, expiresAt, total])

  return percent
}

function formatTimeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  const mins = Math.floor(ms / (1000 * 60))
  return `${mins}m`
}

export function PingBubble({ ping, isOwn = false }: PingBubbleProps) {
  const colors = PING_COLORS[ping.type]
  const ttlPercent = useTTLPercent(ping.sentAt, ping.expiresAt)
  const timeRemaining = formatTimeRemaining(ping.expiresAt)
  const [saved, setSaved] = useState(false)
  const [shared, setShared] = useState(false)

  return (
    <div className={`rounded-xl p-4 ${colors.bg} border border-white/5 space-y-3`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${colors.text}`}>{PING_ICONS[ping.type]}</span>
          <span className={`text-xs font-medium uppercase tracking-wider ${colors.text}`}>
            {PING_LABELS[ping.type]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isOwn && (
            <span className="text-gray-600 text-xs">you</span>
          )}
          {!isOwn && (
            <span className="text-gray-500 text-xs">@{ping.senderId}</span>
          )}
          <span className="text-gray-600 text-xs">{timeRemaining} left</span>
        </div>
      </div>

      {/* Content */}
      {ping.content && (
        <p className="text-gray-200 text-sm leading-relaxed">
          {ping.content.split(/(\bhttps?:\/\/\S+)/g).map((part, i) =>
            /^\bhttps?:\/\//.test(part)
              ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-blue-300 break-all">{part}</a>
              : part
          )}
        </p>
      )}

      {/* TTL bar */}
      <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full ${colors.bar} rounded-full transition-all duration-1000`}
          style={{ width: `${ttlPercent}%` }}
        />
      </div>
      {/* Action bar */}
      {ping.content && (
        <div className="flex justify-end gap-4 pt-2 mt-1 border-t border-white/10">
          <button
            onClick={() => {
              const url = ping.content?.match(/https?:\/\/\S+/)?.[0]
              addAsset(crypto.randomUUID(), { type: 'link', url: url ?? undefined, title: ping.content ?? '', sharedInThread: '', sharedAt: new Date().toISOString() })
              setSaved(true)
              setTimeout(() => setSaved(false), 2000)
            }}
            className="text-gray-500 hover:text-gray-200 transition-colors p-1"
            title="Save"
          >
            {saved
              ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z"/></svg>
            }
          </button>
          <button
            onClick={() => {
              const text = ping.content ?? ''
              if (navigator.share) {
                navigator.share({ text })
              } else {
                navigator.clipboard.writeText(text)
                setShared(true)
                setTimeout(() => setShared(false), 2000)
              }
            }}
            className="text-gray-500 hover:text-gray-200 transition-colors p-1"
            title="Share"
          >
            {shared
              ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            }
          </button>
        </div>
      )}
    </div>
  )
}
