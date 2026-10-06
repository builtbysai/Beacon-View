import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  desktopChallengeFromState,
  desktopDeepLink,
  DesktopGoogleHandoffs,
  type DesktopGoogleOutcome,
  desktopOAuthState,
  pkceChallenge,
} from '../src/desktop-google-handoff.js';

const session: DesktopGoogleOutcome = {
  kind: 'session',
  addPassword: false,
  email: 'owner@example.com',
  householdId: 'household-1',
  userId: 'user-1',
};

function verifierAndChallenge() {
  const verifier = randomBytes(32).toString('base64url');
  return { challenge: pkceChallenge(verifier), verifier };
}

describe('desktop Google sign-in handoff', () => {
  it('matches the RFC 7636 appendix B S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('round-trips the challenge through the OAuth state', () => {
    const { challenge } = verifierAndChallenge();
    const state = desktopOAuthState(challenge);
    expect(desktopChallengeFromState(state)).toBe(challenge);
    expect(desktopOAuthState(challenge)).not.toBe(state);
  });

  it('does not treat web, Android, or malformed state as desktop', () => {
    const { challenge } = verifierAndChallenge();
    expect(desktopChallengeFromState(undefined)).toBeNull();
    expect(desktopChallengeFromState('web.abc')).toBeNull();
    expect(desktopChallengeFromState('android.abc')).toBeNull();
    expect(desktopChallengeFromState('desktop.short.token')).toBeNull();
    expect(desktopChallengeFromState(`desktop.${challenge}`)).toBeNull();
    expect(
      desktopChallengeFromState(`desktop.${challenge}.token.extra`),
    ).toBeNull();
    expect(() => desktopOAuthState('not-a-challenge')).toThrow();
  });

  it('redeems a code exactly once with the matching verifier', () => {
    const handoffs = new DesktopGoogleHandoffs(60_000);
    const { challenge, verifier } = verifierAndChallenge();
    const code = handoffs.issue(challenge, session);
    expect(handoffs.redeem(code, verifier)).toEqual(session);
    expect(handoffs.redeem(code, verifier)).toBeNull();
  });

  it('consumes the code when the verifier is wrong so it cannot be retried', () => {
    const handoffs = new DesktopGoogleHandoffs(60_000);
    const { challenge, verifier } = verifierAndChallenge();
    const code = handoffs.issue(challenge, session);
    expect(
      handoffs.redeem(code, randomBytes(32).toString('base64url')),
    ).toBeNull();
    expect(handoffs.redeem(code, verifier)).toBeNull();
  });

  it('rejects malformed verifiers and unknown codes', () => {
    const handoffs = new DesktopGoogleHandoffs(60_000);
    const { challenge } = verifierAndChallenge();
    const code = handoffs.issue(challenge, session);
    expect(handoffs.redeem(code, 'too short')).toBeNull();
    expect(
      handoffs.redeem(randomBytes(32).toString('base64url'), 'x'.repeat(43)),
    ).toBeNull();
  });

  it('expires codes and prunes them on the next issue', () => {
    let now = 1_000;
    const handoffs = new DesktopGoogleHandoffs(60_000, () => now);
    const first = verifierAndChallenge();
    const code = handoffs.issue(first.challenge, session);
    now += 60_000;
    expect(handoffs.redeem(code, first.verifier)).toBeNull();
    const second = verifierAndChallenge();
    const fresh = handoffs.issue(second.challenge, session);
    expect(handoffs.redeem(fresh, second.verifier)).toEqual(session);
  });

  it('builds only the fixed desktop deep link', () => {
    expect(desktopDeepLink({ code: 'a+b/c' })).toBe(
      'beaconsecureview://auth/desktop?code=a%2Bb%2Fc',
    );
    expect(desktopDeepLink({ status: 'failed' })).toBe(
      'beaconsecureview://auth/desktop?status=failed',
    );
  });
});
