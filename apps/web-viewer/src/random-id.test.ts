import { afterEach, expect, test, vi } from 'vitest';

import { randomUuid } from './random-id';

afterEach(() => vi.unstubAllGlobals());

test('generates a version 4 UUID when randomUUID is unavailable', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (target: Uint8Array) => {
      target.set(Uint8Array.from({ length: 16 }, (_, index) => index));
      return target;
    },
  });

  expect(randomUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
});
