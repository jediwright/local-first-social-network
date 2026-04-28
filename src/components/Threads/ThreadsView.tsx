/**
 * ThreadsView.tsx — Main threads view
 *
 * Layout:
 *   - No thread selected: ThreadList fills the view
 *   - Thread selected: ThreadDetail + ThreadComposer
 *   - Asset library: accessible via tab in header
 *
 * Responsive: on narrow screens, list and detail are separate views.
 * Thread history persists offline — readable after any prior online session.
 */

import { useState } from 'react'
import { ThreadList } from './ThreadList'
import { ThreadDetail } from './ThreadDetail'
import { ThreadComposer } from './ThreadComposer'
import { AssetLibrary } from './AssetLibrary'
import { NewThreadModal } from './NewThreadModal'

type ThreadTab = 'threads' | 'assets'

export function ThreadsView({ initialThreadHandle, onThreadOpened }: { initialThreadHandle?: string, onThreadOpened?: () => void } = {}) {
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [showNewThread, setShowNewThread] = useState(!!initialThreadHandle)
  const [tab, setTab] = useState<ThreadTab>('threads')

  const handleSelectThread = (contactId: string) => {
    setSelectedContact(contactId)
    setTab('threads')
  }

  const handleNewThread = (contactId: string) => {
    setSelectedContact(contactId)
    setShowNewThread(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        <button
          onClick={() => setTab('threads')}
          className={`flex-1 py-2.5 text-xs font-medium transition ${
            tab === 'threads' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Threads
        </button>
        <button
          onClick={() => setTab('assets')}
          className={`flex-1 py-2.5 text-xs font-medium transition ${
            tab === 'assets' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Assets
        </button>
      </div>

      {/* Asset library */}
      {tab === 'assets' && (
        <div className="flex-1 overflow-hidden">
          <AssetLibrary />
        </div>
      )}

      {/* Threads tab */}
      {tab === 'threads' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedContact ? (
            // Thread detail view
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <ThreadDetail
                  contactId={selectedContact}
                  onBack={() => setSelectedContact(null)}
                />
              </div>
              <ThreadComposer contactId={selectedContact} />
            </div>
          ) : (
            // Thread list view
            <div className="flex-1 overflow-hidden">
              <ThreadList
                selectedContactId={selectedContact}
                onSelectThread={handleSelectThread}
                onNewThread={() => setShowNewThread(true)}
              />
            </div>
          )}
        </div>
      )}

      {/* New thread modal */}
      {showNewThread && (
        <NewThreadModal
          onOpen={(h) => { handleNewThread(h); onThreadOpened?.() }}
          onClose={() => { setShowNewThread(false); onThreadOpened?.() }}
          initialHandle={initialThreadHandle || ''}
        />
      )}
    </div>
  )
}
