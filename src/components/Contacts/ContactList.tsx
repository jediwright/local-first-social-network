import { useTrustGraph, useIdentity } from '../../hooks/useYjs'
import { canonicalThreadId, threadsMap } from '../../store/ydoc'
import type { TrustTier } from '../../store/ydoc'

interface Props {
  onSelectContact: (contactId: string) => void
}

function tierBadge(tier: TrustTier) {
  const styles: Record<string, string> = {
    close:        'bg-green-900 text-green-300',
    contact:      'bg-blue-900 text-blue-300',
    discoverable: 'bg-gray-800 text-gray-400',
    guardian:     'bg-purple-900 text-purple-300',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[tier] ?? styles.contact}`}>
      {tier}
    </span>
  )
}

function lastThreadActivity(myHandle: string, contactId: string): string | null {
  const key = canonicalThreadId(myHandle, contactId)
  const thread = threadsMap.get(key)
  if (!thread || thread.length === 0) return null
  const last = thread.get(thread.length - 1) as { sentAt?: string }
  return last?.sentAt ?? null
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function ContactList({ onSelectContact }: Props) {
  const contacts = useTrustGraph()
  const identity = useIdentity()
  const myHandle = identity?.handle ?? ''

  if (contacts.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
        <span className="text-2xl">⊕</span>
        <p className="text-sm">No contacts yet</p>
        <p className="text-xs text-gray-600">Make a connection to get started</p>
      </div>
    )
  }

  const sorted = Array.from(contacts.entries()).sort((a, b) => {
    if (a[1].tier === 'close' && b[1].tier !== 'close') return -1
    if (b[1].tier === 'close' && a[1].tier !== 'close') return 1
    return new Date(b[1].connectedAt).getTime() - new Date(a[1].connectedAt).getTime()
  })

  return (
    <div className="flex flex-col divide-y divide-gray-800">
      {sorted.map(([contactId, entry]) => {
        const lastActivity = myHandle ? lastThreadActivity(myHandle, contactId) : null
        return (
          <button
            key={contactId}
            onClick={() => onSelectContact(contactId)}
            className="flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-900 transition-colors w-full"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-100 truncate">@{contactId}</span>
                {tierBadge(entry.tier)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {lastActivity
                  ? `Last activity ${formatRelative(lastActivity)}`
                  : `Connected ${formatRelative(entry.connectedAt)}`}
              </div>
            </div>
            <span className="text-gray-600 text-sm">›</span>
          </button>
        )
      })}
    </div>
  )
}
