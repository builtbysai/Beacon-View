import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

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
});
