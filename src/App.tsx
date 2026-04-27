/**
 * App.tsx — Local-First Social shell
 *
 * Routing logic:
 *   - Wait for IndexedDB persistence to load
 *   - If no identity → show ProfileSetup (onboarding)
 *   - If identity exists → show main app shell
 *
 * Phase 1: Main app shell shows ProfileView + placeholder nav for
 * Pings / Threads / Channels / Contacts (built in Phase 2+).
 */

import { useState } from 'react'
import { useDocumentReady, useIdentity, useProfileComplete } from './hooks/useYjs'
import { ProfileSetup } from './components/Profile/ProfileSetup'
import { ProfileView } from './components/Profile/ProfileView'
import { PingsView } from './components/PingFeed/PingsView'
import { ChannelList } from './components/Channels/ChannelList'
import { OfflineBanner } from './components/shared/OfflineBanner'
import { OnlineStatus } from './components/shared/OnlineStatus'

type View = 'pings' | 'threads' | 'channels' | 'contacts' | 'profile'

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="text-3xl animate-pulse">◎</div>
        <p className="text-gray-600 text-sm">Loading local data…</p>
      </div>
    </div>
  )
}

function PlaceholderView({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center space-y-2">
        <p className="text-gray-500 text-sm">{name}</p>
        <p className="text-gray-700 text-xs">Coming in Phase 2</p>
      </div>
    </div>
  )
}

const NAV_ITEMS: Array<{ id: View; label: string; icon: string; phase: number }> = [
  { id: 'pings',    label: 'Pings',    icon: '◎', phase: 2 },
  { id: 'channels', label: 'Channels', icon: '#',  phase: 2 },
  { id: 'threads',  label: 'Threads',  icon: '≡',  phase: 3 },
  { id: 'contacts', label: 'Contacts', icon: '⊕',  phase: 5 },
  { id: 'profile',  label: 'Profile',  icon: '○',  phase: 1 },
]

export function App() {
  const { ready } = useDocumentReady()
  const identity = useIdentity()
  const profileComplete = useProfileComplete()
  const [view, setView] = useState<View>('pings')
  const [onboarded, setOnboarded] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState('general')

  // Wait for IndexedDB to hydrate
  if (!ready) return <LoadingScreen />

  // Show onboarding if no profile exists and not mid-onboarding
  if (!profileComplete && !onboarded) {
    return <ProfileSetup onComplete={() => setOnboarded(true)} />
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <OfflineBanner />

      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-lg">◎</span>
          <span className="text-white font-semibold text-sm tracking-tight">Local-First Social</span>
        </div>
        {identity && (
          <div className="flex items-center gap-3">
            <OnlineStatus compact />
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-pointer"
              style={{ backgroundColor: identity.avatarColor }}
              onClick={() => setView('profile')}
              title={`@${identity.handle}`}
            >
              {identity.displayName.charAt(0).toUpperCase()}
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-h-0">
        {view === 'pings'    && <PingsView />}
        {view === 'channels' && (
          <div className="h-full">
            <ChannelList
              selectedChannelId={selectedChannel}
              onSelectChannel={id => { setSelectedChannel(id); setView('pings') }}
            />
          </div>
        )}
        {view === 'threads'  && <PlaceholderView name="Threads — Phase 3" />}
        {view === 'contacts' && <PlaceholderView name="Contacts — Phase 5" />}
        {view === 'profile'  && <ProfileView />}
      </main>

      {/* Bottom nav */}
      <nav className="border-t border-gray-800 flex">
        {NAV_ITEMS.map(({ id, label, icon, phase }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition ${
              view === id
                ? 'text-indigo-400'
                : phase <= 2
                  ? 'text-gray-500 hover:text-gray-300'
                  : 'text-gray-700 cursor-not-allowed'
            }`}
            disabled={phase > 2}
            title={phase > 2 ? `Phase ${phase}` : label}
          >
            <span className="text-base leading-none">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
