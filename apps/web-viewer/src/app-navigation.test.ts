import { describe, expect, it } from 'vitest';
import {
  contentWidthClass,
  deviceSettingsIdFromPath,
  legacyDeviceIdFromPath,
  pageFromPath,
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
    expect(contentWidthClass('settings')).toBe('');
  });
});
