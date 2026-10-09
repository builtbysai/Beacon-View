import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSleepTimer } from './sleep-timer';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('sleep timer', () => {
  it('is off initially, expires once, and requires an explicit restart', () => {
    const { result } = renderHook(() => useSleepTimer('camera'));
    expect(result.current.minutes).toBe(0);
    act(() => result.current.choose(15));
    act(() => {
      vi.advanceTimersByTime(14 * 60_000);
    });
    expect(result.current.remaining).toBe(1);
    expect(result.current.expired).toBe(false);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.expired).toBe(true);
    act(() => result.current.choose(0));
    expect(result.current.expired).toBe(true);
    act(() => result.current.reset());
    expect(result.current.expired).toBe(false);
  });
  it('can be cancelled or replaced without the previous deadline firing', () => {
    const { result } = renderHook(() => useSleepTimer('camera'));
    act(() => result.current.choose(15));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    act(() => result.current.choose(30));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(result.current.remaining).toBe(20);
    expect(result.current.expired).toBe(false);
    act(() => result.current.choose(0));
    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(result.current.expired).toBe(false);
  });
  it('checks overdue deadlines on wake and resets for a different camera', () => {
    const { result, rerender } = renderHook(({ id }) => useSleepTimer(id), {
      initialProps: { id: 'first' },
    });
    act(() => result.current.choose(60));
    // Wall-clock jump with no interval callbacks models a suspended page.
    vi.setSystemTime(new Date('2026-10-09T13:05:00Z'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.expired).toBe(true);
    rerender({ id: 'second' });
    expect(result.current.expired).toBe(false);
    expect(result.current.minutes).toBe(0);
  });
  it('removes intervals and wake listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useSleepTimer('camera'));
    act(() => result.current.choose(15));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
