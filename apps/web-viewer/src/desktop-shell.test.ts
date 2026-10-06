import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type BeaconDesktopBridge,
  isDesktopShell,
  reportDesktopCapture,
} from './desktop-shell';

describe('desktop shell bridge', () => {
  afterEach(() => {
    delete window.beaconDesktop;
  });

  it('is inert in an ordinary browser', () => {
    expect(isDesktopShell()).toBe(false);
    expect(() => reportDesktopCapture(true)).not.toThrow();
  });

  it('forwards capture state to the desktop app', () => {
    const setCaptureActive = vi.fn();
    window.beaconDesktop = { setCaptureActive, version: 1 };
    expect(isDesktopShell()).toBe(true);
    reportDesktopCapture(true);
    reportDesktopCapture(false);
    expect(setCaptureActive.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores a bridge of an unknown shape', () => {
    window.beaconDesktop = {
      setCaptureActive: 'nope',
      version: 2,
    } as unknown as BeaconDesktopBridge;
    expect(isDesktopShell()).toBe(false);
    expect(() => reportDesktopCapture(true)).not.toThrow();
  });
});
