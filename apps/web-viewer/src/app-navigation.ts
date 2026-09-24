import type { IconName } from './Icon';

// Devices is no longer a user-facing destination: a camera-owning phone,
// tablet, or computer is presented as one Camera, managed from Cameras.
export type Page =
  | 'dashboard'
  | 'cameras'
  | 'camera mode'
  | 'settings'
  | 'diagnostics'
  | 'events'
  | 'trust'
  | 'contact'
  | 'account deletion';

export const pagePaths: Record<Page, string> = {
  'camera mode': '/camera-mode',
  cameras: '/cameras',
  dashboard: '/',
  diagnostics: '/diagnostics',
  events: '/events',
  settings: '/settings',
  trust: '/trust',
  contact: '/contact',
  'account deletion': '/account-deletion',
};

export const pageLabels: Record<Page, string> = {
  dashboard: 'Home',
  cameras: 'Cameras',
  events: 'Activity',
  'camera mode': 'Add camera',
  settings: 'Settings',
  trust: 'Trust and privacy',
  contact: 'Contact Beacon',
  'account deletion': 'Account deletion',
  diagnostics: 'Connection details',
};

export const navigationIcons: Record<string, IconName> = {
  dashboard: 'home',
  cameras: 'camera',
  events: 'activity',
  settings: 'settings',
};

export const pagesWithAddCamera: ReadonlySet<Page> = new Set([
  'dashboard',
  'cameras',
]);

const pageContentWidth: Partial<Record<Page, 'medium' | 'wide'>> = {
  dashboard: 'wide',
  cameras: 'wide',
  events: 'wide',
  settings: 'wide',
  'camera mode': 'medium',
};

export function contentWidthClass(page: Page): string {
  const width = pageContentWidth[page];
  return width ? `workspace-${width}` : '';
}

export function legacyDeviceIdFromPath(
  pathname = window.location.pathname,
): string | null {
  const match = pathname.match(/^\/devices\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function deviceSettingsIdFromPath(
  pathname = window.location.pathname,
): string | null {
  const legacy = legacyDeviceIdFromPath(pathname);
  if (legacy) return legacy;
  const match = pathname.match(/^\/cameras\/([^/]+)\/settings$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function pageFromPath(pathname = window.location.pathname): Page {
  if (pathname === '/camera-mode/setup') return 'camera mode';
  if (pathname.startsWith('/devices/') || pathname.startsWith('/cameras/')) {
    return 'cameras';
  }
  return (
    (Object.entries(pagePaths).find(([, path]) => path === pathname)?.[0] as
      Page | undefined) ?? 'dashboard'
  );
}

export function pairingLink(code: string): string {
  const url = new URL('/pair', window.location.origin);
  url.searchParams.set('code', code);
  return url.toString();
}

export function browserCameraSetupLink(code: string): string {
  const url = new URL('/camera-mode/setup', window.location.origin);
  url.searchParams.set('code', code);
  return url.toString();
}

/** Only accept a pairing code or a Beacon setup URL from this origin. */
export function pairingCodeFromScan(value: string): string | null {
  const trimmed = value.trim();
  const code = /^[A-HJ-NP-Z2-9]{10}$/i.test(trimmed)
    ? trimmed
    : (() => {
        try {
          const url = new URL(trimmed);
          if (
            url.origin !== window.location.origin ||
            !['/pair', '/camera-mode/setup'].includes(url.pathname)
          )
            return null;
          return url.searchParams.get('code');
        } catch {
          return null;
        }
      })();
  return code && /^[A-HJ-NP-Z2-9]{10}$/i.test(code) ? code.toUpperCase() : null;
}

export function eventsUrl(): string {
  const url = new URL('/api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
