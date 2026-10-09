import { useCallback, useEffect, useRef, useState } from 'react';

import { request } from './api';
import { isDesktopShell } from './desktop-shell';

/**
 * Cast to TV (ADR 0097). The viewer picks a Chromecast with Google's sender
 * framework. Once a session starts it creates a short-lived, view-only guest
 * link for the one camera and sends its path to Beacon's receiver page on the
 * TV, which opens it. Stopping revokes the link.
 */
export const CAST_NAMESPACE = 'urn:x-cast:com.beaconsecureview.cast';
const SENDER_SDK =
  'https://www.gstatic.com/cast/sdk/libs/sender/1.0/cast_framework.js?loadCastFramework=1';
/** The TV link lives this long; after that the TV stops showing the camera. */
export const CAST_LINK_HOURS = 4;

/** The path the receiver opens: a guest link in cast mode. */
export function castWatchPath(token: string): string {
  return `/g/${encodeURIComponent(token)}?cast=1`;
}

/** Cast senders run in Chrome-based browsers, never in the desktop app. */
export function castBrowserSupported(): boolean {
  if (typeof navigator === 'undefined' || isDesktopShell()) return false;
  return /\b(Chrome|CriOS|Edg)\//u.test(navigator.userAgent);
}

interface CastSession {
  endSession(stopCasting: boolean): void;
  sendMessage(namespace: string, message: unknown): Promise<unknown>;
}

interface CastContextLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  getCurrentSession(): CastSession | null;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  requestSession(): Promise<string | undefined>;
  setOptions(options: Record<string, unknown>): void;
}

interface CastGlobals {
  cast?: {
    framework: {
      CastContext: { getInstance(): CastContextLike };
      CastContextEventType: { SESSION_STATE_CHANGED: string };
      SessionState: { SESSION_ENDED: string };
    };
  };
  chrome?: { cast?: { AutoJoinPolicy: { ORIGIN_SCOPED: string } } };
  __onGCastApiAvailable?: (available: boolean) => void;
}

let loading: Promise<boolean> | null = null;

/** Loads Google's sender framework once. Resolves false when it can't run. */
export function loadCastFramework(): Promise<boolean> {
  if (loading) return loading;
  const globals = window as unknown as CastGlobals;
  loading = new Promise<boolean>((resolve) => {
    globals.__onGCastApiAvailable = (available) => resolve(available);
    const script = document.createElement('script');
    script.src = SENDER_SDK;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  return loading;
}

/** Whether Beacon has a Cast application configured for this server. */
export async function fetchCastAppId(): Promise<string | null> {
  try {
    const result = await request<{ appId: string | null }>('/api/cast-config');
    return typeof result.appId === 'string' ? result.appId : null;
  } catch {
    return null;
  }
}

interface CastState {
  /** Cast is configured and this browser can use it. */
  available: boolean;
  busy: boolean;
  casting: boolean;
  error: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Cast control for one camera. Only owners and admins can create the link. */
export function useCastToTv(cameraId: string, enabled: boolean): CastState {
  const [appId, setAppId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [casting, setCasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linkId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !castBrowserSupported()) return;
    let active = true;
    void (async () => {
      const id = await fetchCastAppId();
      if (!active || !id) return;
      if (!(await loadCastFramework()) || !active) return;
      const globals = window as unknown as CastGlobals;
      const context = globals.cast?.framework.CastContext.getInstance();
      if (!context || !globals.chrome?.cast) return;
      context.setOptions({
        autoJoinPolicy: globals.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        receiverApplicationId: id,
      });
      setAppId(id);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  const revoke = useCallback(async () => {
    const id = linkId.current;
    linkId.current = null;
    if (id)
      await request(`/api/household/guest-links/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
  }, []);

  // The TV session can end without the page's help (the TV is switched off).
  useEffect(() => {
    if (!ready) return;
    const globals = window as unknown as CastGlobals;
    const framework = globals.cast!.framework;
    const context = framework.CastContext.getInstance();
    const onChange = (event: unknown) => {
      if (
        (event as { sessionState?: string }).sessionState ===
        framework.SessionState.SESSION_ENDED
      ) {
        setCasting(false);
        void revoke();
      }
    };
    context.addEventListener(
      framework.CastContextEventType.SESSION_STATE_CHANGED,
      onChange,
    );
    return () =>
      context.removeEventListener(
        framework.CastContextEventType.SESSION_STATE_CHANGED,
        onChange,
      );
  }, [ready, revoke]);

  // Leaving the camera ends its link; the TV stops showing it.
  useEffect(() => () => void revoke(), [cameraId, revoke]);

  const start = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const context = (
        window as unknown as CastGlobals
      ).cast!.framework.CastContext.getInstance();
      const failure = await context.requestSession();
      // Dismissing the device picker is not a failure.
      if (failure) {
        if (failure !== 'cancel')
          setError('Couldn’t reach that TV. Try again.');
        return;
      }
      const session = context.getCurrentSession();
      if (!session) throw new Error('No session');
      await revoke();
      const created = await request<{ id: string; token: string }>(
        '/api/household/guest-links',
        {
          body: JSON.stringify({
            cameraIds: [cameraId],
            expiresInHours: CAST_LINK_HOURS,
            label: 'Cast to TV',
          }),
          method: 'POST',
        },
      );
      linkId.current = created.id;
      await session.sendMessage(CAST_NAMESPACE, {
        path: castWatchPath(created.token),
        type: 'watch',
      });
      setCasting(true);
    } catch {
      setError('Couldn’t start casting. Try again.');
      await revoke();
    } finally {
      setBusy(false);
    }
  }, [busy, cameraId, ready, revoke]);

  const stop = useCallback(async () => {
    const context = (
      window as unknown as CastGlobals
    ).cast?.framework.CastContext.getInstance();
    context?.getCurrentSession()?.endSession(true);
    setCasting(false);
    await revoke();
  }, [revoke]);

  return {
    available: appId !== null && ready,
    busy,
    casting,
    error,
    start,
    stop,
  };
}
