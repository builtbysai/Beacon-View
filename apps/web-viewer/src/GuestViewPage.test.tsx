import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { GuestViewPage } from './GuestViewPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

it('offers a retry for a temporary guest-link network error', async () => {
  window.history.replaceState(null, '', '/g/guest-token');
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Network unavailable'))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ cameras: [] }), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetch);
  render(<GuestViewPage />);
  expect(await screen.findByText('Couldn’t connect right now.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Nothing to show right now.')).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('reports a revoked guest link as unavailable', async () => {
  window.history.replaceState(null, '', '/g/guest-token');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'This link is not valid' }), {
        status: 404,
      }),
    ),
  );
  render(<GuestViewPage />);
  expect(
    await screen.findByText('This link is no longer available.'),
  ).toBeVisible();
});
