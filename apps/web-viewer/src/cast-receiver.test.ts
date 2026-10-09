import { describe, expect, it } from 'vitest';

// The receiver is plain JavaScript served as-is, so it is imported directly.
import { NAMESPACE, watchPath } from '../public/cast/receiver.js';
import { CAST_NAMESPACE, castWatchPath } from './cast-sender';

const token = 'A'.repeat(43);

describe('Cast messages', () => {
  it('uses one namespace on both ends', () => {
    expect(NAMESPACE).toBe(CAST_NAMESPACE);
  });

  it('opens exactly what the sender builds', () => {
    expect(watchPath({ path: castWatchPath(token), type: 'watch' })).toBe(
      `/g/${token}?cast=1`,
    );
  });

  it('refuses anything that is not a guest-link path on this site', () => {
    for (const path of [
      'https://evil.example/g/' + token + '?cast=1',
      '//evil.example/g/' + token + '?cast=1',
      '/g/short?cast=1',
      `/g/${token}`,
      `/g/${token}?cast=1&x=1`,
      `/settings?cast=1`,
      `/g/../${token}?cast=1`,
      'javascript:alert(1)',
      7,
      null,
    ])
      expect(watchPath({ path, type: 'watch' })).toBeNull();
    expect(watchPath({ path: castWatchPath(token), type: 'other' })).toBeNull();
    expect(watchPath(null)).toBeNull();
    expect(watchPath('watch')).toBeNull();
  });
});
