import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { AddDevicePage } from './AddDevicePage';

vi.mock('./api', () => ({ request: vi.fn() }));

const android = {
  arch: 'universal',
  bytes: 1,
  file: 'Beacon-android-0.1.0-alpha10.apk',
  kind: 'apk',
  platform: 'android',
  sha256: 'a',
};

function publish(files: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ files, publishedAt: '2026-10-12', version: '0.4.1' }),
      ok: true,
    }),
  );
}

beforeEach(() => publish([android]));
afterEach(() => {
  cleanup();
  vi.mocked(request).mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AddDevicePage', () => {
  it('asks which device first and shows nothing else until it is chosen', () => {
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={vi.fn()} />);
    expect(
      screen.getByRole('radiogroup', {
        name: 'Which device will be the camera?',
      }),
    ).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByText('Use this device as a camera')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('walks through an Android phone: install the app, then pair with a ready code', async () => {
    vi.mocked(request).mockResolvedValue({
      code: 'ABCD234567',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Phone or tablet/ }));

    expect(await screen.findByText('ABCD234567')).toBeVisible();
    expect(request).toHaveBeenCalledWith(
      '/api/pairing-codes',
      expect.objectContaining({ method: 'POST' }),
    );
    const download = await screen.findByRole('link', {
      name: /Download for Android/,
    });
    expect(download).toHaveAttribute(
      'href',
      '/downloads/Beacon-android-0.1.0-alpha10.apk',
    );
    expect(screen.getByText(/Set up this device as a camera/)).toBeVisible();
  });

  it('says so when the Android app is not published on this server', async () => {
    publish([]);
    vi.mocked(request).mockResolvedValue({ code: 'ZZZZ' });
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Phone or tablet/ }));
    expect(
      await screen.findByText(
        'The Android app isn’t published on this server yet.',
      ),
    ).toBeVisible();
  });

  it('gives an iPhone or iPad the Safari route and an honest note about keeping it awake', async () => {
    vi.mocked(request).mockResolvedValue({ code: 'IOSCODE123' });
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Phone or tablet/ }));
    fireEvent.click(
      await screen.findByRole('radio', { name: /iPhone or iPad/ }),
    );
    expect(await screen.findByText('IOSCODE123')).toBeVisible();
    expect(screen.getAllByText(/Safari/).length).toBeGreaterThan(0);
    expect(screen.getByText(/keep the device plugged in/)).toBeVisible();
    expect(
      screen.queryByRole('link', { name: /Download for Android/ }),
    ).toBeNull();
  });

  it('offers a new code once the first one has expired', async () => {
    vi.useFakeTimers();
    vi.mocked(request)
      .mockResolvedValueOnce({
        code: 'FIRSTCODE1',
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
      })
      .mockResolvedValueOnce({ code: 'SECONDCODE', expiresAt: undefined });
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Phone or tablet/ }));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByText('FIRSTCODE1')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByText('SECONDCODE')).toBeVisible();
  });

  it('starts the camera in this browser for "This device"', () => {
    const onUseBrowser = vi.fn();
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={onUseBrowser} />);
    fireEvent.click(screen.getByRole('radio', { name: /This device/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start the camera' }));
    expect(onUseBrowser).toHaveBeenCalled();
  });

  it('shows the computer setup inside the page', async () => {
    render(<AddDevicePage onBack={vi.fn()} onUseBrowser={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Computer/ }));
    expect(
      await screen.findByRole('button', { name: 'Create setup' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
