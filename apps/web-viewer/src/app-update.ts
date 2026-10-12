import { useCallback, useEffect, useRef, useState } from 'react';

import { isBusy } from './busy';

const ENTRY_PATTERN = /^assets\/[A-Za-z0-9._-]+\.js$/u;
const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 30 * 60_000;
const MIN_GAP_MS = 5 * 60_000;
/** A hidden page that has an update waiting reloads itself after this long, if nothing needs it. */
const HIDDEN_RELOAD_MS = 10 * 60_000;
const SNOOZE_MS = 4 * 60 * 60_000;
const SNOOZE_KEY = 'beacon.update.snoozed.until';

/** The entry script this page was loaded from, e.g. "assets/index-AbC123.js"; null in development. */
export function currentEntry(
  root: ParentNode = document,
  base = window.location.href,
): string | null {
  for (const script of root.querySelectorAll<HTMLScriptElement>(
    'script[type="module"][src]',
  )) {
    const path = new URL(script.src, base).pathname.replace(/^\//u, '');
    if (ENTRY_PATTERN.test(path) && path.startsWith('assets/index-'))
      return path;
  }
  return null;
}

/** The entry script of the newest deployed build, or null when it cannot be read. */
export async function latestEntry(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const value = (await response.json()) as { entry?: unknown };
    return typeof value.entry === 'string' && ENTRY_PATTERN.test(value.entry)
      ? value.entry
      : null;
  } catch {
    return null;
  }
}

export function isUpdateAvailable(
  current: string | null,
  latest: string | null,
): boolean {
  return current !== null && latest !== null && current !== latest;
}

function snoozedNow(now = Date.now()): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > now;
  } catch {
    return false;
  }
}

/**
 * Tells an open page that a newer version of Beacon was deployed (ADR 0118). It checks shortly after load,
 * whenever the page comes back into view, and every half hour; "Reload" applies the update, "Later" puts the
 * offer away for four hours. A hidden page with an update waiting reloads itself after ten minutes, but only
 * when nothing registered with busy.ts needs it, so an unattended screen catches up without cutting off a
 * live view, an open camera or a recording.
 */
export function useAppUpdate(): {
  /** An update is waiting and has not been put off. */
  available: boolean;
  /** Checks now, ignoring the usual spacing; resolves true when an update is waiting. */
  checkNow: () => Promise<boolean>;
  later: () => void;
  /** An update is waiting, even if it was put off. */
  pending: boolean;
  reload: () => void;
} {
  const [available, setAvailable] = useState(false);
  const [snoozed, setSnoozed] = useState(snoozedNow);
  const checkedAt = useRef(0);
  const entry = useRef(currentEntry());

  const check = useCallback(async (force = false) => {
    if (entry.current === null) return false;
    if (!force && Date.now() - checkedAt.current < MIN_GAP_MS) return false;
    checkedAt.current = Date.now();
    const latest = await latestEntry();
    const newer = isUpdateAvailable(entry.current, latest);
    if (newer) setAvailable(true);
    return newer;
  }, []);

  useEffect(() => {
    if (entry.current === null) return;
    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const every = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  useEffect(() => {
    if (!available) return;
    let timer: number | null = null;
    const arm = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== 'hidden') return;
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'hidden' && !isBusy())
          window.location.reload();
        else arm();
      }, HIDDEN_RELOAD_MS);
    };
    document.addEventListener('visibilitychange', arm);
    arm();
    return () => {
      document.removeEventListener('visibilitychange', arm);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [available]);

  return {
    available: available && !snoozed,
    checkNow: () => check(true),
    pending: available,
    later: () => {
      try {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
      } catch {
        // Private browsing: it simply comes back on the next check.
      }
      setSnoozed(true);
    },
    reload: () => {
      void navigator.serviceWorker
        ?.getRegistration()
        .then((registration) => registration?.update())
        .catch(() => undefined)
        .finally(() => window.location.reload());
    },
  };
}
