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

import { useState, useEffect } from 'react'
import { useDocumentReady, useIdentity, useProfileComplete, usePreferences } from './hooks/useYjs'
import { ProfileSetup } from './components/Profile/ProfileSetup'
import { ProfileView } from './components/Profile/ProfileView'
import { PingsView } from './components/PingFeed/PingsView'
import { ChannelList } from './components/Channels/ChannelList'
import { ThreadsView } from './components/Threads/ThreadsView'
import OfflineBanner from './components/shared/OfflineBanner'
import { connect as relayConnect, on } from './lib/relay'
import OnlineStatus from './components/shared/OnlineStatus'
import ConnectionRequest from './components/Connection/ConnectionRequest'
import ConnectionToast from './components/shared/ConnectionToast'
import ContactsView from './components/Contacts/ContactsView'

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


const NAV_ITEMS: Array<{ id: View; label: string; icon: string; phase: number }> = [
  { id: 'pings',    label: 'Pings',    icon: '◎', phase: 2 },
  { id: 'channels', label: 'Channels', icon: '#',  phase: 2 },
  { id: 'threads',  label: 'Threads',  icon: '≡',  phase: 3 },
  { id: 'contacts', label: 'Contacts', icon: '⊕',  phase: 4 },
  { id: 'profile',  label: 'Profile',  icon: '○',  phase: 1 },
]

export function App() {
  const { ready } = useDocumentReady()
  const identity = useIdentity()
  const profileComplete = useProfileComplete()
  const [view, setView] = useState<View>('pings')
  const [onboarded, setOnboarded] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [showConnect, setShowConnect] = useState(false)
  const [incomingRequests, setIncomingRequests] = useState<Array<{requestId: string, fromHandle: string}>>([])
  const [connectionToast, setConnectionToast] = useState<string | null>(null)
  const prefs = usePreferences()
  const [pendingThreadHandle, setPendingThreadHandle] = useState<string | null>(null)

  // Connect to relay once profile is ready
  useEffect(() => {
    if (ready && profileComplete) {
      relayConnect()
    }
  }, [ready, profileComplete])

  // Always-on incoming connection request listener
  useEffect(() => {
    const unsubRequest = on('connection_request', (data: {requestId: string, fromHandle: string}) => {
      const guardianHandle = (prefs as {guardianHandle?: string} | null)?.guardianHandle
      if (guardianHandle) {
        // Guardian mode — forward request to guardian, don't open modal
        console.log(`[app] guardian mode: connection request from ${data.fromHandle} forwarded to guardian @${guardianHandle}`)
        // Phase 5: relay forwarding stubbed — full GUARDIAN_REQUEST protocol is post-MVP
        return
      }
      setIncomingRequests(prev => {
        if (prev.some(r => r.requestId === data.requestId)) return prev
        setShowConnect(true)
        return [...prev, data]
      })
    })
    // Always-on connection accepted listener — show toast on initiator side
    const unsubAccepted = on('connection_accepted', (data: {byHandle: string}) => {
      if (data.byHandle) {
        setShowConnect(false)
        setTimeout(() => setConnectionToast(prev => prev ?? data.byHandle.replace(/^@/, '')), 400)
      }
    })
    return () => { unsubRequest(); unsubAccepted() }
  }, [])

  // Wait for IndexedDB to hydrate
  if (!ready) return <LoadingScreen />

  // Show onboarding if no profile exists and not mid-onboarding
  if (!profileComplete && !onboarded) {
    return <ProfileSetup onComplete={() => setOnboarded(true)} />
  }

  return (
    <div className="h-screen bg-gray-950 flex flex-col overflow-hidden">
      <OfflineBanner />

      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-lg">◎</span>
          <span className="text-white font-semibold text-sm tracking-tight">Local-First Social</span>
        </div>
        {identity && (
          <div className="flex items-center gap-3">
            <OnlineStatus showLabel={false} />
            <button
              onClick={() => setShowConnect(v => !v)}
              className="text-xs text-indigo-400 border border-indigo-800 rounded-lg px-2 py-1 hover:bg-indigo-950 transition"
            >⊕ Connect</button>
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

      {/* Connect modal */}
      {showConnect && (
        <div className="absolute top-14 right-4 z-50 w-80">
          <ConnectionRequest onConnected={(handle) => { setShowConnect(false); setTimeout(() => setConnectionToast(prev => prev ?? handle), 400) }} incomingRequests={incomingRequests} onDismissRequest={(id: string) => setIncomingRequests(prev => prev.filter(r => r.requestId !== id))} />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {view === 'pings'    && <PingsView />}
        {view === 'channels' && (
          <div className="h-full">
            <ChannelList
              selectedChannelId={selectedChannel}
              onSelectChannel={id => { setSelectedChannel(id); setView('pings') }}
            />
          </div>
        )}
        {view === 'threads'  && <ThreadsView initialThreadHandle={pendingThreadHandle || undefined} onThreadOpened={() => setPendingThreadHandle(null)} />}
        {view === 'contacts' && <ContactsView onOpenThread={(id) => { setPendingThreadHandle(id); setView('threads') }} />}
        {view === 'profile'  && <ProfileView />}
      </main>

      {/* Connection toast */}
      {connectionToast && (
        <ConnectionToast
          handle={connectionToast}
          onStartThread={(handle) => {
            setConnectionToast(null)
            setPendingThreadHandle(handle)
            setView('threads')
          }}
          onDismiss={() => setConnectionToast(null)}
        />
      )}

      {/* Bottom nav */}
      <nav className="border-t border-gray-800 flex shrink-0">
        {NAV_ITEMS.map(({ id, label, icon, phase }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition ${
              view === id
                ? 'text-indigo-400'
                : phase <= 4
                  ? 'text-gray-500 hover:text-gray-300'
                  : 'text-gray-700 cursor-not-allowed'
            }`}
            disabled={phase > 4}
            title={phase > 3 ? `Phase ${phase}` : label}
          >
            <span className="text-base leading-none">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
