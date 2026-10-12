import { useEffect, useState } from 'react';

import { isAndroidApp } from './android-shell';

/** The browser's "install this site as an app" prompt, kept until a button asks for it. Imported by main.tsx
 * so the early `beforeinstallprompt` event is never missed. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function installedAsApp(): boolean {
  // Inside the Android app it is already an app: never offer to install it again.
  if (isAndroidApp()) return true;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function usePwaInstall(): { available: boolean; install: () => void } {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((count) => count + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return {
    available: deferred !== null && !installedAsApp(),
    install: () => {
      const prompt = deferred;
      if (!prompt) return;
      void prompt.prompt().finally(() => {
        deferred = null;
        notify();
      });
    },
  };
}
