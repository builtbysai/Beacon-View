import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { HouseholdSharingSettings } from './HouseholdSharingSettings';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const camera = {
  credentialRevoked: false,
  deviceId: 'device-id',
  deviceName: 'Hallway phone',
  enabled: true,
  facing: 'rear',
  id: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
  lastSeenAt: null,
  name: 'Rear camera',
  online: true,
  platform: 'android' as const,
  streaming: false,
  viewerCount: 0,
};

describe('HouseholdSharingSettings', () => {
  it('creates an email-bound invitation and reveals its code once', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({ invitations: [], members: [] });
      if (path === '/api/household/invitations' && options?.method === 'POST')
        return Promise.resolve({
          expiresAt: '2026-09-14T12:00:00.000Z',
          token: 'one-time-secret-code',
        });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);
    await screen.findByText('No household members.');

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'guest@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Access level'), {
      target: { value: 'guest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(await screen.findByText('one-time-secret-code')).toBeVisible();
    expect(request).toHaveBeenCalledWith(
      '/api/household/invitations',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'guest@example.com',
          role: 'guest',
          expiresInHours: 24,
        }),
        method: 'POST',
      }),
    );
  });

  it('saves explicit View and Listen grants without implicitly enabling Talk', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({
          invitations: [],
          members: [
            {
              email: 'viewer@example.com',
              expiresAt: null,
              grants: [],
              id: '5c265d4e-c0db-4e42-8852-1f6e6967421f',
              role: 'viewer',
              status: 'active',
            },
          ],
        });
      if (path.endsWith('/grants') && options?.method === 'PUT')
        return Promise.resolve(undefined);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="admin" />);
    await screen.findByText('viewer@example.com');

    fireEvent.click(screen.getByRole('checkbox', { name: 'View' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Listen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save camera access' }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/household/members/5c265d4e-c0db-4e42-8852-1f6e6967421f/grants',
        {
          body: JSON.stringify({
            grants: [
              {
                cameraId: camera.id,
                canListen: true,
                canTalk: false,
              },
            ],
          }),
          method: 'PUT',
        },
      ),
    );
  });
});
