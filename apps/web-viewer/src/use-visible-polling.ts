import { useEffect, useRef } from 'react';

/**
 * Calls `callback` every `intervalMs` while the page is visible, and once more
 * as soon as it becomes visible again. Household viewers and guests have no
 * realtime channel (it is limited to owners and admins), so this keeps camera
 * status from going stale without polling a tab nobody is looking at (V43).
 */
export function useVisiblePolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const start = () => {
      if (timer === null)
        timer = window.setInterval(() => latest.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        latest.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}
