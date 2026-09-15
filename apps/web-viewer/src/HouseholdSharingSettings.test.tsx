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
  Reflect.deleteProperty(navigator, 'clipboard');
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
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
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
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    const copyLinkButton = await screen.findByRole('button', {
      name: 'Copy invite link',
    });
    fireEvent.click(copyLinkButton);
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join?token=one-time-secret-code`,
    );
    fireEvent.click(screen.getByText('Or share the code manually'));
    expect(screen.getByText('one-time-secret-code')).toBeVisible();
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

  it('resends a pending invitation with a fresh code', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({
          invitations: [
            {
              expiresAt: '2026-09-14T12:00:00.000Z',
              id: 'a3f6c8f0-6e8a-4b64-9b3d-9c0b6a2a8f77',
              invitedEmail: 'guest@example.com',
              role: 'guest',
            },
          ],
          members: [],
        });
      if (
        path ===
          '/api/household/invitations/a3f6c8f0-6e8a-4b64-9b3d-9c0b6a2a8f77/resend' &&
        options?.method === 'POST'
      )
        return Promise.resolve({
          expiresAt: '2026-09-16T12:00:00.000Z',
          token: 'fresh-one-time-code',
        });
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);
    await screen.findByText('guest@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));

    expect(
      await screen.findByRole('button', { name: 'Copy invite link' }),
    ).toBeVisible();
    fireEvent.click(screen.getByText('Or share the code manually'));
    expect(screen.getByText('fresh-one-time-code')).toBeVisible();
    expect(
      screen.getByText(/New invitation created for guest@example\.com/),
    ).toBeVisible();
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
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="admin" />);
    await screen.findByText('viewer@example.com');

    fireEvent.click(screen.getByText('Camera access'));
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
                canFlip: false,
                canPause: false,
              },
            ],
          }),
          method: 'PUT',
        },
      ),
    );
  });

  it('sends the chosen default permissions for a viewer invite', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({ invitations: [], members: [] });
      if (path === '/api/household/invitations' && options?.method === 'POST')
        return Promise.resolve({
          expiresAt: '2026-09-14T12:00:00.000Z',
          token: 'viewer-invite-code',
        });
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);
    await screen.findByText('No household members.');

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'viewer@example.com' },
    });
    // Access level defaults to Viewer, so the permission picker is already
    // showing; Listen defaults on, flip this test's picks explicitly.
    fireEvent.click(screen.getByLabelText('Talk by default'));
    fireEvent.click(screen.getByLabelText('Flip camera by default'));
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/household/invitations',
        expect.objectContaining({
          body: JSON.stringify({
            email: 'viewer@example.com',
            role: 'viewer',
            defaultCanListen: true,
            defaultCanTalk: true,
            defaultCanFlip: true,
            defaultCanPause: false,
          }),
          method: 'POST',
        }),
      ),
    );
  });

  it('creates a guest link scoped to the checked cameras and permissions', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({ invitations: [], members: [] });
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
      if (path === '/api/household/guest-links' && options?.method === 'POST')
        return Promise.resolve({
          expiresAt: '2026-09-15T12:00:00.000Z',
          token: 'guest-link-secret',
        });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);
    await screen.findByText('No household members.');

    fireEvent.click(
      screen.getByRole('radio', { name: 'Share a guest link' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hallway phone' }));
    fireEvent.click(screen.getByLabelText('Let them listen'));
    fireEvent.click(screen.getByRole('button', { name: 'Create guest link' }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/household/guest-links',
        expect.objectContaining({
          body: JSON.stringify({
            cameraIds: [camera.id],
            canListen: true,
            canTalk: false,
            canFlip: false,
            canPause: false,
            expiresInHours: 24,
          }),
          method: 'POST',
        }),
      ),
    );

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy guest link' }),
    );
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/g/guest-link-secret`,
    );
  });

  it('shows only one of the invite/guest-link forms at a time, and keeps the join form collapsed', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({ invitations: [], members: [] });
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);
    await screen.findByText('No household members.');

    // The manual join-by-code form starts collapsed -- most people arrive
    // through a clicked invite link instead, which accepts automatically.
    expect(screen.queryByLabelText('Invitation code')).not.toBeVisible();
    fireEvent.click(screen.getByText('Have an invite code?'));
    expect(screen.getByLabelText('Invitation code')).toBeVisible();

    // Defaults to the invite form; the guest-link form's fields aren't
    // rendered until its tab is chosen, and vice versa.
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.queryByLabelText('Label (optional)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Share a guest link' }));
    expect(screen.getByLabelText('Label (optional)')).toBeVisible();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Invite by email' }));
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.queryByLabelText('Label (optional)')).not.toBeInTheDocument();
  });

  it('lists pending invitations and active guest links together', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({
          invitations: [
            {
              createdAt: '2026-09-13T12:00:00.000Z',
              expiresAt: '2026-09-15T12:00:00.000Z',
              id: 'a3f6c8f0-6e8a-4b64-9b3d-9c0b6a2a8f77',
              invitedEmail: 'viewer@example.com',
              role: 'viewer',
            },
          ],
          members: [],
        });
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({
          guestLinks: [
            {
              cameraIds: [camera.id],
              canFlip: false,
              canListen: true,
              canPause: false,
              canTalk: false,
              createdAt: '2026-09-14T12:00:00.000Z',
              expiresAt: '2026-09-16T12:00:00.000Z',
              id: 'guest-link-1',
              label: 'For grandma',
            },
          ],
        });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);

    expect(
      await screen.findByText('viewer@example.com'),
    ).toBeVisible();
    expect(screen.getByText(/Invitation · viewer · expires/)).toBeVisible();
    expect(screen.getByText('For grandma')).toBeVisible();
    expect(screen.getByText(/Guest link · 1 camera · expires/)).toBeVisible();
  });

  it('only offers permanent removal for an already-revoked member', async () => {
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/household/sharing')
        return Promise.resolve({
          invitations: [],
          members: [
            {
              email: 'gone@example.com',
              expiresAt: null,
              grants: [],
              id: 'b4b0f2d6-df3f-4c2a-9e9b-6e6b6f6e9a10',
              role: 'viewer',
              status: 'revoked',
            },
          ],
        });
      if (path.endsWith('/permanently') && options?.method === 'DELETE')
        return Promise.resolve(undefined);
      if (path === '/api/household/guest-links' && !options?.method)
        return Promise.resolve({ guestLinks: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    render(<HouseholdSharingSettings cameras={[camera]} role="owner" />);
    await screen.findByText('gone@example.com');

    expect(
      screen.queryByRole('button', { name: 'Remove access' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/household/members/b4b0f2d6-df3f-4c2a-9e9b-6e6b6f6e9a10/permanently',
        { method: 'DELETE' },
      ),
    );
  });
});
