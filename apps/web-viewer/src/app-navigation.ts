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
  cameras: 'wide',
  'camera mode': 'medium',
  events: 'medium',
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

export function eventsUrl(): string {
  const url = new URL('/api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
