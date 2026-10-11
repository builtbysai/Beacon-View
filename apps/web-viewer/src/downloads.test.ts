import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cameraSetupFile,
  cameraSetupLink,
  detectPlatform,
  type DownloadFile,
  loadDownloads,
  preconfiguredInstallerName,
  primaryDownload,
} from './downloads';

const windows: DownloadFile = {
  arch: 'x64',
  bytes: 111_000_000,
  file: 'Beacon-Setup-0.2.0-x64.exe',
  kind: 'installer',
  platform: 'windows',
  sha256: 'abc',
};

afterEach(() => vi.unstubAllGlobals());

describe('downloads', () => {
  it('detects the visitor platform, including iPads that claim to be Macs', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(
      'windows',
    );
    expect(
      detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0),
    ).toBe('macos');
    expect(
      detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5),
    ).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5)).toBe(
      'android',
    );
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)', 0)).toBe('linux');
  });

  it('loads only well-formed manifest entries and tolerates a missing manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            files: [windows, { ...windows, file: '../../etc/passwd' }],
            publishedAt: '2026-10-07',
            version: '0.2.0',
          }),
        ok: true,
      }),
    );
    expect((await loadDownloads())?.files).toEqual([windows]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await loadDownloads()).toBeNull();
  });

  it('accepts the Android app as a published download', async () => {
    const android: DownloadFile = {
      arch: 'universal',
      bytes: 67_000_000,
      file: 'Beacon-android-0.1.0-alpha9.apk',
      kind: 'apk',
      platform: 'android',
      sha256: 'def',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            files: [windows, android],
            publishedAt: '2026-10-11',
            version: '0.4.1',
          }),
        ok: true,
      }),
    );
    expect((await loadDownloads())?.files).toEqual([windows, android]);
  });

  it('prefers the x64 installer for the platform', () => {
    const manifest = {
      files: [{ ...windows, arch: 'arm64' as const }, windows],
      publishedAt: '',
      version: '0.2.0',
    };
    expect(primaryDownload(manifest, 'windows')).toEqual(windows);
    expect(primaryDownload(manifest, 'macos')).toBeNull();
  });

  it('builds every one-click setup form from the same pairing code', async () => {
    const setup = {
      code: 'ABCDEFGHJK',
      microphone: true,
      power: 'standby' as const,
    };
    expect(preconfiguredInstallerName(windows, setup)).toBe(
      'Beacon-Setup-0.2.0-x64 beacon-camera-ABCDEFGHJK-standby-mic.exe',
    );
    expect(cameraSetupLink(setup)).toBe(
      'beaconsecureview://camera/setup?code=ABCDEFGHJK&mic=1&power=standby',
    );
    expect(
      JSON.parse(await cameraSetupFile(setup, 'https://beacon.example').text()),
    ).toEqual({
      code: 'ABCDEFGHJK',
      microphone: true,
      origin: 'https://beacon.example',
      power: 'standby',
      type: 'beacon-camera-setup',
      version: 1,
    });
  });
});
