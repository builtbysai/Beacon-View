import { describe, expect, it } from 'vitest';

import { parseRetryAfter } from '../src/notification-delivery.js';

describe('notification Retry-After handling', () => {
  it('accepts delay seconds and HTTP dates', () => {
    const now = Date.parse('2026-09-12T12:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Sat, 12 Sep 2026 12:01:00 GMT', now)).toBe(60_000);
  });

  it('ignores invalid values and caps provider delays', () => {
    expect(parseRetryAfter('invalid')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter('999999')).toBe(2 * 60 * 60 * 1_000);
  });
});
