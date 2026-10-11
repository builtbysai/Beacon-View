import { describe, expect, it } from 'vitest';

import {
  FAST_RETRIES,
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

  it('keeps retrying transient failures but never retries lost authorization', () => {
    expect(FAST_RETRIES).toBe(5);
    expect(mayRetry('signaling unavailable')).toBe(true);
    expect(mayRetry('camera offline')).toBe(true);
    expect(mayRetry('connection timed out')).toBe(true);
    expect(mayRetry('ICE failed')).toBe(true);
    expect(mayRetry('authorization lost')).toBe(false);
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
