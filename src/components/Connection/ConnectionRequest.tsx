/**
 * ConnectionRequest.tsx
 * local-first-social-network
 *
 * Handles both incoming and outgoing connection request UI.
 * Trust tier is assigned on accept: 'close' (full sync) or 'contact' (limited).
 */

import { useState } from 'react';
import {
  acceptConnectionRequest,
  rejectConnectionRequest,
  sendConnectionRequest,
  getConnectionState,
} from '../../lib/relay';
import { profileMap } from '../../store/ydoc';

// ─── Types ────────────────────────────────────────────────────────────────────

type TrustTier = 'close' | 'contact';

interface IncomingRequest {
  requestId: string;
  fromHandle: string;
}

interface OutboundState {
  status: 'idle' | 'sending' | 'routed' | 'accepted' | 'rejected' | 'failed';
  toHandle: string;
  errorMessage?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setTrustTier(handle: string, tier: TrustTier) {
  const trustGraph = profileMap.get('trust_graph') as Map<string, unknown> | undefined;
  if (!trustGraph) return;
  trustGraph.set(handle.toLowerCase().trim(), {
    tier,
    connectedAt: new Date().toISOString(),
    syncStatus: 'synced',
  });
}

// ─── Incoming request panel ───────────────────────────────────────────────────

function IncomingRequestCard({
  request,
  onDismiss,
  onConnected,
}: {
  request: IncomingRequest;
  onDismiss: (requestId: string) => void;
  onConnected?: (handle: string) => void;
}) {
  const [selectedTier, setSelectedTier] = useState<TrustTier>('contact');
  const [status, setStatus] = useState<'pending' | 'accepting' | 'rejecting' | 'done'>('pending');

  function handleAccept() {
    setStatus('accepting');
    setTrustTier(request.fromHandle, selectedTier);
    acceptConnectionRequest(request.requestId, request.fromHandle);
    setTimeout(() => {
      onDismiss(request.requestId);
      onConnected?.(request.fromHandle);
    }, 600);
  }

  function handleReject() {
    setStatus('rejecting');
    rejectConnectionRequest(request.requestId, request.fromHandle);
    setTimeout(() => onDismiss(request.requestId), 600);
  }

  if (status === 'accepting') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-700 font-medium">
          Connected with {request.fromHandle}
        </p>
      </div>
    );
  }

  if (status === 'rejecting') {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm text-neutral-500">Request declined.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          {request.fromHandle} wants to connect
        </p>
        <p className="text-xs text-neutral-500 mt-0.5">
          Choose how much access to give them.
        </p>
      </div>

      {/* Trust tier selector */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide">
          Trust tier
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSelectedTier('close')}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
              selectedTier === 'close'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
            }`}
          >
            <span className="block text-sm font-medium">Close</span>
            <span className="block text-xs opacity-70">All pings + full thread history</span>
          </button>
          <button
            onClick={() => setSelectedTier('contact')}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
              selectedTier === 'contact'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
            }`}
          >
            <span className="block text-sm font-medium">Contact</span>
            <span className="block text-xs opacity-70">Limited pings, threads on request</span>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleAccept}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          Accept
        </button>
        <button
          onClick={handleReject}
          className="flex-1 rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

// ─── Outbound request panel ───────────────────────────────────────────────────

function OutboundRequestPanel({
  onSuccess,
}: {
  onSuccess?: (handle: string) => void;
}) {
  const [handleInput, setHandleInput] = useState('');
  const [outbound, setOutbound] = useState<OutboundState>({ status: 'idle', toHandle: '' });
  const relayState = getConnectionState();
  const relayOnline = relayState !== 'idle' && relayState !== 'connecting';

  async function handleSend() {
    const normalized = handleInput.trim().startsWith('@')
      ? handleInput.trim().toLowerCase()
      : `@${handleInput.trim().toLowerCase()}`;

    if (!normalized || normalized === '@') return;

    setOutbound({ status: 'sending', toHandle: normalized });

    try {
      const result = await sendConnectionRequest(normalized);
      if (result.accepted) {
        setOutbound({ status: 'accepted', toHandle: normalized });
        onSuccess?.(normalized);
      } else {
        setOutbound({ status: 'rejected', toHandle: normalized });
      }
    } catch (err: any) {
      setOutbound({ status: 'failed', toHandle: normalized, errorMessage: err.message });
    }
  }

  function reset() {
    setHandleInput('');
    setOutbound({ status: 'idle', toHandle: '' });
  }

  if (outbound.status === 'accepted') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">
          Connected with {outbound.toHandle}
        </p>
        <button onClick={reset} className="text-xs text-green-600 mt-1 underline">
          Connect another
        </button>
      </div>
    );
  }

  if (outbound.status === 'rejected') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          {outbound.toHandle} declined your request.
        </p>
        <button onClick={reset} className="text-xs text-amber-700 mt-1 underline">
          Try another handle
        </button>
      </div>
    );
  }

  if (outbound.status === 'failed') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">
          {outbound.errorMessage || 'Could not send request.'}
        </p>
        <button onClick={reset} className="text-xs text-red-700 mt-1 underline">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-neutral-900">Connect with someone</p>

      {!relayOnline && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
          Relay offline — connection requests require relay access.
        </p>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">@</span>
          <input
            type="text"
            value={handleInput.startsWith('@') ? handleInput.slice(1) : handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="handle"
            disabled={!relayOnline || outbound.status === 'sending'}
            className="w-full rounded-xl border border-neutral-200 pl-7 pr-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-400 disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!relayOnline || !handleInput.trim() || outbound.status === 'sending'}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {outbound.status === 'sending' ? (
            <span className="flex items-center gap-1.5">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Sending
            </span>
          ) : (
            'Send'
          )}
        </button>
      </div>

      {outbound.status === 'routed' && (
        <p className="text-xs text-neutral-500">
          Request sent to {outbound.toHandle}. Waiting for response…
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ConnectionRequest({
  onConnected,
  incomingRequests = [],
  onDismissRequest,
}: {
  onConnected?: (handle: string) => void;
  incomingRequests?: IncomingRequest[];
  onDismissRequest?: (requestId: string) => void;
}) {
  function dismissIncoming(requestId: string) {
    onDismissRequest?.(requestId);
  }

  return (
    <div className="space-y-3">
      {/* Incoming requests — shown at top */}
      {incomingRequests.map((req) => (
        <IncomingRequestCard key={req.requestId} request={req} onDismiss={dismissIncoming} onConnected={onConnected} />
      ))}

      {/* Outbound request panel */}
      <OutboundRequestPanel onSuccess={onConnected} />
    </div>
  );
}
