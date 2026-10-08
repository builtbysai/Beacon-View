import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { findDesktopAuthLink, parseDesktopAuthLink } from '../src/deep-link.js';
import {
  exchangeScript,
  googleStartUrl,
  parseExchangeResult,
  PendingGoogleSignIn,
  pkceChallenge,
} from '../src/google-sign-in.js';

const code = randomBytes(32).toString('base64url');

describe('desktop sign-in deep links', () => {
  it('parses the code and failure links the backend sends', () => {
    expect(
      parseDesktopAuthLink(`beaconsecureview://auth/desktop?code=${code}`),
    ).toEqual({ code, kind: 'code' });
    expect(
      parseDesktopAuthLink(`beaconsecureview://auth/desktop/?code=${code}`),
    ).toEqual({ code, kind: 'code' });
    expect(
      parseDesktopAuthLink('beaconsecureview://auth/desktop?status=failed'),
    ).toEqual({ kind: 'failed' });
  });

  it('ignores Android links, other hosts, and malformed codes', () => {
    for (const link of [
      `beaconsecureview://auth/mobile?code=${code}`,
      `beaconsecureview://evil/desktop?code=${code}`,
      `https://auth/desktop?code=${code}`,
      'beaconsecureview://auth/desktop?code=short',
      `beaconsecureview://auth/desktop?code=${code}%27);alert(1);//`,
      'beaconsecureview://auth/desktop?status=signedIn',
      'beaconsecureview://auth/desktop',
      'garbage',
    ])
      expect(parseDesktopAuthLink(link), link).toBeNull();
  });

  it('finds the link in a forwarded command line', () => {
    expect(
      findDesktopAuthLink([
        'C:\\Program Files\\Beacon\\Beacon.exe',
        '--allow-file-access-from-files',
        `beaconsecureview://auth/desktop?code=${code}`,
      ]),
    ).toEqual({ code, kind: 'code' });
    expect(findDesktopAuthLink(['Beacon.exe', '--background'])).toBeNull();
  });
});

describe('pending Google sign-in', () => {
  it('hands its verifier out once, matching the challenge it sent', () => {
    const pending = new PendingGoogleSignIn(60_000);
    const challenge = pending.begin();
    const verifier = pending.take();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge(verifier!)).toBe(challenge);
    expect(pending.take()).toBeNull();
  });

  it('has nothing to offer a link nobody asked for, or an expired one', () => {
    let now = 0;
    const pending = new PendingGoogleSignIn(60_000, () => now);
    expect(pending.take()).toBeNull();
    pending.begin();
    now = 60_000;
    expect(pending.take()).toBeNull();
    pending.begin();
    pending.cancel();
    expect(pending.take()).toBeNull();
  });

  it('builds the desktop start URL on the app origin', () => {
    const url = new URL(
      googleStartUrl('https://beacon.builtbysai.com', 'c'.repeat(43), true),
    );
    expect(url.origin + url.pathname).toBe(
      'https://beacon.builtbysai.com/api/auth/google',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      challenge: 'c'.repeat(43),
      intent: 'addPassword',
      platform: 'desktop',
    });
  });
});

describe('handoff exchange', () => {
  const verifier = randomBytes(32).toString('base64url');

  it('only ever embeds validated, JSON-encoded values', () => {
    const script = exchangeScript(code, verifier);
    expect(script).toContain(
      JSON.stringify(JSON.stringify({ code, verifier })),
    );
    expect(script).toContain("'x-beacon-desktop': '1'");
    expect(() =>
      exchangeScript("x');alert(1);//".padEnd(40, 'a'), verifier),
    ).toThrow();
    expect(() => exchangeScript(code, 'short')).toThrow();
  });

  it('follows only server-chosen same-origin paths', () => {
    expect(
      parseExchangeResult({
        body: { redirect: '/', status: 'signedIn' },
        ok: true,
      }),
    ).toEqual({ kind: 'signedIn', path: '/' });
    expect(
      parseExchangeResult({
        body: {
          redirect: '/settings?section=account&addPassword=1',
          status: 'signedIn',
        },
        ok: true,
      }),
    ).toEqual({
      kind: 'signedIn',
      path: '/settings?section=account&addPassword=1',
    });
    expect(
      parseExchangeResult({ body: { status: 'linkRequired' }, ok: true }),
    ).toEqual({ kind: 'linkRequired' });
    for (const redirect of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      7,
    ])
      expect(
        parseExchangeResult({
          body: { redirect, status: 'signedIn' },
          ok: true,
        }),
      ).toEqual({ kind: 'failed' });
    expect(parseExchangeResult({ body: { error: 'nope' }, ok: false })).toEqual(
      {
        kind: 'failed',
      },
    );
    expect(parseExchangeResult(null)).toEqual({ kind: 'failed' });
  });
});
