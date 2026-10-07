import { useCallback, useEffect, useRef, useState } from 'react';

import { request } from './api';
import { desktopBridge } from './desktop-shell';

/** Whether this owner can save recordings to Google Drive right now. */
export type DriveRecordingState =
  | 'checking'
  | 'ready'
  | 'not_connected'
  /** Google stopped accepting the connection; the owner must reconnect. */
  | 'expired'
  /** Drive isn't configured on this Beacon server, so recording is off. */
  | 'unavailable';

export interface DriveRecording {
  state: DriveRecordingState;
  /** A connect flow is open (popup, browser tab, or system browser). */
  connecting: boolean;
  /** Why the last connect attempt failed, if it did. */
  connectError: string;
  /** Starts connecting Drive without leaving the current page, so a live
   * view or a clip waiting to upload survives. */
  connect: () => void;
  /** A request found Drive unusable; update without waiting for a poll. */
  report: (code: string | undefined) => void;
  refresh: () => void;
}

/** For screens rendered without a tracker (tests, guest views): recording
 * is assumed possible and the server's own check still applies. */
export const DRIVE_READY: DriveRecording = {
  connect: () => undefined,
  connectError: '',
  connecting: false,
  refresh: () => undefined,
  report: () => undefined,
  state: 'ready',
};

/** Server error codes that mean "fix Google Drive", not "try again". */
export function isDriveProblem(code: string | undefined): boolean {
  return code === 'drive_reconnect_required' || code === 'drive_not_connected';
}

export const DRIVE_CONNECT_URL = '/api/drive/connect?purpose=recordings';
/** Message the connect popup posts to the page that opened it. */
export const DRIVE_CONNECT_MESSAGE = 'beacon:drive-connect';
const POLL_MS = 3_000;
const CONNECT_TIMEOUT_MS = 10 * 60_000;
/** Focus checks are cheap (the server re-checks Google at most hourly), but
 * there's no need to repeat one within this window. */
const FOCUS_RECHECK_MS = 30_000;

interface DriveStatus {
  configured: boolean;
  expired?: boolean;
  recordingsConnected: boolean;
}

export function driveRecordingState(status: DriveStatus): DriveRecordingState {
  if (!status.configured) return 'unavailable';
  if (status.recordingsConnected) return 'ready';
  return status.expired ? 'expired' : 'not_connected';
}

/** iOS/Android home-screen apps keep their own cookies; a popup would open
 * in a browser that isn't signed in, so they connect in the same window. */
function installedWebApp(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function useDriveRecording(enabled: boolean): DriveRecording {
  const [state, setState] = useState<DriveRecordingState>('checking');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const checkedAt = useRef(0);
  const poll = useRef<number | null>(null);
  const deadline = useRef(0);
  const popup = useRef<Window | null>(null);

  const stopWaiting = useCallback(() => {
    if (poll.current !== null) window.clearInterval(poll.current);
    poll.current = null;
    setConnecting(false);
  }, []);

  const refresh = useCallback(async (): Promise<DriveRecordingState | null> => {
    try {
      const next = driveRecordingState(
        await request<DriveStatus>('/api/drive/status'),
      );
      checkedAt.current = Date.now();
      setState(next);
      if (next === 'ready') {
        stopWaiting();
        setConnectError('');
      }
      return next;
    } catch {
      // Unknown is treated as ready: the server still checks Drive before a
      // recording starts, so a blip here never blocks recording.
      setState((current) => (current === 'checking' ? 'ready' : current));
      return null;
    }
  }, [stopWaiting]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    function recheck() {
      if (document.visibilityState !== 'visible') return;
      if (
        poll.current === null &&
        Date.now() - checkedAt.current < FOCUS_RECHECK_MS
      )
        return;
      void refresh();
    }
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [enabled, refresh]);

  // The connect popup reports how Google's consent ended.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { result?: unknown; type?: unknown } | null;
      if (data?.type !== DRIVE_CONNECT_MESSAGE) return;
      if (data.result === 'connected') {
        void refresh();
        return;
      }
      stopWaiting();
      setConnectError(
        data.result === 'denied'
          ? 'Google Drive permission wasn’t granted. Try again when ready.'
          : 'Google Drive couldn’t be connected. Try again.',
      );
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refresh, stopWaiting]);

  useEffect(() => stopWaiting, [stopWaiting]);

  const connect = useCallback(() => {
    setConnectError('');
    if (!desktopBridge() && installedWebApp()) {
      window.location.assign(DRIVE_CONNECT_URL);
      return;
    }
    // The desktop app turns this into "Continue in your browser"; a browser
    // opens Google's consent in a small window over this page.
    const opened = window.open(
      DRIVE_CONNECT_URL,
      'beacon-drive-connect',
      'popup,width=520,height=720',
    );
    if (!opened && !desktopBridge()) {
      setConnectError(
        'Your browser blocked the Google Drive window. Allow pop-ups for Beacon, then try again.',
      );
      return;
    }
    popup.current = opened;
    setConnecting(true);
    deadline.current = Date.now() + CONNECT_TIMEOUT_MS;
    if (poll.current !== null) window.clearInterval(poll.current);
    poll.current = window.setInterval(() => {
      if (Date.now() > deadline.current) {
        stopWaiting();
        return;
      }
      void refresh();
    }, POLL_MS);
  }, [refresh, stopWaiting]);

  const report = useCallback((code: string | undefined) => {
    if (code === 'drive_reconnect_required') setState('expired');
    else if (code === 'drive_not_connected') setState('not_connected');
  }, []);

  const refreshNow = useCallback(() => void refresh(), [refresh]);

  return {
    connect,
    connectError,
    connecting,
    refresh: refreshNow,
    report,
    state: enabled ? state : 'unavailable',
  };
}

/** In the connect popup: tell the opener how consent ended and close.
 * Returns true when this window is that popup. */
export function finishDriveConnectPopup(): boolean {
  const result = new URLSearchParams(window.location.search).get('drive');
  if (!result || !window.opener) return false;
  try {
    (window.opener as Window).postMessage(
      { result, type: DRIVE_CONNECT_MESSAGE },
      window.location.origin,
    );
  } catch {
    return false;
  }
  window.close();
  return true;
}
