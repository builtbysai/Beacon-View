import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SetupHealthCheck } from './SetupHealthCheck';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps a failed recording check unknown while reporting available connections, without starting capture', async () => {
  const fetch = vi
    .fn<(path: string, options?: RequestInit) => Promise<Response>>()
    .mockImplementation((path) => {
      if (path === '/api/drive/status')
        return Promise.resolve(new Response('{}', { status: 503 }));
      return Promise.resolve(
        new Response(
          JSON.stringify(
            path === '/api/diagnostics'
              ? { cameras: [{ availability: 'online' }], devices: [] }
              : { preferences: [{ motionEnabled: true }] },
          ),
          { status: 200 },
        ),
      );
    });
  const getUserMedia = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  render(<SetupHealthCheck />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check setup' }));
  expect(
    await screen.findByText(/Recording connection: could not be checked/),
  ).toBeVisible();
  expect(screen.getByText(/1 of 1 cameras online/)).toBeVisible();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(
    fetch.mock.calls.every(
      (call) => !call[1]?.method || call[1].method === 'GET',
    ),
  ).toBe(true);
});

it('cancels status requests when the household-scoped page unmounts', async () => {
  const fetch = vi
    .fn<(path: string, options?: RequestInit) => Promise<Response>>()
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const view = render(<SetupHealthCheck />);
  fireEvent.click(screen.getByRole('button', { name: 'Check setup' }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  view.unmount();
  expect(fetch.mock.calls.every((call) => call[1]?.signal?.aborted)).toBe(true);
});
