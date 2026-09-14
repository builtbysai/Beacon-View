import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { NotificationSettings } from './NotificationSettings';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(cleanup);

describe('NotificationSettings', () => {
  beforeEach(() => {
    vi.mocked(request).mockResolvedValue({
      preferences: [
        {
          deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
          deviceName: 'Hallway camera',
          motionEnabled: false,
          offlineEnabled: false,
          quietHours: null,
        },
      ],
    });
  });

  it('loads disabled-by-default preferences without prompting for permission', async () => {
    const permission = vi.fn();
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { requestPermission: permission },
    });
    render(<NotificationSettings />);
    expect(await screen.findByText('Hallway camera')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Motion alerts' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Offline and recovery alerts' }),
    ).not.toBeChecked();
    expect(permission).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('marks a camera card dirty only after a preference changes', async () => {
    render(<NotificationSettings />);
    const motion = await screen.findByRole('checkbox', {
      name: 'Motion alerts',
    });
    const save = screen.getByRole('button', { name: 'Save changes' });

    expect(save).toBeDisabled();
    fireEvent.click(motion);
    expect(save).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});
