/**
 * OnlineStatus.tsx — updated for Phase 4
 * local-first-social-network
 *
 * Three states, clearly distinguished:
 *   relay-connected   — WebSocket open, handle registered
 *   relay-disconnected — network up, relay unreachable or reconnecting
 *   offline           — navigator.onLine === false
 *
 * The distinction matters: relay-disconnected means local features
 * work fully, but new connections and channel discovery are paused.
 */

import { useState, useEffect } from 'react';
import { on, getConnectionState } from '../../lib/relay';

type RelayState = 'idle' | 'connecting' | 'registered' | 'pending_accept' | 'syncing' | 'established';

type DisplayStatus = 'relay-connected' | 'relay-disconnected' | 'offline';

function computeDisplayStatus(relayState: RelayState, networkOnline: boolean): DisplayStatus {
  if (!networkOnline) return 'offline';
  if (relayState === 'registered' || relayState === 'pending_accept' || relayState === 'syncing' || relayState === 'established') {
    return 'relay-connected';
  }
  return 'relay-disconnected';
}

const STATUS_CONFIG: Record<DisplayStatus, { dot: string; label: string; title: string }> = {
  'relay-connected': {
    dot: 'bg-green-400',
    label: 'text-green-700',
    title: 'Connected',
  },
  'relay-disconnected': {
    dot: 'bg-amber-400',
    label: 'text-amber-700',
    title: 'Relay offline',
  },
  offline: {
    dot: 'bg-neutral-400',
    label: 'text-neutral-500',
    title: 'Offline',
  },
};

interface OnlineStatusProps {
  showLabel?: boolean;
  className?: string;
}

export default function OnlineStatus({ showLabel = false, className = '' }: OnlineStatusProps) {
  const [relayState, setRelayState] = useState<RelayState>(getConnectionState());
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);

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

  const displayStatus = computeDisplayStatus(relayState, networkOnline);
  const config = STATUS_CONFIG[displayStatus];

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`h-2 w-2 rounded-full ${config.dot}`} />
      {showLabel && (
        <span className={`text-xs font-medium ${config.label}`}>{config.title}</span>
      )}
    </span>
  );
}

// ─── Hook export for programmatic access ─────────────────────────────────────

export function useOnlineStatus() {
  const [relayState, setRelayState] = useState<RelayState>(getConnectionState());
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);

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

  return {
    displayStatus: computeDisplayStatus(relayState, networkOnline),
    relayState,
    networkOnline,
    isRelayConnected: displayStatus => displayStatus === 'relay-connected',
  };
}
