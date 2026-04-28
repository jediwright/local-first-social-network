import { useState, useEffect } from 'react'
import { useTrustGraph, useIdentity } from '../../hooks/useYjs'
import { getThreadMessages, canonicalThreadId, threadsMap } from '../../store/ydoc'
import type { ThreadMessage } from '../../store/ydoc'

interface Props {
  contactId: string
  onBack: () => void
  onOpenThread: (contactId: string) => void
  onEditTrust: (contactId: string) => void
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function ContactDetail({ contactId, onBack, onOpenThread, onEditTrust }: Props) {
  const contacts = useTrustGraph()
  const identity = useIdentity()
  const myHandle = identity?.handle ?? ''
  const entry = contacts.get(contactId)
  const [messages, setMessages] = useState<ThreadMessage[]>([])

  useEffect(() => {
    const load = () => setMessages(getThreadMessages(contactId))
    load()
    // observe thread for live updates
    const key = myHandle ? canonicalThreadId(myHandle, contactId) : contactId
    const thread = threadsMap.get(key)
    if (thread) {
      thread.observe(load)
      return () => thread.unobserve(load)
    }
  }, [contactId, myHandle])

  if (!entry) {
    return (
      <div className="flex flex-col h-full">
        <button onClick={onBack} className="px-4 py-3 text-left text-gray-400 text-sm hover:text-gray-200">
          ← Back
        </button>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Contact not found
        </div>
      </div>
    )
  }

  const tierColor = entry.tier === 'close' ? 'text-green-400' : 'text-blue-400'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-200 text-sm">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">@{contactId}</span>
            <span className={`text-xs ${tierColor}`}>{entry.tier}</span>
          </div>
          <p className="text-xs text-gray-500">
            Connected {new Date(entry.connectedAt).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => onEditTrust(contactId)}
          className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded border border-gray-700 hover:border-gray-500"
        >
          Trust settings
        </button>
      </div>

      {/* Thread history */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-4">No messages yet</p>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === myHandle
            return (
              <div key={msg.messageId} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs px-3 py-2 rounded-lg text-sm ${
                  isMe ? 'bg-blue-900 text-blue-100' : 'bg-gray-800 text-gray-200'
                }`}>
                  <p>{msg.content}</p>
                  <p className="text-xs opacity-50 mt-1">{formatTime(msg.sentAt)}</p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Thread CTA */}
      <div className="px-4 py-3 border-t border-gray-800">
        <button
          onClick={() => onOpenThread(contactId)}
          className="w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition-colors"
        >
          Open thread →
        </button>
      </div>
    </div>
  )
}
