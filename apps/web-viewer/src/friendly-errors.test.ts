import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  friendlyError,
  friendlyServerError,
  mediaErrorMessage,
} from './friendly-errors';

const backendSource = path.resolve(__dirname, '../../backend/src');

/** Every error string the server can send. */
function serverMessages(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(backendSource)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(path.join(backendSource, file), 'utf8');
    for (const match of source.matchAll(/error:\s*'([^']+)'/gu))
      found.add(match[1]!);
  }
  return [...found];
}

describe('friendly errors', () => {
  it('has plain words for every message the server can send', () => {
    const messages = serverMessages();
    expect(messages.length).toBeGreaterThan(50);
    const raw = messages.filter((message) => {
      const { message: shown } = friendlyServerError(409, message, undefined);
      // Either translated, or the server text was already a full sentence.
      return shown === message && !/[.!?]$/u.test(message);
    });
    expect(raw).toEqual([]);
  });

  it('never shows internal terms', () => {
    for (const message of serverMessages()) {
      const { message: shown } = friendlyServerError(400, message, undefined);
      expect(shown).not.toMatch(/csrf|pagination|envelope|grant|origin/iu);
    }
  });

  it('keeps identifiers as codes instead of display text', () => {
    expect(
      friendlyServerError(409, 'googleAccountExists', undefined),
    ).toMatchObject({ code: 'google_account_exists' });
    expect(
      friendlyServerError(409, 'googleAccountExists', undefined).message,
    ).not.toContain('googleAccountExists');
  });

  it('falls back to the status when the server sent nothing useful', () => {
    expect(friendlyServerError(503, undefined, undefined).message).toMatch(
      /having trouble/u,
    );
    expect(friendlyServerError(429, undefined, undefined).message).toMatch(
      /too many attempts/iu,
    );
  });

  it('tells camera and microphone problems apart', () => {
    expect(
      mediaErrorMessage(new DOMException('', 'NotAllowedError'), 'camera'),
    ).toMatch(/permission/u);
    expect(
      mediaErrorMessage(new DOMException('', 'NotReadableError'), 'camera'),
    ).toMatch(/another app/u);
    expect(
      mediaErrorMessage(new DOMException('', 'NotFoundError'), 'microphone'),
    ).toMatch(/No microphone was found/u);
  });

  it('never passes a browser’s technical wording through', () => {
    expect(friendlyError(new TypeError('Failed to fetch'), 'x')).toMatch(
      /can’t reach beacon/iu,
    );
    expect(
      friendlyError(
        new DOMException(
          'Registration failed - push service error',
          'AbortError',
        ),
        'x',
      ),
    ).toBe('That didn’t finish. Try again.');
    expect(
      friendlyError(new DOMException('weird', 'OperationError'), 'Fallback.'),
    ).toBe('Fallback.');
    expect(
      friendlyError(new Error('undefined is not a function'), 'Fallback.'),
    ).toBe('Fallback.');
    expect(friendlyError('nope', 'Fallback.')).toBe('Fallback.');
  });

  it('passes Beacon’s own sentences through', () => {
    expect(
      friendlyError(
        new Error('Finish the current recording before switching cameras.'),
        'x',
      ),
    ).toBe('Finish the current recording before switching cameras.');
  });
});
