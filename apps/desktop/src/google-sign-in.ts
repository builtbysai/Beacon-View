import { createHash, randomBytes } from 'node:crypto';

const VERIFIER = /^[A-Za-z0-9_-]{43}$/;
const HANDOFF_CODE = /^[A-Za-z0-9_-]{32,512}$/;

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Holds the PKCE verifier for the one Google sign-in this app has started.
 * A deep link that arrives with no sign-in pending (another app or a web
 * page trying to inject a session) has no verifier to pair with and is
 * dropped.
 */
export class PendingGoogleSignIn {
  private pending: { expiresAt: number; verifier: string } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts (or restarts) a sign-in and returns its S256 challenge. */
  begin(): string {
    const verifier = randomBytes(32).toString('base64url');
    this.pending = { expiresAt: this.now() + this.ttlMs, verifier };
    return pkceChallenge(verifier);
  }

  /** Returns the verifier at most once, and only before it expires. */
  take(): string | null {
    const pending = this.pending;
    this.pending = null;
    return pending && pending.expiresAt > this.now() ? pending.verifier : null;
  }

  cancel(): void {
    this.pending = null;
  }
}

export function googleStartUrl(
  appOrigin: string,
  challenge: string,
  addPassword: boolean,
): string {
  const url = new URL('/api/auth/google', appOrigin);
  url.searchParams.set('platform', 'desktop');
  url.searchParams.set('challenge', challenge);
  if (addPassword) url.searchParams.set('intent', 'addPassword');
  return url.href;
}

/**
 * Script run in an isolated world of the Beacon page so the exchange is a
 * same-origin request and the resulting session cookie lands in the
 * webview's own cookie jar. Inputs are validated and JSON-encoded; nothing
 * from the deep link is ever interpolated raw.
 */
export function exchangeScript(code: string, verifier: string): string {
  if (!HANDOFF_CODE.test(code) || !VERIFIER.test(verifier))
    throw new Error('Invalid sign-in handoff');
  const body = JSON.stringify(JSON.stringify({ code, verifier }));
  return `fetch('/api/desktop/auth/google', {
  body: ${body},
  cache: 'no-store',
  credentials: 'same-origin',
  headers: { 'content-type': 'application/json', 'x-beacon-desktop': '1' },
  method: 'POST',
}).then(
  async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) }),
  () => ({ ok: false, body: null }),
);`;
}

type ExchangeOutcome =
  | { kind: 'signedIn'; path: string }
  | { kind: 'linkRequired' }
  | { kind: 'failed' };

/** Interprets the script's result; the only paths ever followed are
 * same-origin absolute paths the server chose. */
export function parseExchangeResult(value: unknown): ExchangeOutcome {
  if (!value || typeof value !== 'object') return { kind: 'failed' };
  const { ok, body } = value as { body?: unknown; ok?: unknown };
  if (ok !== true || !body || typeof body !== 'object')
    return { kind: 'failed' };
  const { redirect, status } = body as { redirect?: unknown; status?: unknown };
  if (status === 'linkRequired') return { kind: 'linkRequired' };
  if (
    status === 'signedIn' &&
    typeof redirect === 'string' &&
    /^\/(?![/\\])[^\\]*$/.test(redirect)
  )
    return { kind: 'signedIn', path: redirect };
  return { kind: 'failed' };
}
