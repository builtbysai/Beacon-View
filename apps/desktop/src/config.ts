/** The canonical Beacon web application and API origin (ADR 0042). */
export const PRODUCTION_ORIGIN = 'https://beacon.builtbysai.com';

export const APP_ID = 'com.builtbysai.beacon';

/** Launch argument the login item uses so Beacon starts in the tray. */
export const BACKGROUND_ARG = '--background';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

/**
 * Packaged builds always load the production origin. Unpackaged development
 * builds may point at a local web viewer (`pnpm dev`, ADR 0005 LAN mode) via
 * BEACON_DESKTOP_ORIGIN; plain HTTP is accepted only for loopback and
 * private-network hosts.
 */
export function resolveAppOrigin(
  packaged: boolean,
  override: string | undefined,
): string {
  if (packaged || !override) return PRODUCTION_ORIGIN;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new Error('BEACON_DESKTOP_ORIGIN must be an absolute URL');
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('BEACON_DESKTOP_ORIGIN must be a bare origin');
  if (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      (LOOPBACK_HOSTS.has(url.hostname) || isPrivateIpv4(url.hostname)))
  )
    return url.origin;
  throw new Error(
    'BEACON_DESKTOP_ORIGIN must use HTTPS, or HTTP on a loopback or private-network host',
  );
}
