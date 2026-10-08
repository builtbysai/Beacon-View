import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { GoogleDriveSettings } from './GoogleDriveSettings';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('GoogleDriveSettings', () => {
  it('offers a least-scope connection when the server enables Drive', async () => {
    vi.mocked(request).mockResolvedValue({
      connected: false,
      configured: true,
      recordingsConnected: false,
      providerEmail: null,
      updatedAt: null,
    });

    render(<GoogleDriveSettings />);

    expect(
      await screen.findByRole('link', { name: 'Connect' }),
    ).toHaveAttribute('href', '/api/drive/connect?purpose=recordings');
    expect(screen.getByText('Not connected')).toBeVisible();
  });

  it('does not offer a dead OAuth link when Drive is unconfigured', async () => {
    vi.mocked(request).mockResolvedValue({
      connected: false,
      configured: false,
      recordingsConnected: false,
      providerEmail: null,
      updatedAt: null,
    });

    render(<GoogleDriveSettings />);

    expect(await screen.findByText('Unavailable')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/not configured on this Beacon server/),
    ).toBeVisible();
  });

  it('retries a failed Drive status request', async () => {
    vi.mocked(request)
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce({
        connected: false,
        configured: true,
        recordingsConnected: false,
        providerEmail: null,
        updatedAt: null,
      });

    render(<GoogleDriveSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Temporarily unavailable',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Connect' })).toBeVisible();
  });

  it('surfaces an OAuth callback result and cleans it from the URL', async () => {
    window.history.replaceState(
      {},
      '',
      '/settings?section=storage&drive=failed',
    );
    vi.mocked(request).mockResolvedValue({
      connected: false,
      configured: true,
      recordingsConnected: false,
      providerEmail: null,
      updatedAt: null,
    });

    render(<GoogleDriveSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Google Drive couldn’t be connected',
    );
    expect(window.location.search).toBe('?section=storage');
  });

  it('offers to upgrade an appdata-only connection to cloud recording', async () => {
    vi.mocked(request).mockResolvedValue({
      connected: true,
      configured: true,
      recordingsConnected: false,
      providerEmail: 'drive@example.com',
      updatedAt: '2026-09-14T12:00:00.000Z',
    });

    render(<GoogleDriveSettings />);

    expect(
      await screen.findByRole('link', { name: 'Turn on' }),
    ).toHaveAttribute('href', '/api/drive/connect?purpose=recordings');
    expect(screen.getByText('Cloud recording')).toBeVisible();
  });

  it('can verify and disconnect an existing connection', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/drive/status')
        return Promise.resolve({
          connected: true,
          configured: true,
          recordingsConnected: true,
          providerEmail: 'drive@example.com',
          updatedAt: '2026-09-14T12:00:00.000Z',
        });
      if (path === '/api/drive/verify') return Promise.resolve(undefined);
      if (path === '/api/drive/connection' && options?.method === 'DELETE')
        return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<GoogleDriveSettings />);
    expect(await screen.findByText(/Connected as/)).toHaveTextContent(
      'drive@example.com',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/api/drive/verify', {
        method: 'POST',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/api/drive/connection', {
        method: 'DELETE',
      }),
    );
  });
});
