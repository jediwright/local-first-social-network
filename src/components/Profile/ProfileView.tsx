/**
 * ProfileView.tsx — Profile display (post-onboarding)
 *
 * Shows identity, trust graph summary, preferences.
 * Data export trigger (Phase 6 — skeleton only in Phase 1).
 */

import { useIdentity, usePreferences, useTrustGraph, usePingHistory, useChannelMemberships } from '../../hooks/useYjs'
import { exportLocalState } from '../../store/ydoc'

export function ProfileView() {
  const identity = useIdentity()
  const prefs = usePreferences()
  const contacts = useTrustGraph()
  const pingHistory = usePingHistory()
  const memberships = useChannelMemberships()

  if (!identity) return null

  const handleExport = () => {
    const data = exportLocalState()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `socialpings-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const closeCount = Array.from(contacts.values()).filter(c => c.tier === 'close').length
  const contactCount = Array.from(contacts.values()).filter(c => c.tier === 'contact').length

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      {/* Identity card */}
      <div className="bg-gray-900 rounded-xl p-6 flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
          style={{ backgroundColor: identity.avatarColor }}
        >
          {identity.displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 className="text-white text-xl font-semibold">{identity.displayName}</h2>
          <p className="text-gray-400">@{identity.handle}</p>
          <p className="text-gray-600 text-xs mt-1">
            Member since {new Date(identity.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Close', value: closeCount, color: 'text-emerald-400' },
          { label: 'Contacts', value: contactCount, color: 'text-indigo-400' },
          { label: 'Pings sent', value: pingHistory.length, color: 'text-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-500 text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Channels */}
      {memberships.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4">
          <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
            Channels ({memberships.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {memberships.map(m => (
              <span key={m.channelId} className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">
                #{m.channelId}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Preferences summary */}
      {prefs && (
        <div className="bg-gray-900 rounded-xl p-4 space-y-2">
          <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">Preferences</h3>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Default ping</span>
            <span className="text-gray-200">{prefs.defaultPingType}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Discoverable</span>
            <span className={prefs.discoverable ? 'text-emerald-400' : 'text-gray-600'}>
              {prefs.discoverable ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Notifications</span>
            <span className={prefs.notificationsEnabled ? 'text-emerald-400' : 'text-gray-600'}>
              {prefs.notificationsEnabled ? 'On' : 'Off'}
            </span>
          </div>
        </div>
      )}

      {/* Handle status */}
      <div className="bg-gray-900 rounded-xl p-4">
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-400">Relay registration</span>
          <span className="text-gray-600 text-xs">
            {identity.handleRegisteredAt
              ? `Registered ${new Date(identity.handleRegisteredAt).toLocaleDateString()}`
              : 'Phase 4 — not yet connected'}
          </span>
        </div>
      </div>

      {/* Export */}
      <button
        onClick={handleExport}
        className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl py-3 text-sm font-medium transition flex items-center justify-center gap-2"
      >
        <span>↓</span>
        Export local data (JSON)
      </button>

      <p className="text-center text-gray-700 text-xs">
        All data stored locally. This device owns it.
      </p>
    </div>
  )
}
