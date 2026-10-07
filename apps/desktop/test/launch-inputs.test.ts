import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findLaunchInput,
  PENDING_INSTALLER_SETUP,
  takePendingInstallerSetup,
} from '../src/launch-inputs.js';

const origin = 'https://beacon.builtbysai.com';
const code = 'ABCDEFGHJK';
const directories: string[] = [];
function directory(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'beacon-launch-'));
  directories.push(created);
  return created;
}
afterEach(() => {
  for (const created of directories.splice(0))
    rmSync(created, { force: true, recursive: true });
});

describe('launch inputs', () => {
  it('recognizes sign-in links, setup links, and setup files', () => {
    expect(
      findLaunchInput(
        [
          'Beacon.exe',
          `beaconsecureview://auth/desktop?code=${'a'.repeat(43)}`,
        ],
        origin,
      )?.kind,
    ).toBe('auth');
    expect(
      findLaunchInput(
        ['Beacon.exe', `beaconsecureview://camera/setup?code=${code}`],
        origin,
      ),
    ).toEqual({
      kind: 'camera-setup',
      request: { code, microphone: false, power: 'standby' },
    });
    const file = path.join(directory(), 'Living room.beaconcamera');
    writeFileSync(
      file,
      JSON.stringify({
        code,
        origin,
        power: 'always',
        type: 'beacon-camera-setup',
        version: 1,
      }),
    );
    expect(findLaunchInput(['Beacon.exe', file], origin)).toEqual({
      kind: 'camera-setup',
      request: { code, microphone: false, power: 'always' },
    });
  });

  it('ignores the executable path and unrelated arguments', () => {
    expect(
      findLaunchInput(
        ['C:\\x\\beacon-camera-ABCDEFGHJK.exe', '--background'],
        origin,
      ),
    ).toBeNull();
    expect(
      findLaunchInput(
        ['Beacon.exe', path.join(directory(), 'missing.beaconcamera')],
        origin,
      ),
    ).toBeNull();
  });
});

describe('pending installer setup', () => {
  it('reads a pre-configured installer name once', () => {
    const userData = directory();
    writeFileSync(
      path.join(userData, PENDING_INSTALLER_SETUP),
      `Beacon-Setup-0.2.0-x64 beacon-camera-${code}-standby.exe\r\n`,
    );
    expect(takePendingInstallerSetup(userData)).toEqual({
      code,
      microphone: false,
      power: 'standby',
    });
    expect(existsSync(path.join(userData, PENDING_INSTALLER_SETUP))).toBe(
      false,
    );
    expect(takePendingInstallerSetup(userData)).toBeNull();
  });

  it('discards ordinary installs and stale records', () => {
    const userData = directory();
    const file = path.join(userData, PENDING_INSTALLER_SETUP);
    writeFileSync(file, 'Beacon-Setup-0.2.0-x64.exe');
    expect(takePendingInstallerSetup(userData)).toBeNull();
    writeFileSync(file, `Beacon-Setup beacon-camera-${code}.exe`);
    const hourAgo = (Date.now() - 60 * 60 * 1_000) / 1_000;
    utimesSync(file, hourAgo, hourAgo);
    expect(takePendingInstallerSetup(userData)).toBeNull();
    expect(existsSync(file)).toBe(false);
  });
});
