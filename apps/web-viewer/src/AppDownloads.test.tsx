import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AppDownloads } from './AppDownloads';

const files = [
  ['windows', 'installer', 'Beacon-Setup-0.4.1-x64.exe', 'x64'],
  ['android', 'apk', 'Beacon-android-0.1.0-alpha10.apk', 'universal'],
].map(([platform, kind, file, arch]) => ({
  arch,
  bytes: 111_000_000,
  file,
  kind,
  platform,
  sha256: 'b'.repeat(64),
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ files, publishedAt: '2026-10-12', version: '0.4.1' }),
      ok: true,
    }),
  );
  vi.stubGlobal('navigator', {
    ...navigator,
    maxTouchPoints: 0,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('leads with the download for this device and lists the other ways', async () => {
  render(<AppDownloads variant="landing" onOpenWeb={vi.fn()} />);
  const primary = await screen.findByRole('link', {
    name: 'Download for Windows',
  });
  expect(primary).toHaveAttribute(
    'href',
    '/downloads/Beacon-Setup-0.4.1-x64.exe',
  );
  expect(
    screen.getByText(/Version 0\.4\.1 · installer · 111 MB/),
  ).toBeVisible();
  expect(screen.getByText('Verify this download')).toBeVisible();
  const android = screen.getByRole('link', { name: 'Download' });
  expect(android).toHaveAttribute(
    'href',
    '/downloads/Beacon-android-0.1.0-alpha10.apk',
  );
  expect(screen.getByText('iPhone & iPad')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open' })).toBeVisible();
});

it('inside the app there is no "any browser" row, because you are already in one', async () => {
  render(<AppDownloads variant="app" />);
  await screen.findByRole('link', { name: 'Download for Windows' });
  expect(screen.queryByText('Any browser')).toBeNull();
});
