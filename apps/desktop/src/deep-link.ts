/** Shared with Android's sign-in handoff; desktop uses its own path. */
export const DEEP_LINK_SCHEME = 'beaconsecureview';

export type DesktopAuthLink =
  { kind: 'code'; code: string } | { kind: 'failed' };

/** Handoff codes are base64url server tokens (see the backend's
 * desktopGoogleExchangeSchema). Anything else is ignored outright. */
const HANDOFF_CODE = /^[A-Za-z0-9_-]{32,512}$/;

export function parseDesktopAuthLink(value: string): DesktopAuthLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${DEEP_LINK_SCHEME}:` ||
    url.host !== 'auth' ||
    (url.pathname !== '/desktop' && url.pathname !== '/desktop/')
  )
    return null;
  const code = url.searchParams.get('code');
  if (code !== null)
    return HANDOFF_CODE.test(code) ? { kind: 'code', code } : null;
  return url.searchParams.get('status') === 'failed'
    ? { kind: 'failed' }
    : null;
}

/** Windows and Linux deliver the deep link as a command-line argument of the
 * second launch, which the single-instance lock forwards to this process. */
export function findDesktopAuthLink(
  argv: readonly string[],
): DesktopAuthLink | null {
  for (const argument of argv) {
    if (argument.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`))
      return parseDesktopAuthLink(argument);
  }
  return null;
}
