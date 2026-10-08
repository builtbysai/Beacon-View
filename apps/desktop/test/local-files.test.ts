import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  linuxAutostartEntry,
  quoteExecArgument,
} from '../src/linux-autostart.js';
import { readPreferences, writePreferences } from '../src/preferences.js';

const temporaryDirectories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'beacon-desktop-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe('Linux autostart entry', () => {
  it('leaves plain paths unquoted', () => {
    expect(quoteExecArgument('/opt/Beacon/beacon')).toBe('/opt/Beacon/beacon');
    expect(quoteExecArgument('--background')).toBe('--background');
  });

  it('quotes and escapes per the Desktop Entry spec', () => {
    expect(quoteExecArgument('/home/sam/My Apps/Beacon.AppImage')).toBe(
      '"/home/sam/My Apps/Beacon.AppImage"',
    );
    // `"` -> `\"` (Exec quoting) -> `\\"` (string escaping).
    expect(quoteExecArgument('/a "b"')).toBe('"/a \\\\"b\\\\""');
    expect(quoteExecArgument('/a/$HOME')).toBe('"/a/\\\\$HOME"');
    expect(quoteExecArgument('/a/100%')).toBe('/a/100%%');
    expect(() => quoteExecArgument('/a\nExec=evil')).toThrow();
  });

  it('writes a minimal autostart entry that launches in the background', () => {
    const entry = linuxAutostartEntry('/opt/Beacon/beacon', ['--background']);
    expect(entry).toContain('[Desktop Entry]\nType=Application\n');
    expect(entry).toContain('\nExec=/opt/Beacon/beacon --background\n');
    expect(entry.endsWith('\n')).toBe(true);
  });
});

describe('desktop preferences', () => {
  it('defaults when the file is missing or malformed', () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, 'prefs.json');
    expect(readPreferences(file)).toEqual({
      cameraResumePath: null,
      relaunchHidden: false,
      trayHintShown: false,
    });
    writeFileSync(file, '{not json');
    expect(readPreferences(file)).toEqual({
      cameraResumePath: null,
      relaunchHidden: false,
      trayHintShown: false,
    });
    writeFileSync(file, JSON.stringify({ trayHintShown: 'yes' }));
    expect(readPreferences(file)).toEqual({
      cameraResumePath: null,
      relaunchHidden: false,
      trayHintShown: false,
    });
  });

  it('round-trips through an atomic write', () => {
    const file = path.join(temporaryDirectory(), 'nested', 'prefs.json');
    const saved = {
      cameraResumePath: '/camera-mode/setup?autostart=1&power=standby',
      relaunchHidden: false,
      trayHintShown: true,
    };
    writePreferences(file, saved);
    expect(readPreferences(file)).toEqual(saved);
  });

  it('drops a resume path that is not a Camera Mode path', () => {
    const file = path.join(temporaryDirectory(), 'prefs.json');
    writeFileSync(
      file,
      JSON.stringify({
        cameraResumePath: '//evil.example/x',
        relaunchHidden: false,
        trayHintShown: true,
      }),
    );
    expect(readPreferences(file)).toEqual({
      cameraResumePath: null,
      relaunchHidden: false,
      trayHintShown: true,
    });
  });
});

describe('offline page', () => {
  it('allows exactly its own inline script through the CSP hash', () => {
    const html = readFileSync(
      path.join(import.meta.dirname, '..', 'static', 'offline.html'),
      'utf8',
    );
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const hash = createHash('sha256').update(scripts[0]![1]!).digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toContain("default-src 'none'");
  });
});
