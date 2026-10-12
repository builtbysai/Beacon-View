/** Centralized human-readable naming logic, shared everywhere Beacon shows a
 * camera, device, or browser session identity. A normal browser cannot
 * reliably expose a computer's real hostname through standard web APIs, and
 * Beacon does not fingerprint devices to work around that — so the best
 * legitimate default is the browser/OS family parsed from the browser's own
 * user-agent string (the same coarse information every site already
 * receives on every request), with the user always free to rename. */

/** Parse a user-agent string into its browser and OS family, e.g. "Chrome"
 * and "Windows". Returns nulls for anything unrecognized rather than
 * guessing. */
export function parseUserAgent(userAgent: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!userAgent) return { browser: null, os: null };
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\/|FxiOS\//.test(userAgent)
          ? 'Firefox'
          : /Version\/.*Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;
  return { browser, os };
}

/** Combine a parsed browser/OS pair into one label, e.g. "Chrome on
 * Windows". Falls back gracefully when only one half is known. */
export function browserOsLabel(
  userAgent: string | null | undefined,
  fallback: string,
): string {
  // The Android app's own requests identify as the runtime ("Dalvik/2.1.0 ...") or the HTTP library.
  if (userAgent && /Dalvik\/|okhttp\//.test(userAgent))
    return 'Beacon for Android';
  const { browser, os } = parseUserAgent(userAgent);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? fallback;
}

/** A device's platform and device-type fields are legitimately distinct
 * concepts on the backend, but a browser camera has the same value in both
 * ('browser'), which would otherwise render as a literal "browser ·
 * browser" — collapse that duplicate instead of leaking raw field values
 * into the UI. */
export function deviceKindLabel(device: {
  platform: string;
  deviceType: string;
}): string {
  const capitalize = (value: string) =>
    value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
  if (device.platform === device.deviceType) return capitalize(device.platform);
  return `${capitalize(device.platform)} ${device.deviceType}`;
}

/** Browser-reported camera labels often carry a raw USB vendor:product id,
 * e.g. "HD Pro Webcam C920 (046d:08e5)" — strip that for what's shown or
 * pre-filled in the UI. The user-editable name field still lets someone
 * override it, and nothing here is fabricated: it's the same label the
 * browser already gave us, just without the debugging suffix. */
export function friendlyDeviceLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}
