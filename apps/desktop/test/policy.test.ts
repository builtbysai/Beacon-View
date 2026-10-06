import { describe, expect, it } from 'vitest';

import { PRODUCTION_ORIGIN, resolveAppOrigin } from '../src/config.js';
import { classifyNavigation, isAppUrl } from '../src/navigation-policy.js';
import { isPermissionGranted } from '../src/permissions.js';

const origin = PRODUCTION_ORIGIN;

describe('app origin', () => {
  it('always uses production in packaged builds, even with an override', () => {
    expect(resolveAppOrigin(true, 'http://127.0.0.1:5173')).toBe(origin);
    expect(resolveAppOrigin(false, undefined)).toBe(origin);
  });

  it('accepts HTTPS or private-network HTTP origins in development', () => {
    expect(resolveAppOrigin(false, 'http://127.0.0.1:5173')).toBe(
      'http://127.0.0.1:5173',
    );
    expect(resolveAppOrigin(false, 'http://localhost:5181/')).toBe(
      'http://localhost:5181',
    );
    expect(resolveAppOrigin(false, 'http://192.168.1.20:5173')).toBe(
      'http://192.168.1.20:5173',
    );
    expect(resolveAppOrigin(false, 'https://staging.example.com')).toBe(
      'https://staging.example.com',
    );
  });

  it('refuses public HTTP, paths, credentials, and junk', () => {
    for (const value of [
      'http://example.com',
      'http://172.32.0.1:5173',
      'https://example.com/app',
      'https://user:pass@example.com',
      'file:///C:/beacon',
      'not a url',
    ])
      expect(() => resolveAppOrigin(false, value), value).toThrow();
  });
});

describe('navigation policy', () => {
  it('keeps Beacon pages in the window', () => {
    for (const path of [
      '/',
      '/settings?section=account',
      '/live/abc',
      '/api/auth/google/callback',
    ])
      expect(classifyNavigation(`${origin}${path}`, origin)).toEqual({
        kind: 'app',
      });
  });

  it('moves Google sign-in to the system browser', () => {
    expect(classifyNavigation(`${origin}/api/auth/google`, origin)).toEqual({
      addPassword: false,
      kind: 'google-sign-in',
    });
    expect(
      classifyNavigation(
        `${origin}/api/auth/google?intent=addPassword`,
        origin,
      ),
    ).toEqual({ addPassword: true, kind: 'google-sign-in' });
  });

  it('sends Google linking and Drive connection to Beacon in the browser', () => {
    expect(
      classifyNavigation(`${origin}/api/auth/google/link`, origin),
    ).toEqual({
      kind: 'google-in-browser',
      settingsPath: '/settings?section=account',
    });
    expect(
      classifyNavigation(
        `${origin}/api/drive/connect?purpose=recordings`,
        origin,
      ),
    ).toEqual({
      kind: 'google-in-browser',
      settingsPath: '/settings?section=storage',
    });
  });

  it('opens other sites externally and blocks everything else', () => {
    expect(
      classifyNavigation('https://accounts.google.com/o/oauth2/auth', origin),
    ).toEqual({
      kind: 'external',
      url: 'https://accounts.google.com/o/oauth2/auth',
    });
    expect(classifyNavigation('mailto:help@example.com', origin).kind).toBe(
      'external',
    );
    // Lookalike hosts and other schemes never count as Beacon.
    for (const target of [
      'https://beacon.builtbysai.com.evil.example/',
      'http://beacon.builtbysai.com/',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'beaconsecureview://auth/desktop?code=x',
      'not a url',
    ])
      expect(['external', 'blocked'], target).toContain(
        classifyNavigation(target, origin).kind,
      );
    expect(classifyNavigation('file:///etc/passwd', origin).kind).toBe(
      'blocked',
    );
    expect(classifyNavigation('javascript:alert(1)', origin).kind).toBe(
      'blocked',
    );
    expect(
      isAppUrl('https://beacon.builtbysai.com.evil.example/', origin),
    ).toBe(false);
  });
});

describe('web permissions', () => {
  it('grants camera, microphone, clipboard write, and fullscreen to Beacon only', () => {
    expect(
      isPermissionGranted('media', `${origin}/`, origin, ['video', 'audio']),
    ).toBe(true);
    expect(
      isPermissionGranted('clipboard-sanitized-write', `${origin}/x`, origin),
    ).toBe(true);
    expect(isPermissionGranted('fullscreen', `${origin}/live`, origin)).toBe(
      true,
    );
    expect(
      isPermissionGranted('media', 'https://evil.example/', origin, ['video']),
    ).toBe(false);
  });

  it('denies everything else', () => {
    for (const permission of [
      'notifications',
      'geolocation',
      'display-capture',
      'clipboard-read',
      'midiSysex',
      'openExternal',
      'unknown',
    ])
      expect(
        isPermissionGranted(permission, `${origin}/`, origin),
        permission,
      ).toBe(false);
    expect(isPermissionGranted('media', `${origin}/`, origin, ['screen'])).toBe(
      false,
    );
    expect(isPermissionGranted('media', 'garbage', origin)).toBe(false);
  });
});
