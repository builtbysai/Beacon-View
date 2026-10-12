import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentEntry, isUpdateAvailable, latestEntry } from './app-update';
import { markBusy } from './busy';
import { UpdateBanner } from './UpdateBanner';

describe('update checks', () => {
  it('finds the entry script this page was loaded from', () => {
    document.head.innerHTML = `
      <script type="module" src="/assets/vendor-XYZ.js"></script>
      <script type="module" src="/assets/index-OLD123.js"></script>`;
    expect(currentEntry()).toBe('assets/index-OLD123.js');
    document.head.innerHTML = '';
    expect(currentEntry()).toBeNull();
  });

  it('only believes a well-formed version file', async () => {
    const ok = (entry: unknown) =>
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ entry }),
        ok: true,
      });
    expect(await latestEntry(ok('assets/index-NEW456.js'))).toBe(
      'assets/index-NEW456.js',
    );
    expect(await latestEntry(ok('https://evil.example/x.js'))).toBeNull();
    expect(await latestEntry(ok('../../etc/passwd'))).toBeNull();
    expect(await latestEntry(ok(7))).toBeNull();
    expect(
      await latestEntry(vi.fn().mockResolvedValue({ ok: false })),
    ).toBeNull();
    expect(
      await latestEntry(vi.fn().mockRejectedValue(new Error('offline'))),
    ).toBeNull();
  });

  it('is an update only when both entries are known and differ', () => {
    expect(isUpdateAvailable('assets/index-A.js', 'assets/index-B.js')).toBe(
      true,
    );
    expect(isUpdateAvailable('assets/index-A.js', 'assets/index-A.js')).toBe(
      false,
    );
    expect(isUpdateAvailable(null, 'assets/index-B.js')).toBe(false);
    expect(isUpdateAvailable('assets/index-A.js', null)).toBe(false);
  });
});

describe('UpdateBanner', () => {
  const reload = vi.fn();
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML =
      '<script type="module" src="/assets/index-OLD123.js"></script>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ entry: 'assets/index-NEW456.js' }),
        ok: true,
      }),
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    vi.stubGlobal('location', { ...window.location, reload });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
    visibility = 'visible';
    reload.mockReset();
  });

  async function openedWithUpdate() {
    render(<UpdateBanner />);
    await act(() => vi.advanceTimersByTimeAsync(21_000));
  }

  it('offers the update once a newer build is deployed, and Later puts it away', async () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(21_000));
    expect(screen.getByRole('status')).toHaveTextContent(
      'A new version of Beacon is ready.',
    );

    act(() => screen.getByRole('button', { name: 'Later' }).click());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing when this page already runs the newest build', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ entry: 'assets/index-OLD123.js' }),
      ok: true,
    } as Response);
    render(<UpdateBanner />);
    await act(() => vi.advanceTimersByTimeAsync(21_000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reloads a page that stays hidden with an update waiting, unless something needs it', async () => {
    await openedWithUpdate();
    const release = markBusy('live view');
    visibility = 'hidden';
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(11 * 60_000));
    expect(reload).not.toHaveBeenCalled();

    release();
    await act(() => vi.advanceTimersByTimeAsync(11 * 60_000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a page that comes back into view', async () => {
    await openedWithUpdate();
    visibility = 'hidden';
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    visibility = 'visible';
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(20 * 60_000));
    expect(reload).not.toHaveBeenCalled();
  });
});
