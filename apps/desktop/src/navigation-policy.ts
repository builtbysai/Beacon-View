export type NavigationDecision =
  /** Stays inside the Beacon window. */
  | { kind: 'app' }
  /** Google sign-in must run in the system browser (Google refuses OAuth in
   * embedded webviews); the shell starts the PKCE handoff instead. */
  | { kind: 'google-sign-in'; addPassword: boolean }
  /** Google account linking and Drive connection need the existing session,
   * which only exists in this webview, so they finish in the browser. */
  | { kind: 'google-in-browser'; settingsPath: string }
  /** Any other web or mail link opens in the person's own browser. */
  | { kind: 'external'; url: string }
  | { kind: 'blocked' };

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/**
 * Decides where a top-level navigation may go. Only the Beacon origin ever
 * renders inside the window, so no third-party page can reach the preload
 * bridge or the camera and microphone permission the window holds.
 */
export function classifyNavigation(
  target: string,
  appOrigin: string,
): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { kind: 'blocked' };
  }
  if (url.origin === appOrigin) {
    switch (url.pathname) {
      case '/api/auth/google':
        return {
          kind: 'google-sign-in',
          addPassword: url.searchParams.get('intent') === 'addPassword',
        };
      case '/api/auth/google/link':
        return {
          kind: 'google-in-browser',
          settingsPath: '/settings?section=account',
        };
      case '/api/drive/connect':
        return {
          kind: 'google-in-browser',
          settingsPath: '/settings?section=storage',
        };
      default:
        return { kind: 'app' };
    }
  }
  if (EXTERNAL_PROTOCOLS.has(url.protocol))
    return { kind: 'external', url: url.href };
  return { kind: 'blocked' };
}

export function isAppUrl(target: string, appOrigin: string): boolean {
  try {
    return new URL(target).origin === appOrigin;
  } catch {
    return false;
  }
}
