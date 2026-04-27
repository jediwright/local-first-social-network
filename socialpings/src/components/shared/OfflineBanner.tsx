/**
 * OfflineBanner.tsx — Network offline indicator
 *
 * Note: In Phase 4, this will distinguish between:
 *   - Network offline (navigator.onLine === false)
 *   - Relay disconnected (connected to internet but relay WebSocket is down)
 *
 * For Phase 1, we only track navigator.onLine.
 * All features work offline — this is purely informational.
 */

import { useState, useEffect } from 'react'

export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (online) return null

  return (
    <div className="bg-amber-900/80 border-b border-amber-700 text-amber-200 text-xs text-center py-2 px-4">
      ◉ Offline — pings and threads continue working locally
    </div>
  )
}
