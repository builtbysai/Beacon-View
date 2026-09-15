import type { ConnectionFailure } from './reconnect';
import type { TalkState } from './talk';

export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'stream unavailable'
  | 'privacy on'
  | 'switching source'
  | ConnectionFailure;

export type LiveOverlay = {
  detail: string;
  title: string;
};

export function liveOverlay(
  status: ConnectionStatus,
  videoReady: boolean,
  switching: boolean,
  retryAttempt: number,
): LiveOverlay | null {
  if (status === 'connected' && videoReady && !switching) return null;
  if (switching) {
    return {
      title: 'Switching camera',
      detail: 'The device is switching cameras.',
    };
  }
  if (status === 'connected') {
    return {
      title: 'Starting secure video',
      detail: 'The secure connection is ready. Waiting for the first frame.',
    };
  }
  if (status === 'privacy on') {
    return {
      title: 'Privacy is on',
      detail:
        'Live viewing is blocked. Turn privacy off when you are ready to resume.',
    };
  }
  if (status === 'connecting') {
    return {
      title: 'Connecting to camera',
      detail: 'Waiting for the secure live stream.',
    };
  }
  if (status === 'reconnecting') {
    return {
      title: 'Connection interrupted',
      detail: `Beacon is retrying${retryAttempt ? ` · attempt ${retryAttempt}` : ''}.`,
    };
  }
  if (status === 'switching source') {
    return {
      title: 'Switching camera',
      detail: 'The device is releasing the previous camera.',
    };
  }
  return { title: status, detail: 'This stream needs your attention.' };
}

export function talkStatusText(state: Exclude<TalkState, 'idle'>): string {
  const messages: Record<Exclude<TalkState, 'idle'>, string> = {
    permission: 'Allow microphone access to talk.',
    connecting: 'Connecting talk…',
    speaking: 'Speaking · microphone on',
    busy: 'Another viewer is talking.',
    recovering: 'Microphone off · reconnecting',
    unavailable: 'Talk unavailable.',
  };
  return messages[state];
}
