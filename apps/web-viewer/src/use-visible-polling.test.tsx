import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVisiblePolling } from './use-visible-polling';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisiblePolling (V43)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('polls while visible, pauses while hidden, and refreshes on return', () => {
    const callback = vi.fn();
    renderHook(() => useVisiblePolling(callback, 20_000, true));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(callback).toHaveBeenCalledTimes(3);

    act(() => {
      setVisibility('hidden');
    });
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(callback).toHaveBeenCalledTimes(3);

    act(() => {
      setVisibility('visible');
    });
    expect(callback).toHaveBeenCalledTimes(4);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(callback).toHaveBeenCalledTimes(5);
  });

  it('does nothing when disabled and stops on unmount', () => {
    const callback = vi.fn();
    const off = renderHook(() => useVisiblePolling(callback, 1_000, false));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(callback).not.toHaveBeenCalled();
    off.unmount();
    const on = renderHook(() => useVisiblePolling(callback, 1_000, true));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
    on.unmount();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
