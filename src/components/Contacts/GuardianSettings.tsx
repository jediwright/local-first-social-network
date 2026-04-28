import { useState } from 'react'
import { usePreferences } from '../../hooks/useYjs'
import { profileMap } from '../../store/ydoc'

export default function GuardianSettings() {
  const prefs = usePreferences()
  const guardianHandle = prefs?.guardianHandle ?? null
  const [input, setInput] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  function saveGuardian() {
    const handle = input.trim().replace(/^@/, '')
    if (!handle) return
    const existing = (profileMap.get('preferences') as Record<string, unknown>) ?? {}
    profileMap.set('preferences', { ...existing, guardianHandle: handle })
    setInput('')
    setConfirming(false)
  }

  function removeGuardian() {
    const existing = (profileMap.get('preferences') as Record<string, unknown>) ?? {}
    const updated = { ...existing }
    delete updated.guardianHandle
    profileMap.set('preferences', updated)
    setRemoving(false)
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">Guardian mode</h3>
        {guardianHandle && (
          <span className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full">Active</span>
        )}
      </div>
      {guardianHandle ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Your account is supervised by <span className="text-purple-300">@{guardianHandle}</span>.
            Channel discovery and connection requests require guardian approval.
          </p>
          {removing ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-300">Remove guardian @{guardianHandle}?</p>
              <div className="flex gap-2">
                <button onClick={removeGuardian} className="flex-1 py-1.5 rounded bg-red-900 hover:bg-red-800 text-red-200 text-xs">Remove</button>
                <button onClick={() => setRemoving(false)} className="flex-1 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setRemoving(true)} className="text-xs text-gray-500 hover:text-gray-300 underline">
              Remove guardian
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Set a guardian to supervise channel discovery and connection requests.
          </p>
          {confirming ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-300">Set @{input.replace(/^@/, '')} as your guardian?</p>
              <div className="flex gap-2">
                <button onClick={saveGuardian} className="flex-1 py-1.5 rounded bg-purple-900 hover:bg-purple-800 text-purple-200 text-xs">Confirm</button>
                <button onClick={() => setConfirming(false)} className="flex-1 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="@handle"
                className="flex-1 bg-gray-800 text-gray-200 text-xs px-3 py-1.5 rounded border border-gray-700 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={() => input.trim() && setConfirming(true)}
                disabled={!input.trim()}
                className="px-3 py-1.5 rounded bg-purple-900 hover:bg-purple-800 disabled:opacity-40 text-purple-200 text-xs"
              >
                Set
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
