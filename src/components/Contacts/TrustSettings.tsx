import { useState } from 'react'
import { useTrustGraph } from '../../hooks/useYjs'
import { updateContactTier, removeContact, profileMap } from '../../store/ydoc'

interface Props {
  contactId: string
  onBack: () => void
  onRemoved: () => void
}

export default function TrustSettings({ contactId, onBack, onRemoved }: Props) {
  const contacts = useTrustGraph()
  const entry = contacts.get(contactId)
  const [confirming, setConfirming] = useState<'remove' | 'block' | null>(null)

  if (!entry) return null

  function handlePromote() {
    updateContactTier(contactId, 'close')
  }

  function handleDemote() {
    updateContactTier(contactId, 'contact')
  }

  function handleRemove() {
    removeContact(contactId)
    onRemoved()
  }

  function handleBlock() {
    removeContact(contactId)
    // Add to blocked_handles list
    let blocked = profileMap.get('blocked_handles') as string[] | undefined
    blocked = blocked ? [...blocked, contactId] : [contactId]
    profileMap.set('blocked_handles', blocked)
    onRemoved()
  }

  const isClose = entry.tier === 'close'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-200 text-sm">←</button>
        <div>
          <p className="text-sm font-semibold text-gray-100">Trust settings</p>
          <p className="text-xs text-gray-500">@{contactId}</p>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3">
        {/* Current tier */}
        <div className="bg-gray-900 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current tier</p>
          <p className="text-sm font-medium text-gray-100">{entry.tier}</p>
        </div>

        {/* Promote / Demote */}
        {!isClose && (
          <button
            onClick={handlePromote}
            className="w-full py-2.5 rounded-lg bg-green-900 hover:bg-green-800 text-green-200 text-sm font-medium transition-colors"
          >
            Promote to close
          </button>
        )}
        {isClose && (
          <button
            onClick={handleDemote}
            className="w-full py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
          >
            Demote to contact
          </button>
        )}

        {/* Remove */}
        {confirming === 'remove' ? (
          <div className="bg-gray-900 rounded-lg px-4 py-3 space-y-2">
            <p className="text-sm text-gray-300">Remove @{contactId} from your contacts?</p>
            <div className="flex gap-2">
              <button onClick={handleRemove} className="flex-1 py-2 rounded bg-red-900 hover:bg-red-800 text-red-200 text-sm">Remove</button>
              <button onClick={() => setConfirming(null)} className="flex-1 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming('remove')}
            className="w-full py-2.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 text-sm font-medium transition-colors"
          >
            Remove contact
          </button>
        )}

        {/* Block */}
        {confirming === 'block' ? (
          <div className="bg-gray-900 rounded-lg px-4 py-3 space-y-2">
            <p className="text-sm text-gray-300">Block @{contactId}? This removes them and prevents future requests.</p>
            <div className="flex gap-2">
              <button onClick={handleBlock} className="flex-1 py-2 rounded bg-red-900 hover:bg-red-800 text-red-200 text-sm">Block</button>
              <button onClick={() => setConfirming(null)} className="flex-1 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming('block')}
            className="w-full py-2.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-red-500 text-sm font-medium transition-colors"
          >
            Block
          </button>
        )}
      </div>
    </div>
  )
}
