import { describe, expect, it } from 'vitest';

import {
  appOptions,
  fileVersion,
  formatSize,
  splitForVisitor,
} from './app-downloads';
import type { DownloadFile, DownloadsManifest } from './downloads';

function file(
  platform: DownloadFile['platform'],
  kind: DownloadFile['kind'],
  name: string,
  arch: DownloadFile['arch'] = 'x64',
): DownloadFile {
  return {
    arch,
    bytes: 110_000_000,
    file: name,
    kind,
    platform,
    sha256: 'a'.repeat(64),
  };
}

const manifest: DownloadsManifest = {
  files: [
    file('windows', 'installer', 'Beacon-Setup-0.4.1-x64.exe'),
    file('linux', 'appimage', 'Beacon-0.4.1-x86_64.AppImage'),
    file('linux', 'deb', 'Beacon-0.4.1-amd64.deb'),
    file('android', 'apk', 'Beacon-android-0.1.0-alpha10.apk', 'universal'),
  ],
  publishedAt: '2026-10-12',
  version: '0.4.1',
};

describe('app downloads', () => {
  it('offers a download only for what is published, with the right version', () => {
    const options = appOptions(manifest);
    const byId = Object.fromEntries(
      options.map((option) => [option.id, option]),
    );
    expect(byId.windows?.file?.file).toBe('Beacon-Setup-0.4.1-x64.exe');
    expect(byId.windows?.version).toBe('0.4.1');
    expect(byId.android?.version).toBe('0.1.0-alpha10');
    expect(byId.linux?.alternate?.kind).toBe('deb');
    // Nothing for the Mac was published: it says so instead of offering a dead button.
    expect(byId.macos?.file).toBeUndefined();
    expect(byId.macos?.note).toMatch(/Not published/);
    expect(byId.ios?.steps).toHaveLength(3);
  });

  it('puts the visitor’s own device first and everything else after it', () => {
    const options = appOptions(manifest);
    expect(splitForVisitor(options, 'windows').primary.id).toBe('windows');
    expect(splitForVisitor(options, 'ios').primary.id).toBe('ios');
    const other = splitForVisitor(options, 'other');
    expect(other.primary.id).toBe('browser');
    expect(other.others).toHaveLength(options.length - 1);
  });

  it('works before the manifest has loaded', () => {
    expect(appOptions(null).every((option) => !option.file)).toBe(true);
  });

  it('reads the Android version from its file name and formats sizes', () => {
    expect(fileVersion(manifest.files[3]!, manifest)).toBe('0.1.0-alpha10');
    expect(formatSize(111_400_000)).toBe('111 MB');
    expect(formatSize(1_500_000_000)).toBe('1.5 GB');
  });
});
