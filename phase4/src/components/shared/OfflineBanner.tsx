/**
 * OfflineBanner.tsx — updated for Phase 4
 * local-first-social-network
 *
 * Banner that surfaces relay and network status to the user.
 * Relay-disconnected is distinct from offline:
 *   - offline: all network features paused; local features continue
 *   - relay-disconnected: network up, relay unreachable; new connections paused,
 *     local features (pings, threads, asset library) fully operational
 *
 * The banner is invisible when relay is connected.
 * Rendered at app root so it's always visible regardless of view.
 */

import { useState, useEffect } from 'react';
import { on, getConnectionState } from '../../lib/relay';

type RelayState = 'idle' | 'connecting' | 'registered' | 'pending_accept' | 'syncing' | 'established';

type BannerVariant = 'relay-disconnected' | 'offline' | 'connecting' | 'hidden';

function computeVariant(relayState: RelayState, networkOnline: boolean): BannerVariant {
  if (!networkOnline) return 'offline';
  if (relayState === 'registered' || relayState === 'pending_accept' || relayState === 'syncing' || relayState === 'established') {
    return 'hidden';
  }
  if (relayState === 'connecting') return 'connecting';
  return 'relay-disconnected';
}

const BANNER_CONTENT: Record<Exclude<BannerVariant, 'hidden'>, { bg: string; text: string; icon: string; message: string; sub?: string }> = {
  connecting: {
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800',
    icon: '↻',
    message: 'Connecting to relay…',
    sub: 'Local features are fully available.',
  },
  'relay-disconnected': {
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    icon: '○',
    message: 'Relay unavailable — reconnecting',
    sub: 'Pings, threads, and your asset library work offline. New connections paused.',
  },
  offline: {
    bg: 'bg-neutral-100 border-neutral-300',
    text: 'text-neutral-700',
    icon: '◌',
    message: 'You\'re offline',
    sub: 'Your local data is fully available. Changes sync when you reconnect.',
  },
};

interface OfflineBannerProps {
  className?: string;
}

export default function OfflineBanner({ className = '' }: OfflineBannerProps) {
  const [relayState, setRelayState] = useState<RelayState>(getConnectionState());
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when state changes — don't suppress a new banner type
  const variant = computeVariant(relayState, networkOnline);

  useEffect(() => {
    setDismissed(false);
  }, [variant]);

  useEffect(() => {
    const unsubRelay = on('state_change', ({ state }: { state: RelayState }) => {
      setRelayState(state);
    });

    function handleOnline() { setNetworkOnline(true); }
    function handleOffline() { setNetworkOnline(false); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubRelay();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (variant === 'hidden' || dismissed) return null;

  // Don't show "connecting" banner on first load for more than a brief moment
  // to avoid a flash. Gate it with a delay.
  if (variant === 'connecting') {
    return <ConnectingBannerDelayed />;
  }

  const config = BANNER_CONTENT[variant];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-4 py-2 flex items-start justify-between gap-3 ${config.bg} ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span className={`text-base leading-none mt-0.5 flex-shrink-0 ${config.text}`} aria-hidden>
          {config.icon}
        </span>
        <div className="min-w-0">
          <span className={`text-sm font-medium ${config.text}`}>{config.message}</span>
          {config.sub && (
            <span className={`text-xs block mt-0.5 opacity-80 ${config.text}`}>{config.sub}</span>
          )}
        </div>
      </div>

      {/* Dismiss button — not shown for 'connecting' since it auto-hides */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className={`text-xs flex-shrink-0 opacity-60 hover:opacity-100 mt-0.5 ${config.text}`}
      >
        ✕
      </button>
    </div>
  );
}

// Delayed connecting banner — avoids flashing on fast connections
function ConnectingBannerDelayed() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  const config = BANNER_CONTENT['connecting'];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-4 py-2 flex items-center gap-2.5 ${config.bg}`}
    >
      <svg className={`animate-spin h-3.5 w-3.5 flex-shrink-0 ${config.text}`} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <span className={`text-sm font-medium ${config.text}`}>{config.message}</span>
      {config.sub && (
        <span className={`text-xs opacity-75 ${config.text}`}>{config.sub}</span>
      )}
    </div>
  );
}
