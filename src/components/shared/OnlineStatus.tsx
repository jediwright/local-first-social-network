/**
 * OnlineStatus.tsx — Connection status indicator
 *
 * Phase 1: shows IndexedDB persistence status.
 * Phase 4: will show relay WebSocket connection state separately.
 */

import { usePersistenceReady } from '../../hooks/useYjs'

interface OnlineStatusProps {
  compact?: boolean
}

export function OnlineStatus({ compact = false }: OnlineStatusProps) {
  const ready = usePersistenceReady()

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={ready ? 'Data synced to local storage' : 'Loading local storage…'}>
        <div className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        <span className="text-gray-500 text-xs">{ready ? 'local' : 'loading…'}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-2 h-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
      <span className="text-gray-400">
        {ready ? 'Saved locally' : 'Loading…'}
      </span>
    </div>
  )
}
