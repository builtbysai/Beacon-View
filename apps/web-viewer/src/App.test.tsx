import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class TestSocket {
  static instance: TestSocket | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor() {
    TestSocket.instance = this;
  }

  close() {}

  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

describe('App', () => {
  it('shows the authentication form when no session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: 'Authentication required' }),
        ok: false,
      }),
    );
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible(),
    );
    expect(
      screen.getByRole('heading', { name: 'Beacon SecureView' }),
    ).toBeInTheDocument();
  });

  it('shows the empty camera state for an authenticated household', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              user: { email: 'owner@example.com', id: '1' },
            }),
          ok: true,
          status: 200,
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ cameras: [] }),
          ok: true,
          status: 200,
        }),
    );
    render(<App />);

    expect(
      await screen.findByText('No cameras are paired with this household.'),
    ).toBeVisible();
  });

  it('completes pairing, closes the wizard, and highlights the new camera', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({ user: { email: 'owner@example.com', id: '1' } }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ cameras: [] }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ code: 'ABCD2345' }),
        ok: true,
        status: 201,
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            cameras: [
              {
                credentialRevoked: false,
                id: 'camera-public-id',
                lastSeenAt: new Date().toISOString(),
                name: 'Android Camera',
                online: true,
              },
            ],
          }),
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', fetch);
    render(<App />);

    await screen.findByText('No cameras are paired with this household.');
    fireEvent.click(screen.getByRole('button', { name: 'Pair device' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Create pairing code' }),
    );
    expect(await screen.findByText('ABCD2345')).toBeVisible();
    vi.useFakeTimers();
    await act(async () => {
      TestSocket.instance?.emit({
        cameraId: 'camera-public-id',
        pairingState: 'completed',
        type: 'camera-paired',
      });
      await Promise.resolve();
    });
    expect(screen.getByText('Camera connected')).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(screen.getByText('Android Camera')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
