/**
 * The Beacon desktop app (apps/desktop, ADR 0082) loads this same web viewer
 * and exposes exactly this object from its preload script. In an ordinary
 * browser it is absent and every helper here is a no-op.
 */
export interface BeaconDesktopBridge {
  readonly version: 1;
  /** Drives the tray's visible "camera is live" indicator while the window
   * is hidden -- capture must stay visible to the person at the device. */
  setCaptureActive(active: boolean): void;
}

declare global {
  interface Window {
    beaconDesktop?: BeaconDesktopBridge;
  }
}

function desktopBridge(): BeaconDesktopBridge | null {
  const bridge = window.beaconDesktop;
  return bridge?.version === 1 && typeof bridge.setCaptureActive === 'function'
    ? bridge
    : null;
}

export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

export function reportDesktopCapture(active: boolean): void {
  desktopBridge()?.setCaptureActive(active);
}
