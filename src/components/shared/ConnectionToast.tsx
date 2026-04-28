/**
 * ConnectionToast.tsx
 * local-first-social-network
 *
 * Slides in after a successful connection handshake.
 * Persists until user acts. "Start a thread" navigates. × dismisses.
 */

import { useState, useEffect } from 'react'

interface ConnectionToastProps {
  handle: string
  onStartThread: (handle: string) => void
  onDismiss: () => void
}

export default function ConnectionToast({ handle, onStartThread, onDismiss }: ConnectionToastProps) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Slide in
    const t1 = setTimeout(() => setVisible(true), 50)
    return () => { clearTimeout(t1) }
  }, [])

  function dismiss() {
    setLeaving(true)
    setTimeout(onDismiss, 300)
  }

  return (
    <div
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible && !leaving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-neutral-100 px-4 py-3 flex items-center gap-3 min-w-[280px] max-w-[360px]">
        {/* Avatar placeholder */}
        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <span className="text-indigo-600 text-sm font-bold">
            {handle.replace('@', '').charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 truncate">
            {handle} is now in your circle
          </p>
          <button
            onClick={() => { onStartThread(handle); dismiss() }}
            className="text-xs text-indigo-600 font-medium hover:text-indigo-800 transition-colors mt-0.5"
          >
            Start a thread →
          </button>
        </div>

        <button
          onClick={dismiss}
          className="text-neutral-400 hover:text-neutral-600 flex-shrink-0 text-lg leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}
