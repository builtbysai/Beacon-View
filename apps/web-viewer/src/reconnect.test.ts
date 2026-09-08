import { describe, expect, it } from 'vitest';

import {
  MAX_AUTOMATIC_RETRIES,
  mayRetry,
  RetryGeneration,
  retryDelay,
} from './reconnect';

describe('viewer reconnect policy', () => {
  it('uses bounded exponential backoff with deterministic jitter', () => {
    expect(retryDelay(0, 0.5)).toBe(1_000);
    expect(retryDelay(4, 0.5)).toBe(16_000);
    expect(retryDelay(20, 1)).toBe(20_000);
  });

  it('retries transient offline states but never retries lost authorization', () => {
    expect(mayRetry('signaling unavailable', 0)).toBe(true);
    expect(mayRetry('signaling unavailable', MAX_AUTOMATIC_RETRIES)).toBe(
      false,
    );
    expect(mayRetry('authorization lost', 0)).toBe(false);
    expect(mayRetry('camera offline', 0)).toBe(true);
    expect(mayRetry('camera offline', MAX_AUTOMATIC_RETRIES)).toBe(false);
  });

  it('invalidates stale sockets and scheduled retries', () => {
    const generations = new RetryGeneration();
    const first = generations.next();
    const second = generations.next();
    expect(generations.isCurrent(first)).toBe(false);
    expect(generations.isCurrent(second)).toBe(true);
    generations.cancel();
    expect(generations.isCurrent(second)).toBe(false);
  });
});
