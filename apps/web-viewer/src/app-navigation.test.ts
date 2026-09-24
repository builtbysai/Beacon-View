import { describe, expect, it } from 'vitest';
import {
  browserCameraSetupLink,
  contentWidthClass,
  deviceSettingsIdFromPath,
  legacyDeviceIdFromPath,
  pageFromPath,
  pairingCodeFromScan,
} from './app-navigation';

describe('application navigation', () => {
  it('maps known routes and falls back to the dashboard', () => {
    expect(pageFromPath('/settings')).toBe('settings');
    expect(pageFromPath('/cameras/device-1/settings')).toBe('cameras');
    expect(pageFromPath('/not-a-route')).toBe('dashboard');
  });

  it('keeps legacy device bookmarks compatible with camera settings', () => {
    expect(legacyDeviceIdFromPath('/devices/front%20door')).toBe('front door');
    expect(deviceSettingsIdFromPath('/devices/front%20door')).toBe(
      'front door',
    );
    expect(deviceSettingsIdFromPath('/cameras/front%20door/settings')).toBe(
      'front door',
    );
    expect(deviceSettingsIdFromPath('/cameras')).toBeNull();
  });

  it('keeps page width policy in the navigation module', () => {
    expect(contentWidthClass('cameras')).toBe('workspace-wide');
    expect(contentWidthClass('settings')).toBe('workspace-wide');
  });

  it('accepts only a code or same-origin Beacon pairing QR', () => {
    const code = 'ABCDEFGH23';
    expect(pairingCodeFromScan(code.toLowerCase())).toBe(code);
    const setup = browserCameraSetupLink(code);
    expect(new URL(setup).pathname).toBe('/camera-mode/setup');
    expect(pairingCodeFromScan(setup)).toBe(code);
    expect(
      pairingCodeFromScan(
        new URL(`/pair?code=${code}`, window.location.origin).toString(),
      ),
    ).toBe(code);
    expect(
      pairingCodeFromScan(`https://evil.example/pair?code=${code}`),
    ).toBeNull();
    expect(
      pairingCodeFromScan(
        new URL(`/g/${code}`, window.location.origin).toString(),
      ),
    ).toBeNull();
    expect(pairingCodeFromScan('javascript:alert(1)')).toBeNull();
  });
});
