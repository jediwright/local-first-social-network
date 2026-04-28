/**
 * ThreadDetail.tsx — Full thread conversation view
 *
 * Renders all messages in a thread, newest at bottom.
 * Marks messages as read on view.
 * Shows asset references inline.
 * Phase 3: local only — messages sent to self or staged for Phase 4 relay sync.
 */

import { useEffect, useRef } from 'react'
import { useThread, useIdentity } from '../../hooks/useYjs'
import { markMessageRead, getAsset } from '../../store/ydoc'
import type { ThreadMessage } from '../../store/ydoc'

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface AssetPreviewProps {
  assetRef: string
}

function AssetPreview({ assetRef }: AssetPreviewProps) {
  const asset = getAsset(assetRef)
  if (!asset) return null

  if (asset.type === 'link' && asset.url) {
    return (
      <a
        href={asset.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-2 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 hover:border-gray-600 transition"
      >
        <p className="text-indigo-400 text-xs">→ {asset.title ?? asset.url}</p>
        <p className="text-gray-500 text-xs truncate">{asset.url}</p>
      </a>
    )
  }

  return (
    <div className="mt-2 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
      <p className="text-gray-400 text-xs">📎 {asset.title ?? 'Attachment'}</p>
    </div>
  )
}

interface MessageBubbleProps {
  message: ThreadMessage
  isOwn: boolean
  showTime: boolean
}

function MessageBubble({ message, isOwn, showTime }: MessageBubbleProps) {
  return (
    <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} mb-1`}>
      <div
        className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${
          isOwn
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-gray-800 text-gray-100 rounded-bl-sm'
        }`}
      >
        {message.content}
        {message.assetRef && <AssetPreview assetRef={message.assetRef} />}
      </div>
      {showTime && (
        <span className="text-gray-600 text-xs mt-1 px-1">{formatTime(message.sentAt)}</span>
      )}
    </div>
  )
}

interface ThreadDetailProps {
  contactId: string
  onBack?: () => void
}

export function ThreadDetail({ contactId, onBack }: ThreadDetailProps) {
  const identity = useIdentity()
  const messages = useThread(contactId).slice().sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  const bottomRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Mark unread messages as read on view
  useEffect(() => {
    if (!identity) return
    messages.forEach(msg => {
      if (msg.senderId !== identity.handle && !msg.readAt) {
        markMessageRead(contactId, msg.messageId)
      }
    })
  }, [messages, contactId, identity])

  if (!identity) return null

  // Group messages to show timestamps at intervals
  const shouldShowTime = (msg: ThreadMessage, index: number): boolean => {
    if (index === messages.length - 1) return true
    const next = messages[index + 1]
    const diff = new Date(next.sentAt).getTime() - new Date(msg.sentAt).getTime()
    return diff > 5 * 60 * 1000 // show time if >5min gap
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 flex-shrink-0">
        {onBack && (
          <button onClick={onBack} className="text-gray-500 hover:text-gray-300 transition text-sm">
            ←
          </button>
        )}
        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium">
          {contactId.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-white text-sm font-medium">@{contactId}</p>
          <p className="text-gray-600 text-xs">
            {messages.length} message{messages.length !== 1 ? 's' : ''} · local
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
            <p className="text-gray-500 text-sm">No messages yet</p>
            <p className="text-gray-700 text-xs">
              Messages are stored locally. Sync with @{contactId} in Phase 4.
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.messageId}
                message={msg}
                isOwn={msg.senderId === identity.handle}
                showTime={shouldShowTime(msg, i)}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  )
}
