import { describe, expect, it } from 'vitest';

import { canInstallQuietly, selfUpdating } from '../src/updates.js';

describe('automatic updates', () => {
  it('installs itself only where no signature or admin rights are needed', () => {
    expect(selfUpdating('win32', {})).toBe(true);
    expect(selfUpdating('linux', { APPIMAGE: '/home/a/Beacon.AppImage' })).toBe(
      true,
    );
    expect(selfUpdating('linux', {})).toBe(false);
    expect(selfUpdating('darwin', {})).toBe(false);
  });

  it('never restarts under someone watching or using the window', () => {
    expect(
      canInstallQuietly({ cameraActivity: 'off', windowVisible: false }),
    ).toBe(true);
    expect(
      canInstallQuietly({ cameraActivity: 'standby', windowVisible: false }),
    ).toBe(true);
    expect(
      canInstallQuietly({ cameraActivity: 'live', windowVisible: false }),
    ).toBe(false);
    expect(
      canInstallQuietly({ cameraActivity: 'off', windowVisible: true }),
    ).toBe(false);
  });
});
