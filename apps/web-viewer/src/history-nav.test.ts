import { afterEach, describe, expect, it, vi } from 'vitest';

import { goBack, pushRoute, replaceRoute } from './history-nav';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('history-nav', () => {
  it('goes back through real browser history once something has been pushed', async () => {
    pushRoute('/cameras');
    pushRoute('/cameras/camera-1');
    expect(window.location.pathname).toBe('/cameras/camera-1');

    const fallback = vi.fn();
    goBack(fallback);
    await vi.waitFor(() => expect(window.location.pathname).toBe('/cameras'));
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back instead of leaving the app when there is nothing to go back to', () => {
    // Simulates a fresh tab landing directly on a deep link: no in-app
    // history behind the current entry.
    window.history.replaceState({}, '', '/cameras/camera-1');

    const fallback = vi.fn();
    goBack(fallback);
    expect(fallback).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/cameras/camera-1');
  });

  it('carries the depth forward across a replace so a later goBack still works', async () => {
    pushRoute('/cameras');
    replaceRoute('/cameras/camera-1');
    expect(window.location.pathname).toBe('/cameras/camera-1');

    const fallback = vi.fn();
    goBack(fallback);
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(fallback).not.toHaveBeenCalled();
  });
});
