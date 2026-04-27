export type RelayState = 'idle' | 'connecting' | 'registered' | 'pending_accept' | 'syncing' | 'established';

export function connect(): void;
export function disconnect(): void;
export function sendConnectionRequest(toHandle: string): Promise<{ accepted: boolean; byHandle?: string }>;
export function acceptConnectionRequest(requestId: string, fromHandle: string): void;
export function rejectConnectionRequest(requestId: string, fromHandle: string): void;
export function joinChannels(channelIds: string[]): void;
export function leaveChannels(channelIds: string[]): void;
export function on(event: string, handler: Function): () => void;
export function getConnectionState(): RelayState;
export function isRelayConnected(): boolean;
