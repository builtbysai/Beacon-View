import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { NotificationSettings } from './NotificationSettings';
import { AutosaveIndicator, SettingsAutosaveProvider } from './SettingsAutosave';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(cleanup);

function renderNotificationSettings() {
  return render(
    <SettingsAutosaveProvider>
      <AutosaveIndicator />
      <NotificationSettings />
    </SettingsAutosaveProvider>,
  );
}

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
    renderNotificationSettings();
    expect(await screen.findByText('Hallway camera')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Motion alerts for Hallway camera' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('switch', {
        name: 'Offline and recovery alerts for Hallway camera',
      }),
    ).not.toBeChecked();
    expect(permission).not.toHaveBeenCalled();
  });

  it('autosaves a preference change immediately, with no Save button', async () => {
    vi.mocked(request).mockImplementation((path) => {
      if (path === '/api/notification-preferences') {
        return Promise.resolve({
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
      }
      if (
        path ===
        '/api/notification-preferences/8dc18bea-7a3b-48ad-b48a-48d00f975f54'
      ) {
        return Promise.resolve({
          preference: {
            deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
            deviceName: 'Hallway camera',
            motionEnabled: true,
            offlineEnabled: false,
            quietHours: null,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${String(path)}`));
    });
    renderNotificationSettings();
    const motion = await screen.findByRole('switch', {
      name: 'Motion alerts for Hallway camera',
    });
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();

    fireEvent.click(motion);
    expect(motion).toBeChecked();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/notification-preferences/8dc18bea-7a3b-48ad-b48a-48d00f975f54',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(await screen.findByText('Saved')).toBeVisible();
  });
});
