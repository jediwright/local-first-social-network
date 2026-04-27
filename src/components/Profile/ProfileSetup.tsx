/**
 * ProfileSetup.tsx — Profile creation onboarding
 *
 * Three-step flow:
 *   1. Display name
 *   2. Handle (@handle — stored locally, relay-registered in Phase 4)
 *   3. Avatar color (generated palette, no photo upload for MVP)
 *
 * On completion, writes identity + default preferences to profile map.
 * Y.js + IndexedDB persistence means this survives browser restarts.
 */

import React, { useState, useCallback } from 'react'
import {
  setIdentity,
  setPreferences,
  defaultPreferences,
  generateAvatarColor,
} from '../../store/ydoc'

const AVATAR_COLORS = [
  { hex: '#6366f1', label: 'Indigo' },
  { hex: '#8b5cf6', label: 'Violet' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#10b981', label: 'Emerald' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#ef4444', label: 'Red' },
  { hex: '#14b8a6', label: 'Teal' },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#84cc16', label: 'Lime' },
]

type Step = 'name' | 'handle' | 'avatar' | 'done'

interface ProfileSetupProps {
  onComplete: () => void
}

function sanitizeHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 30)
}

export function ProfileSetup({ onComplete }: ProfileSetupProps) {
  const [step, setStep] = useState<Step>('name')
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [avatarColor, setAvatarColor] = useState(() => generateAvatarColor())
  const [nameError, setNameError] = useState('')
  const [handleError, setHandleError] = useState('')

  const handleNameNext = useCallback(() => {
    const trimmed = displayName.trim()
    if (!trimmed) { setNameError('Name is required'); return }
    if (trimmed.length < 2) { setNameError('At least 2 characters'); return }
    setNameError('')
    // Pre-fill handle suggestion from display name
    if (!handle) {
      setHandle(sanitizeHandle(trimmed.replace(/\s+/g, '_')))
    }
    setStep('handle')
  }, [displayName, handle])

  const handleHandleNext = useCallback(() => {
    const clean = sanitizeHandle(handle)
    if (!clean) { setHandleError('Handle is required'); return }
    if (clean.length < 2) { setHandleError('At least 2 characters'); return }
    setHandle(clean)
    setHandleError('')
    setStep('avatar')
  }, [handle])

  const handleComplete = useCallback(() => {
    setIdentity({
      displayName: displayName.trim(),
      handle: sanitizeHandle(handle),
      handleRegisteredAt: null, // set in Phase 4 on relay registration
      avatarColor,
      createdAt: new Date().toISOString(),
    })
    setPreferences(defaultPreferences())
    setStep('done')
    // Small delay so the "done" state renders before parent rerenders
    setTimeout(onComplete, 400)
  }, [displayName, handle, avatarColor, onComplete])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / wordmark */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-3xl">◎</span>
            <span className="text-2xl font-semibold text-white tracking-tight">SocialPings</span>
          </div>
          <p className="text-gray-400 text-sm">You own your graph. The relay exits after connection.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(['name', 'handle', 'avatar'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  step === s ? 'bg-indigo-500' :
                  (['name', 'handle', 'avatar'] as Step[]).indexOf(step) > i ? 'bg-indigo-800' :
                  'bg-gray-700'
                }`}
              />
              {i < 2 && <div className="w-6 h-px bg-gray-700" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step: Name */}
        {step === 'name' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white mb-1">What should we call you?</h1>
              <p className="text-gray-400 text-sm">This is how you'll appear to connections. You can change it later.</p>
            </div>
            <div>
              <input
                type="text"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setNameError('') }}
                onKeyDown={e => e.key === 'Enter' && handleNameNext()}
                placeholder="Your name"
                maxLength={60}
                autoFocus
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-4 py-3 text-base placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
              {nameError && <p className="text-red-400 text-sm mt-1">{nameError}</p>}
            </div>
            <button
              onClick={handleNameNext}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-3 font-medium transition"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step: Handle */}
        {step === 'handle' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white mb-1">Choose your handle</h1>
              <p className="text-gray-400 text-sm">
                Your @handle is how others will find you. Lowercase, letters, numbers, underscores only.
                {' '}<span className="text-gray-500">Uniqueness enforced by relay in Phase 4.</span>
              </p>
            </div>
            <div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base select-none">@</span>
                <input
                  type="text"
                  value={handle}
                  onChange={e => { setHandle(sanitizeHandle(e.target.value)); setHandleError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleHandleNext()}
                  placeholder="yourhandle"
                  maxLength={30}
                  autoFocus
                  className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg pl-8 pr-4 py-3 text-base placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
              {handle && (
                <p className="text-gray-500 text-xs mt-1">@{sanitizeHandle(handle)}</p>
              )}
              {handleError && <p className="text-red-400 text-sm mt-1">{handleError}</p>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep('name')}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-3 font-medium transition"
              >
                Back
              </button>
              <button
                onClick={handleHandleNext}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-3 font-medium transition"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step: Avatar color */}
        {step === 'avatar' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white mb-1">Pick a color</h1>
              <p className="text-gray-400 text-sm">No photo required. Your color is your presence signal.</p>
            </div>

            {/* Avatar preview */}
            <div className="flex justify-center">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-colors"
                style={{ backgroundColor: avatarColor }}
              >
                {displayName.trim().charAt(0).toUpperCase()}
              </div>
            </div>

            {/* Color grid */}
            <div className="grid grid-cols-5 gap-3">
              {AVATAR_COLORS.map(({ hex, label }) => (
                <button
                  key={hex}
                  title={label}
                  onClick={() => setAvatarColor(hex)}
                  className={`w-full aspect-square rounded-full transition-transform hover:scale-110 focus:outline-none ${
                    avatarColor === hex ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-950 scale-110' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('handle')}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-3 font-medium transition"
              >
                Back
              </button>
              <button
                onClick={handleComplete}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-3 font-medium transition"
              >
                Create profile
              </button>
            </div>
          </div>
        )}

        {/* Step: Done (brief confirmation before parent rerenders) */}
        {step === 'done' && (
          <div className="text-center space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto shadow-lg"
              style={{ backgroundColor: avatarColor }}
            >
              {displayName.trim().charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white text-lg font-semibold">{displayName.trim()}</p>
              <p className="text-gray-400 text-sm">@{sanitizeHandle(handle)}</p>
            </div>
            <p className="text-gray-500 text-sm">Profile saved locally. You own this data.</p>
          </div>
        )}

        {/* Local-first note */}
        {step !== 'done' && (
          <p className="text-center text-gray-600 text-xs mt-8">
            Stored locally via IndexedDB. No account required. No server owns this.
          </p>
        )}
      </div>
    </div>
  )
}
