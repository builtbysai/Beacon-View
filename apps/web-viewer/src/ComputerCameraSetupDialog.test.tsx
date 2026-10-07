import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { ComputerCameraSetupDialog } from './ComputerCameraSetupDialog';
import { takePendingUseCase } from './pending-use-case';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(request).mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function manifest(files: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ files, publishedAt: '2026-10-07', version: '0.2.0' }),
      ok: true,
    }),
  );
}

describe('ComputerCameraSetupDialog', () => {
  it('creates a one-time setup and offers every way to use it', async () => {
    manifest([
      {
        arch: 'x64',
        bytes: 1,
        file: 'Beacon-Setup-0.2.0-x64.exe',
        kind: 'installer',
        platform: 'windows',
        sha256: 'a',
      },
      {
        arch: 'arm64',
        bytes: 1,
        file: 'Beacon-0.2.0-arm64.dmg',
        kind: 'dmg',
        platform: 'macos',
        sha256: 'b',
      },
    ]);
    vi.mocked(request).mockResolvedValue({
      code: 'ABCDEFGHJK',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      id: 'pairing-1',
    });
    render(<ComputerCameraSetupDialog onDismiss={() => undefined} />);

    fireEvent.click(screen.getByRole('radio', { name: /Baby monitor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create setup' }));

    expect(
      await screen.findByLabelText('Pairing code ABCDEFGHJK'),
    ).toBeVisible();
    expect(screen.getByText(/Expires in (10:00|9:5\d)/)).toBeVisible();
    // Baby monitor: camera always on, with sound.
    const installer = await screen.findByRole('link', {
      name: /Download for Windows/,
    });
    expect(installer).toHaveAttribute(
      'download',
      'Beacon-Setup-0.2.0-x64 beacon-camera-ABCDEFGHJK-always-mic.exe',
    );
    expect(installer).toHaveAttribute(
      'href',
      '/downloads/Beacon-Setup-0.2.0-x64.exe',
    );
    expect(
      screen.getByRole('link', { name: 'Open in Beacon' }),
    ).toHaveAttribute(
      'href',
      'beaconsecureview://camera/setup?code=ABCDEFGHJK&mic=1&power=always',
    );
    expect(screen.getByRole('link', { name: 'a Mac' })).toHaveAttribute(
      'href',
      '/downloads/Beacon-0.2.0-arm64.dmg',
    );
    expect(
      screen
        .getByRole('link', { name: 'Use this browser' })
        .getAttribute('href'),
    ).toContain(
      '/camera-mode/setup?autostart=1&code=ABCDEFGHJK&mic=1&power=always',
    );
    expect(takePendingUseCase()).toBe('baby');
  });

  it('says plainly when no Windows build is published', async () => {
    manifest([]);
    vi.mocked(request).mockResolvedValue({
      code: 'ABCDEFGHJK',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      id: 'pairing-1',
    });
    render(<ComputerCameraSetupDialog onDismiss={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create setup' }));
    expect(
      await screen.findByText(/Windows app isn’t published on this server yet/),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open in Beacon' })).toBeVisible();
  });

  it('offers a fresh setup once the code expires', async () => {
    manifest([]);
    vi.mocked(request).mockResolvedValue({
      code: 'ABCDEFGHJK',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      id: 'pairing-1',
    });
    render(<ComputerCameraSetupDialog onDismiss={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create setup' }));
    expect(
      await screen.findByRole('button', { name: 'Create a new setup' }),
    ).toBeVisible();
  });
});

describe('pending use case', () => {
  it('is taken once and expires with its pairing code', () => {
    localStorage.setItem(
      'beacon.pending-camera-use-case.v1',
      JSON.stringify({
        expiresAt: new Date(Date.now() - 1).toISOString(),
        useCase: 'security',
      }),
    );
    expect(takePendingUseCase()).toBeNull();
    localStorage.setItem(
      'beacon.pending-camera-use-case.v1',
      JSON.stringify({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        useCase: 'doorbell',
      }),
    );
    expect(takePendingUseCase()).toBe('doorbell');
    expect(takePendingUseCase()).toBeNull();
  });
});
