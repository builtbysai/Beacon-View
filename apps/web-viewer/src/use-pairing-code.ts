import { useCallback, useEffect, useState } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';

export interface PairingCodeState {
  code: string;
  /** The code ran out; a new one is needed. */
  expired: boolean;
  busy: boolean;
  error: string;
  /** "9:42" until it expires. */
  remaining: string;
  /** Creates a fresh one-time code (the old one stops mattering when it expires). */
  create: () => void;
}

/**
 * A one-time pairing code for adding a device (it lasts 10 minutes). Created as soon as `enabled`
 * turns on, so the person sees a ready-to-use code instead of a button; when the camera pairs, the app
 * hears about it over the household connection and leaves this page.
 */
export function usePairingCode(enabled: boolean): PairingCodeState {
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const create = useCallback(() => {
    setBusy(true);
    setError('');
    request<{ code: string; expiresAt?: string }>('/api/pairing-codes', {
      body: '{}',
      method: 'POST',
    })
      .then((result) => {
        setCode(result.code);
        setExpiresAt(
          result.expiresAt
            ? Date.parse(result.expiresAt)
            : Date.now() + 600_000,
        );
        setNow(Date.now());
      })
      .catch((caught: unknown) =>
        setError(
          friendlyError(
            caught,
            'A pairing code couldn’t be created. Try again.',
          ),
        ),
      )
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (enabled && !code && !busy && !error) create();
    // Only when it is first needed; "create" is the way to ask again.
  }, [enabled]);

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [code]);

  const seconds = Math.max(0, Math.round((expiresAt - now) / 1_000));
  return {
    busy,
    code,
    create,
    error,
    expired: Boolean(code) && seconds === 0,
    remaining: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
