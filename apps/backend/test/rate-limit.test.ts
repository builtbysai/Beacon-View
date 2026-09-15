import { afterEach, describe, expect, it, vi } from 'vitest';

import { RateLimiter } from '../src/rate-limit.js';

describe('RateLimiter', () => {
  afterEach(() => vi.useRealTimers());

  it('allows requests under the limit and blocks once it is reached', () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    expect(limiter.take('key', 2, 1_000, now)).toBe(true);
    expect(limiter.take('key', 2, 1_000, now)).toBe(true);
    expect(limiter.take('key', 2, 1_000, now)).toBe(false);
    limiter.close();
  });

  it('allows requests again once the window has passed', () => {
    const limiter = new RateLimiter();
    const start = Date.now();
    expect(limiter.take('key', 1, 1_000, start)).toBe(true);
    expect(limiter.take('key', 1, 1_000, start + 500)).toBe(false);
    expect(limiter.take('key', 1, 1_000, start + 1_500)).toBe(true);
    limiter.close();
  });

  it('tracks separate keys independently', () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    expect(limiter.take('a', 1, 1_000, now)).toBe(true);
    expect(limiter.take('b', 1, 1_000, now)).toBe(true);
    expect(limiter.take('a', 1, 1_000, now)).toBe(false);
    limiter.close();
  });

  it('clear() resets every key immediately', () => {
    const limiter = new RateLimiter();
    const now = Date.now();
    limiter.take('key', 1, 1_000, now);
    expect(limiter.take('key', 1, 1_000, now)).toBe(false);
    limiter.clear();
    expect(limiter.take('key', 1, 1_000, now)).toBe(true);
    limiter.close();
  });

  it('sweeps long-stale keys so distinct one-shot keys do not grow memory forever', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.take('stale-key', 5, 1_000, Date.now());
    expect(limiter.size).toBe(1);
    // Well past the 24h staleness threshold, in 10-minute sweep steps.
    vi.advanceTimersByTime(25 * 60 * 60 * 1_000);
    expect(limiter.size).toBe(0);
    limiter.close();
  });

  it('does not sweep a key that has been used recently', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.take('active-key', 5, 1_000, Date.now());
    vi.advanceTimersByTime(10 * 60 * 60 * 1_000);
    limiter.take('active-key', 5, 1_000, Date.now());
    vi.advanceTimersByTime(10 * 60 * 60 * 1_000);
    expect(limiter.size).toBe(1);
    limiter.close();
  });
});
