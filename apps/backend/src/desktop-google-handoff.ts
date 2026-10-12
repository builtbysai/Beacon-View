import { createHash } from 'node:crypto';

import { generateToken, hashSecret, secretsEqual } from './security.js';

/**
 * Google sign-in for the installed desktop app (ADR 0082).
 *
 * Google refuses OAuth inside embedded webviews, so the desktop shell runs
 * the consent screen in the person's own browser and gets the result back
 * through the `beaconsecureview://auth/desktop` deep link. Any local app can
 * claim a custom URL scheme, so the code in that link is useless on its own:
 * it is bound to an RFC 7636 (PKCE, S256) challenge whose verifier never
 * leaves the desktop shell that started the sign-in.
 */

/** The browser lands here after Google; the page hands the code to the app
 * through beaconsecureview://auth/desktop and tells the person the tab can
 * be closed (apps/web-viewer DesktopAuthReturnPage). */
const DESKTOP_COMPLETION_PATH = '/auth/desktop/complete';

/** BASE64URL(SHA-256(verifier)) is always exactly 43 characters. */
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 section 4.1 verifier alphabet and length. */
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

const DESKTOP_STATE_PREFIX = 'desktop.';

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** The OAuth `state` for a desktop sign-in carries its (public) challenge so
 * the callback can bind the handoff code to it without another cookie. */
export function desktopOAuthState(challenge: string): string {
  if (!PKCE_CHALLENGE_PATTERN.test(challenge))
    throw new Error('Invalid PKCE challenge');
  return `${DESKTOP_STATE_PREFIX}${challenge}.${generateToken()}`;
}

/** Returns the PKCE challenge when `state` began a desktop sign-in. */
export function desktopChallengeFromState(
  state: string | undefined,
): string | null {
  return challengeFromState(state, DESKTOP_STATE_PREFIX);
}

function challengeFromState(
  state: string | undefined,
  prefix: string,
): string | null {
  if (!state?.startsWith(prefix)) return null;
  const [challenge, token, ...rest] = state.slice(prefix.length).split('.');
  if (
    rest.length > 0 ||
    !challenge ||
    !token ||
    !PKCE_CHALLENGE_PATTERN.test(challenge)
  )
    return null;
  return challenge;
}

/** The code travels in the URL fragment, which browsers never send back to
 * the server, so it stays out of access logs and Referer headers. */
export function desktopCompletionPath(
  result: { code: string } | { status: 'failed' },
): string {
  return 'code' in result
    ? `${DESKTOP_COMPLETION_PATH}#code=${encodeURIComponent(result.code)}`
    : `${DESKTOP_COMPLETION_PATH}#status=${result.status}`;
}

export type DesktopGoogleOutcome =
  | {
      kind: 'session';
      addPassword: boolean;
      email: string;
      householdId: string;
      userId: string;
    }
  | {
      kind: 'linkRequired';
      avatarUrl: string | null;
      email: string;
      googleSubject: string;
    };

interface HandoffEntry {
  challenge: string;
  expiresAt: number;
  outcome: DesktopGoogleOutcome;
}

/**
 * Single-use, short-lived handoff codes. Only the SHA-256 of each code is
 * held, and a redemption attempt consumes the code whether or not the
 * verifier matches, so a code intercepted from the deep link cannot be
 * retried against the verifier.
 */
export class DesktopGoogleHandoffs {
  private readonly entries = new Map<string, HandoffEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  issue(challenge: string, outcome: DesktopGoogleOutcome): string {
    if (!PKCE_CHALLENGE_PATTERN.test(challenge))
      throw new Error('Invalid PKCE challenge');
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    const code = generateToken();
    this.entries.set(hashSecret(code), {
      challenge,
      expiresAt: now + this.ttlMs,
      outcome,
    });
    return code;
  }

  redeem(code: string, verifier: string): DesktopGoogleOutcome | null {
    const key = hashSecret(code);
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry || entry.expiresAt <= this.now()) return null;
    if (!PKCE_VERIFIER_PATTERN.test(verifier)) return null;
    if (!secretsEqual(pkceChallenge(verifier), entry.challenge)) return null;
    return entry.outcome;
  }
}
