import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSessions } from './BrowserSessions';

afterEach(() => vi.unstubAllGlobals());

describe('BrowserSessions', () => {
  it('revokes another browser without exposing device metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            sessions: [
              {
                createdAt: '2026-09-01T00:00:00Z',
                current: false,
                expiresAt: '2026-10-01T00:00:00Z',
                id: '00000000-0000-4000-8000-000000000001',
                lastSeenAt: '2026-09-06T00:00:00Z',
              },
            ],
          }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    render(<BrowserSessions onCurrentRevoked={vi.fn()} />);

    expect(await screen.findByText('Signed-in browser')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Revoke session' }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/account/sessions/00000000-0000-4000-8000-000000000001',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.queryByText('Signed-in browser')).not.toBeInTheDocument();
  });

  it('labels a session by its browser/OS and hides Revoke for the current one', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          sessions: [
            {
              createdAt: '2026-09-01T00:00:00Z',
              current: true,
              expiresAt: '2026-10-01T00:00:00Z',
              id: 'current-session',
              lastSeenAt: '2026-09-06T00:00:00Z',
              userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
            },
          ],
        }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<BrowserSessions onCurrentRevoked={vi.fn()} />);

    expect(
      await screen.findByText('Chrome on Windows (this session)'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Revoke' }),
    ).not.toBeInTheDocument();
  });
});
