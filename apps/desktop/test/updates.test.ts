import { describe, expect, it } from 'vitest';

import {
  canInstallQuietly,
  initialUpdateStatus,
  nextUpdateStatus,
  selfUpdating,
} from '../src/updates.js';

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

describe('update status shown in Settings', () => {
  const start = initialUpdateStatus('0.4.1', true);

  it('walks from checking to a ready download', () => {
    let status = nextUpdateStatus(start, { type: 'checking' });
    expect(status.state).toBe('checking');
    status = nextUpdateStatus(status, { type: 'found', version: '0.5.0' });
    expect(status).toMatchObject({ state: 'downloading', version: '0.5.0' });
    status = nextUpdateStatus(status, { percent: 41.6, type: 'progress' });
    expect(status).toMatchObject({ percent: 42, state: 'downloading' });
    status = nextUpdateStatus(status, { type: 'downloaded', version: '0.5.0' });
    expect(status).toMatchObject({ state: 'ready', version: '0.5.0' });
    expect(status.percent).toBeUndefined();
  });

  it('keeps a downloaded update ready through later checks and failures', () => {
    const ready = nextUpdateStatus(start, {
      type: 'downloaded',
      version: '0.5.0',
    });
    expect(nextUpdateStatus(ready, { at: 1, type: 'none' })).toBe(ready);
    expect(nextUpdateStatus(ready, { type: 'error' })).toBe(ready);
    expect(nextUpdateStatus(ready, { type: 'checking' })).toBe(ready);
  });

  it('offers a download to run when this install cannot replace itself', () => {
    const manual = nextUpdateStatus(initialUpdateStatus('0.4.1', false), {
      type: 'found',
      version: '0.5.0',
    });
    expect(manual).toMatchObject({ state: 'manual', version: '0.5.0' });
  });

  it('remembers when the last check finished and reports a failed one', () => {
    const idle = nextUpdateStatus(start, {
      at: 1_700_000_000_000,
      type: 'none',
    });
    expect(idle).toMatchObject({ checkedAt: 1_700_000_000_000, state: 'idle' });
    expect(nextUpdateStatus(idle, { type: 'error' }).state).toBe('error');
  });
});
