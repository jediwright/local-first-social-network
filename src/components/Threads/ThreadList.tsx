/**
 * ThreadList.tsx — Thread list sorted by last activity
 *
 * Shows all threads (contacts with message history), sorted by
 * last message time. Unread indicator for messages not yet read.
 * New thread flow for starting a conversation with a new contact handle.
 *
 * Phase 3: all local. In Phase 4, contacts come from trust graph
 * after relay handshake. For now, any @handle can be used as a
 * thread target.
 */

import { useMemo } from 'react'
import { useAllThreads, useIdentity } from '../../hooks/useYjs'
import type { ThreadMessage } from '../../store/ydoc'

interface ThreadListProps {
  selectedContactId: string | null
  onSelectThread: (contactId: string) => void
  onNewThread: () => void
}

function formatTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  if (mins > 0) return `${mins}m`
  return 'now'
}

function getUnreadCount(messages: ThreadMessage[], myHandle: string): number {
  return messages.filter(m => m.senderId !== myHandle && !m.readAt).length
}

function getLastMessage(messages: ThreadMessage[]): ThreadMessage | null {
  if (messages.length === 0) return null
  return messages[messages.length - 1]
}

export function ThreadList({ selectedContactId, onSelectThread, onNewThread }: ThreadListProps) {
  const identity = useIdentity()
  const allThreads = useAllThreads()

  const sortedThreads = useMemo(() => {
    const myHandle = identity?.handle ?? ''
    return Array.from(allThreads.entries())
      .map(([canonicalKey, messages]) => {
        const peerHandle = canonicalKey.split(':').find(h => h !== myHandle) ?? canonicalKey
        return {
          contactId: peerHandle,
          messages,
          lastMessage: getLastMessage(messages),
          unreadCount: identity ? getUnreadCount(messages, identity.handle) : 0,
        }
      })
      .filter(t => t.messages.length > 0)
      .sort((a, b) => {
        const aTime = a.lastMessage?.sentAt ?? ''
        const bTime = b.lastMessage?.sentAt ?? ''
        return bTime.localeCompare(aTime)
      })
  }, [allThreads, identity])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-white font-medium text-sm">Threads</h2>
        <button
          onClick={onNewThread}
          className="text-indigo-400 hover:text-indigo-300 text-xs transition flex items-center gap-1"
        >
          <span>+</span> New
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {sortedThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center space-y-3">
            <span className="text-4xl text-gray-800">≡</span>
            <p className="text-gray-500 text-sm">No threads yet</p>
            <p className="text-gray-700 text-xs">Start a conversation with anyone by handle</p>
            <button
              onClick={onNewThread}
              className="w-full max-w-sm mx-auto bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-3 rounded-xl transition font-medium"
            >
              Start a thread
            </button>
          </div>
        ) : (
          <div>
            {sortedThreads.map(({ contactId, messages, lastMessage, unreadCount }) => {
              const isSelected = selectedContactId === contactId
              const isOwn = lastMessage?.senderId === identity?.handle

              return (
                <button
                  key={contactId}
                  onClick={() => onSelectThread(contactId)}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition text-left border-l-2 ${
                    isSelected
                      ? 'bg-indigo-950/50 border-indigo-500'
                      : 'hover:bg-gray-800/50 border-transparent'
                  }`}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
                    {contactId.charAt(0).toUpperCase()}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium truncate ${isSelected ? 'text-indigo-300' : 'text-gray-200'}`}>
                        @{contactId}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {lastMessage && (
                          <span className="text-gray-600 text-xs">{formatTime(lastMessage.sentAt)}</span>
                        )}
                        {unreadCount > 0 && (
                          <span className="bg-indigo-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {lastMessage && (
                      <p className="text-gray-500 text-xs truncate mt-0.5">
                        {isOwn ? 'You: ' : ''}{lastMessage.content}
                      </p>
                    )}
                    <p className="text-gray-700 text-xs mt-0.5">{messages.length} message{messages.length !== 1 ? 's' : ''}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
