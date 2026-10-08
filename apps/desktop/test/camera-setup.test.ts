import { describe, expect, it } from 'vitest';

import {
  cameraSetupPath,
  parseCameraSetupFile,
  parseCameraSetupLink,
  parseInstallerFileName,
  validResumePath,
} from '../src/camera-setup.js';

const origin = 'https://beacon.builtbysai.com';
const code = 'ABCDEFGHJK';

function file(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    code,
    origin,
    power: 'standby',
    type: 'beacon-camera-setup',
    version: 1,
    ...overrides,
  });
}

describe('camera setup links', () => {
  it('parses a setup link with its options', () => {
    expect(
      parseCameraSetupLink(
        `beaconsecureview://camera/setup?code=${code}&power=always&mic=1`,
      ),
    ).toEqual({ code, microphone: true, power: 'always' });
    expect(
      parseCameraSetupLink(`beaconsecureview://camera/setup?code=abcdefghjk`),
    ).toEqual({ code, microphone: false, power: 'standby' });
  });

  it('rejects other hosts, schemes, codes, and power values', () => {
    for (const link of [
      `beaconsecureview://auth/desktop?code=${code}`,
      `https://camera/setup?code=${code}`,
      'beaconsecureview://camera/setup?code=ABCDEFGHI1', // I and 1 are not in the alphabet
      'beaconsecureview://camera/setup?code=SHORT',
      `beaconsecureview://camera/setup?code=${code}&power=max`,
      'garbage',
    ])
      expect(parseCameraSetupLink(link), link).toBeNull();
  });
});

describe('camera setup files', () => {
  it('accepts a well-formed file for this origin', () => {
    expect(parseCameraSetupFile(file({ microphone: true }), origin)).toEqual({
      code,
      microphone: true,
      power: 'standby',
    });
  });

  it('refuses files for another origin or with unexpected content', () => {
    for (const text of [
      file({ origin: 'https://evil.example' }),
      file({ type: 'something-else' }),
      file({ version: 2 }),
      file({ code: 'nope' }),
      file({ microphone: 'yes' }),
      file({ power: 'max' }),
      'not json',
      'x'.repeat(5_000),
    ])
      expect(parseCameraSetupFile(text, origin)).toBeNull();
  });
});

describe('pre-configured installer names', () => {
  it('finds the setup token, including after browser duplicate suffixes', () => {
    expect(
      parseInstallerFileName(
        `Beacon-Setup-0.2.0-x64 beacon-camera-${code}-standby.exe`,
      ),
    ).toEqual({ code, microphone: false, power: 'standby' });
    expect(
      parseInstallerFileName(
        `Beacon-Setup-0.2.0-x64 beacon-camera-${code}-always-mic (1).exe`,
      ),
    ).toEqual({ code, microphone: true, power: 'always' });
  });

  it('ignores ordinary installers', () => {
    expect(parseInstallerFileName('Beacon-Setup-0.2.0-x64.exe')).toBeNull();
    expect(parseInstallerFileName('beacon-camera-ABCDEFGHI1.exe')).toBeNull();
  });

  it('routes every setup to the web pairing page', () => {
    expect(cameraSetupPath({ code, microphone: false, power: 'standby' })).toBe(
      `/camera-mode/setup?autostart=1&code=${code}&mic=0&power=standby`,
    );
  });
});

describe('camera resume paths', () => {
  it('accepts only Camera Mode paths with known options', () => {
    expect(
      validResumePath('/camera-mode/setup?autostart=1&mic=0&power=standby'),
    ).toBe('/camera-mode/setup?autostart=1&mic=0&power=standby');
    expect(validResumePath('/camera-mode?autostart=1')).toBe(
      '/camera-mode?autostart=1',
    );
  });

  it('refuses codes, other paths, and other origins', () => {
    for (const value of [
      `/camera-mode/setup?autostart=1&code=${code}`,
      '/settings?autostart=1',
      '/camera-mode',
      '//evil.example/camera-mode?autostart=1',
      'https://evil.example/camera-mode?autostart=1',
      '/camera-mode?autostart=1&power=max',
      42,
      null,
    ])
      expect(validResumePath(value), String(value)).toBeNull();
  });
});
