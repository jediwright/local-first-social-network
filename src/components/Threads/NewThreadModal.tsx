/**
 * NewThreadModal.tsx — Start a thread with any @handle
 *
 * Phase 3: local only. In Phase 4, this triggers a connection
 * request via relay. For now, any handle can be used as a
 * thread target — useful for writing messages to self or
 * staging conversations for Phase 4 sync.
 */

import { useState } from 'react'
import { getOrCreateThread } from '../../store/ydoc'

interface NewThreadModalProps {
  onOpen: (contactId: string) => void
  onClose: () => void
}

function sanitizeHandle(raw: string): string {
  return raw.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '').slice(0, 30)
}

export function NewThreadModal({ onOpen, onClose }: NewThreadModalProps) {
  const [handle, setHandle] = useState(initialHandle)
  const [error, setError] = useState('')

  const handleStart = () => {
    const clean = sanitizeHandle(handle)
    if (!clean) { setError('Handle is required'); return }
    if (clean.length < 2) { setError('At least 2 characters'); return }

    // Initialize the thread Y.Array (creates it if not exists)
    getOrCreateThread(clean)
    onOpen(clean)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <div>
          <h3 className="text-white font-semibold text-base">Start a thread</h3>
          <p className="text-gray-400 text-sm mt-1">
            Enter a handle to start a local thread.
            In Phase 4, this will send a connection request.
          </p>
        </div>

        <div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">@</span>
            <input
              type="text"
              value={handle}
              onChange={e => { setHandle(sanitizeHandle(e.target.value)); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleStart()}
              placeholder="handle"
              maxLength={30}
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-8 pr-4 py-3 text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>
          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl py-2.5 text-sm transition"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!handle}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm transition"
          >
            Start thread
          </button>
        </div>
      </div>
    </div>
  )
}
