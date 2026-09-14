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
      providerEmail: null,
      updatedAt: null,
    });

    render(<GoogleDriveSettings />);

    expect(
      await screen.findByRole('link', { name: 'Connect Google Drive' }),
    ).toHaveAttribute('href', '/api/drive/connect');
    expect(
      screen.getByText(/camera media and recordings are not uploaded/i),
    ).toBeVisible();
  });

  it('can verify and disconnect an existing connection', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/drive/status')
        return Promise.resolve({
          connected: true,
          configured: true,
          providerEmail: 'drive@example.com',
          updatedAt: '2026-09-14T12:00:00.000Z',
        });
      if (path === '/api/drive/verify') return Promise.resolve(undefined);
      if (path === '/api/drive/connection' && options?.method === 'DELETE')
        return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    render(<GoogleDriveSettings />);
    expect(await screen.findByText(/Connected account:/)).toHaveTextContent(
      'drive@example.com',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verify connection' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/api/drive/verify', {
        method: 'POST',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Drive' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/api/drive/connection', {
        method: 'DELETE',
      }),
    );
  });
});
