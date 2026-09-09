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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BrowserSessions onCurrentRevoked={vi.fn()} />);

    expect(await screen.findByText('Signed-in browser')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/account/sessions/00000000-0000-4000-8000-000000000001',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.queryByText('Signed-in browser')).not.toBeInTheDocument();
  });
});
